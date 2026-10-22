extends Node2D

const Dish = preload("res://dish.gd")
const UI = preload("res://ui.gd")
const GenView = preload("res://genview.gd")

const DEFAULT_SEED := 7

var dish: Node2D
var sim: # delegated so ui.gd works unchanged
	get:
		return dish.sim
var palette: # delegated
	get:
		return dish.palette

var paused := false
var substeps := 1
var ui: UI
var genview: Control
var fps_label: Label
var presets: Array = [] # [{name, data}]
var hand_strength := 9000.0

var breeding := false
var _tick1_done := false
var _tick_count := 0
var _work_us := 0
var _last_log_t := 0
var _demo := "--breed-demo" in OS.get_cmdline_user_args()
var gen := 1
var current_name := "wild"
var lineage_parents: Array = []


var _dbg_t0 := 0.0
var _bench := OS.has_feature("debug") or "--bench" in OS.get_cmdline_user_args()

func _dbg(msg: String) -> void:
	if not _bench:
		return
	if _dbg_t0 == 0.0:
		_dbg_t0 = Time.get_ticks_msec() / 1000.0
	var f := FileAccess.open("user://debug.log", FileAccess.READ_WRITE)
	if f == null:
		f = FileAccess.open("user://debug.log", FileAccess.WRITE)
	f.seek_end()
	f.store_line("%8.2f %s" % [Time.get_ticks_msec() / 1000.0 - _dbg_t0, msg])
	f.close()


func _ready() -> void:
	_dbg("ready_begin")
	RenderingServer.set_default_clear_color(Color(0.02, 0.02, 0.045))
	get_window().title = "Primordial Dish"
	dish = Dish.new()
	add_child(dish)
	dish.init(get_viewport_rect().size, 2400, 5, DEFAULT_SEED)
	dish.fetch_enabled = not ("--no-fetch" in OS.get_cmdline_user_args())
	_dbg("ready_dish world=%s sim=%s display=%s rd=%s" % [str(dish.sim.world_size), dish.sim.get_script().resource_path, DisplayServer.get_name(), str(RenderingServer.get_rendering_device() != null)])
	_build_ui()
	_dbg("ready_ui")
	_build_genview()
	_dbg("ready_genview")
	_scan_presets()
	if presets.size() > 0:
		load_preset_index(0)
	_dbg("ready_presets")
	dish.refresh_colors()
	dish.refresh_transforms()
	_dbg("ready_done")


func _build_ui() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	ui = UI.new()
	layer.add_child(ui)
	ui.build(self)


func _build_genview() -> void:
	var layer := CanvasLayer.new()
	layer.layer = 2
	add_child(layer)
	genview = GenView.new()
	layer.add_child(genview)
	genview.build(self)


func _physics_process(_delta: float) -> void:
	var _tick_t0 := Time.get_ticks_usec()
	# dev-only scripted run: godot --path . -- --breed-demo  (regression probe)
	if _demo:
		if _tick_count == 60:
			_start_generation()
		elif _tick_count == 660:
			_end_generation(genview.pick(2))
		elif _tick_count == 900:
			get_tree().quit()
	_handle_actions()
	if not _tick1_done:
		_tick1_done = true
		_dbg("tick1")
	_tick_count += 1
	if _bench:
		_work_us += Time.get_ticks_usec() - _tick_t0
		if _tick_count % 30 == 0:
			var now := Time.get_ticks_usec()
			_dbg("fps=%d gap=%.1fms work=%.2fms breeding=%s" % [
				Engine.get_frames_per_second(),
				(now - _last_log_t) / 1000.0 / 30.0,
				_work_us / 1000.0 / 30.0,
				str(breeding)])
			_last_log_t = now
			_work_us = 0
	if breeding:
		genview.tick(substeps)
	elif not paused:
		if Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT):
			sim.apply_radial(get_global_mouse_position(), 170.0, hand_strength)
		elif Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT):
			sim.apply_radial(get_global_mouse_position(), 170.0, -hand_strength)
		elif Input.is_action_pressed("pl_stir"):
			sim.apply_radial(sim.world_size * 0.5, 500.0, hand_strength * 0.6)
		dish.tick(substeps)
	if fps_label:
		fps_label.text = "FPS %d | %d particles | K=%d | %s%s" % [
			Engine.get_frames_per_second(), sim.num_particles, sim.num_species,
			current_name, "  [PAUSED]" if paused else ""]


func _handle_actions() -> void:
	var focus := get_viewport().gui_get_focus_owner()
	if focus is LineEdit:
		return
	if breeding:
		if Input.is_action_just_pressed("pl_shot"):
			save_screenshot()
		if Input.is_action_just_pressed("pl_faster"):
			substeps = mini(substeps + 1, 5)
		if Input.is_action_just_pressed("pl_slower"):
			substeps = maxi(substeps - 1, 1)
		if Input.is_action_just_pressed("pl_breed") or Input.is_action_just_pressed("pl_back"):
			_end_generation({})
		for i in 5:
			if Input.is_action_just_pressed("pl_preset%d" % (i + 1)):
				_end_generation(genview.pick(i))
		if Input.is_action_just_pressed("pl_pick6"):
			_end_generation(genview.pick(5))
		return
	if Input.is_action_just_pressed("pl_pause"):
		paused = not paused
	if Input.is_action_just_pressed("pl_snapshot"):
		snapshot_preset()
	if Input.is_action_just_pressed("pl_randomize"):
		randomize_matrix()
	if Input.is_action_just_pressed("pl_mutate"):
		mutate_matrix()
	for i in 5:
		if Input.is_action_just_pressed("pl_preset%d" % (i + 1)):
			load_preset_index(i)
	if Input.is_action_just_pressed("pl_shot"):
		save_screenshot()
	if Input.is_action_just_pressed("pl_faster"):
		substeps = mini(substeps + 1, 5)
	if Input.is_action_just_pressed("pl_slower"):
		substeps = maxi(substeps - 1, 1)
	if Input.is_action_just_pressed("pl_breed"):
		_start_generation()


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_SIZE_CHANGED:
		sim.world_size = get_viewport_rect().size


func _exit_tree() -> void:
	genview.stop()
	dish.shutdown()


# ---- breeding ----

func _start_generation() -> void:
	_dbg("breed_begin")
	var parent := {
		"matrix": PackedFloat32Array(sim.matrix),
		"K": sim.num_species,
		"name": current_name,
	}
	var mate := {}
	if ui.preset_list.selected >= 0 and ui.preset_list.selected < presets.size():
		mate = presets[ui.preset_list.selected].data
	lineage_parents = [current_name, mate.get("name", "")] if not mate.is_empty() else [current_name]
	_dbg("breed_mate=%s" % str(lineage_parents))
	breeding = true
	ui.visible = false
	genview.start_generation(parent, mate, gen)
	_dbg("breed_started")


func pick_child(i: int) -> void:
	if breeding:
		_end_generation(genview.pick(i))


func _end_generation(winner: Dictionary) -> void:
	breeding = false
	genview.stop()
	ui.visible = true
	if winner.is_empty():
		return
	if winner.K == sim.num_species:
		sim.set_matrix(winner.matrix)
		current_name = winner.name
		gen += 1
		ui.update_matrix_grid()


# ---- called by the UI ----

func set_param(key: String, value: float) -> void:
	match key:
		"force_factor":
			sim.force_factor = value
		"rmax":
			sim.rmax = value
		"beta":
			sim.beta = value
		"damping":
			sim.damping = value
		"substeps":
			substeps = int(value)


func set_species(k: int) -> void:
	sim.configure(sim.num_particles, k, sim.rng.seed)
	sim.randomize_matrix()
	dish.reload()
	ui.rebuild_matrix_grid()
	ui.update_matrix_grid()


func set_matrix_at(i: int, v: float) -> void:
	sim.set_matrix_at(i, v)


func randomize_matrix() -> void:
	sim.randomize_matrix()
	current_name = "wild"
	ui.update_matrix_grid()


func mutate_matrix() -> void:
	sim.mutate_matrix()
	ui.update_matrix_grid()


func zero_matrix() -> void:
	var z := PackedFloat32Array()
	z.resize(sim.matrix.size())
	sim.set_matrix(z)
	ui.update_matrix_grid()


func save_preset(pname: String) -> void:
	pname = pname.strip_edges()
	if pname == "":
		pname = "preset_%d" % int(Time.get_unix_time_from_system())
	DirAccess.make_dir_recursive_absolute("user://presets")
	var d: Dictionary = sim.to_dict()
	d["name"] = pname
	if not lineage_parents.is_empty():
		d["parents"] = lineage_parents
		d["gen"] = gen
	var f := FileAccess.open("user://presets/%s.json" % pname.validate_filename(), FileAccess.WRITE)
	f.store_string(JSON.stringify(d, "  "))
	f.close()
	_scan_presets()


func load_preset_index(i: int) -> void:
	if i < 0 or i >= presets.size():
		return
	sim.apply_dict(presets[i].data)
	current_name = presets[i].name
	dish.reload()
	ui.sync_from_sim()


func save_screenshot() -> void:
	DirAccess.make_dir_recursive_absolute("user://screenshots")
	var img := get_viewport().get_texture().get_image()
	var path := "user://screenshots/shot_%d.png" % int(Time.get_unix_time_from_system())
	img.save_png(path)
	print("screenshot saved: ", path)


func snapshot_preset() -> void:
	DirAccess.make_dir_recursive_absolute("user://presets")
	var d: Dictionary = sim.to_dict()
	d["name"] = "%s_%d" % [current_name, int(Time.get_unix_time_from_system()) % 1000000]
	if not lineage_parents.is_empty():
		d["parents"] = lineage_parents
		d["gen"] = gen
	var path := "user://presets/%s.json" % d["name"]
	var f := FileAccess.open(path, FileAccess.WRITE)
	f.store_string(JSON.stringify(d, "  "))
	f.close()
	print("snapshot saved: ", path)
	_scan_presets()


func _scan_presets() -> void:
	presets.clear()
	for dir_path in ["res://presets", "user://presets"]:
		var dir := DirAccess.open(dir_path)
		if dir == null:
			continue
		for fname in dir.get_files():
			if not fname.ends_with(".json"):
				continue
			var d = JSON.parse_string(FileAccess.get_file_as_string(dir_path + "/" + fname))
			if d is Dictionary:
				presets.append({"name": d.get("name", fname.get_basename()), "data": d})
	if ui:
		var names := PackedStringArray()
		for p in presets:
			names.append(p.name)
		ui.refresh_presets(names)
