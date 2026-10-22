//! GPU-resident CA state, bounded dispatch batching and complete living-cell extraction.
use super::Gpu;
use anyhow::{ensure, Result};
use nova_automata::{Boundary, Grid};
use wgpu::util::DeviceExt;
pub struct GpuAutomaton {
    gpu: Gpu,
    states: [wgpu::Buffer; 2],
    groups: [wgpu::BindGroup; 2],
    pipeline: wgpu::ComputePipeline,
    compact: wgpu::ComputePipeline,
    counters: wgpu::Buffer,
    living: wgpu::Buffer,
    shape: [usize; 3],
    rules: nova_automata::Rules,
    boundary: Boundary,
    current: usize,
    pub tick: u64,
    dispatch: [u32; 2],
    cells: usize,
}
impl GpuAutomaton {
    pub fn new(grid: &Grid) -> Result<Self> {
        grid.validate()?;
        let gpu = Gpu::new()?;
        let n = grid.cells.len();
        let limit = gpu.device.limits();
        ensure!(
            n * 4 <= limit.max_storage_buffer_binding_size as usize
                && (n as u64) * 16 <= 512 * 1024 * 1024,
            "CA GPU memory budget exceeded"
        );
        let max = limit.max_compute_workgroups_per_dimension;
        let gx = (n.div_ceil(64) as u32).min(max);
        let gy = (n.div_ceil(64) as u32).div_ceil(gx);
        ensure!(gy <= max, "CA dispatch exceeds adapter limits");
        let data: Vec<u32> = grid.cells.iter().map(|&x| x as u32).collect();
        let state = |data: &[u32]| {
            gpu.device
                .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("native CA state"),
                    contents: bytemuck::cast_slice(data),
                    usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
                })
        };
        let states = [state(&data), state(&vec![0; n])];
        let config: [[u32; 4]; 3] = [
            [
                grid.shape[0] as u32,
                grid.shape[1] as u32,
                grid.shape[2] as u32,
                n as u32,
            ],
            [
                grid.rules.birth,
                grid.rules.survival,
                grid.rules.radius,
                (grid.boundary == Boundary::Periodic) as u32,
            ],
            [grid.rules.dimensions, gx * 64, 0, 0],
        ];
        let params = gpu
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: None,
                contents: bytemuck::cast_slice(&config),
                usage: wgpu::BufferUsages::UNIFORM,
            });
        let counters = gpu.device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: 8,
            usage: wgpu::BufferUsages::STORAGE
                | wgpu::BufferUsages::COPY_DST
                | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });
        let living = gpu.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("complete live list, no truncation"),
            size: (n * 4) as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });
        let entries: Vec<_> = (0..5)
            .map(|i| wgpu::BindGroupLayoutEntry {
                binding: i,
                visibility: wgpu::ShaderStages::COMPUTE,
                ty: wgpu::BindingType::Buffer {
                    ty: if i == 2 {
                        wgpu::BufferBindingType::Uniform
                    } else {
                        wgpu::BufferBindingType::Storage { read_only: i == 0 }
                    },
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            })
            .collect();
        let layout = gpu
            .device
            .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: None,
                entries: &entries,
            });
        let pl = gpu
            .device
            .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: None,
                bind_group_layouts: &[&layout],
                push_constant_ranges: &[],
            });
        let shader = gpu
            .device
            .create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("Conway native integer"),
                source: wgpu::ShaderSource::Wgsl(include_str!("../shaders/automata.wgsl").into()),
            });
        let create = |entry_point| {
            gpu.device
                .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                    label: None,
                    layout: Some(&pl),
                    module: &shader,
                    entry_point,
                })
        };
        let pipeline = create("evolve");
        let compact = create("compact");
        let groups = std::array::from_fn(|i| {
            let buffers = [&states[i], &states[1 - i], &params, &counters, &living];
            let entries: Vec<_> = buffers
                .iter()
                .enumerate()
                .map(|(binding, b)| wgpu::BindGroupEntry {
                    binding: binding as u32,
                    resource: b.as_entire_binding(),
                })
                .collect();
            gpu.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: None,
                layout: &layout,
                entries: &entries,
            })
        });
        Ok(Self {
            gpu,
            states,
            groups,
            pipeline,
            compact,
            counters,
            living,
            shape: grid.shape,
            rules: grid.rules,
            boundary: grid.boundary,
            current: 0,
            tick: grid.tick,
            dispatch: [gx, gy],
            cells: n,
        })
    }
    pub fn adapter(&self) -> &str {
        &self.gpu.adapter
    }
    pub fn step(&mut self, ticks: usize) -> Result<()> {
        ensure!(ticks <= 1_000_000, "GPU step budget exceeded");
        let mut remaining = ticks;
        while remaining > 0 {
            let batch = remaining.min(128);
            let mut encoder = self.gpu.device.create_command_encoder(&Default::default());
            for _ in 0..batch {
                encoder.clear_buffer(&self.counters, 0, None);
                {
                    let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                        label: None,
                        timestamp_writes: None,
                    });
                    pass.set_pipeline(&self.pipeline);
                    pass.set_bind_group(0, &self.groups[self.current], &[]);
                    pass.dispatch_workgroups(self.dispatch[0], self.dispatch[1], 1);
                }
                self.current = 1 - self.current;
                self.tick += 1;
            }
            self.gpu.queue.submit(Some(encoder.finish()));
            self.gpu.device.poll(wgpu::Maintain::Wait);
            remaining -= batch;
        }
        Ok(())
    }
    fn read_words(&self, source: &wgpu::Buffer, words: usize) -> Result<Vec<u32>> {
        if words == 0 {
            return Ok(vec![]);
        }
        let staging = self.gpu.device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: (words * 4) as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut encoder = self.gpu.device.create_command_encoder(&Default::default());
        encoder.copy_buffer_to_buffer(source, 0, &staging, 0, (words * 4) as u64);
        self.gpu.queue.submit(Some(encoder.finish()));
        let slice = staging.slice(..);
        let (tx, rx) = std::sync::mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |x| {
            let _ = tx.send(x);
        });
        self.gpu.device.poll(wgpu::Maintain::Wait);
        rx.recv()??;
        let data = slice
            .get_mapped_range()
            .chunks_exact(4)
            .map(|x| u32::from_le_bytes(x.try_into().unwrap()))
            .collect();
        staging.unmap();
        Ok(data)
    }
    pub fn read(&self) -> Result<Grid> {
        let mut grid = Grid::new(self.shape, self.rules, self.boundary)?;
        grid.cells = self
            .read_words(&self.states[self.current], self.cells)?
            .into_iter()
            .map(|x| x as u8)
            .collect();
        grid.tick = self.tick;
        grid.validate()?;
        Ok(grid)
    }
    pub fn living_cells(&self) -> Result<Vec<[u32; 3]>> {
        let mut encoder = self.gpu.device.create_command_encoder(&Default::default());
        encoder.clear_buffer(&self.counters, 0, None);
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: None,
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.compact);
            pass.set_bind_group(0, &self.groups[self.current], &[]);
            pass.dispatch_workgroups(self.dispatch[0], self.dispatch[1], 1);
        }
        self.gpu.queue.submit(Some(encoder.finish()));
        let count = self.read_words(&self.counters, 2)?[0] as usize;
        ensure!(count <= self.cells, "invalid live-cell count");
        Ok(self
            .read_words(&self.living, count)?
            .into_iter()
            .map(|i| {
                [
                    i % self.shape[0] as u32,
                    (i / self.shape[0] as u32) % self.shape[1] as u32,
                    i / (self.shape[0] * self.shape[1]) as u32,
                ]
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nova_automata::{Boundary, Rules};

    fn compare_backend(shape: [usize; 3], dims: u32, boundary: Boundary) {
        let rule = if dims == 3 { "B5/S4-5" } else { "B3/S23" };
        let mut cpu = Grid::new(shape, Rules::parse(rule, dims, 1).unwrap(), boundary).unwrap();
        cpu.randomize(42, 0.2).unwrap();
        let mut gpu = match GpuAutomaton::new(&cpu) {
            Ok(gpu) => gpu,
            Err(err) if err.to_string().contains("no native compute adapter") => {
                eprintln!("Skipping GPU numerical comparison: no compatible compute adapter");
                return;
            }
            Err(err) => panic!("Failed to initialize GPU automaton: {err}"),
        };
        for tick in 1..=4 {
            cpu.step().unwrap();
            gpu.step(1).unwrap();
            let observed = gpu.read().unwrap();
            assert_eq!(observed.tick, cpu.tick);
            assert_eq!(
                observed.cells, cpu.cells,
                "CPU/GPU cellular automata mismatch at tick {tick}, shape={shape:?}, boundary={boundary:?}"
            );
        }
    }

    #[test]
    fn gpu_periodic_wrapping_matches_cpu_on_non_power_of_two_grids() {
        // Previously diverged only on periodic faces (e.g. 24^3) under Vulkan/llvmpipe.
        compare_backend([24, 24, 24], 3, Boundary::Periodic);
        compare_backend([20, 24, 16], 3, Boundary::Periodic);
        compare_backend([96, 72, 1], 2, Boundary::Periodic);
    }

    #[test]
    fn gpu_solid_boundaries_match_cpu() {
        compare_backend([24, 24, 24], 3, Boundary::Dead);
        compare_backend([96, 72, 1], 2, Boundary::Dead);
    }
}
