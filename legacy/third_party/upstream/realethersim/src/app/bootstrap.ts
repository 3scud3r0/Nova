import * as THREE from 'three';
import { registerArchetypes } from '../archetypes';
import { SYSTEMS } from '../archetypes/strangeAttractor';
import { resolveParams } from '../core/params';
import { largestLyapunov } from '../physics/lyapunov';
import { createCamera } from '../render/camera';
import { FloatingOrigin } from '../render/floatingOrigin';
import { createPointCloud, type PointCloud } from '../render/points';
import { createTrailCloud, type TrailCloud } from '../render/trails';
import { createRenderer } from '../render/renderer';
import { PostProcessing } from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { theme } from '../render/theme';
import { buildSnapshot } from '../state/snapshot';
import type { Snapshot, SnapshotCamera } from '../state/schema';
import { MainThreadDriver, type SimDriver } from '../sim/driver';
import { WorkerDriver } from '../sim/workerDriver';
import { NullDriver } from '../sim/nullDriver';
import { createGpu, hasGpu, type GpuSim } from '../gpu';
import { isRaymarch, getFactory } from '../core/registry';
import { createRaymarch, type RaymarchPass } from '../render/raymarch';
import { createFieldPass, type FieldPass } from '../render/field';
import { RAYMARCH_SYSTEMS } from '../archetypes/raymarchFractal';
import { APP_VERSION } from '../version';
import { embedText } from '../state/pngMeta';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { detectCapabilities } from './capabilities';
import type { Engine } from './engine';
import { $archetypeId, $engine, $global, $guides, $hierarchy, $params, $paused, $selectedNode, $telemetry } from '../ui/store';

const SEED = 1;

// Composition root: wires capabilities → renderer → sim driver → render loop → UI store.
export async function bootstrap(canvas: HTMLCanvasElement): Promise<Engine> {
  registerArchetypes();

  const caps = await detectCapabilities();
  const { renderer, backend } = await createRenderer(canvas);
  // Pixel readback row order differs by backend: WebGPU returns rows top-down (like the screen), WebGL2's
  // readPixels returns them bottom-up. Every export that copies a readback into an image must use this.
  const READBACK_BOTTOM_UP = backend === 'webgl2';
  const useWorker = caps.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined';
  $telemetry.setKey('backend', `${backend} · ${useWorker ? 'worker+SAB' : 'main-thread'}`);

  // GPU compute is the capable default on the WebGPU backend (far more particles, smoother). The
  // WebGL2 fallback can't run TSL compute passes, so it stays on the CPU path there. Listeners
  // aren't attached yet, so this just seeds the initial state; users can still toggle it off.
  if (backend === 'webgpu') $global.setKey('gpuCompute', true);

  const scene = new THREE.Scene();
  scene.background = theme.background;
  const { camera, controls } = createCamera(canvas);
  const floatingOrigin = new FloatingOrigin();

  // --- HDR bloom post pass: the scene renders into an HDR pass target, bright regions bloom, and
  // the composite draws to whatever render target is active — so the live view, screenshots, clips
  // AND thumbnails all inherit it. Strength is a live uniform (per-system override via
  // factory.bloom, applied on rebuild). `?bloom=0` is a debug kill switch; construction is guarded
  // so an unsupported backend falls back to direct rendering. TSL nodes are dynamically typed (same
  // convention as src/gpu/types.ts). ---
  const BLOOM_DEFAULT = 0.4;
  let post: PostProcessing | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let bloomPass: any = null;
  if (new URLSearchParams(location.search).get('bloom') !== '0') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const scenePass: any = pass(scene, camera);
      bloomPass = bloom(scenePass, BLOOM_DEFAULT, 0.4, 0.5); // strength, radius, threshold
      post = new PostProcessing(renderer, scenePass.add(bloomPass));
    } catch (e) {
      console.warn('[bloom] post pass unavailable — falling back to direct render', e);
      post = null;
      bloomPass = null;
    }
  }
  function renderFrame(): void {
    if (post) {
      // Outside the RAF loop (thumbnail / clip / screenshot captures drive rendering manually with
      // setAnimationLoop(null)) three's Animation never bumps the node frameId, so FRAME-gated nodes
      // (the scene pass) would silently reuse a stale texture — every capture comes out identical.
      // Bump it ourselves; this mirrors exactly what three's Animation loop does each RAF tick.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nodes = (renderer as any)._nodes;
      if (nodes?.nodeFrame) nodes.nodeFrame.update();
      post.render();
    } else {
      renderer.render(scene, camera);
    }
  }

  // --- smooth macro→micro focus tracking (NFR-2.2) ---
  // Log-space distance interpolation preserves the view direction while flying to frame a group.
  const focus = {
    active: false,
    t: 0,
    dur: 0.7,
    fromT: new THREE.Vector3(),
    toT: new THREE.Vector3(),
    fromD: 1,
    toD: 1,
    dir: new THREE.Vector3(),
  };
  const _focusCenter = new THREE.Vector3();
  const _focusTmp = new THREE.Vector3();
  const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

  function focusOn(center: THREE.Vector3, radius: number): void {
    focus.fromT.copy(controls.target);
    focus.toT.copy(center);
    focus.fromD = camera.position.distanceTo(controls.target);
    const margin = 1.7;
    focus.toD = Math.max(0.01, (radius * margin) / Math.tan(((camera.fov * Math.PI) / 180) / 2));
    focus.dir.copy(camera.position).sub(controls.target).normalize();
    if (focus.dir.lengthSq() === 0) focus.dir.set(0, 0, 1);
    focus.t = 0;
    focus.active = true;
  }

  function updateFocus(dt: number): void {
    if (!focus.active) return;
    focus.t = Math.min(1, focus.t + dt / focus.dur);
    const e = easeInOut(focus.t);
    _focusTmp.copy(focus.fromT).lerp(focus.toT, e);
    const d = Math.exp(Math.log(focus.fromD) * (1 - e) + Math.log(focus.toD) * e);
    controls.target.copy(_focusTmp);
    camera.position.copy(_focusTmp).addScaledVector(focus.dir, d);
    if (focus.t >= 1) focus.active = false;
  }

  let forceMainDriver = false; // DEV thumbnail capture: drive on the main thread so synchronous stepFrame
  //                              advances the sim + accumulates trails (the worker advances on wall-clock).
  async function makeDriver(): Promise<SimDriver> {
    const id = $archetypeId.get();
    // Sphere-traced fractals never run as a point sim: hand back an inert driver so the worker is
    // never asked to instantiate one, while keeping `driver` non-null for the rest of bootstrap.
    if (isRaymarch(id)) return new NullDriver(id, getFactory(id).label);
    const g = $global.get();
    const p = $params.get();
    // user-authored systems carry compiled closures that can't be shipped to the worker → main thread
    return useWorker && !forceMainDriver && !getFactory(id).mainThread
      ? WorkerDriver.create(id, p, g.dt, g.particleCount, SEED, g.trailLength)
      : new MainThreadDriver(id, p, g.dt, g.particleCount, SEED);
  }

  let driver = await makeDriver();
  driver.setTrailLength($global.get().trailLength);
  let posArray = new Float32Array(driver.particleCount * 3);
  let cloud: PointCloud = createPointCloud(posArray, driver.colors, {
    geometry: 'points',
    pointSize: driver.pointSize,
  });
  let trailCloud: TrailCloud = makeTrailCloud();
  scene.add(cloud.points);
  scene.add(trailCloud.group);
  $hierarchy.set(driver.hierarchy);

  // Static guide-geometry overlay (equipotential boundaries, reach circles, …): opt-in per factory
  // (factory.guides), drawn in render space, globally toggled by $guides. Rebuilt on every switch.
  // Rendered as dense additive POINTS (the proven WebGPU render path) rather than line primitives.
  const guideGroup = new THREE.Group();
  scene.add(guideGroup);
  function sampleGuide(pts: Array<[number, number, number]>, closed: boolean): Float32Array {
    const out: number[] = [];
    const segs = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < segs; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      const n = Math.max(2, Math.ceil(Math.hypot(dx, dy, dz) / 0.025)); // ~1 point / 0.025 render units
      for (let j = 0; j < n; j++) {
        const t = j / n;
        out.push(a[0] + dx * t, a[1] + dy * t, a[2] + dz * t);
      }
    }
    return new Float32Array(out);
  }
  function updateGuides(): void {
    for (const c of guideGroup.children) {
      const p = c as THREE.Points;
      p.geometry.dispose();
      (p.material as THREE.Material).dispose();
    }
    guideGroup.clear();
    guideGroup.visible = $guides.get();
    if (!$guides.get()) return;
    const spec = getFactory($archetypeId.get()).guides?.();
    if (!spec) return;
    for (const gl of spec) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(sampleGuide(gl.points, !!gl.closed), 3));
      geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
      const mat = new THREE.PointsMaterial({
        color: gl.color ?? 0x6f7a8a,
        size: 0.03,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const p = new THREE.Points(geom, mat);
      p.frustumCulled = false;
      guideGroup.add(p);
    }
  }
  $guides.subscribe(() => updateGuides()); // fires now (initial) + on every toggle

  function makeTrailCloud(): TrailCloud {
    const tc = createTrailCloud(driver.trailRing(), driver.particleCount, driver.trailSlots(), driver.colors, driver.pointSize);
    tc.refreshAll();
    tc.setVisible($global.get().trailLength > 0);
    return tc;
  }

  // --- experimental GPU-compute mode (attractors only), isolated from the CPU pipeline ---
  let gpuSim: GpuSim | null = null;
  let gpuPending: Promise<void> | null = null; // in-flight setupGpu() (DEV thumbnail capture awaits it)
  function gpuRequested(): boolean {
    return $global.get().gpuCompute && hasGpu($archetypeId.get());
  }
  function teardownGpu(): void {
    if (!gpuSim) return;
    scene.remove(gpuSim.points);
    gpuSim.dispose();
    gpuSim = null;
  }
  async function setupGpu(): Promise<void> {
    teardownGpu();
    const id = $archetypeId.get();
    if (!hasGpu(id)) return;
    const g = $global.get();
    try {
      const sim = createGpu(id, g.particleCount, g.dt, $params.get());
      scene.add(sim.points);
      if (sim.init) renderer.compute(sim.init); // renderer.init() already awaited at startup → sync compute
      gpuSim = sim;
    } catch (err) {
      console.error('[ethersim] GPU compute init failed — reverting to CPU', err);
      $global.setKey('gpuCompute', false);
    }
  }
  // --- sphere-traced 3D fractals: a full-screen distance-estimator pass, orbited by the camera ---
  let raymarch: RaymarchPass | null = null;
  let fieldPass: FieldPass | null = null;
  function teardownRaymarch(): void {
    if (!raymarch) return;
    scene.remove(raymarch.mesh);
    raymarch.dispose();
    raymarch = null;
  }
  function setupRaymarch(): void {
    teardownRaymarch();
    const id = $archetypeId.get();
    const sys = RAYMARCH_SYSTEMS[id];
    if (!sys) return;
    try {
      raymarch = createRaymarch(sys, backend);
      raymarch.setParams($params.get());
      scene.add(raymarch.mesh);
      // frame the fractal: target origin, pull the camera back to a sensible distance
      controls.target.set(0, 0, 0);
      const [dx, dy, dz] = sys.camDir ?? [0.55, 0.42, 1]; // per-system override (e.g. axial tunnel view)
      camera.position.set(dx, dy, dz).normalize().multiplyScalar(raymarch.cameraDistance);
      controls.update();
    } catch (err) {
      console.error('[ethersim] raymarch init failed', err);
      teardownRaymarch();
    }
  }

  function teardownField(): void {
    if (!fieldPass) return;
    scene.remove(fieldPass.mesh);
    fieldPass.dispose();
    fieldPass = null;
  }
  function setupField(): void {
    teardownField();
    fieldPass = createFieldPass({ size: 3.4 });
    scene.add(fieldPass.mesh);
    const f = driver.readField?.();
    if (f) fieldPass.update(f);
  }

  // Toggle visibility/driver between CPU, GPU, raymarch, and field-texture paths.
  function applyMode(): void {
    // continuous-field systems draw their readField() as a smooth colour-map panel, not a point cloud
    if (getFactory($archetypeId.get()).fieldRender) {
      teardownRaymarch();
      teardownGpu();
      driver.setPaused(paused);
      cloud.points.visible = false;
      trailCloud.setVisible(false);
      if (!fieldPass) setupField();
      $telemetry.setKey('backend', `${backend} · field`);
      return;
    }
    teardownField();
    if (isRaymarch($archetypeId.get())) {
      driver.setPaused(true);
      cloud.points.visible = false;
      trailCloud.setVisible(false);
      teardownGpu();
      if (!raymarch) setupRaymarch();
      $telemetry.setKey('backend', `${backend} · raymarch`);
      return;
    }
    teardownRaymarch();
    const useGpu = gpuRequested();
    driver.setPaused(useGpu ? true : paused);
    cloud.points.visible = !useGpu;
    trailCloud.setVisible(!useGpu && $global.get().trailLength > 0);
    if (useGpu) {
      if (!gpuSim) gpuPending = setupGpu(); // tracked so the DEV capture can await GPU readiness
    } else {
      gpuPending = null;
      teardownGpu();
    }
    $telemetry.setKey('backend', `${backend} · ${useGpu ? 'GPU compute' : useWorker ? 'worker+SAB' : 'main-thread'}`);
  }

  // --- rebuild (archetype or particle-count change), serialized + atomically swapped ---
  let chain: Promise<void> = Promise.resolve();
  let rebuildQueued = false;
  function scheduleRebuild(): void {
    if (rebuildQueued) return;
    rebuildQueued = true;
    queueMicrotask(() => {
      rebuildQueued = false;
      chain = chain.then(doRebuild).catch((err) => console.error('[ethersim] rebuild failed', err));
    });
  }
  async function doRebuild(): Promise<void> {
    const next = await makeDriver();
    next.setTrailLength($global.get().trailLength);
    const nextPos = new Float32Array(next.particleCount * 3);
    const nextCloud = createPointCloud(nextPos, next.colors, {
      geometry: 'points',
      pointSize: next.pointSize,
    });
    const oldDriver = driver;
    const oldCloud = cloud;
    const oldTrail = trailCloud;
    // Atomic swap (synchronous — the render loop cannot interleave here).
    driver = next;
    posArray = nextPos;
    clockModelT = 0; // fresh system (or fresh params) → the sim clock restarts at T+0
    clockPrevFrame = 0;
    cloud = nextCloud;
    trailCloud = makeTrailCloud();
    scene.remove(oldCloud.points);
    scene.remove(oldTrail.group);
    scene.add(cloud.points);
    scene.add(trailCloud.group);
    oldDriver.dispose();
    oldCloud.dispose();
    oldTrail.dispose();
    $hierarchy.set(driver.hierarchy);
    $selectedNode.set(null); // clear selection/highlight for the new archetype
    teardownGpu(); // force a fresh GPU sim for the new archetype / particle count
    teardownRaymarch(); // force a fresh raymarch pass (e.g. switching between 3D fractals)
    teardownField(); // force a fresh field-texture pass for the new archetype
    applyMode(); // re-establish field vs raymarch vs GPU vs CPU
    updateGuides(); // refresh the overlay for the new system
    if (bloomPass) bloomPass.strength.value = getFactory($archetypeId.get()).bloom ?? BLOOM_DEFAULT;
    // The Kármán field is a flat horizontal sheet — frame it near top-down (the classic CFD view).
    if ($archetypeId.get() === 'karman') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 3.2, 0.85);
      controls.update();
    }
    // The pseudospectrum is a landscape — frame it from an elevated 3/4 to show the peaks + continents.
    if ($archetypeId.get() === 'pseudospectrum') {
      controls.target.set(0, 0.45, 0);
      camera.position.set(0, 2.5, 3.0);
      controls.update();
    }
    // The cosmic web is a centred 3D volume — frame the whole cube from a 3/4 view.
    if ($archetypeId.get() === 'cosmicWeb') {
      controls.target.set(0, 0, 0);
      camera.position.set(2.3, 1.5, 2.8);
      controls.update();
    }
    // The Spiral of Theodorus: a slight downward tilt so the radial dome reads, while the rosette symmetry
    // still reads near-face-on.
    if ($archetypeId.get() === 'theodorus') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 1.15, 3.85);
      controls.update();
    }
    // DLA grows a dendrite in the horizontal X-Z plane — view it from above so it isn't seen edge-on.
    if ($archetypeId.get() === 'dla') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 3.5, 1.15);
      controls.update();
    }
    // Magnetic reconnection: a slight 3/4 tilt so the extruded current-sheet slab / X-line reads, while
    // the neon X still reads near-front-on.
    if ($archetypeId.get() === 'reconnection') {
      controls.target.set(0, 0, 0);
      camera.position.set(1.4, 0.8, 3.9);
      controls.update();
    }
    // Cymatics is a flat vibrating plate — view it near top-down (the classic cymatics photograph), a
    // slight tilt so the relief shimmers.
    if ($archetypeId.get() === 'cymatics') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 4.2, 1.4); // mostly top-down so the figure reads, tilted enough that the relief shimmers
      controls.update();
    }
    // The polynomial root cloud lives in the complex plane (Re→x, Im→y) — view it face-on so the iconic
    // unit-circle "feather" reads; orbiting reveals the density relief.
    if ($archetypeId.get() === 'polynomialRoots') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 0, 3.6);
      controls.update();
    }
    // The string worldsheet is a ribbon swept along z, bulging in y — frame it 3/4 so the σ-extent and
    // the τ-sweep history both read.
    if ($archetypeId.get() === 'stringWorldsheet') {
      controls.target.set(0, 0, 0);
      camera.position.set(3.1, 2.2, 3.4);
      controls.update();
    }
    // The Stokes phase surface is a terrain — frame it from an elevated 3/4 (like the pseudospectrum).
    if ($archetypeId.get() === 'stokesPhase') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 2.6, 3.0);
      controls.update();
    }
    // Dispersion is a rocking domed disk facing +Z — frame so the whole bowl + rings fill the frame.
    if ($archetypeId.get() === 'dispersionWave') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 0.6, 3.9);
      controls.update();
    }
    // Crossed diffraction is a flat radial figure facing +Z — view it face-on.
    if ($archetypeId.get() === 'crossedDiffraction') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 0, 3.4);
      controls.update();
    }
    // The dandelion blowball is a sphere — a gentle 3/4 so it reads as a 3-D puff.
    if ($archetypeId.get() === 'dandelion') {
      controls.target.set(0, 0, 0);
      camera.position.set(0.6, 0.4, 3.1);
      controls.update();
    }
    // Attractor swarms are a scatter of butterflies in the view plane — view face-on to see the whole ring.
    if ($archetypeId.get() === 'lorenzSwarm' || $archetypeId.get() === 'attractorMenagerie') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 0, 4.4);
      controls.update();
    }
    // The solar corona is a sphere — frame it face-on, filling the frame like the SDO disk.
    if ($archetypeId.get() === 'solarCorona') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 0, 2.1);
      controls.update();
    }
    // The spiral galaxy is a flat disk — view it near face-on with a slight tilt so the arms + bar read.
    if ($archetypeId.get() === 'spiralGalaxy') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 1.8, 2.9);
      controls.update();
    }
    // The galaxy collision plays out around the barycentre — a 3/4 view catches the tidal tails + merger.
    if ($archetypeId.get() === 'galaxyCollision') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 1.9, 5.0);
      controls.update();
    }
    // Lightning strikes vertically between cloud and ground — face-on, storm-photographer framing.
    if ($archetypeId.get() === 'lightning') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 0, 3.4);
      controls.update();
    }
    // Structure formation is a comoving 3-D box — frame the whole cube from a 3/4 view (like the web).
    if ($archetypeId.get() === 'structureFormation') {
      controls.target.set(0, 0, 0);
      camera.position.set(2.2, 1.5, 2.7);
      controls.update();
    }
    // The white hole is a funnel with an erupting throat — elevated 3/4, like the embedding diagrams.
    if ($archetypeId.get() === 'whiteHole') {
      controls.target.set(0, -0.1, 0);
      camera.position.set(0, 1.7, 3.1);
      controls.update();
    }
    // The Martian clouds are a high sheet over a horizon haze — look gently up from below.
    if ($archetypeId.get() === 'marsClouds') {
      controls.target.set(0, 0.25, 0);
      camera.position.set(0, -0.15, 3.0);
      controls.update();
    }
    // The fragmentation event is centred on the target body — a 3/4 view catches projectile + cascade.
    if ($archetypeId.get() === 'impactFragmentation') {
      controls.target.set(0, 0, 0);
      camera.position.set(1.4, 1.0, 3.2);
      controls.update();
    }
    // The pulsar's beams sweep about the vertical spin axis — a side-on 3/4 shows dipole + lighthouse.
    if ($archetypeId.get() === 'pulsar') {
      controls.target.set(0, 0, 0);
      camera.position.set(0.5, 1.1, 3.4);
      controls.update();
    }
    // The twin jets run along ±x — view near-face-on so the kink wiggle and knots read.
    if ($archetypeId.get() === 'relativisticJet') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 0.7, 3.6);
      controls.update();
    }
    // The Lenia dish is a horizontal plate — near top-down, tilted enough for the relief to read.
    if ($archetypeId.get() === 'multiLenia') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 2.5, 1.25);
      controls.update();
    }
    // The gravity well is a dented membrane — a low sweeping 3/4, like every textbook picture.
    if ($archetypeId.get() === 'gravityWell') {
      controls.target.set(0, -0.35, 0);
      camera.position.set(1.35, 0.6, 2.5);
      controls.update();
    }
    // The condensate forms at the trap centre — a face-on 3/4 so the in-fall and the peak both read.
    if ($archetypeId.get() === 'bec') {
      controls.target.set(0, 0, 0);
      camera.position.set(0.9, 0.7, 3.0);
      controls.update();
    }
    // A Cassini-style oblique: low over the ring plane so the gap-edge waves and walls read.
    if ($archetypeId.get() === 'daphnis') {
      controls.target.set(0.7, 0, 0.7);
      camera.position.set(1.3, 0.3, 1.62);
      controls.update();
    }
    if ($archetypeId.get() === 'hyperbolicSphere') {
      controls.target.set(0, 0, 0);
      camera.position.set(0.4, 0.55, 2.9);
      controls.update();
    }
    // A 3/4 view of the coiled ring so the ladder and the supercoil buckle both read.
    if ($archetypeId.get() === 'dnaSupercoil') {
      controls.target.set(0, 0, 0);
      camera.position.set(1.4, 0.95, 1.95);
      controls.update();
    }
    if ($archetypeId.get() === 'trigMap') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 0, 3.0);
      controls.update();
    }
    if ($archetypeId.get() === 'newtonFlow') {
      controls.target.set(0, 0, 0);
      camera.position.set(0.2, 0.15, 2.9);
      controls.update();
    }
    // The ISS view: low over the curved limb, looking out along the auroral oval.
    if ($archetypeId.get() === 'auroraOrbit') {
      controls.target.set(0, 0.3, -1.4);
      camera.position.set(0.2, 1.5, 3.6);
      controls.update();
    }
    if ($archetypeId.get() === 'fireflies') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 0.2, 4.4);
      controls.update();
    }
    // Oblique 3/4 of the ringing membrane so the outgoing quadrupole waves and the throat read.
    if ($archetypeId.get() === 'ringdown') {
      controls.target.set(0, -0.2, 0);
      camera.position.set(1.5, 1.6, 2.3);
      controls.update();
    }
    // ISS view: over the curved night limb, the jet leaping up toward the camera.
    if ($archetypeId.get() === 'giganticJet') {
      controls.target.set(0, 0.7, -0.4);
      camera.position.set(0.3, 1.3, 3.3);
      controls.update();
    }
    // Oblique near-top-down so the non-closing rosette reads as a flower around the dark hole.
    if ($archetypeId.get() === 'precession') {
      controls.target.set(0, 0, 0);
      camera.position.set(0.4, 2.9, 1.9);
      controls.update();
    }
    // Face-on: the random-walk fan and the LIL walls read as a 2-D plot.
    if ($archetypeId.get() === 'iteratedLog') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 0, 3.0);
      controls.update();
    }
    if ($archetypeId.get() === 'spiralWhirl') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 0, 3.0);
      controls.update();
    }
    // A 3/4 view so the neural sheet's fold onto the sphere reads.
    if ($archetypeId.get() === 'som') {
      controls.target.set(0, 0, 0);
      camera.position.set(1.6, 1.05, 2.2);
      controls.update();
    }
    // Pulled back + off-axis so the sheet straining across the branching tree reads.
    if ($archetypeId.get() === 'vascularSom') {
      controls.target.set(-0.05, 0.03, 0);
      camera.position.set(0.9, 0.52, 2.05);
      controls.update();
    }
    // 3/4 view so the linked nested tori of the Hopf fibration read.
    if ($archetypeId.get() === 'hopfion') {
      controls.target.set(0, 0, 0);
      camera.position.set(0.7, 2.7, 1.05);
      controls.update();
    }
    // Face-on 2-D plots: bifurcation diagram, CA space-time, and the pendulum-swarm plane.
    if ($archetypeId.get() === 'bifurcation' || $archetypeId.get() === 'elementaryCA') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 0, 3.0);
      controls.update();
    }
    if ($archetypeId.get() === 'doublePendulumSwarm') {
      controls.target.set(0, -0.2, 0);
      camera.position.set(0, -0.2, 3.4);
      controls.update();
    }
    if ($archetypeId.get() === 'ising') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 0, 3.1);
      controls.update();
    }
    if ($archetypeId.get() === 'penrose') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 0, 3.0);
      controls.update();
    }
    if ($archetypeId.get() === 'primeSpiral') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 0, 3.0);
      controls.update();
    }
    if ($archetypeId.get() === 'collatz') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 0, 5.4);
      controls.update();
    }
    if ($archetypeId.get() === 'barabasiAlbert') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 0.4, 5.0);
      controls.update();
    }
    // Edge bundling is a ring with arched bundles — view it nearly face-on, tilted enough to see the dome.
    if ($archetypeId.get() === 'edgeBundling') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, -1.0, 4.5);
      controls.update();
    }
    // Recamán's arc diagram lies along the number line — face-on, from slightly above so the tilted lower arcs read.
    if ($archetypeId.get() === 'recaman') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 0.8, 4.3);
      controls.update();
    }
    // Three plates in a row over the momentum sphere — face-on so both read.
    if ($archetypeId.get() === 'racketFlip') {
      controls.target.set(0, -0.3, 0);
      camera.position.set(0, -0.1, 5.7);
      controls.update();
    }
    // Three tops side by side — from a little above so the trails on their spheres read.
    if ($archetypeId.get() === 'heavyTop') {
      controls.target.set(0, -0.35, 0);
      camera.position.set(0, 1.6, 5.4);
      controls.update();
    }
    // The ellipsoid rolling on its floor — from above so the herpolhode rosette reads.
    if ($archetypeId.get() === 'poinsot') {
      controls.target.set(0, -0.35, 0);
      camera.position.set(0.6, 2.3, 4.2);
      controls.update();
    }
    // The pendulum over its floor — a high 3/4 view of the wire, the trace and the pegs.
    if ($archetypeId.get() === 'foucault') {
      controls.target.set(0, -0.3, 0);
      camera.position.set(1.7, 2.8, 3.2);
      controls.update();
    }
    // The river of space is a flat flow around the hole — seen from high above so the flashes' shapes read.
    if ($archetypeId.get() === 'riverSpace') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 3.6, 2.9);
      controls.update();
    }
    // The warp bubble's York-time sheet and light flashes — a raised 3/4 view along the line of motion.
    if ($archetypeId.get() === 'alcubierre') {
      controls.target.set(0, -0.1, 0);
      camera.position.set(0.5, 4.4, 5.6);
      controls.update();
    }
    // The flume is a long shallow channel — seen from above and behind, as in the AWB-1 design.
    if ($archetypeId.get() === 'warpFlume') {
      controls.target.set(0, -0.7, 0);
      camera.position.set(0, 6.4, 8.4);
      controls.update();
    }
    // The rotating shell with its pendulum rosette — from above so the turning swing plane reads.
    if ($archetypeId.get() === 'thirringShell') {
      controls.target.set(0, 0, 0);
      camera.position.set(1.6, 2.6, 4.6);
      controls.update();
    }
    // The train and the platform side by side — a raised front view so the clock rows and dials read.
    if ($archetypeId.get() === 'specialRelativity') {
      controls.target.set(0, 0.15, -0.1);
      camera.position.set(0, 3.3, 4.5);
      controls.update();
    }
    // The spacetime diagram: time up, a low 3/4 view so the cones, hyperbolae and tilting axes all read.
    if ($archetypeId.get() === 'lightCones') {
      controls.target.set(0, 0, 0);
      camera.position.set(1.7, 1.6, 7.4);
      controls.update();
    }
    // The spinning hole from above the equator, tilted so the twisting rain and the equatorial tracks both read.
    if ($archetypeId.get() === 'kerrDragging') {
      controls.target.set(0, 0, 0);
      camera.position.set(0.5, 4.4, 3.0);
      controls.update();
    }
    // The FDTD field panel, seen from almost straight above like the Luneburg lens.
    if ($archetypeId.get() === 'maxwellFdtd') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 3.9, 0.7);
      controls.update();
    }
    // Charged particles: a raised 3/4 view that suits the mirror bottle, the belts, and the cyclotron layers.
    if ($archetypeId.get() === 'chargedParticles') {
      controls.target.set(0, 0, 0);
      camera.position.set(2.3, 2.5, 3.7);
      controls.update();
    }
    // Three-body: a raised view of the Lagrange landscape (the orbit plane is flat, so it suits all set-ups).
    if ($archetypeId.get() === 'threeBody') {
      controls.target.set(0, -0.3, 0);
      camera.position.set(0.3, 3.0, 3.9);
      controls.update();
    }
    // The gas box from above and in front, with the speed histograms standing on the wall behind.
    if ($archetypeId.get() === 'idealGas') {
      controls.target.set(0, 0.25, -0.4);
      camera.position.set(-0.3, 2.9, 3.9);
      controls.update();
    }
    // The heat plate, seen from almost straight above like the other field panels.
    if ($archetypeId.get() === 'heatEquation') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 3.9, 0.7);
      controls.update();
    }
    // The percolation grid from above and in front, so the fire's raised front reads.
    if ($archetypeId.get() === 'percolation') {
      controls.target.set(0, 0, 0.2);
      camera.position.set(0, 3.3, 2.4);
      controls.update();
    }
    // The tank from above and to the side, so the flood front and the bow waves read as relief.
    if ($archetypeId.get() === 'shallowWater') {
      controls.target.set(0, 0.1, 0);
      camera.position.set(2.6, 2.4, 2.9);
      controls.update();
    }
    // Convection is a slice standing upright (hot floor at the bottom) — face it straight on.
    if ($archetypeId.get() === 'rayleighBenard') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 0, 3.2);
      controls.update();
    }
    // An upright square slice (gravity points down the screen) — face it straight on.
    if ($archetypeId.get() === 'shearInstabilities') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 0, 4.4);
      controls.update();
    }
    // An upright slice through the ground (surface at the top) — face it straight on.
    if ($archetypeId.get() === 'elasticWaves') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 0, 4.4);
      controls.update();
    }
    // The chain above its dispersion curve — a flat, face-on view.
    if ($archetypeId.get() === 'phonons') {
      controls.target.set(0, -0.2, 0);
      camera.position.set(0, -0.2, 4.3);
      controls.update();
    }
    // Phase space is a flat plot — face it straight on.
    if ($archetypeId.get() === 'twoStream') {
      controls.target.set(0, -0.25, 0);
      camera.position.set(0, -0.25, 4.3);
      controls.update();
    }
    // A slice through the star's middle — face it straight on.
    if ($archetypeId.get() === 'stellarCollapse') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 0, 4.4);
      controls.update();
    }
    // The cracking plate is flat — face it straight on.
    if ($archetypeId.get() === 'fracture') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 0, 3.6);
      controls.update();
    }
    // The two-slit set-up is a flat panel — face it straight on.
    if ($archetypeId.get() === 'aharonovBohm') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 0, 3.5);
      controls.update();
    }
    // The plates side-on and a little above, so the strings, the gap and the spectrum strip all read.
    if ($archetypeId.get() === 'casimirPlates') {
      controls.target.set(0, -0.3, 0);
      camera.position.set(0.9, 0.9, 4.4);
      controls.update();
    }
    if ($archetypeId.get() === 'customParametric') {
      controls.target.set(0, 0, 0);
      camera.position.set(2.6, 1.8, 3.4);
      controls.update();
    }
    // Front 3/4 view of the brain so the paired lobes and the midline central complex read.
    if ($archetypeId.get() === 'flyBrain') {
      controls.target.set(0, 0, 0);
      camera.position.set(0.4, 0.7, 3.3);
      controls.update();
    }
    // Near-top-down so the plane wave, the lens disk, and the focus all read as a flat field.
    if ($archetypeId.get() === 'luneburgLens') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 3.9, 0.7);
      controls.update();
    }
    if ($archetypeId.get() === 'aurora') {
      controls.target.set(0, 0.5, -0.4);
      camera.position.set(0, 0.3, 3.9);
      controls.update();
    }
    // The bio bay is a dark water plane — a kayaker's low 3/4 view so the glowing wake reads on the surface.
    if ($archetypeId.get() === 'bioBay') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 1.7, 2.5);
      controls.update();
    }
    // The comb jelly drifts centred — a close 3/4 so the rainbow rows read.
    if ($archetypeId.get() === 'combJelly') {
      controls.target.set(0, 0, 0);
      camera.position.set(0.7, 0.25, 2.3);
      controls.update();
    }
    // The jellyfish fountain dangles below its crown — frame the whole dome.
    if ($archetypeId.get() === 'jellyfishFountain') {
      controls.target.set(0, -0.05, 0);
      camera.position.set(0, 0.3, 3.4);
      controls.update();
    }
    scheduleLle();
  }

  // --- in-app Lyapunov validation (attractors only), off the critical path ---
  function scheduleLle(): void {
    const id = $archetypeId.get();
    const system = SYSTEMS[id];
    if (!system) {
      $telemetry.setKey('lle', NaN);
      return;
    }
    window.setTimeout(() => {
      if ($archetypeId.get() !== id) return; // archetype changed meanwhile
      const lle = largestLyapunov(system, resolveParams($params.get(), $global.get().dt), {
        intervals: 700,
        transient: 1500,
      });
      $telemetry.setKey('lle', lle);
    }, 350);
  }
  scheduleLle();

  // --- store subscriptions (.listen = no initial fire) ---
  let lastCount = $global.get().particleCount;
  let lastTrail = $global.get().trailLength;
  let lastGpu = $global.get().gpuCompute;
  $archetypeId.listen(() => scheduleRebuild());
  $global.listen((g) => {
    driver.setParams($params.get(), g.dt);
    gpuSim?.setParams({ dt: g.dt });
    if (g.trailLength !== lastTrail) {
      lastTrail = g.trailLength;
      driver.setTrailLength(g.trailLength);
      if (!gpuSim) trailCloud.setVisible(g.trailLength > 0);
    }
    if (g.gpuCompute !== lastGpu) {
      lastGpu = g.gpuCompute;
      applyMode();
    }
    if (g.particleCount !== lastCount) {
      lastCount = g.particleCount;
      scheduleRebuild();
    }
  });
  // A param declared `rebuild: true` (a structural choice: a set-up, a grid size, a count) re-creates the
  // system when it changes. The view is kept — only switching systems moves the camera to its preset.
  let lastParamsId = $archetypeId.get();
  let lastParams: Record<string, number> = { ...$params.get() };
  let structuralTimer: ReturnType<typeof setTimeout> | undefined;
  $params.listen((p) => {
    driver.setParams(p, $global.get().dt);
    gpuSim?.setParams({ ...p, dt: $global.get().dt });
    raymarch?.setParams(p);
    scheduleLle();
    // decide after the current task settles: switching systems sets the new defaults BEFORE the new id
    const snap = { ...p };
    queueMicrotask(() => {
      const id = $archetypeId.get();
      const structural = id === lastParamsId && getFactory(id).params.some((s) => s.rebuild && snap[s.key] !== lastParams[s.key]);
      lastParamsId = id;
      lastParams = snap;
      if (!structural) return;
      // debounced: dragging a structural slider fires many changes, but only the value it settles on rebuilds
      clearTimeout(structuralTimer);
      structuralTimer = setTimeout(() => {
        if ($archetypeId.get() !== id) return; // switched away meanwhile — that switch rebuilt already
        const pos = camera.position.clone(), target = controls.target.clone();
        scheduleRebuild();
        queueMicrotask(() => {
          chain = chain.then(() => { camera.position.copy(pos); controls.target.copy(target); controls.update(); });
        });
      }, 180);
    });
  });

  // --- resize ---
  function resize(): void {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  // Mobile: rotation + the visual viewport (URL bar show/hide) don't always fire a plain 'resize'
  // promptly, so listen explicitly. The small delay lets the new dimensions settle after a rotate.
  window.addEventListener('orientationchange', () => setTimeout(resize, 120));
  window.visualViewport?.addEventListener('resize', resize);
  resize();

  // --- render loop (decoupled from the sim) ---
  const timer = new THREE.Timer();
  // NB: intentionally not calling timer.connect(document) — the Page Visibility API would
  // freeze the clock (and the main-thread fallback sim) whenever the page reports hidden.
  // The Math.min clamp below handles large deltas after a tab switch.
  let paused = false;
  let frames = 0;
  let windowStart = 0;
  // Physical sim-clock (factory.clock): model time = Σ(fixed-step dt × speed param), accumulated from
  // frameIndex deltas so it tracks the archetype's own t exactly (pausing, dt changes, and speed-slider
  // moves all stay in sync). Reset on every rebuild; wraps at clock.cycle for systems that replay.
  let clockModelT = 0;
  let clockPrevFrame = 0;

  function updateSimClock(): void {
    const spec = getFactory($archetypeId.get()).clock;
    if (!spec || gpuSim || raymarch) {
      if ($telemetry.get().simTime !== '') $telemetry.setKey('simTime', '');
      return;
    }
    const fi = driver.frameIndex();
    if (fi > clockPrevFrame) {
      clockModelT += (fi - clockPrevFrame) * ($global.get().dt || 1 / 60) * ($params.get().speed ?? 1);
    }
    clockPrevFrame = fi;
    const total = clockModelT + (spec.offset ?? 0);
    const wrapped = spec.cycle ? total % spec.cycle : total;
    const v = wrapped * spec.scale;
    $telemetry.setKey('simTime', `T + ${v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${spec.unit}`);
  }

  applyMode(); // establish CPU (default) or GPU path now that `paused` exists

  // One simulation step (no screen render) — advances the raymarch shader clock / GPU compute / CPU
  // integrator exactly as the animation loop does. Factored out so the offline thumbnail-capture pass
  // can drive systems forward WITHOUT requestAnimationFrame (which a backgrounded tab throttles).
  function stepFrame(dt: number, elapsed: number): void {
    if (raymarch) {
      if (!paused) raymarch.update(elapsed); // drive shader animation (frozen while paused)
    } else if (gpuSim) {
      if (!paused) {
        for (let s = 0; s < gpuSim.substeps; s++) {
          for (const pass of gpuSim.steps) renderer.compute(pass); // submitted, not awaited
        }
      }
    } else {
      if (!paused) driver.pump(dt);
      if (fieldPass) {
        const f = driver.readField?.();
        if (f) fieldPass.update(f); // draw the field colour-map instead of the point cloud
      } else {
        floatingOrigin.rebase(driver.source(), posArray); // anchor = 0 (identity copy) in P1
        cloud.posAttr.needsUpdate = true;
        if (trailCloud.group.visible) trailCloud.update(driver.trailHead());
      }
    }
  }

  function animate(): void {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.05); // clamp residual large deltas

    stepFrame(dt, timer.getElapsed());
    updateFocus(dt);
    controls.update();
    renderFrame();

    frames++;
    const now = timer.getElapsed();
    if (now - windowStart >= 0.25) {
      $telemetry.setKey('fps', frames / (now - windowStart));
      $telemetry.setKey('particles', gpuSim ? gpuSim.particleCount : driver.particleCount);
      $telemetry.setKey('substeps', gpuSim ? gpuSim.substeps : driver.substeps());
      $telemetry.setKey('camPos', [camera.position.x, camera.position.y, camera.position.z]);
      $telemetry.setKey('camTarget', [controls.target.x, controls.target.y, controls.target.z]);
      updateSimClock();
      frames = 0;
      windowStart = now;
    }
  }
  renderer.setAnimationLoop(animate);

  // --- snapshot ---
  function cameraSnapshot(): SnapshotCamera {
    return {
      position: [camera.position.x, camera.position.y, camera.position.z],
      target: [controls.target.x, controls.target.y, controls.target.z],
      zoomDecade: 0,
      fov: camera.fov,
      logarithmicDepth: false,
    };
  }

  const engine: Engine = {
    backend,
    exportSnapshot(): Snapshot {
      return buildSnapshot({
        archetypeId: driver.archetypeId,
        particleCount: driver.particleCount,
        dt: $global.get().dt,
        trailLength: $global.get().trailLength,
        archetypeParams: $params.get(),
        hierarchy: driver.hierarchy,
        camera: cameraSnapshot(),
        frameIndex: driver.frameIndex(),
        seed: SEED,
      });
    },
    importSnapshot(snap: Snapshot): void {
      $global.set({
        dt: snap.global.dt,
        particleCount: snap.particleCount,
        trailLength: snap.global.trailLength ?? $global.get().trailLength,
        gpuCompute: $global.get().gpuCompute,
      });
      $params.set({ ...snap.archetypeParams });
      $archetypeId.set(snap.archetypeId); // triggers rebuild via listeners
      const [px, py, pz] = snap.camera.position;
      const [tx, ty, tz] = snap.camera.target;
      camera.position.set(px, py, pz);
      controls.target.set(tx, ty, tz);
      controls.update();
    },
    setCamera(position, target) {
      camera.position.set(position[0], position[1], position[2]);
      controls.target.set(target[0], target[1], target[2]);
      controls.update();
    },
    async captureImageBlob(): Promise<Blob> {
      // Render the current view into an offscreen target (the WebGPU swap-chain isn't readable),
      // sRGB so it matches the screen, then composite a branded overlay and embed the snapshot.
      const sizeV = new THREE.Vector2();
      renderer.getDrawingBufferSize(sizeV);
      const w = Math.max(1, sizeV.x | 0);
      const h = Math.max(1, sizeV.y | 0);
      const rt = new THREE.RenderTarget(w, h);
      if (!post) rt.texture.colorSpace = THREE.SRGBColorSpace; // post composite is already sRGB-encoded — an sRGB-tagged target would encode twice (washed-out lift)
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(rt);
      renderFrame(); // enqueue synchronously (bloom composite included); the async readback below awaits GPU completion
      const buf = (await renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h)) as Uint8Array;
      renderer.setRenderTarget(prev);
      rt.dispose();

      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const ctx = cv.getContext('2d');
      if (!ctx) throw new Error('2D canvas context unavailable');
      const img = ctx.createImageData(w, h);
      // WebGPU pads each readback row to a 256-byte boundary; WebGL2 packs tightly. Detect which,
      // then copy each row from its real (padded) source offset — otherwise rows drift and shear.
      const stride = buf.length === w * h * 4 ? w * 4 : Math.ceil((w * 4) / 256) * 256;
      for (let r = 0; r < h; r++) {
        const src = (READBACK_BOTTOM_UP ? h - 1 - r : r) * stride; // WebGPU reads back top-down; only WebGL2 needs the flip
        img.data.set(buf.subarray(src, src + w * 4), r * w * 4);
      }
      ctx.putImageData(img, 0, 0);

      // --- overlay: ETHERSIM + version (bottom-left), system/params/camera (bottom-right) ---
      const id = driver.archetypeId;
      const label = getFactory(id).label;
      const p = $params.get();
      const paramStr = Object.entries(p)
        .slice(0, 5)
        .map(([k, v]) => `${k} ${(+v).toFixed(2)}`)
        .join('   ');
      const cam = `cam ${camera.position.x.toFixed(2)}, ${camera.position.y.toFixed(2)}, ${camera.position.z.toFixed(2)}`;
      const fs = Math.max(11, Math.round(h * 0.016));
      const pad = Math.round(h * 0.03);
      ctx.shadowColor = 'rgba(0,0,0,0.85)';
      ctx.shadowBlur = fs * 0.5;
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      ctx.font = `600 ${Math.round(fs * 1.5)}px ui-monospace, "SF Mono", Menlo, monospace`;
      ctx.fillStyle = 'rgba(120,232,220,0.95)';
      ctx.fillText('ETHERSIM', pad, h - pad - fs * 1.3);
      ctx.font = `${Math.round(fs * 0.85)}px ui-monospace, monospace`;
      ctx.fillStyle = 'rgba(200,220,240,0.6)';
      ctx.fillText(`v${APP_VERSION}  ·  ethersim.ai`, pad, h - pad);
      ctx.textAlign = 'right';
      ctx.font = `${Math.round(fs * 1.1)}px ui-monospace, monospace`;
      ctx.fillStyle = 'rgba(225,238,252,0.9)';
      ctx.fillText(label, w - pad, h - pad - fs * 2.6);
      ctx.font = `${Math.round(fs * 0.85)}px ui-monospace, monospace`;
      ctx.fillStyle = 'rgba(185,205,228,0.65)';
      ctx.fillText(paramStr, w - pad, h - pad - fs * 1.3);
      ctx.fillText(cam, w - pad, h - pad);

      // PNG → embed the full snapshot as a tEXt chunk (the image alone can recreate the sim).
      const blob: Blob = await new Promise((res) => cv.toBlob((b) => res(b as Blob), 'image/png'));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const withMeta = embedText(bytes, 'ethersim', JSON.stringify(this.exportSnapshot()));
      return new Blob([withMeta as unknown as BlobPart], { type: 'image/png' });
    },
    async exportImage(): Promise<void> {
      const blob = await this.captureImageBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ethersim-${driver.archetypeId}-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
    },
    // Record a short looping clip of the live view and download it as WebM (+ animated GIF) — a
    // motion-faithful share asset for social/marketing (a still can't show the 3D animation). The
    // live render loop keeps running; each tick we re-render the current scene to an offscreen target
    // (the WebGPU swap-chain isn't readable, same as captureImageBlob), restore the target BEFORE the
    // async readback (so the live loop never renders into our target), and draw the frame onto a 2D
    // mirror canvas: MediaRecorder records that mirror for the WebM, and we sample its pixels for the GIF.
    async captureClip(onStatus?: (msg: string) => void): Promise<void> {
      const DUR = 5000; // ms recorded
      const FPS = 20; // webm sample / mirror-update rate
      const GIF_EVERY = 2; // gif takes every Nth mirror frame → ~10fps
      const MAXW = 560; // mirror width (aspect-preserved; webm + gif source)
      const id = driver.archetypeId;
      const label = getFactory(id).label;

      const sizeV = new THREE.Vector2();
      renderer.getDrawingBufferSize(sizeV);
      // Fall back to the CSS canvas size × DPR if the drawing buffer reports empty (a 1×1/0 buffer can
      // happen in headless/automation contexts — the offline thumbnail pass guards the same way).
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const sw = Math.max(2, (sizeV.x | 0) || Math.round((canvas.clientWidth || window.innerWidth || 1280) * dpr));
      const sh = Math.max(2, (sizeV.y | 0) || Math.round((canvas.clientHeight || window.innerHeight || 800) * dpr));
      const scale = Math.min(1, MAXW / sw);
      const w = Math.max(2, (Math.round(sw * scale) >> 1) << 1); // even dims (encoder-friendly)
      const h = Math.max(2, (Math.round(sh * scale) >> 1) << 1);

      const rt = new THREE.RenderTarget(w, h); // render directly at the (small) clip resolution → fast readback
      if (!post) rt.texture.colorSpace = THREE.SRGBColorSpace; // post composite is already sRGB-encoded — an sRGB-tagged target would encode twice (washed-out lift)
      const mirror = document.createElement('canvas');
      mirror.width = w;
      mirror.height = h;
      const mctx = mirror.getContext('2d')!;

      const stamp = (): void => {
        const fs = Math.max(10, Math.round(h * 0.04));
        mctx.save();
        mctx.shadowColor = 'rgba(0,0,0,0.8)';
        mctx.shadowBlur = fs * 0.5;
        mctx.textBaseline = 'alphabetic';
        mctx.textAlign = 'left';
        mctx.font = `600 ${fs}px ui-monospace, Menlo, monospace`;
        mctx.fillStyle = 'rgba(120,232,220,0.92)';
        mctx.fillText('ETHERSIM', fs * 0.6, h - fs * 1.5);
        mctx.font = `${Math.round(fs * 0.66)}px ui-monospace, monospace`;
        mctx.fillStyle = 'rgba(200,220,240,0.6)';
        mctx.fillText('ethersim.ai', fs * 0.6, h - fs * 0.55);
        mctx.textAlign = 'right';
        mctx.fillStyle = 'rgba(225,238,252,0.85)';
        mctx.font = `${Math.round(fs * 0.8)}px ui-monospace, monospace`;
        mctx.fillText(label, w - fs * 0.6, h - fs * 0.7);
        mctx.restore();
      };

      // optional WebM recorder on the mirror (guarded — captureStream / MediaRecorder may be absent)
      const canRec = typeof MediaRecorder !== 'undefined' && typeof (mirror as HTMLCanvasElement).captureStream === 'function';
      let rec: MediaRecorder | null = null;
      let webmDone: Promise<Blob | null> = Promise.resolve(null);
      if (canRec) {
        const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || 'video/webm';
        const stream = mirror.captureStream(FPS);
        rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
        const chunks: Blob[] = [];
        rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        webmDone = new Promise((res) => { rec!.onstop = () => res(new Blob(chunks, { type: 'video/webm' })); });
        rec.start();
      }

      const gifFrames: Uint8ClampedArray[] = [];
      const prevTarget = renderer.getRenderTarget();
      // Take over the render loop for the duration so nothing else renders into our target mid-readback
      // (the readback must run while rt is the active target — same ordering as captureImageBlob).
      renderer.setAnimationLoop(null);
      const dt = 1 / FPS;
      let elapsed = 0;
      const t0 = performance.now();
      let frame = 0;
      onStatus?.('● recording…');
      try {
        await new Promise<void>((resolve) => {
          const tick = async (): Promise<void> => {
            elapsed += dt;
            stepFrame(dt, elapsed); // advance the sim ourselves (live loop is paused)
            controls.update();
            renderer.setRenderTarget(rt);
            renderFrame();
            const buf = (await renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h)) as Uint8Array;
            renderer.setRenderTarget(prevTarget);
            const img = mctx.createImageData(w, h);
            const stride = buf.length === w * h * 4 ? w * 4 : Math.ceil((w * 4) / 256) * 256;
            for (let r = 0; r < h; r++) {
              const src = (READBACK_BOTTOM_UP ? h - 1 - r : r) * stride; // WebGPU reads back top-down; only WebGL2 needs the flip
              img.data.set(buf.subarray(src, src + w * 4), r * w * 4);
            }
            mctx.putImageData(img, 0, 0);
            stamp();
            if (frame % GIF_EVERY === 0) gifFrames.push(mctx.getImageData(0, 0, w, h).data.slice());
            frame++;
            if (performance.now() - t0 >= DUR) { resolve(); return; }
            setTimeout(() => void tick(), 1000 / FPS);
          };
          void tick();
        });
      } finally {
        renderer.setRenderTarget(prevTarget);
        renderer.setAnimationLoop(animate); // restore the live loop no matter what
      }
      rt.dispose();

      // download helper
      const save = (blob: Blob, ext: string): void => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ethersim-${id}-${Date.now()}.${ext}`;
        a.click();
        URL.revokeObjectURL(url);
      };

      if (rec) {
        rec.stop();
        const webm = await webmDone;
        if (webm && webm.size) save(webm, 'webm');
      }

      onStatus?.('encoding GIF…');
      // yield so the status paints before the (blocking) GIF encode
      await new Promise((r) => setTimeout(r, 30));
      const enc = GIFEncoder();
      const delay = Math.round(1000 / (FPS / GIF_EVERY));
      for (const data of gifFrames) {
        const palette = quantize(data, 256);
        const index = applyPalette(data, palette);
        enc.writeFrame(index, w, h, { palette, delay });
      }
      enc.finish();
      save(new Blob([enc.bytes() as unknown as BlobPart], { type: 'image/gif' }), 'gif');
      onStatus?.(`clip saved ✓ (${rec ? 'webm + gif' : 'gif'}) — ${gifFrames.length} frames`);
    },
    togglePause(): boolean {
      paused = !paused;
      driver.setPaused(paused);
      $paused.set(paused); // mirror to the store so demo cycling halts while frozen + the HUD reflects it
      return paused;
    },
    // Pan the view (translate camera + orbit target together) without rotating. dx/dy are screen
    // directions in [-1,1]; the step scales with zoom distance so it feels consistent. Used by the
    // arrow keys to nudge the framing — handy when the Learn panel overlaps the sim.
    panView(dx: number, dy: number): void {
      camera.updateMatrixWorld();
      const dist = Math.max(0.001, camera.position.distanceTo(controls.target));
      const step = dist * 0.05;
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
      const move = right.multiplyScalar(dx * step).add(up.multiplyScalar(dy * step));
      camera.position.add(move);
      controls.target.add(move);
      controls.update();
    },
    reset(): void {
      scheduleRebuild();
    },
    highlightParticles(start: number | null, count: number): void {
      cloud.highlight(start, count);
    },
    focusNode(start: number | null, count: number): void {
      if (start === null || count <= 0) return;
      const pos = driver.source();
      const end = start + count;
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (let i = start; i < end; i++) {
        const o = i * 3;
        cx += pos[o];
        cy += pos[o + 1];
        cz += pos[o + 2];
      }
      cx /= count;
      cy /= count;
      cz /= count;
      let r2 = 0;
      for (let i = start; i < end; i++) {
        const o = i * 3;
        const dx = pos[o] - cx;
        const dy = pos[o + 1] - cy;
        const dz = pos[o + 2] - cz;
        const d = dx * dx + dy * dy + dz * dz;
        if (d > r2) r2 = d;
      }
      _focusCenter.set(cx, cy, cz);
      focusOn(_focusCenter, Math.max(Math.sqrt(r2), 0.05));
    },
  };

  $engine.set(engine);

  // DEV-ONLY thumbnail tooling — the entire block (impl + capture loop) is gated by import.meta.env.DEV
  // so the readback/encode body tree-shakes out of the production bundle.
  if (import.meta.env.DEV) {
    // Clean (overlay-free) downscaled WebP of the current view. Renders the scene into an offscreen
    // sRGB target and reads it back — the HTML control UI is never in the render target, so the
    // thumbnail is pure 3D. Centre-cropped to 8:5 for a consistent gallery aspect.
    const captureThumbnail = async (maxW = 480): Promise<string> => {
      const sizeV = new THREE.Vector2();
      renderer.getDrawingBufferSize(sizeV);
      const w = Math.max(1, sizeV.x | 0);
      const h = Math.max(1, sizeV.y | 0);
      const rt = new THREE.RenderTarget(w, h);
      if (!post) rt.texture.colorSpace = THREE.SRGBColorSpace; // post composite is already sRGB-encoded — an sRGB-tagged target would encode twice (washed-out lift)
      const prev = renderer.getRenderTarget();
      let buf: Uint8Array;
      try {
        renderer.setRenderTarget(rt);
        renderFrame(); // enqueue synchronously (bloom composite included); the async readback below awaits GPU completion
        buf = (await renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h)) as Uint8Array;
      } finally {
        renderer.setRenderTarget(prev); // always restore + free, even if render/readback threw
        rt.dispose();
      }

      const full = document.createElement('canvas');
      full.width = w;
      full.height = h;
      const fctx = full.getContext('2d');
      if (!fctx) throw new Error('2D canvas context unavailable');
      const img = fctx.createImageData(w, h);
      const stride = buf.length === w * h * 4 ? w * 4 : Math.ceil((w * 4) / 256) * 256; // WebGPU row padding
      for (let r = 0; r < h; r++) {
        const src = (READBACK_BOTTOM_UP ? h - 1 - r : r) * stride; // top-down on WebGPU (verified vs the live canvas); WebGL2 needs the flip
        img.data.set(buf.subarray(src, src + w * 4), r * w * 4);
      }
      fctx.putImageData(img, 0, 0);

      const aspect = 1.6; // 8:5 gallery card
      let sw = w;
      let sh = Math.round(w / aspect);
      if (sh > h) {
        sh = h;
        sw = Math.round(h * aspect);
      }
      const sx = Math.round((w - sw) / 2);
      const sy = Math.round((h - sh) / 2);
      const tw = Math.min(maxW, sw);
      const th = Math.round(tw / aspect);
      const thumb = document.createElement('canvas');
      thumb.width = tw;
      thumb.height = th;
      const tctx = thumb.getContext('2d');
      if (!tctx) throw new Error('2D canvas context unavailable');
      tctx.imageSmoothingEnabled = true;
      tctx.imageSmoothingQuality = 'high';
      tctx.drawImage(full, sx, sy, sw, sh, 0, 0, tw, th);
      return thumb.toDataURL('image/webp', 0.82);
    };
    engine.captureThumbnail = captureThumbnail; // expose for any dev consumer

    // ?capture=thumbs: cycle every system, advance it a fixed number of simulation steps, grab a clean
    // WebP, and POST it to the dev-server middleware that writes public/thumbs/<id>.webp. RAF-INDEPENDENT
    // (drives stepFrame directly + awaits the microtask rebuild AND the async GPU setup), so it completes
    // even when the tab is backgrounded (requestAnimationFrame is throttled) and works on GPU-compute systems.
    const captureAllThumbnails = async (): Promise<void> => {
      const { listFactories } = await import('../core/registry');
      const { selectArchetype } = await import('../ui/store');
      renderer.setAnimationLoop(null); // stop the live loop: it double-steps + its controls.update() fights our camera
      forceMainDriver = true; // so synchronous stepFrame advances trail systems (worker advances on wall-clock)
      // A fresh/headless first load can leave the renderer at a 1×1 drawing buffer (the resize observer
      // hasn't fired yet) → the readback is a single black pixel. Force a real capture resolution.
      {
        const el = renderer.domElement as HTMLCanvasElement;
        const cw = Math.max(el.clientWidth || 0, (typeof window !== 'undefined' && window.innerWidth) || 0, 1280);
        const ch = Math.max(el.clientHeight || 0, (typeof window !== 'undefined' && window.innerHeight) || 0, 800);
        renderer.setSize(cw, ch, false);
        camera.aspect = cw / ch;
        camera.updateProjectionMatrix();
      }
      const only = new URLSearchParams(location.search).get('only'); // ?capture=thumbs&only=<id>[,<id>…] → subset
      const onlySet = only ? new Set(only.split(',')) : null;
      const ids = listFactories()
        .map((f) => f.id)
        .filter((id) => !onlySet || onlySet.has(id));
      // Wait for the queued (microtask) rebuild swap AND the async GPU setup to finish, so stepFrame
      // drives the right path (raymarch / GPU compute / CPU) against a fully-built system.
      const settle = async (): Promise<void> => {
        await Promise.resolve();
        await Promise.resolve();
        await chain; // doRebuild done (driver/raymarch swapped; applyMode kicked off setupGpu)
        if (gpuPending) await gpuPending; // GPU sim actually ready (computeAsync(init) resolved)
        await Promise.resolve();
      };
      console.log(`[thumbs] capturing ${ids.length} systems…`);
      let ok = 0;
      let fail = 0;
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        selectArchetype(id);
        await settle();
        // Deterministic framing: don't let a thumbnail inherit the previous system's camera (the
        // per-system presets in doRebuild only fire for a few systems). Default 3/4 view otherwise.
        controls.target.set(0, 0, 0);
        // raymarch systems already got their correct camera (camDir·camDist) from setupRaymarch during
        // the rebuild — don't override it. Point clouds get a deterministic default 3/4 (karman top-down).
        if (!isRaymarch(id)) {
          if (id === 'karman') camera.position.set(0, 3.2, 0.85);
          else if (id === 'pseudospectrum') { controls.target.set(0, 0.45, 0); camera.position.set(0, 2.5, 3.0); }
          else if (id === 'cosmicWeb') { controls.target.set(0, 0, 0); camera.position.set(2.3, 1.5, 2.8); }
          else if (id === 'theodorus') { controls.target.set(0, 0, 0); camera.position.set(0, 1.15, 3.85); }
          else if (id === 'reconnection') { controls.target.set(0, 0, 0); camera.position.set(1.4, 0.8, 3.9); }
          else if (id === 'dla') { controls.target.set(0, 0, 0); camera.position.set(0, 3.5, 1.15); }
          else if (id === 'cymatics') { controls.target.set(0, 0, 0); camera.position.set(0, 4.2, 1.4); }
          else if (id === 'polynomialRoots') { controls.target.set(0, 0, 0); camera.position.set(0, 0, 3.6); }
          else if (id === 'stringWorldsheet') { controls.target.set(0, 0, 0); camera.position.set(3.1, 2.2, 3.4); }
          else if (id === 'stokesPhase') { controls.target.set(0, 0, 0); camera.position.set(0, 2.6, 3.0); }
          else if (id === 'dispersionWave') { controls.target.set(0, 0, 0); camera.position.set(0, 0.6, 3.9); }
          else if (id === 'crossedDiffraction') { controls.target.set(0, 0, 0); camera.position.set(0, 0, 3.4); }
          else if (id === 'dandelion') { controls.target.set(0, 0, 0); camera.position.set(0.6, 0.4, 3.1); }
          else if (id === 'lorenzSwarm' || id === 'attractorMenagerie') { controls.target.set(0, 0, 0); camera.position.set(0, 0, 4.4); }
          else if (id === 'solarCorona') { controls.target.set(0, 0, 0); camera.position.set(0, 0, 2.1); }
          else if (id === 'spiralGalaxy') { controls.target.set(0, 0, 0); camera.position.set(0, 1.8, 2.9); }
          else if (id === 'galaxyCollision') { controls.target.set(0, 0, 0); camera.position.set(0, 1.9, 5.0); }
          else if (id === 'lightning') { controls.target.set(0, 0, 0); camera.position.set(0, 0, 3.4); }
          else if (id === 'structureFormation') { controls.target.set(0, 0, 0); camera.position.set(2.2, 1.5, 2.7); }
          else if (id === 'whiteHole') { controls.target.set(0, -0.1, 0); camera.position.set(0, 1.7, 3.1); }
          else if (id === 'marsClouds') { controls.target.set(0, 0.25, 0); camera.position.set(0, -0.15, 3.0); }
          else if (id === 'impactFragmentation') { controls.target.set(0, 0, 0); camera.position.set(1.4, 1.0, 3.2); }
          else if (id === 'pulsar') { controls.target.set(0, 0, 0); camera.position.set(0.5, 1.1, 3.4); }
          else if (id === 'relativisticJet') { controls.target.set(0, 0, 0); camera.position.set(0, 0.7, 3.6); }
          else if (id === 'multiLenia') { controls.target.set(0, 0, 0); camera.position.set(0, 2.5, 1.25); }
          else if (id === 'gravityWell') { controls.target.set(0, -0.35, 0); camera.position.set(1.35, 0.6, 2.5); }
          else if (id === 'bec') { controls.target.set(0, 0, 0); camera.position.set(0.9, 0.7, 3.0); }
          else if (id === 'aurora') { controls.target.set(0, 0.5, -0.4); camera.position.set(0, 0.3, 3.9); }
          else if (id === 'daphnis') { controls.target.set(0.7, 0, 0.7); camera.position.set(1.3, 0.3, 1.62); }
          else if (id === 'hyperbolicSphere') { controls.target.set(0, 0, 0); camera.position.set(0.4, 0.55, 2.9); }
          else if (id === 'dnaSupercoil') { controls.target.set(0, 0, 0); camera.position.set(1.4, 0.95, 1.95); }
          else if (id === 'trigMap') { controls.target.set(0, 0, 0); camera.position.set(0, 0, 3.0); }
          else if (id === 'newtonFlow') { controls.target.set(0, 0, 0); camera.position.set(0.2, 0.15, 2.9); }
          else if (id === 'auroraOrbit') { controls.target.set(0, 0.3, -1.4); camera.position.set(0.2, 1.5, 3.6); }
          else if (id === 'fireflies') { controls.target.set(0, 0, 0); camera.position.set(0, 0.2, 4.4); }
          else if (id === 'ringdown') { controls.target.set(0, -0.2, 0); camera.position.set(1.5, 1.6, 2.3); }
          else if (id === 'giganticJet') { controls.target.set(0, 0.7, -0.4); camera.position.set(0.3, 1.3, 3.3); }
          else if (id === 'precession') { controls.target.set(0, 0, 0); camera.position.set(0.4, 2.9, 1.9); }
          else if (id === 'iteratedLog') { controls.target.set(0, 0, 0); camera.position.set(0, 0, 3.0); }
          else if (id === 'spiralWhirl') { controls.target.set(0, 0, 0); camera.position.set(0, 0, 3.0); }
          else if (id === 'som') { controls.target.set(0, 0, 0); camera.position.set(1.6, 1.05, 2.2); }
          else if (id === 'vascularSom') { controls.target.set(-0.05, 0.03, 0); camera.position.set(0.9, 0.52, 2.05); }
          else if (id === 'hopfion') { controls.target.set(0, 0, 0); camera.position.set(0.7, 2.7, 1.05); }
          else if (id === 'bifurcation' || id === 'elementaryCA') { controls.target.set(0, 0, 0); camera.position.set(0, 0, 3.0); }
          else if (id === 'doublePendulumSwarm') { controls.target.set(0, -0.2, 0); camera.position.set(0, -0.2, 3.4); }
          else if (id === 'ising') { controls.target.set(0, 0, 0); camera.position.set(0, 0, 3.1); }
          else if (id === 'penrose') { controls.target.set(0, 0, 0); camera.position.set(0, 0, 3.0); }
          else if (id === 'primeSpiral') { controls.target.set(0, 0, 0); camera.position.set(0, 0, 3.0); }
          else if (id === 'collatz') { controls.target.set(0, 0, 0); camera.position.set(0, 0, 5.4); }
          else if (id === 'barabasiAlbert') { controls.target.set(0, 0, 0); camera.position.set(0, 0.4, 5.0); }
          else if (id === 'edgeBundling') { controls.target.set(0, 0, 0); camera.position.set(0, -1.0, 4.5); }
          else if (id === 'recaman') { controls.target.set(0, 0, 0); camera.position.set(0, 0.8, 4.3); }
          else if (id === 'racketFlip') { controls.target.set(0, -0.3, 0); camera.position.set(0, -0.1, 5.7); }
          else if (id === 'heavyTop') { controls.target.set(0, -0.35, 0); camera.position.set(0, 1.6, 5.4); }
          else if (id === 'poinsot') { controls.target.set(0, -0.35, 0); camera.position.set(0.6, 2.3, 4.2); }
          else if (id === 'foucault') { controls.target.set(0, -0.3, 0); camera.position.set(1.7, 2.8, 3.2); }
          else if (id === 'riverSpace') { controls.target.set(0, 0, 0); camera.position.set(0, 3.6, 2.9); }
          else if (id === 'alcubierre') { controls.target.set(0, -0.1, 0); camera.position.set(0.5, 4.4, 5.6); }
          else if (id === 'warpFlume') { controls.target.set(0, -0.7, 0); camera.position.set(0, 6.4, 8.4); }
          else if (id === 'thirringShell') { controls.target.set(0, 0, 0); camera.position.set(1.6, 2.6, 4.6); }
          else if (id === 'specialRelativity') { controls.target.set(0, 0.15, -0.1); camera.position.set(0, 3.3, 4.5); }
          else if (id === 'lightCones') { controls.target.set(0, 0, 0); camera.position.set(1.7, 1.6, 7.4); }
          else if (id === 'kerrDragging') { controls.target.set(0, 0, 0); camera.position.set(0.5, 4.4, 3.0); }
          else if (id === 'maxwellFdtd') { controls.target.set(0, 0, 0); camera.position.set(0, 3.9, 0.7); }
          else if (id === 'chargedParticles') { controls.target.set(0, 0, 0); camera.position.set(2.3, 2.5, 3.7); }
          else if (id === 'threeBody') { controls.target.set(0, -0.3, 0); camera.position.set(0.3, 3.0, 3.9); }
          else if (id === 'idealGas') { controls.target.set(0, 0.25, -0.4); camera.position.set(-0.3, 2.9, 3.9); }
          else if (id === 'heatEquation') { controls.target.set(0, 0, 0); camera.position.set(0, 3.9, 0.7); }
          else if (id === 'percolation') { controls.target.set(0, 0, 0.2); camera.position.set(0, 3.3, 2.4); }
          else if (id === 'shallowWater') { controls.target.set(0, 0.1, 0); camera.position.set(2.6, 2.4, 2.9); }
          else if (id === 'rayleighBenard') { controls.target.set(0, 0, 0); camera.position.set(0, 0, 3.2); }
          else if (id === 'shearInstabilities') { controls.target.set(0, 0, 0); camera.position.set(0, 0, 4.4); }
          else if (id === 'elasticWaves') { controls.target.set(0, 0, 0); camera.position.set(0, 0, 4.4); }
          else if (id === 'phonons') { controls.target.set(0, -0.2, 0); camera.position.set(0, -0.2, 4.3); }
          else if (id === 'twoStream') { controls.target.set(0, -0.25, 0); camera.position.set(0, -0.25, 4.3); }
          else if (id === 'stellarCollapse') { controls.target.set(0, 0, 0); camera.position.set(0, 0, 4.4); }
          else if (id === 'fracture') { controls.target.set(0, 0, 0); camera.position.set(0, 0, 3.6); }
          else if (id === 'aharonovBohm') { controls.target.set(0, 0, 0); camera.position.set(0, 0, 3.5); }
          else if (id === 'casimirPlates') { controls.target.set(0, -0.3, 0); camera.position.set(0.9, 0.9, 4.4); }
          else if (id === 'customParametric') { controls.target.set(0, 0, 0); camera.position.set(2.6, 1.8, 3.4); }
          else if (id === 'luneburgLens') { controls.target.set(0, 0, 0); camera.position.set(0, 3.9, 0.7); }
          else if (id === 'flyBrain') { controls.target.set(0, 0, 0); camera.position.set(0.4, 0.7, 3.3); }
          else if (id === 'bioBay') { controls.target.set(0, 0, 0); camera.position.set(0, 1.7, 2.5); }
          else if (id === 'combJelly') { controls.target.set(0, 0, 0); camera.position.set(0.7, 0.25, 2.3); }
          else if (id === 'jellyfishFountain') { controls.target.set(0, -0.05, 0); camera.position.set(0, 0.3, 3.4); }
          else camera.position.set(2.4, 1.5, 4.4);
        }
        controls.update();
        const dt = Math.min($global.get().dt || 1 / 60, 0.05);
        // enough steps to develop the system AND fill its trail ring buffer (trails need ~trailLength steps)
        const DEVELOP = Math.max(200, ($global.get().trailLength || 0) + 80);
        let elapsed = 0; // reset per system → deterministic shader time for raymarch captures
        for (let f = 0; f < DEVELOP; f++) {
          elapsed += dt;
          stepFrame(dt, elapsed);
          if ((f & 31) === 31) await Promise.resolve(); // yield: let the GPU queue breathe (not RAF-bound)
        }
        try {
          const dataUrl = await captureThumbnail(480);
          const res = await fetch('/__thumb', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, dataUrl }),
          });
          if (!res.ok) throw new Error(`write failed ${res.status}`);
          ok++;
          console.log(`[thumbs] ${i + 1}/${ids.length} ${id} ✓`);
        } catch (e) {
          fail++;
          console.error(`[thumbs] ${i + 1}/${ids.length} ${id} ✗`, e);
        }
      }
      console.log(`[thumbs] DONE ok=${ok} fail=${fail}`);
    };

    if (new URLSearchParams(location.search).get('capture') === 'thumbs') {
      void captureAllThumbnails();
    }
  }

  return engine;
}
