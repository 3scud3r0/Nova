"use strict";
const $ = (id) => document.getElementById(id);
const SHADER_NAMES = [
  "particle_life",
  "fluid_surface",
  "fluid_filter",
  "fluid_lighting",
  "fluid_post",
];
const MASK = (1n << 64n) - 1n;
class SplitMix64 {
  constructor(seed) {
    this.state = BigInt(seed);
    if (this.state < 0n || this.state > MASK)
      throw Error("Semente deve ser uint64.");
  }
  next() {
    this.state = (this.state + 0x9e3779b97f4a7c15n) & MASK;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
    return (z ^ (z >> 31n)) & MASK;
  }
  uniform() {
    return Number(this.next() >> 11n) / 9007199254740992;
  }
}
const COLORS = [
  "#f23973",
  "#ff893b",
  "#ebd453",
  "#72ce90",
  "#24b8d5",
  "#4a6eee",
  "#9752e2",
  "#e456cb",
];
const PRESETS = {
  ink: {
    strength: 5,
    flow: 0.35,
    roughness: 0.24,
    sss: 1.3,
    absorption: 2.4,
    film: 350,
    iridescence: 0.2,
    iterations: 3,
    filter: 6,
    damping: 1.8,
  },
  life: {
    strength: 8,
    flow: 0,
    roughness: 0.32,
    sss: 0.25,
    absorption: 2,
    film: 0,
    iridescence: 0,
    iterations: 0,
    filter: 0,
    damping: 1.4,
  },
  iridescent: {
    strength: 4,
    flow: 0.2,
    roughness: 0.1,
    sss: 0.7,
    absorption: 3.6,
    film: 620,
    iridescence: 0.95,
    iterations: 3,
    filter: 7,
    damping: 2.5,
  },
  nebula: {
    strength: 2.5,
    flow: 0.7,
    roughness: 0.28,
    sss: 2.5,
    absorption: 0.7,
    film: 190,
    iridescence: 0.1,
    iterations: 1,
    filter: 5,
    damping: 2.2,
  },
};
function clone(x) {
  return JSON.parse(JSON.stringify(x));
}
function colorLinear(hex) {
  return [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
}
function normalize(v) {
  const l = Math.hypot(...v) || 1;
  return v.map((x) => x / l);
}
function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function sha(bytes) {
  return crypto.subtle
    .digest("SHA-256", bytes)
    .then((b) =>
      Array.from(new Uint8Array(b), (x) =>
        x.toString(16).padStart(2, "0"),
      ).join(""),
    );
}
function download(data, name, type = "application/json") {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function toBase64(bytes) {
  let chunks = [];
  for (let i = 0; i < bytes.length; i += 16384)
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 16384)));
  return btoa(chunks.join(""));
}
function validateSettings(s) {
  if (
    !s ||
    !Number.isInteger(s.count) ||
    s.count < 2 ||
    s.count > 100000 ||
    !PRESETS[s.preset] ||
    !["draft", "balanced", "high", "ultra"].includes(s.quality)
  )
    throw Error("Configuração de cena fora dos limites.");
  new SplitMix64(s.seed);
  if (typeof s.planar !== "boolean") throw Error("Dimensão inválida.");
  const bounds = {
    strength: [0.2, 20],
    flow: [0, 2],
    roughness: [0.04, 0.8],
    sss: [0, 4],
    absorption: [0.1, 8],
    film: [0, 1200],
    iridescence: [0, 1],
    radius: [0.008, 0.06],
    exposure: [0.1, 3],
    bloom: [0, 1.5],
    focus: [1, 6],
    aperture: [0, 10],
    damping: [0, 20],
  };
  for (const [k, [lo, hi]] of Object.entries(bounds))
    if (!Number.isFinite(s[k]) || s[k] < lo || s[k] > hi)
      throw Error("Parâmetro inválido: " + k);
  if (
    !Number.isInteger(s.iterations) ||
    s.iterations < 0 ||
    s.iterations > 4 ||
    !Number.isInteger(s.filter) ||
    s.filter < 0 ||
    s.filter > 8
  )
    throw Error("Orçamento de projeção/filtro inválido.");
}
function checkMatrix(matrix) {
  if (
    !Array.isArray(matrix) ||
    matrix.length !== 64 ||
    matrix.some((x) => !Number.isFinite(x) || Math.abs(x) > 1)
  )
    throw Error("Matriz de afinidade inválida.");
}
function matrixFor(seed) {
  const rng = new SplitMix64(BigInt(seed) ^ 0xaff1717n);
  return Array.from({ length: 64 }, (_, i) => {
    const value = rng.uniform() * 2 - 1;
    return i % 9 === 0 ? 0.7 : value;
  });
}
class Chromatic {
  constructor(device, context, format) {
    this.device = device;
    this.context = context;
    this.format = format;
    this.canvas = $("universe");
    this.tick = 0;
    this.running = true;
    this.tail = Promise.resolve();
    this.resources = [];
    this.targets = [];
    this.yaw = 0.32;
    this.pitch = 0.18;
    this.distance = 3.3;
    this.fps = 0;
    this.frameCount = 0;
    this.lastStats = 0;
    this.replay = null;
    this.recording = null;
    this.lastTime = 0;
    this.accumulator = 0;
    this.capture = false;
    this.events = [];
    this.eventCursor = 0;
    this.width = 0;
    this.height = 0;
    this.filterAxis = [];
    this.statusMetrics = {};
  }
  enqueue(operation) {
    const result = this.tail.then(operation);
    this.tail = result.catch((error) => this.error(error));
    return result;
  }
  error(error) {
    $("error").textContent = String(error.message || error);
    console.error(error);
  }
  buffer(size, usage, data = null) {
    const b = this.device.createBuffer({
      size: Math.ceil(size / 4) * 4,
      usage,
      mappedAtCreation: !!data,
    });
    if (data) {
      new Uint8Array(b.getMappedRange()).set(
        new Uint8Array(
          data.buffer || data,
          data.byteOffset || 0,
          data.byteLength,
        ),
      );
      b.unmap();
    }
    this.resources.push(b);
    return b;
  }
  async pipelines() {
    this.modules = {};
    for (const name of SHADER_NAMES) {
      const module = this.device.createShaderModule({
        code: SOURCES[name],
        label: name,
      });
      const info = await module.getCompilationInfo();
      const errors = info.messages.filter((m) => m.type === "error");
      if (errors.length)
        throw Error(name + ": " + errors.map((m) => m.message).join("\n"));
      this.modules[name] = module;
    }
    const storage = (
      binding,
      readOnly,
      visibility = GPUShaderStage.COMPUTE,
    ) => ({
      binding,
      visibility,
      buffer: { type: readOnly ? "read-only-storage" : "storage" },
    });
    this.simLayout = this.device.createBindGroupLayout({
      entries: [
        storage(0, true),
        storage(1, false),
        storage(2, false),
        storage(3, false),
        storage(4, false),
        storage(5, true),
        storage(6, false),
        {
          binding: 7,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        },
      ],
    });
    const layout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.simLayout],
    });
    this.compute = {};
    for (const entry of [
      "clear_stats",
      "clear_grid",
      "build_grid",
      "predict",
      "solve_density",
      "project",
      "finalize",
    ])
      this.compute[entry] = await this.device.createComputePipelineAsync({
        layout,
        compute: { module: this.modules.particle_life, entryPoint: entry },
      });
    this.surfaceLayout = this.device.createBindGroupLayout({
      entries: [
        storage(0, true, GPUShaderStage.VERTEX),
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
        storage(2, true, GPUShaderStage.VERTEX),
      ],
    });
    const sl = this.device.createPipelineLayout({
      bindGroupLayouts: [this.surfaceLayout],
    });
    this.depthPipeline = await this.device.createRenderPipelineAsync({
      layout: sl,
      vertex: { module: this.modules.fluid_surface, entryPoint: "splat" },
      fragment: {
        module: this.modules.fluid_surface,
        entryPoint: "sphere_depth",
        targets: [{ format: "r32float" }],
      },
      primitive: { topology: "triangle-list" },
      depthStencil: {
        format: "depth32float",
        depthWriteEnabled: true,
        depthCompare: "less",
      },
    });
    this.thicknessPipeline = await this.device.createRenderPipelineAsync({
      layout: sl,
      vertex: { module: this.modules.fluid_surface, entryPoint: "splat" },
      fragment: {
        module: this.modules.fluid_surface,
        entryPoint: "optical_thickness",
        targets: [
          {
            format: "rgba16float",
            blend: {
              color: { srcFactor: "one", dstFactor: "one", operation: "add" },
              alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
            },
          },
        ],
      },
      primitive: { topology: "triangle-list" },
    });
    const textureEntry = (binding, visibility, unfilterable = false) => ({
      binding,
      visibility,
      texture: {
        sampleType: unfilterable ? "unfilterable-float" : "float",
        viewDimension: "2d",
      },
    });
    const uniformEntry = (binding, visibility) => ({
      binding,
      visibility,
      buffer: { type: "uniform" },
    });
    const pipelineLayout = (entries) =>
      this.device.createPipelineLayout({
        bindGroupLayouts: [this.device.createBindGroupLayout({ entries })],
      });
    const cv = GPUShaderStage.COMPUTE,
      fv = GPUShaderStage.FRAGMENT;
    const filterLayout = pipelineLayout([
      textureEntry(0, cv, true),
      textureEntry(1, cv),
      {
        binding: 2,
        visibility: cv,
        storageTexture: {
          access: "write-only",
          format: "r32float",
          viewDimension: "2d",
        },
      },
      {
        binding: 3,
        visibility: cv,
        storageTexture: {
          access: "write-only",
          format: "rgba16float",
          viewDimension: "2d",
        },
      },
      uniformEntry(4, cv),
    ]);
    const lightingLayout = pipelineLayout([
      textureEntry(0, fv, true),
      textureEntry(1, fv),
      uniformEntry(2, fv),
    ]);
    const postLayout = pipelineLayout([
      textureEntry(0, fv),
      textureEntry(1, fv, true),
      { binding: 2, visibility: fv, sampler: { type: "filtering" } },
      uniformEntry(3, fv),
    ]);
    this.filterPipeline = await this.device.createComputePipelineAsync({
      layout: filterLayout,
      compute: {
        module: this.modules.fluid_filter,
        entryPoint: "bilateral_main",
      },
    });
    this.lightingPipeline = await this.device.createRenderPipelineAsync({
      layout: lightingLayout,
      vertex: { module: this.modules.fluid_lighting, entryPoint: "fullscreen" },
      fragment: {
        module: this.modules.fluid_lighting,
        entryPoint: "shade",
        targets: [{ format: "rgba16float" }],
      },
      primitive: { topology: "triangle-list" },
    });
    this.postPipeline = await this.device.createRenderPipelineAsync({
      layout: postLayout,
      vertex: { module: this.modules.fluid_post, entryPoint: "fullscreen" },
      fragment: {
        module: this.modules.fluid_post,
        entryPoint: "post",
        targets: [{ format: this.format }],
      },
      primitive: { topology: "triangle-list" },
    });
    this.sampler = this.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
  }
  async reset(settings, saved = null) {
    validateSettings(settings);
    await this.device.queue.onSubmittedWorkDone();
    for (const b of this.resources) b.destroy();
    for (const t of this.targets) t.destroy();
    this.resources = [];
    this.targets = [];
    this.width = 0;
    this.height = 0;
    this.particles = null;
    this.settings = clone(settings);
    this.initial = clone(settings);
    this.tick = 0;
    this.events = [];
    this.eventCursor = 0;
    this.accumulator = 0;
    this.replay = null;
    this.matrix = matrixFor(settings.seed);
    this.palette = COLORS.slice();
    const n = settings.count;
    this.gridDim = Math.floor(2 / 0.18);
    this.gridCells = this.gridDim ** 3;
    let data;
    if (saved?.data) {
      data = saved.decoded;
      this.tick = saved.tick;
    } else {
      const genesis = saved && !saved.data ? saved.initial : settings;
      const rng = new SplitMix64(genesis.seed);
      data = new Float32Array(n * 12);
      for (let i = 0; i < n; i++) {
        let p = [
          rng.uniform() * 2 - 1,
          rng.uniform() * 2 - 1,
          rng.uniform() * 2 - 1,
        ];
        if (settings.preset !== "life") {
          const group = i % 8,
            angle = (group * Math.PI * 2) / 8;
          p = p.map((x) => x * 0.18);
          p[0] += 0.45 * Math.cos(angle);
          p[1] += 0.3 * Math.sin(angle);
          p[2] += 0.23 * Math.sin(angle * 2);
        }
        if (genesis.planar) p[2] = 0;
        const k = i * 12;
        data.set([...p, i % 8, 0, 0, 0, 1, ...p, 0], k);
      }
    }
    if (saved) {
      checkMatrix(saved.matrix);
      this.matrix = saved.matrix.slice();
      if (
        !Array.isArray(saved.palette) ||
        saved.palette.length !== 8 ||
        saved.palette.some((c) => !/^#[0-9a-f]{6}$/i.test(c))
      )
        throw Error("Paleta inválida.");
      this.palette = saved.palette.slice();
      this.initial = clone(saved.initial);
      this.events = saved.timeline || [];
      if (this.events.length > 4096) throw Error("Histórico excede o limite.");
      validateSettings(this.initial);
      this.validateEvents(this.events);
      if (!saved.data) {
        this.matrix = matrixFor(this.initial.seed);
        this.palette = COLORS.slice();
        this.settings = {
          ...clone(saved.settings),
          strength: this.initial.strength,
          flow: this.initial.flow,
          planar: this.initial.planar,
        };
        this.replay = { target: saved.tick, expected: saved.state_sha256 };
        this.tick = 0;
        this.eventCursor = 0;
      } else this.eventCursor = this.events.length;
    }
    this.particles = [
      this.buffer(
        data.byteLength,
        GPUBufferUsage.STORAGE |
          GPUBufferUsage.COPY_SRC |
          GPUBufferUsage.COPY_DST,
        data,
      ),
      this.buffer(
        data.byteLength,
        GPUBufferUsage.STORAGE |
          GPUBufferUsage.COPY_SRC |
          GPUBufferUsage.COPY_DST,
        data,
      ),
    ];
    this.current = 0;
    this.heads = this.buffer(this.gridCells * 4, GPUBufferUsage.STORAGE);
    this.links = this.buffer(n * 4, GPUBufferUsage.STORAGE);
    this.density = this.buffer(n * 16, GPUBufferUsage.STORAGE);
    this.affinities = this.buffer(
      64 * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      new Float32Array(this.matrix),
    );
    this.statsBuffer = this.buffer(
      16,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    );
    this.statsRead = this.buffer(
      16,
      GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    );
    this.simUniform = this.buffer(
      80,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );
    this.cameraUniform = this.buffer(
      128,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );
    this.paletteBuffer = this.buffer(
      128,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    this.postUniform = this.buffer(
      48,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );
    this.simGroups = [0, 1].map((i) =>
      this.device.createBindGroup({
        layout: this.simLayout,
        entries: [
          this.particles[i],
          this.particles[1 - i],
          this.heads,
          this.links,
          this.density,
          this.affinities,
          this.statsBuffer,
          this.simUniform,
        ].map((buffer, binding) => ({ binding, resource: { buffer } })),
      }),
    );
    this.surfaceGroups = this.particles.map((buffer) =>
      this.device.createBindGroup({
        layout: this.surfaceLayout,
        entries: [buffer, this.cameraUniform, this.paletteBuffer].map(
          (buffer, binding) => ({ binding, resource: { buffer } }),
        ),
      }),
    );
    this.writePalette();
    this.syncUI();
    this.running = true;
    $("pause").textContent = "Pausar";
    $("error").textContent = "";
  }
  validateEvents(events, initial = this.initial) {
    let last = 0;
    for (const e of events) {
      if (!Number.isInteger(e.tick) || e.tick < last || e.tick > 0xffffffff)
        throw Error("Relógio de eventos inválido.");
      last = e.tick;
      if (e.kind === "matrix") {
        if (
          !Number.isInteger(e.index) ||
          e.index < 0 ||
          e.index >= 64 ||
          !Number.isFinite(e.value) ||
          Math.abs(e.value) > 1
        )
          throw Error("Evento de matriz inválido.");
      } else if (e.kind === "parameter") {
        const copy = { ...initial, [e.name]: e.value };
        if (!["strength", "flow", "planar"].includes(e.name))
          throw Error("Parâmetro de evento não permitido.");
        validateSettings(copy);
      } else if (e.kind === "palette") {
        if (
          !Number.isInteger(e.index) ||
          e.index < 0 ||
          e.index >= 8 ||
          !/^#[0-9a-f]{6}$/i.test(e.value)
        )
          throw Error("Evento de paleta inválido.");
      } else throw Error("Tipo de evento inválido.");
    }
  }
  writePalette() {
    this.device.queue.writeBuffer(
      this.paletteBuffer,
      0,
      new Float32Array(this.palette.flatMap((c) => [...colorLinear(c), 1])),
    );
  }
  syncUI() {
    $("planar").value = this.settings.planar ? "1" : "0";
    if (
      !Array.from($("count").options).some(
        (o) => o.value === String(this.settings.count),
      )
    ) {
      const option = document.createElement("option");
      option.value = String(this.settings.count);
      option.textContent = String(this.settings.count);
      $("count").append(option);
    }
    for (const name of [
      "preset",
      "count",
      "quality",
      "seed",
      "strength",
      "flow",
      "radius",
      "roughness",
      "absorption",
      "sss",
      "film",
      "iridescence",
      "exposure",
      "bloom",
      "focus",
      "aperture",
    ])
      $(name).value = this.settings[name];
    this.matrixUI();
    for (let i = 0; i < 8; i++) $("color" + i).value = this.palette[i];
    this.labels();
  }
  labels() {
    for (const name of ["strength", "flow", "radius"])
      $(name + "Value").textContent = Number(this.settings[name]).toFixed(
        name === "radius" ? 3 : 2,
      );
  }
  matrixUI() {
    for (let i = 0; i < 64; i++) {
      const b = $("m" + i),
        a = this.matrix[i];
      b.style.background =
        a > 0
          ? `rgba(92,200,167,${0.15 + 0.8 * a})`
          : `rgba(230,91,132,${0.15 - 0.8 * a})`;
      b.title = `${Math.floor(i / 8)} → ${i % 8}: ${a.toFixed(2)}`;
      b.textContent = a.toFixed(1);
    }
  }
  applyEvent(e, record = true) {
    if (record) {
      if (this.events.length >= 4096)
        throw Error("Histórico cheio; exporte um checkpoint e recrie a cena.");
      this.events.push({ ...e, tick: this.tick });
    }
    if (e.kind === "matrix") {
      this.matrix[e.index] = e.value;
      this.device.queue.writeBuffer(
        this.affinities,
        e.index * 4,
        new Float32Array([e.value]),
      );
      this.matrixUI();
    } else if (e.kind === "parameter") {
      this.settings[e.name] = e.value;
      this.labels();
    } else if (e.kind === "palette") {
      this.palette[e.index] = e.value;
      this.writePalette();
    }
  }
  uniforms() {
    const s = this.settings,
      b = new ArrayBuffer(80),
      u = new Uint32Array(b),
      f = new Float32Array(b);
    u.set([
      s.count,
      this.gridDim,
      this.tick >>> 0,
      s.count > 32768 ? 512 : 2048,
    ]);
    f.set([1 / 120, 0.18, s.strength, s.damping], 4);
    f.set([8 / s.count, 3, 0.0001, s.iterations > 0 ? 0.025 : 0], 8);
    f.set(
      [s.flow, 0, s.preset === "life" ? 0 : 2, s.iterations > 0 ? 0.02 : 0],
      12,
    );
    f.set([0.25, 1, 1.5, s.planar ? 1 : 0], 16);
    this.device.queue.writeBuffer(this.simUniform, 0, b);
  }
  dispatch(encoder, entry, count) {
    const pass = encoder.beginComputePass({ label: entry });
    pass.setPipeline(this.compute[entry]);
    pass.setBindGroup(0, this.simGroups[this.current]);
    pass.dispatchWorkgroups(Math.ceil(count / 64));
    pass.end();
  }
  build(encoder) {
    this.dispatch(encoder, "clear_grid", this.gridCells);
    this.dispatch(encoder, "build_grid", this.settings.count);
  }
  step(encoder) {
    while (
      this.replay &&
      this.eventCursor < this.events.length &&
      this.events[this.eventCursor].tick === this.tick
    )
      this.applyEvent(this.events[this.eventCursor++], false);
    this.uniforms();
    this.dispatch(encoder, "clear_stats", 4);
    this.build(encoder);
    this.dispatch(encoder, "predict", this.settings.count);
    this.current = 1 - this.current;
    const iterations = Math.min(
      this.settings.iterations,
      this.settings.count > 32768 ? 1 : 4,
    );
    for (let k = 0; k < iterations; k++) {
      this.build(encoder);
      this.dispatch(encoder, "solve_density", this.settings.count);
      this.dispatch(encoder, "project", this.settings.count);
      this.current = 1 - this.current;
    }
    this.dispatch(encoder, "finalize", this.settings.count);
    this.current = 1 - this.current;
    this.tick++;
  }
  texture(format, usage) {
    const t = this.device.createTexture({
      size: [this.width, this.height],
      format,
      usage,
    });
    this.targets.push(t);
    return t;
  }
  resize() {
    const limits = {
      draft: [960, 540, 0.8],
      balanced: [1280, 720, 1],
      high: [1920, 1080, 1.25],
      ultra: [3840, 2160, 2],
    };
    const [mw, mh, scale] = limits[this.settings.quality];
    const ratio = Math.min(
      mw / innerWidth,
      mh / innerHeight,
      Math.min(devicePixelRatio, scale),
    );
    const w = Math.max(64, Math.floor(innerWidth * ratio)),
      h = Math.max(64, Math.floor(innerHeight * ratio));
    if (w === this.width && h === this.height) return;
    const estimate =
      w * h * 52 + this.settings.count * 112 + this.gridCells * 8;
    if (estimate > SCENE.max_memory_mib * 1024 ** 2)
      throw Error(
        "A qualidade excede o orçamento estimado de buffers/texturas.",
      );
    for (const t of this.targets) t.destroy();
    this.targets = [];
    for (const b of this.filterAxis) b.destroy();
    this.filterAxis = [];
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    const color =
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      filtered =
        GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;
    this.depths = [
      this.texture("r32float", color),
      this.texture("r32float", filtered),
      this.texture("r32float", filtered),
    ];
    this.pigments = [
      this.texture("rgba16float", color),
      this.texture("rgba16float", filtered),
      this.texture("rgba16float", filtered),
    ];
    this.hardwareDepth = this.texture(
      "depth32float",
      GPUTextureUsage.RENDER_ATTACHMENT,
    );
    this.hdr = this.texture("rgba16float", color);
    this.filterGroups = [];
    for (let passIndex = 0; passIndex < 6; passIndex++) {
      const axis = passIndex % 2;
      const source = passIndex === 0 ? 0 : axis === 0 ? 2 : 1;
      const target = axis === 0 ? 1 : 2;
      const data = new ArrayBuffer(32);
      new Int32Array(data).set([
        axis === 0 ? 1 : 0,
        axis === 1 ? 1 : 0,
        this.settings.filter,
        0,
      ]);
      new Float32Array(data).set(
        [9, Math.max(0.0001, this.settings.radius ** 2 * 8), 0, 0],
        4,
      );
      const buffer = this.device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(buffer, 0, data);
      this.filterAxis.push(buffer);
      this.filterGroups.push(
        this.device.createBindGroup({
          layout: this.filterPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: this.depths[source].createView() },
            { binding: 1, resource: this.pigments[source].createView() },
            { binding: 2, resource: this.depths[target].createView() },
            { binding: 3, resource: this.pigments[target].createView() },
            { binding: 4, resource: { buffer } },
          ],
        }),
      );
    }
    this.lightingGroup = this.device.createBindGroup({
      layout: this.lightingPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.depths[2].createView() },
        { binding: 1, resource: this.pigments[2].createView() },
        { binding: 2, resource: { buffer: this.cameraUniform } },
      ],
    });
    this.postGroup = this.device.createBindGroup({
      layout: this.postPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.hdr.createView() },
        { binding: 1, resource: this.depths[2].createView() },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: { buffer: this.postUniform } },
      ],
    });
    this.estimatedBytes = estimate;
  }
  camera() {
    const s = this.settings;
    const eye = [
        this.distance * Math.cos(this.pitch) * Math.sin(this.yaw),
        this.distance * Math.sin(this.pitch),
        this.distance * Math.cos(this.pitch) * Math.cos(this.yaw),
      ],
      forward = normalize(eye.map((x) => -x)),
      right = normalize(cross(forward, [0, 1, 0])),
      up = cross(right, forward);
    const data = [
      ...eye,
      0,
      ...right,
      0,
      ...up,
      0,
      ...forward,
      Math.tan(0.7 / 2),
      this.width,
      this.height,
      s.radius * (8192 / s.count) ** (1 / 3),
      0,
      s.roughness,
      s.absorption,
      s.sss,
      s.film,
      0,
      0,
      0.35,
      s.iridescence,
      0,
      0,
      0,
      0,
    ];
    this.device.queue.writeBuffer(
      this.cameraUniform,
      0,
      new Float32Array(data),
    );
    this.device.queue.writeBuffer(
      this.postUniform,
      0,
      new Float32Array([
        this.width,
        this.height,
        this.tick,
        0,
        s.focus,
        s.aperture,
        s.bloom,
        s.exposure,
        0.5,
        0.004,
        0,
        0,
      ]),
    );
  }
  render(encoder) {
    const attachments = [
      {
        view: this.depths[0].createView(),
        clearValue: { r: 10, g: 0, b: 0, a: 0 },
        loadOp: "clear",
        storeOp: "store",
      },
    ];
    let pass = encoder.beginRenderPass({
      colorAttachments: attachments,
      depthStencilAttachment: {
        view: this.hardwareDepth.createView(),
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });
    pass.setPipeline(this.depthPipeline);
    pass.setBindGroup(0, this.surfaceGroups[this.current]);
    pass.draw(6, this.settings.count);
    pass.end();
    pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.pigments[0].createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.thicknessPipeline);
    pass.setBindGroup(0, this.surfaceGroups[this.current]);
    pass.draw(6, this.settings.count);
    pass.end();
    for (let axis = 0; axis < this.filterGroups.length; axis++) {
      const p = encoder.beginComputePass();
      p.setPipeline(this.filterPipeline);
      p.setBindGroup(0, this.filterGroups[axis]);
      p.dispatchWorkgroups(
        Math.ceil(this.width / 8),
        Math.ceil(this.height / 8),
      );
      p.end();
    }
    pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.hdr.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.lightingPipeline);
    pass.setBindGroup(0, this.lightingGroup);
    pass.draw(3);
    pass.end();
    const target = this.context.getCurrentTexture();
    pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: target.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.postPipeline);
    pass.setBindGroup(0, this.postGroup);
    pass.draw(3);
    pass.end();
    return target;
  }
  async readState() {
    const size = this.settings.count * 48,
      buffer = this.device.createBuffer({
        size,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(
      this.particles[this.current],
      0,
      buffer,
      0,
      size,
    );
    this.device.queue.submit([encoder.finish()]);
    try {
      await buffer.mapAsync(GPUMapMode.READ);
      const bytes = new Uint8Array(buffer.getMappedRange()).slice();
      return bytes;
    } finally {
      buffer.unmap();
      buffer.destroy();
    }
  }
  async exportState(includeData) {
    if (!includeData && this.tick > 20000)
      throw Error(
        "Exportação de semente limitada a 20.000 ticks; exporte o checkpoint completo.",
      );
    const bytes = await this.readState();
    const payload = {
      protocol: "NOVA-CHROMATIC-v1",
      engine_sha256: SCENE.engine_sha256,
      settings: clone(this.settings),
      initial: clone(this.initial),
      matrix: this.matrix.slice(),
      palette: this.palette.slice(),
      tick: this.tick,
      timeline: clone(this.events),
      camera: { yaw: this.yaw, pitch: this.pitch, distance: this.distance },
      state_sha256: await sha(bytes),
      reproducibility: "f32 GPU; neighbor ordering is not bit-portable",
      science: "visual/synthetic state; not a verified physical truth",
    };
    if (includeData) payload.data = toBase64(bytes);
    download(
      JSON.stringify(payload),
      `nova-${this.settings.seed}-${this.tick}-${includeData ? "checkpoint" : "seed"}.json`,
    );
  }
  async importState(file) {
    if (file.size > 8 * 1024 * 1024) throw Error("Arquivo maior que 8 MiB.");
    const saved = JSON.parse(await file.text());
    if (
      saved.protocol !== "NOVA-CHROMATIC-v1" ||
      saved.engine_sha256 !== SCENE.engine_sha256 ||
      !Number.isInteger(saved.tick) ||
      saved.tick < 0 ||
      saved.tick > 0xffffffff ||
      (!saved.data && saved.tick > 20000) ||
      !/^[0-9a-f]{64}$/.test(saved.state_sha256)
    )
      throw Error("Motor, protocolo ou relógio incompatível.");
    validateSettings(saved.settings);
    validateSettings(saved.initial);
    if (
      saved.initial.count !== saved.settings.count ||
      saved.initial.seed !== saved.settings.seed ||
      saved.initial.preset !== saved.settings.preset ||
      saved.initial.damping !== saved.settings.damping ||
      saved.initial.iterations !== saved.settings.iterations
    )
      throw Error("Genesis inconsistente.");
    checkMatrix(saved.matrix);
    if (
      !Array.isArray(saved.palette) ||
      saved.palette.length !== 8 ||
      saved.palette.some((c) => !/^#[0-9a-f]{6}$/i.test(c))
    )
      throw Error("Paleta inválida.");
    if (
      !Array.isArray(saved.timeline) ||
      saved.timeline.length > 4096 ||
      saved.timeline.some((e) => e.tick > saved.tick)
    )
      throw Error("Histórico inválido.");
    this.validateEvents(saved.timeline, saved.initial);
    if (saved.camera) {
      const { yaw, pitch, distance } = saved.camera;
      if (
        ![yaw, pitch, distance].every(Number.isFinite) ||
        Math.abs(yaw) > 1e4 ||
        Math.abs(pitch) > 1.4 ||
        distance < 1.5 ||
        distance > 7
      )
        throw Error("Câmera inválida.");
    }
    if (saved.data) {
      if (typeof saved.data !== "string" || saved.data.length > 6400000)
        throw Error("Dados fora do orçamento.");
      const raw = Uint8Array.from(atob(saved.data), (c) => c.charCodeAt(0));
      if (
        raw.length !== saved.settings.count * 48 ||
        (await sha(raw)) !== saved.state_sha256
      )
        throw Error("Checkpoint corrompido.");
      const data = new Float32Array(raw.buffer);
      for (let i = 0; i < saved.settings.count; i++) {
        const p = i * 12;
        if (
          !data.subarray(p, p + 12).every(Number.isFinite) ||
          [0, 1, 2, 8, 9, 10].some((k) => Math.abs(data[p + k]) > 1.001) ||
          [4, 5, 6].some((k) => Math.abs(data[p + k]) > 5) ||
          !Number.isInteger(data[p + 3]) ||
          data[p + 3] < 0 ||
          data[p + 3] > 7 ||
          data[p + 7] < 0 ||
          data[p + 7] > 1
        )
          throw Error("Estado de partícula inválido.");
      }
      saved.decoded = data;
    }
    await this.reset(saved.settings, saved);
    if (saved.camera) {
      const { yaw, pitch, distance } = saved.camera;
      if (
        ![yaw, pitch, distance].every(Number.isFinite) ||
        Math.abs(yaw) > 1e4 ||
        Math.abs(pitch) > 1.4 ||
        distance < 1.5 ||
        distance > 7
      )
        throw Error("Câmera inválida.");
      this.yaw = yaw;
      this.pitch = pitch;
      this.distance = distance;
    }
  }
  async screenshot(target, encoder) {
    const stride = Math.ceil((this.width * 4) / 256) * 256;
    const buffer = this.device.createBuffer({
      size: stride * this.height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    encoder.copyTextureToBuffer(
      { texture: target },
      { buffer, bytesPerRow: stride },
      [this.width, this.height],
    );
    return { buffer, stride, width: this.width, height: this.height };
  }
  async finishScreenshot(capture) {
    const { buffer, stride, width, height } = capture;
    try {
      await buffer.mapAsync(GPUMapMode.READ);
      const data = new Uint8Array(buffer.getMappedRange());
      const pixels = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++)
        pixels.set(
          data.subarray(y * stride, y * stride + width * 4),
          y * width * 4,
        );
      if (this.format.startsWith("bgra"))
        for (let i = 0; i < pixels.length; i += 4) {
          const r = pixels[i];
          pixels[i] = pixels[i + 2];
          pixels[i + 2] = r;
        }
      const out = new OffscreenCanvas(width, height);
      out
        .getContext("2d")
        .putImageData(new ImageData(pixels, width, height), 0, 0);
      download(
        await out.convertToBlob({ type: "image/png" }),
        `nova-${this.tick}.png`,
      );
    } finally {
      buffer.unmap();
      buffer.destroy();
    }
  }
  async frame(time) {
    if (!this.particles) return;
    this.resize();
    this.camera();
    const encoder = this.device.createCommandEncoder();
    let steps = 0;
    if (this.running) {
      if (this.replay)
        steps = Math.min(
          this.settings.count > 32768 ? 1 : 2,
          this.replay.target - this.tick,
        );
      else {
        this.accumulator = Math.min(
          this.accumulator + Math.min((time - this.lastTime) / 1000, 0.05),
          0.05,
        );
        steps = Math.min(2, Math.floor(this.accumulator * 120));
        this.accumulator -= steps / 120;
      }
    }
    this.lastTime = time;
    // Each step has its own submission because queue.writeBuffer must precede the
    // dispatch using that step's uniform values. A frame never queues unbounded work.
    for (let k = 0; k < steps; k++) {
      const stepEncoder = this.device.createCommandEncoder();
      this.step(stepEncoder);
      this.device.queue.submit([stepEncoder.finish()]);
    }
    const target = this.render(encoder);
    let capture = null;
    if (this.capture) {
      capture = await this.screenshot(target, encoder);
      this.capture = false;
    }
    const readStats = time - this.lastStats > 1000;
    if (readStats)
      encoder.copyBufferToBuffer(this.statsBuffer, 0, this.statsRead, 0, 16);
    this.device.queue.submit([encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone();
    if (capture) await this.finishScreenshot(capture);
    if (readStats) {
      await this.statsRead.mapAsync(GPUMapMode.READ);
      const metrics = new Uint32Array(this.statsRead.getMappedRange()).slice();
      this.statsRead.unmap();
      this.statusMetrics = {
        truncated_queries: metrics[0],
        speed_clamps: metrics[1],
        max_density: metrics[2] / 1000,
        correction_clamps: metrics[3],
      };
      this.fps = (this.frameCount * 1000) / Math.max(1, time - this.lastStats);
      this.frameCount = 0;
      this.lastStats = time;
    }
    $("status").textContent =
      `${this.replay ? "REPRODUZINDO · " : ""}${this.settings.count.toLocaleString("pt-BR")} partículas · tick ${this.tick} · ${this.width} × ${this.height} · ${this.fps.toFixed(0)} FPS nesta sessão${this.statusMetrics.truncated_queries ? "\nVizinhança limitada: aproximação ativa; veja diagnósticos." : ""}`;
    $("stats").textContent = JSON.stringify(
      {
        backend: "browser WebGPU",
        estimated_gpu_mib: Math.round(this.estimatedBytes / 1024 ** 2),
        neighbor_query_limit: this.settings.count > 32768 ? 512 : 2048,
        fluid_iterations: Math.min(
          this.settings.iterations,
          this.settings.count > 32768 ? 1 : 4,
        ),
        ...this.statusMetrics,
      },
      null,
      2,
    );
    this.frameCount++;
    if (this.replay && this.tick >= this.replay.target) {
      while (
        this.eventCursor < this.events.length &&
        this.events[this.eventCursor].tick === this.tick
      )
        this.applyEvent(this.events[this.eventCursor++], false);
      const actual = await sha(await this.readState());
      $("status").textContent +=
        actual === this.replay.expected
          ? "\nHash de estado reproduzido."
          : "\nHash divergente: a execução GPU não foi idêntica.";
      this.replay = null;
      this.running = false;
      this.syncUI();
      $("pause").textContent = "Continuar";
    }
  }
  record() {
    if (this.recording) {
      this.recording.stop();
      return;
    }
    if (!this.canvas.captureStream || typeof MediaRecorder === "undefined")
      throw Error("Gravação WebM indisponível neste navegador.");
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";
    const stream = this.canvas.captureStream(30),
      recorder = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: 8000000,
      });
    let chunks = [],
      size = 0;
    recorder.ondataavailable = (e) => {
      chunks.push(e.data);
      size += e.data.size;
      if (size > 60 * 1024 ** 2 && recorder.state === "recording")
        recorder.stop();
    };
    const timeout = setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, 30000);
    recorder.onstop = () => {
      clearTimeout(timeout);
      download(new Blob(chunks, { type: mime }), `nova-${this.tick}.webm`);
      stream.getTracks().forEach((t) => t.stop());
      this.recording = null;
      $("record").textContent = "Gravar WebM";
    };
    this.recording = recorder;
    recorder.start(1000);
    $("record").textContent = "Parar gravação";
  }
}
let app;
async function launch() {
  if (new Uint8Array(new Uint32Array([1]).buffer)[0] !== 1)
    throw Error("Este formato requer f32 little-endian.");
  if (!navigator.gpu)
    throw Error(
      "WebGPU indisponível. Use um navegador com WebGPU em localhost/HTTPS. O módulo CPU Particle Life continua disponível pela CLI.",
    );
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: "high-performance",
  });
  if (!adapter) throw Error("Nenhum adaptador WebGPU disponível.");
  const device = await adapter.requestDevice();
  const canvas = $("universe"),
    context = canvas.getContext("webgpu"),
    format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format,
    alphaMode: "opaque",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  app = new Chromatic(device, context, format);
  app.adapter = adapter; // Retain the adapter for the full lifetime of the device.
  device.addEventListener("uncapturederror", (e) => app.error(e.error));
  device.lost.then((info) => {
    app.running = false;
    app.dead = true;
    app.error(Error("Dispositivo GPU perdido: " + info.message));
  });
  await app.pipelines();
  const palette = $("palette");
  COLORS.forEach((c, i) => {
    const input = document.createElement("input");
    input.type = "color";
    input.value = c;
    input.id = "color" + i;
    input.oninput = () =>
      app.enqueue(() =>
        app.applyEvent({ kind: "palette", index: i, value: input.value }),
      );
    palette.append(input);
  });
  for (let i = 0; i < 64; i++) {
    const b = document.createElement("button");
    b.id = "m" + i;
    b.onclick = (e) =>
      app.enqueue(() =>
        app.applyEvent({
          kind: "matrix",
          index: i,
          value: Math.max(
            -1,
            Math.min(
              1,
              Math.round((app.matrix[i] + (e.shiftKey ? -0.2 : 0.2)) * 10) / 10,
            ),
          ),
        }),
      );
    $("matrix").append(b);
  }
  let settings = {
    ...PRESETS[SCENE.preset || "ink"],
    preset: SCENE.preset || "ink",
    seed: String(SCENE.seed || "42"),
    count: SCENE.count || 8192,
    quality: SCENE.quality || "balanced",
    radius: 0.043,
    exposure: 1,
    bloom: 0.3,
    focus: 3.2,
    aperture: 0.8,
    planar: false,
  };
  await app.reset(settings);
  const reset = () => {
    const preset = $("preset").value;
    const next = {
      ...app.settings,
      ...PRESETS[preset],
      preset,
      seed: $("seed").value,
      count: Number($("count").value),
      quality: $("quality").value,
    };
    return app.enqueue(() => app.reset(next));
  };
  $("reset").onclick = reset;
  $("planar").onchange = () => {
    const value = $("planar").value === "1";
    app.enqueue(() =>
      app.applyEvent({ kind: "parameter", name: "planar", value }),
    );
  };
  for (const name of ["preset", "count"]) $(name).onchange = reset;
  $("quality").onchange = () =>
    app.enqueue(() => {
      app.settings.quality = $("quality").value;
      app.width = 0;
    });
  $("seed").onchange = reset;
  for (const name of ["strength", "flow"])
    $(name).oninput = () => {
      const value = Number($(name).value);
      app.enqueue(() => app.applyEvent({ kind: "parameter", name, value }));
    };
  for (const name of [
    "radius",
    "roughness",
    "absorption",
    "sss",
    "film",
    "iridescence",
    "exposure",
    "bloom",
    "focus",
    "aperture",
  ])
    $(name).oninput = () => {
      const value = Number($(name).value);
      app.enqueue(() => {
        app.settings[name] = value;
        app.labels();
        if (name === "radius") app.width = 0;
      });
    };
  $("pause").onclick = () =>
    app.enqueue(() => {
      app.running = !app.running;
      app.accumulator = 0;
      $("pause").textContent = app.running ? "Pausar" : "Continuar";
    });
  $("snapshot").onclick = () => {
    app.capture = true;
  };
  $("record").onclick = () => {
    try {
      app.record();
    } catch (e) {
      app.error(e);
    }
  };
  $("saveSeed").onclick = () => app.enqueue(() => app.exportState(false));
  $("saveState").onclick = () => app.enqueue(() => app.exportState(true));
  $("load").onclick = () => $("file").click();
  $("file").onchange = () => {
    const f = $("file").files[0];
    if (f) app.enqueue(() => app.importState(f));
  };
  let drag = null;
  canvas.onpointerdown = (e) => {
    drag = [e.clientX, e.clientY];
    canvas.setPointerCapture(e.pointerId);
  };
  canvas.onpointermove = (e) => {
    if (drag) {
      app.yaw += (e.clientX - drag[0]) * 0.006;
      app.pitch = Math.max(
        -1.4,
        Math.min(1.4, app.pitch + (e.clientY - drag[1]) * 0.006),
      );
      drag = [e.clientX, e.clientY];
    }
  };
  canvas.onpointerup = () => (drag = null);
  canvas.onwheel = (e) => {
    e.preventDefault();
    app.distance = Math.max(1.5, Math.min(7, app.distance + e.deltaY * 0.002));
  };
  addEventListener("keydown", (e) => {
    if (e.target.matches("input,select")) return;
    if (e.code === "Space") {
      e.preventDefault();
      $("pause").click();
    }
    if (e.key.toLowerCase() === "s") app.capture = true;
  });
  const frame = async (time) => {
    try {
      if (!app.dead) await app.enqueue(() => app.frame(time));
    } catch {
    } finally {
      requestAnimationFrame(frame);
    }
  };
  requestAnimationFrame(frame);
}
launch().catch((error) => {
  $("error").textContent = error.message;
  $("status").textContent = "Inicialização interrompida.";
  console.error(error);
});
