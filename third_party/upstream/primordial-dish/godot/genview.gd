extends Control

# Generation mode: six live dishes side by side bred from one parent.
# 1: clone (elitism control) · 2-4: mutations at rising sigma
# 5: crossover with the preset selected in the dropdown (or stronger mutation)
# 6: wild random (exploration baseline). Pick with keys 1-6, or click a dish.
# Each cell's viewport has the same area as the focus world and its own
# aspect -> identical particle density (same dynamics), no distortion.

const Dish = preload("res://dish.gd")
const OPERATORS := ["clone", "mutate 0.08", "mutate 0.18", "mutate 0.35", "crossover", "wild"]
const LABEL_H := 24.0

var host
var cells: Array = []     # [Control per cell]
var dishes: Array = []    # [Dish]
var vps: Array = []       # [SubViewport]
var scs: Array = []       # [SubViewportContainer]
var labels: Array = []
var child_names: Array = []
var base_area := 1280.0 * 720.0


func build(p_host) -> void:
	host = p_host
	var w: Vector2 = host.sim.world_size
	base_area = w.x * w.y
	set_anchors_preset(Control.PRESET_FULL_RECT)
	var bg := ColorRect.new()
	bg.color = Color(0.02, 0.02, 0.045, 1.0)
	bg.name = "bg"
	add_child(bg)
	for i in 6:
		var cell := Control.new()
		add_child(cell)
		cells.append(cell)
		var sc := SubViewportContainer.new()
		sc.stretch = true
		cell.add_child(sc)
		scs.append(sc)
		var vp := SubViewport.new()
		sc.add_child(vp)
		vps.append(vp)
		var dish: Node2D = Dish.new()
		vp.add_child(dish)
		dishes.append(dish)
		var lb := Label.new()
		lb.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		lb.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		lb.add_theme_font_size_override("font_size", 13)
		cell.add_child(lb)
		labels.append(lb)
		var idx := i
		sc.gui_input.connect(func(ev):
			if ev is InputEventMouseButton and ev.pressed and ev.button_index == MOUSE_BUTTON_LEFT:
				host.pick_child(idx))
	visible = false


func _layout() -> void:
	var ws := get_viewport_rect().size
	size = ws
	var bg := get_node("bg") as ColorRect
	bg.position = Vector2.ZERO
	bg.size = ws
	var cw := ws.x / 3.0
	var ch := ws.y / 2.0
	for i in 6:
		var col := i % 3
		var row := i / 3
		cells[i].position = Vector2(col * cw, row * ch)
		cells[i].size = Vector2(cw, ch)
		scs[i].position = Vector2.ZERO
		scs[i].size = Vector2(cw, ch - LABEL_H)
		labels[i].position = Vector2(0, ch - LABEL_H)
		labels[i].size = Vector2(cw, LABEL_H)


func _notification(what: int) -> void:
	if what == NOTIFICATION_RESIZED and visible:
		_layout()


func start_generation(parent: Dictionary, mate: Dictionary, gen: int) -> void:
	_layout()
	base_area = host.sim.world_size.x * host.sim.world_size.y
	var rng := RandomNumberGenerator.new()
	rng.randomize()
	var a: PackedFloat32Array = parent.matrix
	var k: int = parent.K
	var ops := OPERATORS.duplicate()
	if mate.is_empty() or int(mate.get("num_species", -1)) != k or not mate.has("matrix"):
		ops[4] = "mutate 0.25"
	child_names.clear()
	for i in 6:
		var m := PackedFloat32Array(a)
		match i:
			0:
				pass # clone: the parent itself, re-run as control
			1:
				_mutate(m, rng, 0.08)
			2:
				_mutate(m, rng, 0.18)
			3:
				_mutate(m, rng, 0.35)
			4:
				if ops[4] == "crossover":
					m = _crossover(a, PackedFloat32Array(mate.matrix), rng, k)
					_mutate(m, rng, 0.08)
				else:
					_mutate(m, rng, 0.25)
			5:
				for j in m.size():
					m[j] = rng.randf_range(-1.0, 1.0)
		child_names.append("gen%d-%s" % [gen, "abcdef"[i]])
		# container drives the viewport size (stretch); world = cell pixels,
		# N scaled to keep particle density comparable across cells
		var cell_world: Vector2 = scs[i].size
		var n_child := maxi(300, int(2400.0 * cell_world.x * cell_world.y / base_area))
		dishes[i].init(cell_world, n_child, k, rng.randi())
		dishes[i].sim.set_matrix(m)
		dishes[i].refresh_colors()
		dishes[i].refresh_transforms()
		labels[i].text = "%d: %s  [%s]" % [i + 1, child_names[i], ops[i]]
	visible = true



func _mutate(m: PackedFloat32Array, rng: RandomNumberGenerator, sigma: float) -> void:
	for j in m.size():
		m[j] = clampf(m[j] + rng.randfn(0.0, sigma), -1.0, 1.0)


func _crossover(a: PackedFloat32Array, b: PackedFloat32Array, rng: RandomNumberGenerator, k: int) -> PackedFloat32Array:
	# row-wise: each species' row comes from one of the two parents
	var m := PackedFloat32Array(a)
	for row in k:
		if rng.randf() < 0.5:
			for col in k:
				m[row * k + col] = b[row * k + col]
	return m


func tick(substeps: int) -> void:
	for d in dishes:
		d.tick(substeps)


func pick(i: int) -> Dictionary:
	if i < 0 or i >= dishes.size():
		return {}
	return {
		"matrix": dishes[i].sim.matrix.duplicate(),
		"K": dishes[i].sim.num_species,
		"name": child_names[i],
	}


func stop() -> void:
	for d in dishes:
		d.shutdown()
	visible = false
