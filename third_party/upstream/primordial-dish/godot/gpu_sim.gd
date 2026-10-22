extends RefCounted

# GPU (RenderingDevice compute) version of the particle-life core.
# Same public API as sim.gd: configure, reset_positions, randomize_matrix,
# mutate_matrix, step, apply_radial, fetch_positions, to_dict, apply_dict.
# Brute-force N^2 on the GPU with ping-pong buffers; positions read back
# once per frame for rendering.

const GLSL := """#version 450

layout(local_size_x = 64, local_size_y = 1, local_size_z = 1) in;

layout(set = 0, binding = 0, std430) restrict readonly buffer PosIn { vec2 data[]; } pos_in;
layout(set = 0, binding = 1, std430) restrict readonly buffer VelIn { vec2 data[]; } vel_in;
layout(set = 0, binding = 2, std430) restrict writeonly buffer PosOut { vec2 data[]; } pos_out;
layout(set = 0, binding = 3, std430) restrict writeonly buffer VelOut { vec2 data[]; } vel_out;
layout(set = 0, binding = 4, std430) restrict readonly buffer SpeciesBuf { int data[]; } species_buf;
layout(set = 0, binding = 5, std430) restrict readonly buffer MatrixBuf { float data[]; } matrix_buf;

layout(push_constant, std430) uniform Params {
	float n; float k; float rmax; float beta;
	float damping; float ff; float dt;
	float wx; float wy;
	float mx; float my; float mstr; float mrad;
	float pad0; float pad1; float pad2;
} pc;

void main() {
	uint gi = gl_GlobalInvocationID.x;
	int n = int(pc.n);
	if (int(gi) >= n) { return; }
	int k = int(pc.k);
	vec2 pi = pos_in.data[gi];
	int si = species_buf.data[gi];
	vec2 f = vec2(0.0);
	float hw = pc.wx * 0.5;
	float hh = pc.wy * 0.5;
	float rm2 = pc.rmax * pc.rmax;
	float ob = 1.0 - pc.beta;
	for (int j = 0; j < n; j++) {
		if (j == int(gi)) { continue; }
		vec2 d = pos_in.data[j] - pi;
		if (d.x > hw) { d.x -= pc.wx; } else if (d.x < -hw) { d.x += pc.wx; }
		if (d.y > hh) { d.y -= pc.wy; } else if (d.y < -hh) { d.y += pc.wy; }
		float d2 = dot(d, d);
		if (d2 >= rm2 || d2 < 1e-4) { continue; }
		float r = sqrt(d2);
		float rn = r / pc.rmax;
		float fmag;
		if (rn < pc.beta) {
			fmag = rn / pc.beta - 1.0;
		} else {
			float a = matrix_buf.data[si * k + species_buf.data[j]];
			fmag = a * (1.0 - abs(2.0 * rn - 1.0 - pc.beta) / ob);
		}
		f += (d / r) * fmag;
	}
	vec2 v = vel_in.data[gi] * pc.damping + f * (pc.ff * pc.dt);
	if (pc.mstr != 0.0) {
		vec2 md = vec2(pc.mx, pc.my) - pi;
		if (md.x > hw) { md.x -= pc.wx; } else if (md.x < -hw) { md.x += pc.wx; }
		if (md.y > hh) { md.y -= pc.wy; } else if (md.y < -hh) { md.y += pc.wy; }
		float md2 = dot(md, md);
		if (md2 < pc.mrad * pc.mrad && md2 > 1.0) {
			float mdist = sqrt(md2);
			v += (md / mdist) * pc.mstr * (1.0 - mdist / pc.mrad) * pc.dt;
		}
	}
	vec2 np = pi + v * pc.dt;
	np.x = mod(np.x, pc.wx);
	np.y = mod(np.y, pc.wy);
	pos_out.data[gi] = np;
	vel_out.data[gi] = v;
}
"""

var world_size := Vector2(1280, 720)
var num_particles := 2400
var num_species := 5

# CPU-authoritative mirrors (small data); pos is refreshed by fetch_positions().
var pos := PackedVector2Array()
var vel := PackedVector2Array()
var species := PackedInt32Array()
var matrix := PackedFloat32Array()

var rmax := 50.0
var beta := 0.3
var damping := 0.85
var force_factor := 900.0
var dt := 1.0 / 60.0

var rng := RandomNumberGenerator.new()

static var _shared_shader := RID()
static var _shared_pipeline := RID()
static var _shared_refs := 0

var _rd: RenderingDevice
var _shader := RID()
var _pipeline := RID()
var _shader_held := false
var _pos_buf: Array = [RID(), RID()]
var _vel_buf: Array = [RID(), RID()]
var _species_buf := RID()
var _matrix_buf := RID()
var _uset: Array = [RID(), RID()]
var _ping := 0
var _mpos := Vector2()
var _mrad := 0.0
var _mstr := 0.0


static func is_supported() -> bool:
	return RenderingServer.get_rendering_device() != null


func configure(p_num: int, p_species: int, p_seed: int) -> void:
	num_particles = p_num
	num_species = p_species
	rng.seed = p_seed
	pos.resize(num_particles)
	vel.resize(num_particles)
	species.resize(num_particles)
	matrix.resize(num_species * num_species)
	for i in num_particles:
		species[i] = i % num_species
	reset_positions()
	_alloc_gpu()


func reset_positions() -> void:
	for i in num_particles:
		var ang := rng.randf() * TAU
		var spd := 30.0 + rng.randf() * 60.0
		pos[i] = Vector2(rng.randf() * world_size.x, rng.randf() * world_size.y)
		vel[i] = Vector2(cos(ang), sin(ang)) * spd
	_upload_state()


func randomize_matrix() -> void:
	for i in matrix.size():
		matrix[i] = rng.randf_range(-1.0, 1.0)
	_upload_matrix()


func mutate_matrix(amount := 0.18) -> void:
	for i in matrix.size():
		matrix[i] = clampf(matrix[i] + rng.randfn(0.0, amount), -1.0, 1.0)
	_upload_matrix()


func set_matrix_at(i: int, v: float) -> void:
	matrix[i] = v
	_upload_matrix()


func set_matrix(m: PackedFloat32Array) -> void:
	if m.size() != matrix.size():
		return
	matrix = m.duplicate()
	_upload_matrix()


func apply_radial(center: Vector2, radius: float, strength: float) -> void:
	_mpos = center
	_mrad = radius
	_mstr = strength


func step() -> void:
	if _rd == null or not _pipeline.is_valid():
		return
	var pc := PackedFloat32Array([
		float(num_particles), float(num_species), rmax, beta,
		damping, force_factor, dt,
		world_size.x, world_size.y,
		_mpos.x, _mpos.y, _mstr, _mrad,
		0.0, 0.0, 0.0])
	_mstr = 0.0
	var bytes := pc.to_byte_array()
	var list := _rd.compute_list_begin()
	_rd.compute_list_bind_compute_pipeline(list, _pipeline)
	_rd.compute_list_bind_uniform_set(list, _uset[_ping], 0)
	_rd.compute_list_set_push_constant(list, bytes, bytes.size())
	_rd.compute_list_dispatch(list, int(ceil(float(num_particles) / 64.0)), 1, 1)
	_rd.compute_list_end()
	_ping = 1 - _ping


func fetch_positions() -> void:
	if _rd == null or not _pos_buf[_ping].is_valid():
		return
	var bytes := _rd.buffer_get_data(_pos_buf[_ping], 0, num_particles * 8)
	pos = bytes.to_vector2_array()


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
	_upload_matrix()


# ---- GPU plumbing ----

func _alloc_gpu() -> void:
	_rd = RenderingServer.get_rendering_device()
	if _rd == null:
		push_warning("gpu_sim: no RenderingDevice, sim inert")
		return
	_free_gpu()
	_ensure_shader()
	var n8 := num_particles * 8
	_pos_buf[0] = _rd.storage_buffer_create(n8, pos.to_byte_array())
	_pos_buf[1] = _rd.storage_buffer_create(n8)
	_vel_buf[0] = _rd.storage_buffer_create(n8, vel.to_byte_array())
	_vel_buf[1] = _rd.storage_buffer_create(n8)
	_species_buf = _rd.storage_buffer_create(num_particles * 4, species.to_byte_array())
	_matrix_buf = _rd.storage_buffer_create(num_species * num_species * 4, matrix.to_byte_array())
	_ping = 0
	_uset[0] = _make_uset(_pos_buf[0], _vel_buf[0], _pos_buf[1], _vel_buf[1])
	_uset[1] = _make_uset(_pos_buf[1], _vel_buf[1], _pos_buf[0], _vel_buf[0])


func _ensure_shader() -> void:
	if _shader_held:
		return
	if _shared_pipeline.is_valid():
		_shader = _shared_shader
		_pipeline = _shared_pipeline
		_shared_refs += 1
		_shader_held = true
		return
	var src := RDShaderSource.new()
	src.language = RenderingDevice.SHADER_LANGUAGE_GLSL
	src.source_compute = GLSL
	var spirv := _rd.shader_compile_spirv_from_source(src)
	var err := spirv.get_stage_compile_error(RenderingDevice.SHADER_STAGE_COMPUTE)
	if err != "":
		push_error("gpu_sim shader compile: " + err)
		return
	_shader = _rd.shader_create_from_spirv(spirv)
	_pipeline = _rd.compute_pipeline_create(_shader)
	if _pipeline.is_valid():
		_shared_shader = _shader
		_shared_pipeline = _pipeline
		_shared_refs = 1
	_shader_held = _pipeline.is_valid()


func _make_uset(pin: RID, vin: RID, pout: RID, vout: RID) -> RID:
	var uniforms: Array[RDUniform] = []
	for binding in 6:
		var u := RDUniform.new()
		u.uniform_type = RenderingDevice.UNIFORM_TYPE_STORAGE_BUFFER
		u.binding = binding
		match binding:
			0: u.add_id(pin)
			1: u.add_id(vin)
			2: u.add_id(pout)
			3: u.add_id(vout)
			4: u.add_id(_species_buf)
			5: u.add_id(_matrix_buf)
		uniforms.append(u)
	var us := _rd.uniform_set_create(uniforms, _shader, 0)
	if not _rd.uniform_set_is_valid(us):
		push_error("gpu_sim: invalid uniform set")
	return us


func _upload_state() -> void:
	if _rd == null or not _pos_buf[_ping].is_valid():
		return
	_rd.buffer_update(_pos_buf[_ping], 0, num_particles * 8, pos.to_byte_array())
	_rd.buffer_update(_vel_buf[_ping], 0, num_particles * 8, vel.to_byte_array())


func _upload_matrix() -> void:
	if _rd == null or not _matrix_buf.is_valid():
		return
	_rd.buffer_update(_matrix_buf, 0, num_species * num_species * 4, matrix.to_byte_array())


func _free_gpu() -> void:
	if _rd == null:
		return
	for rid in [_pos_buf[0], _pos_buf[1], _vel_buf[0], _vel_buf[1], _species_buf, _matrix_buf]:
		if rid is RID and rid.is_valid():
			_rd.free_rid(rid)
	_pos_buf = [RID(), RID()]
	_vel_buf = [RID(), RID()]
	_species_buf = RID()
	_matrix_buf = RID()
	_uset = [RID(), RID()]


func shutdown() -> void:
	_free_gpu()
	if not _shader_held:
		return
	_shader_held = false
	_shared_refs -= 1
	if _rd != null and _shared_refs <= 0:
		if _shared_pipeline.is_valid():
			_rd.free_rid(_shared_pipeline)
		if _shared_shader.is_valid():
			_rd.free_rid(_shared_shader)
		_shared_pipeline = RID()
		_shared_shader = RID()
		_shared_refs = 0
	_pipeline = RID()
	_shader = RID()
