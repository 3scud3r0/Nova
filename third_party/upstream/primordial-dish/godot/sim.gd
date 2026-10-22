extends RefCounted

# Particle Life core: K species, KxK attraction/repulsion matrix,
# toroidal world, uniform-grid neighbor search (O(n) instead of O(n^2)).
# Force law (normalized r in [0,1] over rmax):
#   r < beta        -> universal short-range repulsion: f = r/beta - 1
#   beta <= r < 1   -> triangle peaked at r=(1+beta)/2 with height matrix[a][b]

var world_size := Vector2(1280, 720)
var num_particles := 2400
var num_species := 5

var pos := PackedVector2Array()
var vel := PackedVector2Array()
var species := PackedInt32Array()
var matrix := PackedFloat32Array() # force on species a from species b: matrix[a*K+b]

var rmax := 50.0
var beta := 0.3
var damping := 0.85
var force_factor := 900.0
var dt := 1.0 / 60.0

var rng := RandomNumberGenerator.new()

var _gw := 0
var _gh := 0
var _cell := 50.0
var _count := PackedInt32Array()
var _start := PackedInt32Array()
var _cursor := PackedInt32Array()
var _order := PackedInt32Array()
var _pcell := PackedInt32Array()


func configure(p_num: int, p_species: int, p_seed: int) -> void:
	num_particles = p_num
	num_species = p_species
	rng.seed = p_seed
	pos.resize(num_particles)
	vel.resize(num_particles)
	species.resize(num_particles)
	matrix.resize(num_species * num_species)
	_order.resize(num_particles)
	_pcell.resize(num_particles)
	for i in num_particles:
		species[i] = i % num_species
	reset_positions()


func reset_positions() -> void:
	for i in num_particles:
		var ang := rng.randf() * TAU
		var spd := 30.0 + rng.randf() * 60.0
		pos[i] = Vector2(rng.randf() * world_size.x, rng.randf() * world_size.y)
		vel[i] = Vector2(cos(ang), sin(ang)) * spd


func randomize_matrix() -> void:
	for i in matrix.size():
		matrix[i] = rng.randf_range(-1.0, 1.0)


func mutate_matrix(amount := 0.18) -> void:
	for i in matrix.size():
		matrix[i] = clampf(matrix[i] + rng.randfn(0.0, amount), -1.0, 1.0)


func step() -> void:
	_rebuild_grid()
	var n := num_particles
	var k := num_species
	var w := world_size.x
	var h := world_size.y
	var hw := w * 0.5
	var hh := h * 0.5
	var rm2 := rmax * rmax
	var inv_rm := 1.0 / rmax
	var inv_beta := 1.0 / beta
	var ob := 1.0 - beta
	var ff := force_factor
	for i in n:
		var pi := pos[i]
		var fx := 0.0
		var fy := 0.0
		var cx := _pcell[i] % _gw
		var cy := _pcell[i] / _gw
		for oy in range(-1, 2):
			for ox in range(-1, 2):
				var nx: int = (cx + ox + _gw) % _gw
				var ny: int = (cy + oy + _gh) % _gh
				var cell := ny * _gw + nx
				var s := _start[cell]
				var e := s + _count[cell]
				for idx in range(s, e):
					var j := _order[idx]
					if j == i:
						continue
					var d := pos[j] - pi
					if d.x > hw:
						d.x -= w
					elif d.x < -hw:
						d.x += w
					if d.y > hh:
						d.y -= h
					elif d.y < -hh:
						d.y += h
					var d2 := d.x * d.x + d.y * d.y
					if d2 >= rm2 or d2 < 0.0001:
						continue
					var r := sqrt(d2)
					var rn := r * inv_rm
					var f: float
					if rn < beta:
						f = rn * inv_beta - 1.0
					else:
						f = matrix[species[i] * k + species[j]] * (1.0 - absf(2.0 * rn - 1.0 - beta) / ob)
					var inv_r := 1.0 / r
					fx += d.x * inv_r * f
					fy += d.y * inv_r * f
		var v := vel[i] * damping + Vector2(fx, fy) * (ff * dt)
		vel[i] = v
		var np := pi + v * dt
		np.x = fposmod(np.x, w)
		np.y = fposmod(np.y, h)
		pos[i] = np


func set_matrix_at(i: int, v: float) -> void:
	matrix[i] = v


func set_matrix(m: PackedFloat32Array) -> void:
	if m.size() != matrix.size():
		return
	matrix = m.duplicate()


func apply_radial(center: Vector2, radius: float, strength: float) -> void:
	var r2 := radius * radius
	var w := world_size.x
	var h := world_size.y
	var hw := w * 0.5
	var hh := h * 0.5
	for i in num_particles:
		var d := center - pos[i]
		if d.x > hw:
			d.x -= w
		elif d.x < -hw:
			d.x += w
		if d.y > hh:
			d.y -= h
		elif d.y < -hh:
			d.y += h
		var d2 := d.length_squared()
		if d2 > r2 or d2 < 1.0:
			continue
		var dist := sqrt(d2)
		var f := strength * (1.0 - dist / radius) * dt
		vel[i] += (d / dist) * f


func to_dict() -> Dictionary:
	return {
		"num_particles": num_particles,
		"num_species": num_species,
		"seed": rng.seed,
		"rmax": rmax,
		"beta": beta,
		"damping": damping,
		"force_factor": force_factor,
		"matrix": Array(matrix),
	}


func apply_dict(d: Dictionary) -> void:
	rmax = float(d.get("rmax", rmax))
	beta = float(d.get("beta", beta))
	damping = float(d.get("damping", damping))
	force_factor = float(d.get("force_factor", force_factor))
	configure(int(d.get("num_particles", num_particles)), int(d.get("num_species", num_species)), int(d.get("seed", 1)))
	var m: Array = d.get("matrix", [])
	for i in mini(m.size(), matrix.size()):
		matrix[i] = float(m[i])


func _rebuild_grid() -> void:
	_cell = rmax
	_gw = maxi(1, int(ceil(world_size.x / _cell)))
	_gh = maxi(1, int(ceil(world_size.y / _cell)))
	var ncells := _gw * _gh
	if _count.size() != ncells:
		_count.resize(ncells)
		_start.resize(ncells)
		_cursor.resize(ncells)
	for c in ncells:
		_count[c] = 0
	for i in num_particles:
		var cx := clampi(int(pos[i].x / _cell), 0, _gw - 1)
		var cy := clampi(int(pos[i].y / _cell), 0, _gh - 1)
		var cell := cy * _gw + cx
		_pcell[i] = cell
		_count[cell] += 1
	var acc := 0
	for c in ncells:
		_start[c] = acc
		_cursor[c] = acc
		acc += _count[c]
	for i in num_particles:
		var cell := _pcell[i]
		_order[_cursor[cell]] = i
		_cursor[cell] += 1


func fetch_positions() -> void:
	pass # CPU sim: pos is already authoritative
