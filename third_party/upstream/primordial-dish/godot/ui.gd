extends PanelContainer

var host # untyped on purpose: dynamic dispatch to main.gd
var matrix_grid: GridContainer
var spins: Array = []
var preset_list: OptionButton
var name_edit: LineEdit
var fps_label: Label
var sliders := {}
var species_slider: HSlider
var species_value: Label


func build(p_host) -> void:
	host = p_host
	anchor_left = 1.0
	anchor_right = 1.0
	anchor_top = 0.0
	anchor_bottom = 0.0
	offset_left = -356.0
	offset_right = -8.0
	offset_top = 8.0

	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 10)
	margin.add_theme_constant_override("margin_right", 10)
	margin.add_theme_constant_override("margin_top", 10)
	margin.add_theme_constant_override("margin_bottom", 10)
	add_child(margin)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 6)
	margin.add_child(vbox)

	var title := Label.new()
	title.text = "PRIMORDIAL DISH"
	title.add_theme_font_size_override("font_size", 18)
	vbox.add_child(title)

	fps_label = Label.new()
	fps_label.text = "FPS --"
	vbox.add_child(fps_label)
	host.fps_label = fps_label

	vbox.add_child(HSeparator.new())

	_add_slider(vbox, "force", "force_factor", 0.0, 4000.0, host.sim.force_factor, 10.0)
	_add_slider(vbox, "radius", "rmax", 15.0, 120.0, host.sim.rmax, 1.0)
	_add_slider(vbox, "repel zone", "beta", 0.05, 0.6, host.sim.beta, 0.01)
	_add_slider(vbox, "damping", "damping", 0.5, 0.99, host.sim.damping, 0.01)
	_add_slider(vbox, "speed x", "substeps", 1.0, 5.0, 1.0, 1.0)
	_add_species_row(vbox)

	vbox.add_child(HSeparator.new())

	var mlabel := Label.new()
	mlabel.text = "attraction: row species <- column"
	mlabel.add_theme_font_size_override("font_size", 12)
	vbox.add_child(mlabel)

	matrix_grid = GridContainer.new()
	vbox.add_child(matrix_grid)
	rebuild_matrix_grid()

	var btnrow := HBoxContainer.new()
	vbox.add_child(btnrow)
	_add_button(btnrow, "Randomize", host.randomize_matrix)
	_add_button(btnrow, "Mutate", host.mutate_matrix)
	_add_button(btnrow, "Zero", host.zero_matrix)

	vbox.add_child(HSeparator.new())

	preset_list = OptionButton.new()
	preset_list.custom_minimum_size.x = 306
	vbox.add_child(preset_list)

	var loadrow := HBoxContainer.new()
	vbox.add_child(loadrow)
	_add_button(loadrow, "Load", func(): host.load_preset_index(preset_list.selected))
	name_edit = LineEdit.new()
	name_edit.placeholder_text = "preset name"
	name_edit.custom_minimum_size.x = 150
	loadrow.add_child(name_edit)
	_add_button(loadrow, "Save", func(): host.save_preset(name_edit.text))

	var hints := Label.new()
	hints.text = "Space pause | R random | M mutate | B breed\n1-5 presets | C stir | LMB pull | RMB push"
	hints.add_theme_font_size_override("font_size", 11)
	vbox.add_child(hints)


func _add_slider(parent: Control, label: String, key: String, mn: float, mx: float, val: float, step: float) -> void:
	var row := HBoxContainer.new()
	parent.add_child(row)
	var l := Label.new()
	l.text = label
	l.custom_minimum_size.x = 82
	row.add_child(l)
	var s := HSlider.new()
	s.min_value = mn
	s.max_value = mx
	s.step = step
	s.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(s)
	var vl := Label.new()
	vl.custom_minimum_size.x = 52
	vl.text = "%.2f" % val
	row.add_child(vl)
	s.value = val
	s.value_changed.connect(func(v):
		vl.text = "%.2f" % v
		host.set_param(key, v))
	sliders[key] = {"slider": s, "value": vl}


func _add_species_row(parent: Control) -> void:
	var row := HBoxContainer.new()
	parent.add_child(row)
	var l := Label.new()
	l.text = "species"
	l.custom_minimum_size.x = 82
	row.add_child(l)
	species_slider = HSlider.new()
	species_slider.min_value = 2
	species_slider.max_value = 8
	species_slider.step = 1
	species_slider.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(species_slider)
	species_value = Label.new()
	species_value.custom_minimum_size.x = 52
	species_value.text = str(host.sim.num_species)
	row.add_child(species_value)
	species_slider.value = host.sim.num_species
	species_slider.value_changed.connect(func(v):
		species_value.text = str(int(v))
		host.set_species(int(v)))


func _add_button(parent: Control, text: String, cb: Callable) -> void:
	var b := Button.new()
	b.text = text
	b.pressed.connect(cb)
	parent.add_child(b)


func _color_chip(col: Color) -> ColorRect:
	var c := ColorRect.new()
	c.color = col
	c.custom_minimum_size = Vector2(18, 18)
	return c


func _make_matrix_spin(a: int, b: int) -> SpinBox:
	var sb := SpinBox.new()
	sb.min_value = -1.0
	sb.max_value = 1.0
	sb.step = 0.01
	sb.custom_minimum_size.x = 54
	sb.value = host.sim.matrix[a * host.sim.num_species + b]
	sb.value_changed.connect(func(v): host.set_matrix_at(a * host.sim.num_species + b, v))
	return sb


func rebuild_matrix_grid() -> void:
	for c in matrix_grid.get_children():
		matrix_grid.remove_child(c)
		c.queue_free()
	spins.clear()
	var k: int = host.sim.num_species
	matrix_grid.columns = k + 1
	matrix_grid.add_child(Control.new())
	for j in k:
		matrix_grid.add_child(_color_chip(host.palette[j]))
	for a in k:
		matrix_grid.add_child(_color_chip(host.palette[a]))
		for b in k:
			var sb := _make_matrix_spin(a, b)
			spins.append(sb)
			matrix_grid.add_child(sb)


func update_matrix_grid() -> void:
	var k: int = host.sim.num_species
	for a in k:
		for b in k:
			var idx := a * k + b
			if idx < spins.size():
				spins[idx].set_value_no_signal(host.sim.matrix[idx])


func sync_from_sim() -> void:
	for key in sliders:
		var e = sliders[key]
		var v: float = 0.0
		match key:
			"force_factor":
				v = host.sim.force_factor
			"rmax":
				v = host.sim.rmax
			"beta":
				v = host.sim.beta
			"damping":
				v = host.sim.damping
			"substeps":
				v = host.substeps
		e.slider.set_value_no_signal(v)
		e.value.text = "%.2f" % v
	species_slider.set_value_no_signal(host.sim.num_species)
	species_value.text = str(host.sim.num_species)
	rebuild_matrix_grid()


func refresh_presets(names: PackedStringArray) -> void:
	preset_list.clear()
	for n in names:
		preset_list.add_item(n)
