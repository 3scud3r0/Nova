//! Optional wgpu 0.19 compute backend. Buffers stay resident until snapshot.
use crate::fields::{snapshot, validate, Cell};
use pyo3::{exceptions::PyRuntimeError, prelude::*};
use wgpu::util::DeviceExt;
#[pyclass]
pub struct GpuField {
    device: wgpu::Device,
    queue: wgpu::Queue,
    pipeline: wgpu::ComputePipeline,
    buffers: [wgpu::Buffer; 2],
    layout: wgpu::BindGroupLayout,
    n: usize,
    current: usize,
    tick: u64,
    adapter: String,
}
#[pymethods]
impl GpuField {
    #[new]
    #[pyo3(signature=(n,chemistry,max_bytes=536870912))]
    fn new(n: usize, chemistry: Vec<f32>, max_bytes: usize) -> PyResult<Self> {
        if !(4..=256).contains(&n)
            || n.checked_pow(3)
                .and_then(|v| v.checked_mul(144))
                .is_none_or(|v| v > max_bytes)
            || chemistry.len() != 2 * n * n * n
            || chemistry
                .iter()
                .any(|v| !v.is_finite() || *v < 0. || *v > 1.)
        {
            return Err(PyRuntimeError::new_err(
                "GPU memory/dimension/state budget exceeded",
            ));
        }
        pollster::block_on(async {
            let instance = wgpu::Instance::default();
            let adapter = instance
                .request_adapter(&wgpu::RequestAdapterOptions::default())
                .await
                .ok_or_else(|| PyRuntimeError::new_err("no WebGPU adapter"))?;
            let info = format!("{:?}", adapter.get_info());
            let bytes = (n * n * n * 48) as u64;
            let limits = adapter.limits();
            if bytes > limits.max_storage_buffer_binding_size as u64
                || bytes > limits.max_buffer_size
            {
                return Err(PyRuntimeError::new_err(
                    "adapter storage/dispatch limit exceeded",
                ));
            }
            let (device, queue) = adapter
                .request_device(
                    &wgpu::DeviceDescriptor {
                        label: Some("nova-fields"),
                        required_features: wgpu::Features::empty(),
                        required_limits: limits,
                    },
                    None,
                )
                .await
                .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
            let cells: Vec<Cell> = chemistry
                .chunks_exact(2)
                .map(|x| Cell {
                    chem: [x[0], x[1], 0., 0.],
                    ..Cell::default()
                })
                .collect();
            let buffers = [0, 1].map(|_| {
                device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("nova-volume"),
                    contents: bytemuck::cast_slice(&cells),
                    usage: wgpu::BufferUsages::STORAGE
                        | wgpu::BufferUsages::COPY_SRC
                        | wgpu::BufferUsages::COPY_DST,
                })
            });
            let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: None,
                entries: &[
                    entry(0, true),
                    entry(1, false),
                    wgpu::BindGroupLayoutEntry {
                        binding: 2,
                        visibility: wgpu::ShaderStages::COMPUTE,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        count: None,
                    },
                ],
            });
            let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("nova-fields"),
                source: wgpu::ShaderSource::Wgsl(
                    include_str!("compute_shaders/fields.wgsl").into(),
                ),
            });
            let pl = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: None,
                bind_group_layouts: &[&layout],
                push_constant_ranges: &[],
            });
            let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: None,
                layout: Some(&pl),
                module: &shader,
                entry_point: "main",
            });
            Ok(Self {
                device,
                queue,
                pipeline,
                buffers,
                layout,
                n,
                current: 0,
                tick: 0,
                adapter: info,
            })
        })
    }
    fn inject(&mut self, index: usize, velocity: [f32; 3], signal: f32) -> PyResult<()> {
        if index >= self.n * self.n * self.n
            || velocity.iter().any(|v| !v.is_finite() || v.abs() > 10.)
            || !signal.is_finite()
            || signal.abs() > 1.
        {
            return Err(PyRuntimeError::new_err("invalid GPU impulse"));
        }
        self.queue.write_buffer(
            &self.buffers[self.current],
            (index * 48 + 12) as u64,
            bytemuck::cast_slice(&[signal]),
        );
        self.queue.write_buffer(
            &self.buffers[self.current],
            (index * 48 + 16) as u64,
            bytemuck::cast_slice(&velocity),
        );
        Ok(())
    }
    #[getter]
    fn adapter(&self) -> String {
        self.adapter.clone()
    }
    #[pyo3(signature=(steps=1,dt=0.1,feed=0.035,kill=0.065,du=0.16,dv=0.08,viscosity=0.02,speed=1.,damping=0.02,fluid=false,pressure_iterations=32))]
    #[allow(clippy::too_many_arguments)]
    fn step(
        &mut self,
        py: Python<'_>,
        steps: usize,
        dt: f32,
        feed: f32,
        kill: f32,
        du: f32,
        dv: f32,
        viscosity: f32,
        speed: f32,
        damping: f32,
        fluid: bool,
        pressure_iterations: usize,
    ) -> PyResult<()> {
        validate(
            steps,
            dt,
            &[feed, kill, du, dv, viscosity, speed, damping],
            pressure_iterations,
        )?;
        py.allow_threads(|| {
            let mut encoder = self
                .device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });
            for _ in 0..steps {
                let mut stages = vec![0];
                if fluid {
                    stages.extend([1, 2]);
                    stages.extend(std::iter::repeat(3).take(pressure_iterations));
                    stages.push(4);
                }
                for stage in stages {
                    let groups = (self.n * self.n * self.n).div_ceil(64);
                    let columns = groups
                        .min(self.device.limits().max_compute_workgroups_per_dimension as usize);
                    let mut params = vec![self.n as u32, stage];
                    params.extend(
                        [dt, feed, kill, du, dv, viscosity, speed, damping].map(f32::to_bits),
                    );
                    params.extend([(columns * 64) as u32, 0]);
                    let uniform =
                        self.device
                            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                                label: None,
                                contents: bytemuck::cast_slice(&params),
                                usage: wgpu::BufferUsages::UNIFORM,
                            });
                    let group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                        label: None,
                        layout: &self.layout,
                        entries: &[
                            wgpu::BindGroupEntry {
                                binding: 0,
                                resource: self.buffers[self.current].as_entire_binding(),
                            },
                            wgpu::BindGroupEntry {
                                binding: 1,
                                resource: self.buffers[1 - self.current].as_entire_binding(),
                            },
                            wgpu::BindGroupEntry {
                                binding: 2,
                                resource: uniform.as_entire_binding(),
                            },
                        ],
                    });
                    {
                        let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                            label: None,
                            timestamp_writes: None,
                        });
                        pass.set_pipeline(&self.pipeline);
                        pass.set_bind_group(0, &group, &[]);
                        pass.dispatch_workgroups(
                            columns as u32,
                            groups.div_ceil(columns) as u32,
                            1,
                        );
                    }
                    self.current = 1 - self.current;
                }
                self.tick += 1;
            }
            self.queue.submit(Some(encoder.finish()));
        });
        Ok(())
    }
    fn snapshot(&self, py: Python<'_>) -> PyResult<(Vec<f32>, Vec<f32>, Vec<f32>, u64)> {
        py.allow_threads(|| {
            let size = (self.n * self.n * self.n * 48) as u64;
            let read = self.device.create_buffer(&wgpu::BufferDescriptor {
                label: None,
                size,
                usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            let mut encoder = self
                .device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });
            encoder.copy_buffer_to_buffer(&self.buffers[self.current], 0, &read, 0, size);
            self.queue.submit(Some(encoder.finish()));
            let slice = read.slice(..);
            let (tx, rx) = std::sync::mpsc::sync_channel(1);
            slice.map_async(wgpu::MapMode::Read, move |r| {
                let _ = tx.send(r);
            });
            self.device.poll(wgpu::Maintain::Wait);
            rx.recv_timeout(std::time::Duration::from_secs(30))
                .map_err(|e| PyRuntimeError::new_err(e.to_string()))?
                .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
            let bytes = slice.get_mapped_range();
            let data = snapshot(bytemuck::cast_slice(&bytes), self.tick);
            drop(bytes);
            read.unmap();
            Ok(data)
        })
    }
}
fn entry(binding: u32, read_only: bool) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::COMPUTE,
        ty: wgpu::BindingType::Buffer {
            ty: wgpu::BufferBindingType::Storage { read_only },
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    }
}
