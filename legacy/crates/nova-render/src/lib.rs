mod controls;
pub mod substrate;
// Native winit/wgpu fluid surface renderer; all shader assets embedded.
use anyhow::{ensure, Result};
use nova_physics::Universe;
use nova_storage::Lake;
use std::{
    cell::RefCell,
    path::PathBuf,
    rc::Rc,
    sync::Arc,
    time::{Duration, Instant},
};
use wgpu::util::DeviceExt;
use winit::{
    event::{ElementState, Event, MouseScrollDelta, WindowEvent},
    event_loop::{ControlFlow, EventLoop},
    keyboard::{KeyCode, PhysicalKey},
    window::{Window, WindowBuilder},
};
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct RenderParticle {
    p: [f32; 4],
    v: [f32; 4],
    previous: [f32; 4],
}
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Filter {
    axis: [i32; 4],
    values: [f32; 4],
}
struct Targets {
    depth: Vec<wgpu::TextureView>,
    pigment: Vec<wgpu::TextureView>,
    hardware: wgpu::TextureView,
    hdr: wgpu::TextureView,
    filters: Vec<wgpu::BindGroup>,
    lighting: wgpu::BindGroup,
    post: wgpu::BindGroup,
}
struct Renderer {
    ui: controls::Panel,
    window: Arc<Window>,
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    particles: wgpu::Buffer,
    camera: wgpu::Buffer,
    post_config: wgpu::Buffer,
    _palette: wgpu::Buffer,
    sampler: wgpu::Sampler,
    filter_configs: [wgpu::Buffer; 2],
    depth_pipeline: wgpu::RenderPipeline,
    pigment_pipeline: wgpu::RenderPipeline,
    filter_pipeline: wgpu::ComputePipeline,
    light_pipeline: wgpu::RenderPipeline,
    post_pipeline: wgpu::RenderPipeline,
    splats: wgpu::BindGroup,
    targets: Option<Targets>,
    yaw: f32,
    pitch: f32,
    distance: f32,
    scene_scale: f32,
    capacity: usize,
}
fn buffer(device: &wgpu::Device, data: &[u8], usage: wgpu::BufferUsages) -> wgpu::Buffer {
    device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: None,
        contents: data,
        usage,
    })
}
fn entry(
    binding: u32,
    ty: wgpu::BindingType,
    visibility: wgpu::ShaderStages,
) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility,
        ty,
        count: None,
    }
}
fn uniform() -> wgpu::BindingType {
    wgpu::BindingType::Buffer {
        ty: wgpu::BufferBindingType::Uniform,
        has_dynamic_offset: false,
        min_binding_size: None,
    }
}
fn texture(filterable: bool) -> wgpu::BindingType {
    wgpu::BindingType::Texture {
        sample_type: wgpu::TextureSampleType::Float { filterable },
        view_dimension: wgpu::TextureViewDimension::D2,
        multisampled: false,
    }
}
fn layout(device: &wgpu::Device, entries: &[wgpu::BindGroupLayoutEntry]) -> wgpu::BindGroupLayout {
    device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: None,
        entries,
    })
}
fn group(
    device: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
    resources: &[wgpu::BindingResource<'_>],
) -> wgpu::BindGroup {
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: None,
        layout,
        entries: &resources
            .iter()
            .enumerate()
            .map(|(i, r)| wgpu::BindGroupEntry {
                binding: i as u32,
                resource: r.clone(),
            })
            .collect::<Vec<_>>(),
    })
}
fn render_pipeline(
    device: &wgpu::Device,
    shader: &wgpu::ShaderModule,
    layout: &wgpu::BindGroupLayout,
    vertex: &str,
    fragment: &str,
    format: wgpu::TextureFormat,
    blend: Option<wgpu::BlendState>,
    depth: bool,
) -> wgpu::RenderPipeline {
    let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: None,
        bind_group_layouts: &[layout],
        push_constant_ranges: &[],
    });
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: None,
        layout: Some(&pipeline_layout),
        vertex: wgpu::VertexState {
            module: shader,
            entry_point: vertex,
            buffers: &[],
        },
        fragment: Some(wgpu::FragmentState {
            module: shader,
            entry_point: fragment,
            targets: &[Some(wgpu::ColorTargetState {
                format,
                blend,
                write_mask: wgpu::ColorWrites::ALL,
            })],
        }),
        primitive: wgpu::PrimitiveState::default(),
        depth_stencil: depth.then_some(wgpu::DepthStencilState {
            format: wgpu::TextureFormat::Depth32Float,
            depth_write_enabled: true,
            depth_compare: wgpu::CompareFunction::Less,
            stencil: Default::default(),
            bias: Default::default(),
        }),
        multisample: Default::default(),
        multiview: None,
    })
}
impl Renderer {
    async fn new(window: Arc<Window>, capacity: usize) -> Result<Self> {
        let instance = wgpu::Instance::default();
        let surface = instance.create_surface(window.clone())?;
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
            })
            .await
            .ok_or_else(|| anyhow::anyhow!("no graphics adapter for native window"))?;
        ensure!(
            capacity * std::mem::size_of::<RenderParticle>()
                <= adapter.limits().max_storage_buffer_binding_size as usize,
            "particle render buffer exceeds adapter capacity"
        );
        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("NOVA liquid"),
                    required_features: wgpu::Features::empty(),
                    required_limits: adapter.limits(),
                },
                None,
            )
            .await?;
        let size = window.inner_size();
        let caps = surface.get_capabilities(&adapter);
        let format = caps
            .formats
            .iter()
            .copied()
            .find(|f| !f.is_srgb())
            .unwrap_or(caps.formats[0]);
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width: size.width.max(1),
            height: size.height.max(1),
            present_mode: wgpu::PresentMode::Fifo,
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        };
        surface.configure(&device, &config);
        let camera = buffer(
            &device,
            &[0u8; 128],
            wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        );
        let post_config = buffer(
            &device,
            &[0u8; 48],
            wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        );
        let colors: [[f32; 4]; 8] = [
            [0.03, 0.5, 0.9, 1.],
            [0.8, 0.05, 0.3, 1.],
            [0.4, 0.05, 0.9, 1.],
            [0.02, 0.8, 0.65, 1.],
            [0.9, 0.45, 0.03, 1.],
            [0.1, 0.2, 0.9, 1.],
            [0.9, 0.1, 0.6, 1.],
            [0.5, 0.9, 0.1, 1.],
        ];
        let palette = buffer(
            &device,
            bytemuck::cast_slice(&colors),
            wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
        );
        let particles = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("presentation particles"),
            size: (capacity * 48) as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let shader = |name, source: &'static str| {
            device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some(name),
                source: wgpu::ShaderSource::Wgsl(source.into()),
            })
        };
        let splat_shader = shader(
            "sphere depth",
            include_str!("../shaders/fluid_surface.wgsl"),
        );
        let filter_shader = shader("bilateral", include_str!("../shaders/fluid_filter.wgsl"));
        let light_shader = shader(
            "liquid optics",
            include_str!("../shaders/fluid_lighting.wgsl"),
        );
        let post_shader = shader("post", include_str!("../shaders/fluid_post.wgsl"));
        use wgpu::ShaderStages as S;
        let storage = wgpu::BindingType::Buffer {
            ty: wgpu::BufferBindingType::Storage { read_only: true },
            has_dynamic_offset: false,
            min_binding_size: None,
        };
        let splat_layout = layout(
            &device,
            &[
                entry(0, storage, S::VERTEX),
                entry(1, uniform(), S::VERTEX_FRAGMENT),
                entry(2, storage, S::VERTEX),
            ],
        );
        let depth_pipeline = render_pipeline(
            &device,
            &splat_shader,
            &splat_layout,
            "splat",
            "sphere_depth",
            wgpu::TextureFormat::R32Float,
            None,
            true,
        );
        let additive = wgpu::BlendComponent {
            src_factor: wgpu::BlendFactor::One,
            dst_factor: wgpu::BlendFactor::One,
            operation: wgpu::BlendOperation::Add,
        };
        let pigment_pipeline = render_pipeline(
            &device,
            &splat_shader,
            &splat_layout,
            "splat",
            "optical_thickness",
            wgpu::TextureFormat::Rgba16Float,
            Some(wgpu::BlendState {
                color: additive,
                alpha: additive,
            }),
            false,
        );
        let splats = group(
            &device,
            &splat_layout,
            &[
                particles.as_entire_binding(),
                camera.as_entire_binding(),
                palette.as_entire_binding(),
            ],
        );
        let output = |format| wgpu::BindingType::StorageTexture {
            access: wgpu::StorageTextureAccess::WriteOnly,
            format,
            view_dimension: wgpu::TextureViewDimension::D2,
        };
        let filter_layout = layout(
            &device,
            &[
                entry(0, texture(false), S::COMPUTE),
                entry(1, texture(false), S::COMPUTE),
                entry(2, output(wgpu::TextureFormat::R32Float), S::COMPUTE),
                entry(3, output(wgpu::TextureFormat::Rgba16Float), S::COMPUTE),
                entry(4, uniform(), S::COMPUTE),
            ],
        );
        let pl = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: None,
            bind_group_layouts: &[&filter_layout],
            push_constant_ranges: &[],
        });
        let filter_pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: None,
            layout: Some(&pl),
            module: &filter_shader,
            entry_point: "bilateral_main",
        });
        let light_layout = layout(
            &device,
            &[
                entry(0, texture(false), S::FRAGMENT),
                entry(1, texture(false), S::FRAGMENT),
                entry(2, uniform(), S::FRAGMENT),
            ],
        );
        let light_pipeline = render_pipeline(
            &device,
            &light_shader,
            &light_layout,
            "fullscreen",
            "shade",
            wgpu::TextureFormat::Rgba16Float,
            None,
            false,
        );
        let post_layout = layout(
            &device,
            &[
                entry(0, texture(true), S::FRAGMENT),
                entry(1, texture(false), S::FRAGMENT),
                entry(
                    2,
                    wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    S::FRAGMENT,
                ),
                entry(3, uniform(), S::FRAGMENT),
            ],
        );
        let post_pipeline = render_pipeline(
            &device,
            &post_shader,
            &post_layout,
            "fullscreen",
            "post",
            format,
            None,
            false,
        );
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let filter_configs = [[1, 0, 5, 0], [0, 1, 5, 0]].map(|axis| {
            buffer(
                &device,
                bytemuck::bytes_of(&Filter {
                    axis,
                    values: [9., 0.01, 0., 0.],
                }),
                wgpu::BufferUsages::UNIFORM,
            )
        });
        let ui = controls::Panel::new(&window, &device, format);
        let mut s = Self {
            ui,
            window,
            surface,
            device,
            queue,
            config,
            particles,
            camera,
            post_config,
            _palette: palette,
            sampler,
            filter_configs,
            depth_pipeline,
            pigment_pipeline,
            filter_pipeline,
            light_pipeline,
            post_pipeline,
            splats,
            targets: None,
            yaw: 0.,
            pitch: 0.15,
            distance: 5.,
            scene_scale: 10.,
            capacity,
        };
        s.resize(size.width, size.height);
        Ok(s)
    }
    fn resize(&mut self, width: u32, height: u32) {
        if width == 0 || height == 0 {
            return;
        }
        self.config.width = width;
        self.config.height = height;
        self.surface.configure(&self.device, &self.config);
        let tex = |format, usage| {
            self.device
                .create_texture(&wgpu::TextureDescriptor {
                    label: None,
                    size: wgpu::Extent3d {
                        width,
                        height,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format,
                    usage,
                    view_formats: &[],
                })
                .create_view(&Default::default())
        };
        let usage = wgpu::TextureUsages::RENDER_ATTACHMENT
            | wgpu::TextureUsages::TEXTURE_BINDING
            | wgpu::TextureUsages::STORAGE_BINDING;
        let depth: Vec<_> = (0..3)
            .map(|_| tex(wgpu::TextureFormat::R32Float, usage))
            .collect();
        let pigment: Vec<_> = (0..3)
            .map(|_| tex(wgpu::TextureFormat::Rgba16Float, usage))
            .collect();
        let hardware = tex(
            wgpu::TextureFormat::Depth32Float,
            wgpu::TextureUsages::RENDER_ATTACHMENT,
        );
        let hdr = tex(
            wgpu::TextureFormat::Rgba16Float,
            wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
        );
        let filters = (0..2)
            .map(|i| {
                group(
                    &self.device,
                    &self.filter_pipeline.get_bind_group_layout(0),
                    &[
                        wgpu::BindingResource::TextureView(&depth[i]),
                        wgpu::BindingResource::TextureView(&pigment[i]),
                        wgpu::BindingResource::TextureView(&depth[i + 1]),
                        wgpu::BindingResource::TextureView(&pigment[i + 1]),
                        self.filter_configs[i].as_entire_binding(),
                    ],
                )
            })
            .collect();
        let lighting = group(
            &self.device,
            &self.light_pipeline.get_bind_group_layout(0),
            &[
                wgpu::BindingResource::TextureView(&depth[2]),
                wgpu::BindingResource::TextureView(&pigment[2]),
                self.camera.as_entire_binding(),
            ],
        );
        let post = group(
            &self.device,
            &self.post_pipeline.get_bind_group_layout(0),
            &[
                wgpu::BindingResource::TextureView(&hdr),
                wgpu::BindingResource::TextureView(&depth[2]),
                wgpu::BindingResource::Sampler(&self.sampler),
                self.post_config.as_entire_binding(),
            ],
        );
        self.targets = Some(Targets {
            depth,
            pigment,
            hardware,
            hdr,
            filters,
            lighting,
            post,
        });
    }
    fn draw(&mut self, u: &mut Universe, paused: &mut bool) -> Result<()> {
        let output_ui = self.ui.frame(&self.window, u, paused);
        if let Some(model) = &u.fusion {
            self.scene_scale = model.settings.half_extent.into_iter().fold(0., f32::max);
            self.queue
                .write_buffer(&self._palette, 0, bytemuck::cast_slice(&model.palette));
        }
        ensure!(
            u.particles.len() <= self.capacity,
            "renderer particle capacity exceeded"
        );
        let rows: Vec<_> = (0..u.particles.len())
            .map(|i| {
                let p = u.particles.get(i);
                RenderParticle {
                    p: [
                        p.pos_rad[0] / self.scene_scale,
                        p.pos_rad[1] / self.scene_scale,
                        p.pos_rad[2] / self.scene_scale,
                        p.phenotype[0] as f32,
                    ],
                    v: p.vel_mass,
                    previous: [0.; 4],
                }
            })
            .collect();
        self.queue
            .write_buffer(&self.particles, 0, bytemuck::cast_slice(&rows));
        let f = [
            -self.yaw.sin() * self.pitch.cos(),
            -self.pitch.sin(),
            -self.yaw.cos() * self.pitch.cos(),
        ];
        let right = [self.yaw.cos(), 0., -self.yaw.sin()];
        let up = [
            -self.yaw.sin() * self.pitch.sin(),
            self.pitch.cos(),
            -self.yaw.cos() * self.pitch.sin(),
        ];
        let camera: [[f32; 4]; 8] = [
            [
                -f[0] * self.distance,
                -f[1] * self.distance,
                -f[2] * self.distance,
                0.,
            ],
            [right[0], right[1], right[2], 0.],
            [up[0], up[1], up[2], 0.],
            [f[0], f[1], f[2], 0.5],
            [
                self.config.width as f32,
                self.config.height as f32,
                self.ui.presentation.radius,
                0.,
            ],
            [self.ui.presentation.roughness, 4., 0.2, 450.],
            [0., 0., 0.25, 0.25],
            [0.; 4],
        ];
        self.queue
            .write_buffer(&self.camera, 0, bytemuck::cast_slice(&camera));
        let post: [[f32; 4]; 3] = [
            [
                self.config.width as f32,
                self.config.height as f32,
                u.tick as f32,
                0.,
            ],
            [self.distance, 0.8, 0.15, self.ui.presentation.exposure],
            [
                0.25,
                0.002,
                if self.config.format.is_srgb() { 1. } else { 0. },
                0.,
            ],
        ];
        self.queue
            .write_buffer(&self.post_config, 0, bytemuck::cast_slice(&post));
        let output = match self.surface.get_current_texture() {
            Ok(x) => x,
            Err(wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated) => {
                self.surface.configure(&self.device, &self.config);
                return Ok(());
            }
            Err(wgpu::SurfaceError::Timeout) => return Ok(()),
            Err(e) => return Err(e.into()),
        };
        let view = output.texture.create_view(&Default::default());
        let t = self.targets.as_ref().unwrap();
        let mut encoder = self.device.create_command_encoder(&Default::default());
        fn render(
            encoder: &mut wgpu::CommandEncoder,
            target: &wgpu::TextureView,
            clear: wgpu::Color,
            hardware: Option<&wgpu::TextureView>,
            pipeline: &wgpu::RenderPipeline,
            bind: &wgpu::BindGroup,
            vertices: u32,
            instances: u32,
        ) {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: None,
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: target,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(clear),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: hardware.map(|view| {
                    wgpu::RenderPassDepthStencilAttachment {
                        view,
                        depth_ops: Some(wgpu::Operations {
                            load: wgpu::LoadOp::Clear(1.),
                            store: wgpu::StoreOp::Store,
                        }),
                        stencil_ops: None,
                    }
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            pass.set_pipeline(pipeline);
            pass.set_bind_group(0, bind, &[]);
            pass.draw(0..vertices, 0..instances);
        }
        render(
            &mut encoder,
            &t.depth[0],
            wgpu::Color {
                r: 10.,
                g: 0.,
                b: 0.,
                a: 0.,
            },
            Some(&t.hardware),
            &self.depth_pipeline,
            &self.splats,
            6,
            rows.len() as u32,
        );
        render(
            &mut encoder,
            &t.pigment[0],
            wgpu::Color::TRANSPARENT,
            None,
            &self.pigment_pipeline,
            &self.splats,
            6,
            rows.len() as u32,
        );
        for bind in &t.filters {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("bilateral"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.filter_pipeline);
            pass.set_bind_group(0, bind, &[]);
            pass.dispatch_workgroups(
                self.config.width.div_ceil(8),
                self.config.height.div_ceil(8),
                1,
            );
        }
        render(
            &mut encoder,
            &t.hdr,
            wgpu::Color::BLACK,
            None,
            &self.light_pipeline,
            &t.lighting,
            3,
            1,
        );
        render(
            &mut encoder,
            &view,
            wgpu::Color::BLACK,
            None,
            &self.post_pipeline,
            &t.post,
            3,
            1,
        );
        let prepared = self.ui.prepare(
            &self.device,
            &self.queue,
            &mut encoder,
            output_ui,
            [self.config.width, self.config.height],
        );
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("NOVA native inspector"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Load,
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            self.ui.paint(&mut pass, &prepared);
        }
        self.ui.finish(&prepared);
        self.queue
            .submit(prepared.commands.into_iter().chain([encoder.finish()]));
        output.present();
        Ok(())
    }
}
/// Space pauses, arrows orbit, wheel zooms, E injects a jet, Escape exits.
pub fn run(mut universe: Universe, gpu: bool, output: Option<PathBuf>) -> Result<()> {
    let event_loop = EventLoop::new()?;
    let window = Arc::new(
        WindowBuilder::new()
            .with_title("NOVA native · space: pause · arrows: orbit · wheel: zoom · E: emit")
            .with_inner_size(winit::dpi::LogicalSize::new(1280, 800))
            .build(&event_loop)?,
    );
    let mut renderer = pollster::block_on(Renderer::new(window, universe.config.max_particles))?;
    if let Some(model) = &universe.fusion {
        renderer.scene_scale = model.settings.half_extent.into_iter().fold(0., f32::max);
        renderer.pitch = if model.settings.dimensions == 2 {
            0.
        } else {
            0.15
        };
        renderer
            .queue
            .write_buffer(&renderer._palette, 0, bytemuck::cast_slice(&model.palette));
    }
    let compute = if gpu {
        Some(nova_gpu::Gpu::new()?)
    } else {
        None
    };
    let lake = Rc::new(RefCell::new(
        output
            .map(|p| Lake::new(p, &universe, 24, 32.))
            .transpose()?,
    ));
    let recorder = lake.clone();
    let error = Rc::new(RefCell::new(None::<String>));
    let failures = error.clone();
    let mut paused = false;
    let mut children = Vec::<nova_physics::FusionCandidate>::new();
    let mut last_title = Instant::now();
    let mut frames = 0;
    let mut pointer = [0f64; 2];
    let mut radial = 0f32;
    event_loop.run(move |event, elwt| {
        elwt.set_control_flow(ControlFlow::WaitUntil(
            Instant::now() + Duration::from_millis(16),
        ));
        let result: Result<()> = (|| {
            if let Event::WindowEvent { event, .. } = &event {
                if renderer.ui.on_event(&renderer.window, event) {
                    radial = 0.;
                    return Ok(());
                }
            }
            match event {
                Event::WindowEvent { event, .. } => match event {
                    WindowEvent::CloseRequested => elwt.exit(),
                    WindowEvent::Resized(size) => renderer.resize(size.width, size.height),
                    WindowEvent::KeyboardInput { event, .. }
                        if event.state == ElementState::Pressed =>
                    {
                        match event.physical_key {
                            PhysicalKey::Code(KeyCode::Escape) => elwt.exit(),
                            PhysicalKey::Code(KeyCode::Space) => paused = !paused,
                            PhysicalKey::Code(KeyCode::ArrowLeft) => renderer.yaw -= 0.1,
                            PhysicalKey::Code(KeyCode::ArrowRight) => renderer.yaw += 0.1,
                            PhysicalKey::Code(KeyCode::ArrowUp) => {
                                renderer.pitch = (renderer.pitch + 0.1).min(1.4)
                            }
                            PhysicalKey::Code(KeyCode::ArrowDown) => {
                                renderer.pitch = (renderer.pitch - 0.1).max(-1.4)
                            }
                            PhysicalKey::Code(KeyCode::KeyE)
                                if !universe.config.mpm && universe.fusion.is_none() =>
                            {
                                let room = universe.config.max_particles - universe.particles.len();
                                universe.emit(room.min(256))?;
                            }
                            PhysicalKey::Code(KeyCode::KeyB) if universe.fusion.is_some() => {
                                children = universe.breed_rules()?;
                            }
                            PhysicalKey::Code(KeyCode::KeyM) if universe.fusion.is_some() => {
                                let choices = universe.breed_rules()?;
                                universe.choose_rules(&choices[2])?;
                            }
                            PhysicalKey::Code(KeyCode::KeyR) if universe.fusion.is_some() => {
                                let choices = universe.breed_rules()?;
                                universe.choose_rules(&choices[5])?;
                            }
                            PhysicalKey::Code(code) if !children.is_empty() => {
                                let i = match code {
                                    KeyCode::Digit1 => Some(0),
                                    KeyCode::Digit2 => Some(1),
                                    KeyCode::Digit3 => Some(2),
                                    KeyCode::Digit4 => Some(3),
                                    KeyCode::Digit5 => Some(4),
                                    KeyCode::Digit6 => Some(5),
                                    _ => None,
                                };
                                if let Some(i) = i {
                                    universe.choose_rules(&children[i])?;
                                    children.clear();
                                }
                            }
                            _ => (),
                        }
                    }
                    WindowEvent::CursorMoved { position, .. } => {
                        pointer = [position.x, position.y];
                    }
                    WindowEvent::MouseInput { state, button, .. } => {
                        if matches!(
                            button,
                            winit::event::MouseButton::Left | winit::event::MouseButton::Right
                        ) {
                            radial = if state == ElementState::Released {
                                0.
                            } else if button == winit::event::MouseButton::Left {
                                1.
                            } else {
                                -1.
                            };
                        }
                    }
                    WindowEvent::MouseWheel { delta, .. } => {
                        let amount = match delta {
                            MouseScrollDelta::LineDelta(_, y) => y,
                            MouseScrollDelta::PixelDelta(p) => p.y as f32 * 0.02,
                        };
                        renderer.distance = (renderer.distance - amount * 0.2).clamp(1., 8.);
                    }
                    WindowEvent::RedrawRequested => {
                        if renderer.window.inner_size().width == 0
                            || renderer.window.inner_size().height == 0
                        {
                            return Ok(());
                        }
                        if !paused || renderer.ui.single_step {
                            renderer.ui.single_step = false;
                            if radial != 0. {
                                if let Some(model) = &mut universe.fusion {
                                    let aspect = renderer.config.width as f32
                                        / renderer.config.height as f32;
                                    let x = (pointer[0] as f32 / renderer.config.width as f32 * 2.
                                        - 1.)
                                        * 0.5
                                        * renderer.distance
                                        * aspect
                                        * renderer.scene_scale;
                                    let y = (1.
                                        - pointer[1] as f32 / renderer.config.height as f32 * 2.)
                                        * 0.5
                                        * renderer.distance
                                        * renderer.scene_scale;
                                    model.set_brush(
                                        [x, y, 0.],
                                        model.settings.cutoff() * 2.,
                                        radial * model.settings.force * 4.,
                                    )?;
                                }
                            }
                            if let Some(gpu) =
                                compute.as_ref().filter(|_| universe.neural.is_none())
                            {
                                gpu.step(&mut universe)?;
                            } else {
                                universe.step(1)?;
                            }
                            if universe.tick % 10 == 0 {
                                if let Some(lake) = recorder.borrow_mut().as_mut() {
                                    lake.record(&universe, true)?;
                                }
                            }
                        }
                        renderer.draw(&mut universe, &mut paused)?;
                        frames += 1;
                        if last_title.elapsed() > Duration::from_secs(1) {
                            renderer.window.set_title(&format!(
                                "NOVA · {} particles · {} births · {:0.1} FPS · {}",
                                universe.particles.len(),
                                universe.births,
                                frames as f64 / last_title.elapsed().as_secs_f64(),
                                if paused { "paused" } else { "running" }
                            ));
                            frames = 0;
                            last_title = Instant::now();
                        }
                    }
                    _ => (),
                },
                Event::AboutToWait => renderer.window.request_redraw(),
                _ => (),
            }
            Ok(())
        })();
        if let Err(e) = result {
            *failures.borrow_mut() = Some(format!("{e:#}"));
            elwt.exit();
        }
    })?;
    if let Some(lake) = lake.borrow_mut().take() {
        lake.finish()?;
    }
    if let Some(e) = error.borrow_mut().take() {
        anyhow::bail!(e);
    }
    Ok(())
}
