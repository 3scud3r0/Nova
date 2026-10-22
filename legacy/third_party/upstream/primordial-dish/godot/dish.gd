extends Node2D

# One self-contained petri dish: sim core + multimesh rendering.
# Used for the main focus dish and for each cell of the generation grid.

const Sim = preload("res://sim.gd")
const GpuSim = preload("res://gpu_sim.gd")

const PARTICLE_SIZE := 11.0

static var _tex: Texture2D = null # soft-dot sprite shared by all dishes

var sim # Sim or GpuSim (same API)
var mm: MultiMesh
var palette := PackedColorArray()
var _inited := false


func init(world: Vector2, num: int, k: int, p_seed: int) -> void:
	if _inited:
		shutdown()
	if _tex == null:
		_tex = _make_texture()
	sim = GpuSim.new() if GpuSim.is_supported() else Sim.new()
	sim.world_size = world
	sim.configure(num, k, p_seed)
	sim.randomize_matrix()
	_build_palette()
	_build_multimesh()
	_inited = true


func _make_texture() -> Texture2D:
	var img := Image.create(48, 48, false, Image.FORMAT_RGBA8)
	var c := Vector2(23.5, 23.5)
	for y in 48:
		for x in 48:
			var d := (Vector2(x, y) - c).length() / 24.0
			var a := clampf(1.0 - d, 0.0, 1.0)
			a = a * a * (3.0 - 2.0 * a)
			img.set_pixel(x, y, Color(1, 1, 1, a))
	return ImageTexture.create_from_image(img)


func _build_palette() -> void:
	palette.clear()
	for i in sim.num_species:
		palette.append(Color.from_hsv(float(i) / sim.num_species, 0.75, 1.0))


func _build_multimesh() -> void:
	var quad := QuadMesh.new()
	quad.size = Vector2(PARTICLE_SIZE, PARTICLE_SIZE)
	var mat := CanvasItemMaterial.new()
	mat.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	mm = MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_2D
	mm.use_colors = true
	mm.mesh = quad
	mm.instance_count = sim.num_particles
	var mmi := MultiMeshInstance2D.new()
	mmi.multimesh = mm
	mmi.texture = _tex
	mmi.material = mat
	add_child(mmi)


var fetch_enabled := true


func tick(substeps: int) -> void:
	for s in substeps:
		sim.step()
	if fetch_enabled:
		sim.fetch_positions()
	refresh_transforms()


func refresh_colors() -> void:
	for i in sim.num_particles:
		mm.set_instance_color(i, palette[sim.species[i]])


func refresh_transforms() -> void:
	for i in sim.num_particles:
		mm.set_instance_transform_2d(i, Transform2D(0.0, sim.pos[i]))


func reload() -> void:
	# call after sim.apply_dict() or configure() changed counts/species
	_build_palette()
	mm.instance_count = sim.num_particles
	refresh_colors()
	refresh_transforms()


func shutdown() -> void:
	if _inited and sim and sim.has_method("shutdown"):
		sim.shutdown()
	_inited = false
