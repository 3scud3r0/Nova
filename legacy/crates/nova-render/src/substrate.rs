//! Generic native tensor view for every registered substrate, including custom plugins.
use anyhow::{ensure, Result};
use nova_cognition::{Observer, ObserverConfig};
use nova_substrates::{Action, EnvironmentSpec, Registry, Substrate};
use std::sync::Arc;
use winit::{
    event::{ElementState, Event, MouseButton, WindowEvent},
    event_loop::{ControlFlow, EventLoop},
    keyboard::{KeyCode, PhysicalKey},
    window::WindowBuilder,
};
struct Display {
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    pipeline: wgpu::RenderPipeline,
    layout: wgpu::BindGroupLayout,
    texture: Option<(wgpu::Texture, wgpu::BindGroup, [u32; 2])>,
    context: egui::Context,
    state: egui_winit::State,
    overlay: egui_wgpu::Renderer,
}
impl Display {
    async fn new(window: Arc<winit::window::Window>) -> Result<Self> {
        let instance = wgpu::Instance::default();
        let surface = instance.create_surface(window.clone())?;
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                compatible_surface: Some(&surface),
                ..Default::default()
            })
            .await
            .ok_or_else(|| anyhow::anyhow!("no native graphics adapter"))?;
        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("substrate display"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::downlevel_defaults(),
                },
                None,
            )
            .await?;
        let caps = surface.get_capabilities(&adapter);
        let format = caps
            .formats
            .iter()
            .copied()
            .find(|x| x.is_srgb())
            .unwrap_or(caps.formats[0]);
        let size = window.inner_size();
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
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("tensor field"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: false },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            }],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: None,
            bind_group_layouts: &[&layout],
            push_constant_ranges: &[],
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("native tensor shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("../shaders/substrate.wgsl").into()),
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("tensor visualization"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: "vs",
                buffers: &[],
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: "fs",
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            multiview: None,
        });
        let context = egui::Context::default();
        let state = egui_winit::State::new(
            context.clone(),
            egui::ViewportId::ROOT,
            window.as_ref(),
            Some(window.scale_factor() as f32),
            None,
        );
        let overlay = egui_wgpu::Renderer::new(&device, format, None, 1);
        Ok(Self {
            surface,
            device,
            queue,
            config,
            pipeline,
            layout,
            texture: None,
            context,
            state,
            overlay,
        })
    }
    fn upload(&mut self, world: &dyn Substrate, channel: usize) -> Result<()> {
        let view = world.observe();
        let [channels, depth, height, width] = view.shape;
        ensure!(
            channel < channels && width <= 2048 && height <= 2048,
            "display shape/channel limit"
        );
        let n = view.spatial_len();
        let mut pixels = vec![f32::NEG_INFINITY; width * height];
        // Maximum intensity projection of z; raw slices remain available in observe().
        for z in 0..depth {
            for (i, pixel) in pixels.iter_mut().enumerate() {
                let value = view.values[channel * n + z * width * height + i];
                let value = if channel == 0 {
                    value
                } else {
                    0.5 + 0.5 * value.tanh()
                };
                *pixel = pixel.max(value);
            }
        }
        let size = [width as u32, height as u32];
        if self.texture.as_ref().is_none_or(|t| t.2 != size) {
            let texture = self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("substrate density"),
                size: wgpu::Extent3d {
                    width: size[0],
                    height: size[1],
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::R32Float,
                usage: wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            });
            let texture_view = texture.create_view(&Default::default());
            let group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: None,
                layout: &self.layout,
                entries: &[wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&texture_view),
                }],
            });
            self.texture = Some((texture, group, size));
        }
        self.queue.write_texture(
            wgpu::ImageCopyTexture {
                texture: &self.texture.as_ref().unwrap().0,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            bytemuck::cast_slice(&pixels),
            wgpu::ImageDataLayout {
                offset: 0,
                bytes_per_row: Some(size[0] * 4),
                rows_per_image: Some(size[1]),
            },
            wgpu::Extent3d {
                width: size[0],
                height: size[1],
                depth_or_array_layers: 1,
            },
        );
        Ok(())
    }
    fn draw(&mut self, output: egui::FullOutput) -> Result<()> {
        for (id, delta) in &output.textures_delta.set {
            self.overlay
                .update_texture(&self.device, &self.queue, *id, delta);
        }
        let frame = match self.surface.get_current_texture() {
            Ok(frame) => frame,
            Err(wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated) => {
                self.surface.configure(&self.device, &self.config);
                return Ok(());
            }
            Err(wgpu::SurfaceError::Timeout) => return Ok(()),
            Err(error) => return Err(error.into()),
        };
        let view = frame.texture.create_view(&Default::default());
        let jobs = self
            .context
            .tessellate(output.shapes, output.pixels_per_point);
        let screen = egui_wgpu::ScreenDescriptor {
            size_in_pixels: [self.config.width, self.config.height],
            pixels_per_point: output.pixels_per_point,
        };
        let mut encoder = self.device.create_command_encoder(&Default::default());
        let commands =
            self.overlay
                .update_buffers(&self.device, &self.queue, &mut encoder, &jobs, &screen);
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("substrate+controls"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &self.texture.as_ref().unwrap().1, &[]);
            pass.draw(0..3, 0..1);
            self.overlay.render(&mut pass, &jobs, &screen);
        }
        self.queue
            .submit(commands.into_iter().chain(Some(encoder.finish())));
        frame.present();
        for id in output.textures_delta.free {
            self.overlay.free_texture(&id);
        }
        Ok(())
    }
}
pub fn run(initial: EnvironmentSpec) -> Result<()> {
    run_with_registry(initial, Registry::default())
}
/// Custom registered plugins use the same renderer and observer contract.
pub fn run_with_registry(initial: EnvironmentSpec, registry: Registry) -> Result<()> {
    let event_loop = EventLoop::new()?;
    let window = Arc::new(
        WindowBuilder::new()
            .with_title("NOVA — Substrates / Observer")
            .build(&event_loop)?,
    );
    let mut display = pollster::block_on(Display::new(window.clone()))?;
    let mut spec = initial;
    let mut world = registry.build(&spec)?;
    let mut paused = false;
    let mut single_step = false;
    let mut ticks = 1usize;
    let mut channel = 0;
    let mut cursor = [0.5, 0.5, 0.5];
    let mut paint = 0.;
    let mut radius = 0.03;
    let mut observer: Option<Observer> = None;
    let mut message = String::new();
    event_loop.run(move |event,target|{
        target.set_control_flow(ControlFlow::Poll);
        if let Event::WindowEvent{event,..}=event{
            let consumed=display.state.on_window_event(window.as_ref(),&event).consumed;
            match event {
                WindowEvent::CloseRequested=>target.exit(),
                WindowEvent::Resized(size)=>{if size.width>0&&size.height>0{display.config.width=size.width;display.config.height=size.height;display.surface.configure(&display.device,&display.config);}},
                WindowEvent::CursorMoved{position,..} if !consumed=>{let size=window.inner_size();cursor=[(position.x/size.width.max(1) as f64).clamp(0.,1.) as f32,(position.y/size.height.max(1) as f64).clamp(0.,1.) as f32,0.5];},
                WindowEvent::MouseInput{state,button,..}=>{if state==ElementState::Released{paint=0.;}else if !consumed{paint=match button{MouseButton::Left=>1.,MouseButton::Right=>-1.,_=>0.};}},
                WindowEvent::KeyboardInput{event,..} if !consumed&&event.state==ElementState::Pressed=>match event.physical_key{PhysicalKey::Code(KeyCode::Space)=>paused=!paused,PhysicalKey::Code(KeyCode::ArrowRight)=>single_step=true,_=>{}},
                WindowEvent::RedrawRequested=>{
                    let mut selected=spec.kind.clone();let mut reset=false;let mut observing=observer.is_some();let input=display.state.take_egui_input(window.as_ref());
                    let output=display.context.run(input,|ctx|{egui::SidePanel::right("substrate-inspector").default_width(280.).show(ctx,|ui|{
                        ui.heading("NOVA / SUBSTRATES");egui::ComboBox::from_label("Substrato").selected_text(&selected).show_ui(ui,|ui|{for name in registry.names(){ui.selectable_value(&mut selected,name.to_owned(),name);}});
                        ui.horizontal(|ui|{if ui.button(if paused{"Executar"}else{"Pausar"}).clicked(){paused=!paused;}if ui.button("Passo").clicked(){single_step=true;}if ui.button("Reiniciar").clicked(){reset=true;}});
                        ui.add(egui::Slider::new(&mut ticks,1..=256).text("Passos por quadro"));ui.add(egui::Slider::new(&mut channel,0..=3).text("Canal"));ui.add(egui::Slider::new(&mut radius,0.005..=0.2).text("Raio do pincel"));
                        ui.checkbox(&mut observing,"Observador ativo");ui.label(format!("Tick {}",world.observe().tick));ui.label(format!("Tensor {:?}",world.observe().shape));
                        if let Some(o)=&observer{ui.label(format!("Erro de previsão {:.6}",o.report.prediction_mse));ui.label(format!("Replay {} · ações {}",o.report.replay_updates,o.report.actions));}
                        ui.small("Espaço: pausar · →: passo · esquerdo/direito: pintar/apagar ou atrair/repelir. Projeção máxima em z.");if !message.is_empty(){ui.label(&message);}
                    });});
                    let result=(||->Result<()>{
                        if reset||selected!=spec.kind{if selected!=spec.kind{spec=EnvironmentSpec::for_kind(&selected,spec.seed);}world=registry.build(&spec)?;observer=None;}
                        if observing&&observer.is_none(){observer=Some(Observer::new(ObserverConfig{seed:spec.seed,..Default::default()})?);}else if !observing{observer=None;}
                        if paint!=0. {world.interact(&Action::Paint{position:cursor,radius,strength:paint})?;}
                        if !paused||single_step{for _ in 0..if single_step{1}else{ticks}{if let Some(o)=&mut observer{o.tick(world.as_mut(),true)?;}else{world.step(1)?;}}single_step=false;}
                        display.upload(world.as_ref(),channel)?;display.state.handle_platform_output(window.as_ref(),output.platform_output.clone());display.draw(output)?;Ok(())
                    })();
                    if let Err(error)=result{message=error.to_string();paused=true;}
                },
                _=>{}
            }
            window.request_redraw();
        }
    })?;
    Ok(())
}
