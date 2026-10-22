//! Reusable GPU buffers for native fusion. CPU spatial indexing, no neighbor truncation.
use super::Gpu;
use anyhow::{ensure, Result};
use nova_core::Particle;
use nova_physics::Universe;
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Params {
    counts: [u32; 4],
    domain: [f32; 4],
    dynamics: [f32; 4],
    limits: [f32; 4],
    step: [u32; 4],
    cell: [f32; 4],
    feedback: [f32; 4],
    brush: [f32; 4],
    brush_radius: [f32; 4],
    matrix: [[f32; 4]; 16],
    inner: [[f32; 4]; 16],
    outer: [[f32; 4]; 16],
    masses: [[f32; 4]; 2],
}
pub(crate) struct Buffers {
    capacity: usize,
    neighbors_capacity: usize,
    src: wgpu::Buffer,
    dst: wgpu::Buffer,
    ranges: wgpu::Buffer,
    neighbors: wgpu::Buffer,
    params: wgpu::Buffer,
    readback: wgpu::Buffer,
    bind: wgpu::BindGroup,
}
impl Gpu {
    pub(crate) fn step_fusion(&self, u: &mut Universe) -> Result<()> {
        let model = u
            .fusion
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("missing fusion model"))?;
        model.settings.dt = u.config.dt;
        model.settings.validate()?;
        u.particles.validate()?;
        ensure!(
            u.matrix
                .iter()
                .flatten()
                .all(|x| x.is_finite() && x.abs() <= 1.),
            "invalid fusion matrix"
        );
        let n = u.particles.len();
        ensure!(
            n > 0 && model.previous_neighbors.len() == n,
            "invalid fusion membership"
        );
        let brush = model.take_brush();
        let s = &model.settings;
        let grid = nova_fusion::grid::Grid::build(&u.particles, s)?;
        let max = self.device.limits().max_storage_buffer_binding_size as usize;
        ensure!(
            n * 64 <= max
                && n.div_ceil(64)
                    <= self.device.limits().max_compute_workgroups_per_dimension as usize,
            "GPU particle limit exceeded"
        );
        let mut ranges = Vec::with_capacity(n);
        let mut neighbors = Vec::new();
        for p in &u.particles.positions {
            let start = neighbors.len();
            for j in grid.candidates(p.0) {
                ensure!(
                    (neighbors.len() + 1) * 4 <= max,
                    "GPU candidate buffer budget exceeded (no truncation)"
                );
                neighbors.push(j as u32);
            }
            ranges.push([start as u32, neighbors.len() as u32]);
        }
        let mut input: Vec<_> = (0..n).map(|i| u.particles.get(i)).collect();
        ensure!(
            input.iter().all(|p| (p.phenotype[0] as usize) < s.species),
            "particle type exceeds selected species count"
        );
        for (i, p) in input.iter_mut().enumerate() {
            p.vel_mass[3] = s.masses[p.phenotype[0] as usize];
            p.phenotype[2] = model.previous_neighbors[i];
            p.genome_tape[..4].copy_from_slice(&(u.particles.ids[i] as u32).to_le_bytes());
        }
        fn packed(m: &[[f32; 8]; 8]) -> [[f32; 4]; 16] {
            std::array::from_fn(|i| std::array::from_fn(|j| m[(i * 4 + j) / 8][(i * 4 + j) % 8]))
        }
        let p = Params {
            counts: [
                n as u32,
                s.family as u32,
                s.dimensions as u32,
                s.boundary as u32,
            ],
            domain: [s.half_extent[0], s.half_extent[1], s.half_extent[2], s.dt],
            dynamics: [s.force, s.retention, s.repel_strength, s.velocity_coupling],
            limits: [s.max_speed, s.temperature, s.density_limit, 0.],
            step: [u.tick as u32, 0, 0, 0],
            cell: [
                s.cell.repulsion,
                s.cell.attraction,
                s.cell.falloff,
                s.cell.balance,
            ],
            feedback: [s.cell.expected_neighbors, 0., 0., 0.],
            brush: brush
                .map(|(p, _, f)| [p[0], p[1], p[2], f])
                .unwrap_or([0.; 4]),
            brush_radius: brush.map(|(_, r, _)| [r, 0., 0., 0.]).unwrap_or([0.; 4]),
            matrix: packed(&model.varied_matrix(&u.matrix, u.tick)),
            inner: packed(&s.min_radius),
            outer: packed(&s.max_radius),
            masses: std::array::from_fn(|i| std::array::from_fn(|j| s.masses[i * 4 + j])),
        };
        let mut cache = self
            .fusion_buffers
            .lock()
            .map_err(|_| anyhow::anyhow!("GPU buffer cache poisoned"))?;
        let rebuild = cache
            .as_ref()
            .is_none_or(|b| b.capacity < n || b.neighbors_capacity < neighbors.len());
        if rebuild {
            use wgpu::BufferUsages as U;
            let capacity = n.next_power_of_two().min(max / 64).max(n);
            let neighbor_capacity = neighbors
                .len()
                .next_power_of_two()
                .min(max / 4)
                .max(neighbors.len());
            let make = |size: usize, usage| {
                self.device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("NOVA fusion reusable"),
                    size: size.max(4) as u64,
                    usage,
                    mapped_at_creation: false,
                })
            };
            let src = make(capacity * 64, U::STORAGE | U::COPY_DST);
            let dst = make(capacity * 64, U::STORAGE | U::COPY_SRC);
            let ranges = make(capacity * 8, U::STORAGE | U::COPY_DST);
            let neighbors = make(neighbor_capacity * 4, U::STORAGE | U::COPY_DST);
            let params = make(std::mem::size_of::<Params>(), U::UNIFORM | U::COPY_DST);
            let readback = make(capacity * 64, U::MAP_READ | U::COPY_DST);
            let buffers = [&src, &dst, &ranges, &neighbors, &params];
            let entries: Vec<_> = buffers
                .iter()
                .enumerate()
                .map(|(i, b)| wgpu::BindGroupEntry {
                    binding: i as u32,
                    resource: b.as_entire_binding(),
                })
                .collect();
            let bind = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: None,
                layout: &self.fusion_pipeline.get_bind_group_layout(0),
                entries: &entries,
            });
            *cache = Some(Buffers {
                capacity,
                neighbors_capacity: neighbor_capacity,
                src,
                dst,
                ranges,
                neighbors,
                params,
                readback,
                bind,
            });
        }
        let b = cache.as_ref().unwrap();
        self.queue
            .write_buffer(&b.src, 0, bytemuck::cast_slice(&input));
        self.queue
            .write_buffer(&b.ranges, 0, bytemuck::cast_slice(&ranges));
        self.queue
            .write_buffer(&b.neighbors, 0, bytemuck::cast_slice(&neighbors));
        self.queue
            .write_buffer(&b.params, 0, bytemuck::bytes_of(&p));
        let mut encoder = self.device.create_command_encoder(&Default::default());
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("native fusion"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.fusion_pipeline);
            pass.set_bind_group(0, &b.bind, &[]);
            pass.dispatch_workgroups(n.div_ceil(64) as u32, 1, 1);
        }
        encoder.copy_buffer_to_buffer(&b.dst, 0, &b.readback, 0, (n * 64) as u64);
        self.queue.submit(Some(encoder.finish()));
        let slice = b.readback.slice(..(n * 64) as u64);
        let (tx, rx) = std::sync::mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = tx.send(result);
        });
        self.device.poll(wgpu::Maintain::Wait);
        rx.recv()??;
        {
            let mapped = slice.get_mapped_range();
            for (i, bytes) in mapped.chunks_exact(64).enumerate() {
                let p: Particle = bytemuck::pod_read_unaligned(bytes);
                u.particles.positions[i].0 = p.pos_rad;
                u.particles.velocities[i].0 = p.vel_mass;
                model.previous_neighbors[i] = p.phenotype[2];
                model.stats.candidates += (ranges[i][1] - ranges[i][0] - 1) as u64;
                model.stats.interacting_pairs += p.phenotype[2] as u64;
                model.stats.speed_clamps += (p.phenotype[1] & 1) as u64;
                model.stats.density_scaled += ((p.phenotype[1] >> 1) & 1) as u64;
            }
        }
        b.readback.unmap();
        u.particles.validate()?;
        u.tick += 1;
        Ok(())
    }
}
