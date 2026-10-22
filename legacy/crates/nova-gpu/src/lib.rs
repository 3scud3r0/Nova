pub mod automata;
mod fusion;
// Exact CPU cell candidates + GPU force/integration. Explicit readback per tick.
// No hidden all-pairs fallback and no silently truncated neighbor lists.
use anyhow::{ensure, Result};
use nova_core::Particle;
use nova_physics::Universe;
use nova_spatial::CellList;
use wgpu::util::DeviceExt;
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Params {
    counts: [u32; 4],
    law: [f32; 4],
    extra: [f32; 4],
    matrix: [[f32; 4]; 16],
}
pub struct Gpu {
    device: wgpu::Device,
    queue: wgpu::Queue,
    pipeline: wgpu::ComputePipeline,
    fusion_pipeline: wgpu::ComputePipeline,
    fusion_buffers: std::sync::Mutex<Option<fusion::Buffers>>,
    pub adapter: String,
}
impl Gpu {
    pub fn new() -> Result<Self> {
        pollster::block_on(Self::create())
    }
    async fn create() -> Result<Self> {
        let instance = wgpu::Instance::default();
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                force_fallback_adapter: false,
                compatible_surface: None,
            })
            .await
            .ok_or_else(|| anyhow::anyhow!("no native compute adapter"))?;
        let info = adapter.get_info();
        let limits = adapter.limits();
        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("NOVA compute"),
                    required_features: wgpu::Features::empty(),
                    required_limits: limits,
                },
                None,
            )
            .await?;
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Particle Life"),
            source: wgpu::ShaderSource::Wgsl(include_str!("../shaders/particle_life.wgsl").into()),
        });
        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("Particle Life"),
            layout: None,
            module: &shader,
            entry_point: "advance",
        });
        let fusion_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("NOVA upstream fusion"),
            source: wgpu::ShaderSource::Wgsl(include_str!("../shaders/fusion.wgsl").into()),
        });
        let fusion_pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: None,
            layout: None,
            module: &fusion_shader,
            entry_point: "advance",
        });
        Ok(Self {
            fusion_pipeline,
            fusion_buffers: std::sync::Mutex::new(None),
            device,
            queue,
            pipeline,
            adapter: info.name,
        })
    }
    pub fn step(&self, u: &mut Universe) -> Result<()> {
        ensure!(
            u.neural.is_none(),
            "neural organisms currently require CPU stepping"
        );
        if u.fusion.is_some() {
            return self.step_fusion(u);
        }
        u.config.validate()?;
        ensure!(
            !u.config.pvm && !u.config.crossover && !u.config.mpm,
            "GPU backend supports canonical Particle Life; use CPU for PVM/crossover/MPM"
        );
        ensure!(
            u.matrix
                .iter()
                .flatten()
                .all(|x| x.is_finite() && x.abs() <= 1.),
            "invalid affinity matrix"
        );
        let cells = CellList::rebuild(&mut u.particles, u.config.cutoff)?;
        let n = u.particles.len();
        ensure!(
            n > 0 && n <= u32::MAX as usize,
            "invalid GPU particle count"
        );
        let max = self.device.limits().max_storage_buffer_binding_size as usize;
        ensure!(
            n * 64 <= max
                && n * 8 <= max
                && n.div_ceil(64)
                    <= self.device.limits().max_compute_workgroups_per_dimension as usize,
            "GPU particle budget exceeds adapter limits"
        );
        let mut ranges = Vec::with_capacity(n);
        let mut neighbors = Vec::<u32>::new();
        for p in &u.particles.positions {
            let begin = neighbors.len();
            for j in cells.candidates(p.0) {
                ensure!(
                    (neighbors.len() + 1) * 4 <= max,
                    "GPU neighbor buffer exhausted; reduce density/particles (no truncation)"
                );
                neighbors.push(j as u32);
            }
            ranges.push([begin as u32, neighbors.len() as u32]);
        }
        let input: Vec<_> = (0..n).map(|i| u.particles.get(i)).collect();
        let make = |label, data: &[u8], usage| {
            self.device
                .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some(label),
                    contents: data,
                    usage,
                })
        };
        let src = make(
            "particles",
            bytemuck::cast_slice(&input),
            wgpu::BufferUsages::STORAGE,
        );
        let dst = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("output"),
            size: (n * 64) as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });
        let ranges = make(
            "ranges",
            bytemuck::cast_slice(&ranges),
            wgpu::BufferUsages::STORAGE,
        );
        let neighbors = make(
            "neighbors",
            bytemuck::cast_slice(&neighbors),
            wgpu::BufferUsages::STORAGE,
        );
        let c = &u.config;
        let mut matrix = [[0.; 4]; 16];
        for i in 0..64 {
            matrix[i / 4][i % 4] = u.matrix[i / 8][i % 8];
        }
        let params = Params {
            counts: [n as u32, 0, 0, 0],
            law: [c.dt, c.cutoff, c.beta, c.strength],
            extra: [c.damping, c.curl, u.tick as f32 * c.dt, 0.],
            matrix,
        };
        let uniform = make(
            "config",
            bytemuck::bytes_of(&params),
            wgpu::BufferUsages::UNIFORM,
        );
        let buffers = [&src, &dst, &ranges, &neighbors, &uniform];
        let entries: Vec<_> = buffers
            .iter()
            .enumerate()
            .map(|(i, b)| wgpu::BindGroupEntry {
                binding: i as u32,
                resource: b.as_entire_binding(),
            })
            .collect();
        let group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &self.pipeline.get_bind_group_layout(0),
            entries: &entries,
        });
        let readback = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: (n * 64) as u64,
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let mut encoder = self.device.create_command_encoder(&Default::default());
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: None,
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &group, &[]);
            pass.dispatch_workgroups(n.div_ceil(64) as u32, 1, 1);
        }
        encoder.copy_buffer_to_buffer(&dst, 0, &readback, 0, (n * 64) as u64);
        self.queue.submit(Some(encoder.finish()));
        let slice = readback.slice(..);
        let (tx, rx) = std::sync::mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |r| {
            let _ = tx.send(r);
        });
        self.device.poll(wgpu::Maintain::Wait);
        rx.recv()??;
        {
            let mapped = slice.get_mapped_range();
            for (i, bytes) in mapped.chunks_exact(64).enumerate() {
                let p: Particle = bytemuck::pod_read_unaligned(bytes);
                u.particles.positions[i].0 = p.pos_rad;
                u.particles.velocities[i].0 = p.vel_mass;
            }
        }
        readback.unmap();
        u.particles.validate()?;
        u.tick += 1;
        Ok(())
    }
}
