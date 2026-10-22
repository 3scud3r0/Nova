//! Native controls inspired by SandboxScience's separation of simulation, rules and presentation.
//! Original egui implementation; no Vue/browser code is executed or copied.
use anyhow::Result;
use nova_fusion::{breeding::Candidate, Family, Model};
use nova_physics::Universe;
use winit::{event::WindowEvent, window::Window};
pub struct Presentation {
    pub radius: f32,
    pub roughness: f32,
    pub exposure: f32,
}
pub struct Panel {
    pub single_step: bool,
    context: egui::Context,
    state: egui_winit::State,
    renderer: egui_wgpu::Renderer,
    pub presentation: Presentation,
    rule: usize,
    pattern: usize,
    palette: usize,
    children: Vec<Candidate>,
    message: String,
}
pub struct Prepared {
    pub jobs: Vec<egui::ClippedPrimitive>,
    pub screen: egui_wgpu::ScreenDescriptor,
    pub commands: Vec<wgpu::CommandBuffer>,
    free: Vec<egui::TextureId>,
}
enum Action {
    Family(Family),
    Mutate,
    Random,
    Breed,
    Choose(usize),
    Preset(&'static str),
    Generate,
    Save,
    Step,
}
impl Panel {
    pub fn new(window: &Window, device: &wgpu::Device, format: wgpu::TextureFormat) -> Self {
        let context = egui::Context::default();
        let mut style = (*context.style()).clone();
        style.visuals = egui::Visuals::dark();
        style.visuals.panel_fill = egui::Color32::from_rgb(15, 21, 32);
        style.visuals.window_fill = egui::Color32::from_rgb(20, 28, 42);
        style.visuals.selection.bg_fill = egui::Color32::from_rgb(25, 116, 135);
        style.spacing.item_spacing = egui::vec2(8., 8.);
        context.set_style(style);
        let state = egui_winit::State::new(
            context.clone(),
            egui::ViewportId::ROOT,
            window,
            Some(window.scale_factor() as f32),
            None,
        );
        Self {
            single_step: false,
            context,
            state,
            renderer: egui_wgpu::Renderer::new(device, format, None, 1),
            presentation: Presentation {
                radius: 0.025,
                roughness: 0.18,
                exposure: 1.,
            },
            rule: 0,
            pattern: 0,
            palette: 0,
            children: vec![],
            message: String::new(),
        }
    }
    pub fn on_event(&mut self, window: &Window, event: &WindowEvent) -> bool {
        self.state.on_window_event(window, event).consumed
    }
    pub fn frame(
        &mut self,
        window: &Window,
        u: &mut Universe,
        paused: &mut bool,
    ) -> egui::FullOutput {
        let input = self.state.take_egui_input(window);
        let ctx = self.context.clone();
        let mut actions = vec![];
        let output = ctx.run(input, |ctx| {
            egui::TopBottomPanel::top("nova-toolbar").show(ctx, |ui| {
                ui.horizontal(|ui| {
                    ui.heading(
                        egui::RichText::new("NOVA / LAB")
                            .color(egui::Color32::from_rgb(104, 221, 235)),
                    );
                    ui.separator();
                    if ui
                        .button(if *paused {
                            "▶ Executar"
                        } else {
                            "Ⅱ Pausar"
                        })
                        .clicked()
                    {
                        *paused = !*paused;
                    }
                    if ui
                        .add_enabled(*paused, egui::Button::new("Passo"))
                        .clicked()
                    {
                        actions.push(Action::Step);
                    }
                    ui.separator();
                    ui.label(format!("{} partículas", u.particles.len()));
                    ui.label(format!("Geração {}", u.tick));
                });
            });
            egui::SidePanel::right("nova-inspector")
                .default_width(320.)
                .min_width(270.)
                .show(ctx, |ui| {
                    egui::ScrollArea::vertical().show(ui, |ui| {
                        ui.heading("Simulação");
                        if let Some(model) = &mut u.fusion {
                            let current = model.settings.family;
                            let mut chosen = current;
                            egui::ComboBox::from_id_source("source")
                                .selected_text(format!("{current:?}"))
                                .show_ui(ui, |ui| {
                                    for (label, family) in [
                                        ("Nova Fusion", Family::Fusion),
                                        ("Hunar", Family::Hunar),
                                        ("Ethersim", Family::Realethersim),
                                        ("Primordial Dish", Family::PrimordialDish),
                                        ("PAR Particle Life", Family::ParParticleLife),
                                        ("CellFlow", Family::CellFlow),
                                    ] {
                                        ui.selectable_value(&mut chosen, family, label);
                                    }
                                });
                            if chosen != current {
                                actions.push(Action::Family(chosen));
                            }
                            ui.label(format!(
                                "{}D · {} espécies",
                                model.settings.dimensions, model.settings.species
                            ));
                            let s = &mut model.settings;
                            ui.add(
                                egui::Slider::new(&mut s.force, 0.0..=1000.0)
                                    .logarithmic(true)
                                    .text("Força"),
                            );
                            ui.add(
                                egui::Slider::new(&mut s.retention, 0.0..=1.0)
                                    .text("Retenção de velocidade"),
                            );
                            ui.add(
                                egui::Slider::new(&mut s.dt, 0.0001..=1.0)
                                    .logarithmic(true)
                                    .text("Passo de tempo"),
                            );
                            u.config.dt = s.dt;
                            ui.add(
                                egui::Slider::new(&mut s.velocity_coupling, 0.0..=2.0)
                                    .text("Alinhamento"),
                            );
                            ui.add(
                                egui::Slider::new(&mut s.temperature, 0.0..=4.0).text("Agitação"),
                            );
                            if s.family == Family::CellFlow {
                                ui.collapsing("Resposta à densidade", |ui| {
                                    ui.add(
                                        egui::Slider::new(&mut s.cell.balance, 0.0..=1.0)
                                            .text("Equilíbrio"),
                                    );
                                    ui.add(
                                        egui::Slider::new(
                                            &mut s.cell.expected_neighbors,
                                            1.0..=256.0,
                                        )
                                        .text("Vizinhos de referência"),
                                    );
                                    ui.add(
                                        egui::Slider::new(&mut s.cell.repulsion, 0.0..=100.0)
                                            .text("Repulsão"),
                                    );
                                    ui.add(
                                        egui::Slider::new(&mut s.cell.attraction, 0.0..=4.0)
                                            .text("Atração"),
                                    );
                                });
                            }
                            ui.collapsing("Regras variáveis", |ui| {
                                ui.checkbox(&mut s.variation.enabled, "Variar no tempo");
                                ui.add(
                                    egui::Slider::new(&mut s.variation.amplitude, 0.0..=1.0)
                                        .text("Amplitude"),
                                );
                                ui.add(
                                    egui::Slider::new(&mut s.variation.speed, 0.0..=2.0)
                                        .text("Ritmo"),
                                );
                            });
                            ui.separator();
                            ui.heading("Presets e evolução");
                            ui.horizontal_wrapped(|ui| {
                                for name in ["genesis", "orbs", "garden", "symbiotes", "polymers"] {
                                    if ui.button(name).clicked() {
                                        actions.push(Action::Preset(name));
                                    }
                                }
                            });
                            ui.horizontal(|ui| {
                                if ui.button("Mutar").clicked() {
                                    actions.push(Action::Mutate);
                                }
                                if ui.button("Aleatorizar").clicked() {
                                    actions.push(Action::Random);
                                }
                                if ui.button("Reproduzir").clicked() {
                                    actions.push(Action::Breed);
                                }
                            });
                            for (i, child) in self.children.iter().enumerate() {
                                if ui
                                    .button(format!("{} · {}", i + 1, child.lineage.operator))
                                    .clicked()
                                {
                                    actions.push(Action::Choose(i));
                                }
                            }
                            ui.collapsing("Geradores", |ui| {
                                use nova_fusion::par::generators::{
                                    colors::PaletteType, positions::PositionPattern,
                                    rules::RuleType,
                                };
                                egui::ComboBox::from_label("Regra")
                                    .selected_text(RuleType::all()[self.rule].display_name())
                                    .show_ui(ui, |ui| {
                                        for (i, x) in RuleType::all().iter().enumerate() {
                                            ui.selectable_value(
                                                &mut self.rule,
                                                i,
                                                x.display_name(),
                                            );
                                        }
                                    });
                                egui::ComboBox::from_label("Distribuição")
                                    .selected_text(
                                        PositionPattern::all()[self.pattern].display_name(),
                                    )
                                    .show_ui(ui, |ui| {
                                        for (i, x) in PositionPattern::all().iter().enumerate() {
                                            ui.selectable_value(
                                                &mut self.pattern,
                                                i,
                                                x.display_name(),
                                            );
                                        }
                                    });
                                egui::ComboBox::from_label("Paleta")
                                    .selected_text(PaletteType::all()[self.palette].display_name())
                                    .show_ui(ui, |ui| {
                                        for (i, x) in PaletteType::all().iter().enumerate() {
                                            ui.selectable_value(
                                                &mut self.palette,
                                                i,
                                                x.display_name(),
                                            );
                                        }
                                    });
                                if ui.button("Aplicar e redistribuir partículas").clicked() {
                                    actions.push(Action::Generate);
                                }
                            });
                            if ui.button("Salvar preset").clicked() {
                                actions.push(Action::Save);
                            }
                            ui.separator();
                            ui.heading("Matriz de interação");
                            ui.small("Linha recebe · coluna influencia · + atrai · − repele");
                            let k = model.settings.species;
                            egui::Grid::new("affinities")
                                .spacing([2., 2.])
                                .show(ui, |ui| {
                                    for i in 0..k {
                                        for j in 0..k {
                                            ui.add_sized(
                                                [35., 22.],
                                                egui::DragValue::new(&mut u.matrix[i][j])
                                                    .speed(0.02)
                                                    .clamp_range(-1.0..=1.0)
                                                    .fixed_decimals(2),
                                            );
                                        }
                                        ui.end_row();
                                    }
                                });
                            ui.collapsing("Cores das espécies", |ui| {
                                for (i, color) in model.palette.iter_mut().take(k).enumerate() {
                                    ui.horizontal(|ui| {
                                        ui.label(format!("{}", i + 1));
                                        ui.color_edit_button_rgba_unmultiplied(color);
                                    });
                                }
                            });
                        } else {
                            ui.add(
                                egui::Slider::new(&mut u.config.strength, 0.0..=30.0).text("Força"),
                            );
                            ui.add(
                                egui::Slider::new(&mut u.config.damping, 0.0..=20.0)
                                    .text("Arrasto"),
                            );
                        }
                        ui.separator();
                        ui.collapsing("Aparência", |ui| {
                            ui.add(
                                egui::Slider::new(&mut self.presentation.radius, 0.002..=0.08)
                                    .text("Raio visual"),
                            );
                            ui.add(
                                egui::Slider::new(&mut self.presentation.roughness, 0.03..=0.8)
                                    .text("Rugosidade"),
                            );
                            ui.add(
                                egui::Slider::new(&mut self.presentation.exposure, 0.1..=3.0)
                                    .text("Exposição"),
                            );
                        });
                        ui.small(
                            "Setas: orbitar · roda: zoom · clique esquerdo/direito: atrair/repelir",
                        );
                        if !self.message.is_empty() {
                            ui.separator();
                            ui.label(&self.message);
                        }
                    });
                });
        });
        for action in actions {
            if let Err(e) = self.apply(action, u) {
                self.message = format!("{e:#}");
            }
        }
        self.state
            .handle_platform_output(window, output.platform_output.clone());
        output
    }
    fn apply(&mut self, action: Action, u: &mut Universe) -> Result<()> {
        match action {
            Action::Step => self.single_step = true,
            Action::Breed => self.children = u.breed_rules()?,
            Action::Choose(i) => {
                u.choose_rules(&self.children[i])?;
                self.children.clear();
            }
            Action::Mutate | Action::Random => {
                let choices = u.breed_rules()?;
                let i = if matches!(action, Action::Random) {
                    5
                } else {
                    2
                };
                u.choose_rules(&choices[i])?;
            }
            Action::Family(f) => {
                let mut model = Model::new(f);
                model.initialize(&mut u.particles, &mut u.matrix, u.config.seed)?;
                u.config.fusion = Some(f);
                u.config.dt = model.settings.dt;
                u.fusion = Some(model);
                self.children.clear();
            }
            Action::Preset(name) => {
                u.fusion
                    .as_mut()
                    .unwrap()
                    .apply_preset(&mut u.particles, &mut u.matrix, name)?;
            }
            Action::Generate => {
                u.fusion.as_mut().unwrap().select_generators(
                    &mut u.particles,
                    &mut u.matrix,
                    self.rule,
                    self.pattern,
                    self.palette,
                )?;
            }
            Action::Save => {
                let model = u.fusion.as_ref().unwrap();
                std::fs::create_dir_all("runs")?;
                let path = format!(
                    "runs/fusion-preset-{}-{}.json",
                    u.tick,
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)?
                        .as_nanos()
                );
                let file = std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&path)?;
                serde_json::to_writer_pretty(
                    file,
                    &nova_fusion::SavedPreset::capture(model, u.matrix),
                )?;
                self.message = format!("Preset salvo: {path}");
            }
        }
        Ok(())
    }
    pub fn prepare(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        encoder: &mut wgpu::CommandEncoder,
        output: egui::FullOutput,
        size: [u32; 2],
    ) -> Prepared {
        for (id, delta) in &output.textures_delta.set {
            self.renderer.update_texture(device, queue, *id, delta);
        }
        let jobs = self
            .context
            .tessellate(output.shapes, output.pixels_per_point);
        let screen = egui_wgpu::ScreenDescriptor {
            size_in_pixels: size,
            pixels_per_point: output.pixels_per_point,
        };
        let commands = self
            .renderer
            .update_buffers(device, queue, encoder, &jobs, &screen);
        Prepared {
            jobs,
            screen,
            commands,
            free: output.textures_delta.free,
        }
    }
    pub fn paint<'a>(&'a self, pass: &mut wgpu::RenderPass<'a>, prepared: &'a Prepared) {
        self.renderer.render(pass, &prepared.jobs, &prepared.screen);
    }
    pub fn finish(&mut self, prepared: &Prepared) {
        for id in &prepared.free {
            self.renderer.free_texture(id);
        }
    }
}
