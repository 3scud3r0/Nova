import type { ArchetypeFactory, ParamSpec } from '../core/archetype';

// 3D sphere-traced fractals. Unlike every other archetype these don't produce a point cloud —
// they're rendered by a full-screen distance-estimator shader (see src/render/raymarch.ts). They
// register as factories ONLY so the switcher / params panel / learn panel pick them up; bootstrap
// intercepts their id before any point sim is built, so create() must never be called.
// Fractal distance estimators + implicit isosurfaces (F(x,y,z)=isovalue → DE |F−iso|/|∇F|).
export type RaymarchKind =
  | 'mandelbulb'
  | 'qjulia'
  | 'mandelbox'
  | 'menger'
  | 'gyroid'
  | 'schwarzP'
  | 'schwarzD'
  | 'schoenIWP'
  | 'neovius'
  | 'chmutov'
  | 'heart'
  | 'tanglecube'
  | 'goursat'
  | 'barth'
  | 'kummer'
  | 'clebsch'
  | 'cayley'
  | 'fischerKoch'
  | 'schwarzCLP'
  | 'togliatti'
  | 'whitneyUmbrella'
  | 'tooth'
  | 'lidinoid'
  | 'dingDong'
  | 'dupinCyclide'
  | 'orthocircle'
  | 'decocube'
  | 'endrassOctic'
  | 'cassini'
  | 'octicLattice'
  | 'blackhole'
  | 'volumetric'
  | 'conformal'
  | 'newton'
  | 'contour'
  | 'inkBloom'
  | 'moire'
  | 'gravLens'
  | 'opticalVortex'
  | 'onsagerFlow'
  | 'screenedVortex'
  | 'jellyfishBloom'
  | 'kaleidoTunnel';

export interface RaymarchSystem {
  id: string;
  label: string;
  sdf: RaymarchKind;
  params: ParamSpec[];
  category?: string; // UI bucket — 'Fractal' (default) or 'Surface'
  // Internal render tuning (consumed by raymarch.ts, not the UI):
  iters: number; // fractal iterations baked into the shader loop (0 for surfaces)
  bound: number; // bounding-sphere radius the march is clipped to
  camDist: number; // initial camera distance when the system is selected
  camDir?: [number, number, number]; // initial camera direction (normalized in bootstrap); default 3/4 view
  maxSteps: number; // sphere-trace step cap
  freq?: number; // spatial frequency for periodic implicit surfaces (world → lattice scale)
  stepScale?: number; // DE under-relaxation (default 0.7); lower for surfaces whose ∇F vanishes near F=0
  maxStep?: number; // hard cap on the march step (world units) — stops steep-gradient surfaces overshooting
  // Black-hole geodesic marcher only (sdf:'blackhole'); ignored by the SDF path:
  rs?: number; // Schwarzschild / event-horizon radius (geometric units, =1)
  diskIn?: number; // accretion-disk inner edge (ISCO = 3·r_s); outer edge is the live 'disk' param
  photonStep?: number; // adaptive-dt fraction in dt = clamp(photonStep·r, 0.02, 0.6)
  // Volumetric emission marcher only (sdf:'volumetric'); ignored by the other paths:
  volStep?: number; // fixed march step
  sdf2?: 'plasmaOrb' | 'nebula' | 'voxelCloud' | 'flower'; // which density field the volumetric branch dispatches
  cells?: number; // voxelCloud only: cubic-lattice resolution (cells per q-unit), compile-time const
  lobes?: number; // inkBloom only: number of soft bloom lobes (compile-time const — TSL loop bound)
  beams?: number; // opticalVortex only: number of interfering vortex beams (compile-time const)
  bloom?: number; // optional HDR-bloom strength override (raymarch family default is gentle: 0.1)
  occlude?: boolean; // volumetric only: front-to-back compositing (crisp solid voxels) vs additive emission
  sdf3?: 'mobius' | 'inverse' | 'square' | 'cexp' | 'joukowski'; // conformal only: which complex map f(z)
}

const COL: ParamSpec = { key: 'colShift', label: 'colour', min: 0, max: 1, step: 0.01, default: 0.5 };
const ANIM: ParamSpec = { key: 'animate', label: 'morph', min: 0, max: 1, step: 0.01, default: 0.35 };
const ISO: ParamSpec = { key: 'iso', label: 'isovalue', min: -2, max: 2, step: 0.01, default: 0 };

export const RAYMARCH_SYSTEMS: Record<string, RaymarchSystem> = {
  mandelbulb: {
    id: 'mandelbulb',
    label: 'Mandelbulb',
    sdf: 'mandelbulb',
    iters: 8,
    bound: 1.25,
    camDist: 2.7,
    maxSteps: 128,
    params: [
      { key: 'power', label: 'power', min: 2, max: 12, step: 0.1, default: 8 },
      COL,
      ANIM,
    ],
  },
  qjulia: {
    id: 'qjulia',
    label: 'Quaternion Julia',
    sdf: 'qjulia',
    iters: 10,
    bound: 1.6,
    camDist: 3.4,
    maxSteps: 128,
    params: [
      { key: 'cx', label: 'cₓ', min: -1, max: 1, step: 0.005, default: -0.2 },
      { key: 'cy', label: 'c_y', min: -1, max: 1, step: 0.005, default: 0.6 },
      { key: 'cz', label: 'c_z', min: -1, max: 1, step: 0.005, default: 0.2 },
      { key: 'cw', label: 'c_w', min: -1, max: 1, step: 0.005, default: 0.2 },
      COL,
      ANIM,
    ],
  },
  mandelbox: {
    id: 'mandelbox',
    label: 'Mandelbox',
    sdf: 'mandelbox',
    iters: 14,
    bound: 6.0,
    camDist: 9.5,
    maxSteps: 128,
    params: [
      { key: 'scale', label: 'scale', min: -3, max: 3, step: 0.01, default: -1.6 },
      { key: 'minRadius', label: 'min r', min: 0.1, max: 1, step: 0.01, default: 0.5 },
      COL,
      ANIM,
    ],
  },
  menger: {
    id: 'menger',
    label: 'Menger Sponge',
    sdf: 'menger',
    iters: 5,
    bound: 1.8,
    camDist: 3.6,
    maxSteps: 150,
    params: [
      { key: 'spin', label: 'tilt', min: 0, max: 1, step: 0.01, default: 0.2 },
      COL,
      ANIM,
    ],
  },

  // ── implicit isosurfaces (category: Surface) — triply-periodic minimal surfaces + algebraic ──
  gyroid: {
    id: 'gyroid', label: 'Gyroid', sdf: 'gyroid', category: 'Surface',
    iters: 0, freq: 1.3, bound: 4.4, camDist: 10.5, maxSteps: 170, params: [ISO, COL, ANIM],
  },
  schwarzP: {
    id: 'schwarzP', label: 'Schwarz P', sdf: 'schwarzP', category: 'Surface',
    iters: 0, freq: 1.3, bound: 4.4, camDist: 10.5, maxSteps: 170, params: [ISO, COL, ANIM],
  },
  schwarzD: {
    id: 'schwarzD', label: 'Schwarz D (Diamond)', sdf: 'schwarzD', category: 'Surface',
    iters: 0, freq: 1.3, bound: 4.4, camDist: 10.5, maxSteps: 170, params: [ISO, COL, ANIM],
  },
  schoenIWP: {
    id: 'schoenIWP', label: 'Schoen I-WP', sdf: 'schoenIWP', category: 'Surface',
    iters: 0, freq: 1.3, bound: 4.4, camDist: 10.5, maxSteps: 170, params: [ISO, COL, ANIM],
  },
  neovius: {
    id: 'neovius', label: 'Neovius', sdf: 'neovius', category: 'Surface',
    iters: 0, freq: 1.3, bound: 4.4, camDist: 10.5, maxSteps: 170, params: [ISO, COL, ANIM],
  },
  chmutov: {
    id: 'chmutov', label: 'Chmutov Octic', sdf: 'chmutov', category: 'Surface',
    iters: 0, freq: 0.85, bound: 1.75, camDist: 4.7, maxSteps: 210, params: [ISO, COL, ANIM],
  },
  heart: {
    id: 'heart', label: 'Heart', sdf: 'heart', category: 'Surface',
    iters: 0, freq: 0.7, bound: 2.0, camDist: 4.6, maxSteps: 360, stepScale: 0.4, maxStep: 0.035, params: [ISO, COL, ANIM],
  },
  tanglecube: {
    id: 'tanglecube', label: 'Tanglecube', sdf: 'tanglecube', category: 'Surface',
    iters: 0, freq: 1.0, bound: 3.0, camDist: 7.5, maxSteps: 220, stepScale: 0.45, params: [ISO, COL, ANIM],
  },
  goursat: {
    id: 'goursat', label: 'Goursat', sdf: 'goursat', category: 'Surface',
    iters: 0, freq: 0.62, bound: 2.4, camDist: 5.6, maxSteps: 190, params: [ISO, COL, ANIM],
  },
  barth: {
    id: 'barth', label: 'Barth Sextic', sdf: 'barth', category: 'Surface',
    iters: 0, freq: 0.92, bound: 1.55, camDist: 3.7, maxSteps: 240, params: [ISO, COL, ANIM],
  },

  // ── algebraic node surfaces (Kummer/Clebsch/Cayley have gradient-vanishing pinch points → DE
  //    overshoots like the heart, so they carry stepScale + maxStep) and two more TPMS (trig) ──
  kummer: {
    id: 'kummer', label: 'Kummer Surface', sdf: 'kummer', category: 'Surface',
    iters: 0, freq: 0.8, bound: 2, camDist: 5.6, maxSteps: 260, stepScale: 0.35, maxStep: 0.04, params: [ISO, COL, ANIM],
  },
  clebsch: {
    id: 'clebsch', label: 'Clebsch Cubic', sdf: 'clebsch', category: 'Surface',
    iters: 0, freq: 0.62, bound: 2.4, camDist: 7, maxSteps: 240, stepScale: 0.4, maxStep: 0.05, params: [ISO, COL, ANIM],
  },
  cayley: {
    id: 'cayley', label: 'Cayley Cubic', sdf: 'cayley', category: 'Surface',
    iters: 0, freq: 0.42, bound: 2.3, camDist: 6.2, maxSteps: 240, stepScale: 0.4, maxStep: 0.04, params: [ISO, COL, ANIM],
  },
  fischerKoch: {
    id: 'fischerKoch', label: 'Fischer-Koch S', sdf: 'fischerKoch', category: 'Surface',
    iters: 0, freq: 1.3, bound: 4.4, camDist: 10.5, maxSteps: 180, params: [ISO, COL, ANIM],
  },
  schwarzCLP: {
    id: 'schwarzCLP', label: 'Schwarz CLP', sdf: 'schwarzCLP', category: 'Surface',
    iters: 0, freq: 1.3, bound: 4.4, camDist: 10.5, maxSteps: 190, stepScale: 0.6, params: [ISO, COL, ANIM],
  },

  // ── batch 4: node/singular quintics & quartics (gradient-vanishing ⇒ stepScale+maxStep) + a TPMS ──
  togliatti: {
    id: 'togliatti', label: 'Togliatti Quintic', sdf: 'togliatti', category: 'Surface',
    iters: 0, freq: 2.4, bound: 2.3, camDist: 5.2, maxSteps: 240, stepScale: 0.3, maxStep: 0.04, params: [ISO, COL, ANIM],
  },
  whitneyUmbrella: {
    id: 'whitneyUmbrella', label: 'Whitney Umbrella', sdf: 'whitneyUmbrella', category: 'Surface',
    iters: 0, freq: 0.75, bound: 2.3, camDist: 5.2, maxSteps: 260, stepScale: 0.35, maxStep: 0.04, params: [ISO, COL, ANIM],
  },
  tooth: {
    id: 'tooth', label: 'Tooth Surface', sdf: 'tooth', category: 'Surface',
    iters: 0, freq: 0.85, bound: 2.4, camDist: 5.3, maxSteps: 240, stepScale: 0.4, maxStep: 0.04, params: [ISO, COL, ANIM],
  },
  lidinoid: {
    id: 'lidinoid', label: 'Lidinoid', sdf: 'lidinoid', category: 'Surface',
    iters: 0, freq: 1.3, bound: 4.4, camDist: 10.5, maxSteps: 190, params: [ISO, COL, ANIM],
  },
  dingDong: {
    id: 'dingDong', label: 'Ding-Dong Surface', sdf: 'dingDong', category: 'Surface',
    iters: 0, freq: 0.95, bound: 2.3, camDist: 5.2, maxSteps: 260, stepScale: 0.4, maxStep: 0.035, params: [ISO, COL, ANIM],
  },


  // ── batch 5: cyclides / ring lattices / Endrass octic / Cassini ──
  dupinCyclide: {
    id: 'dupinCyclide', label: "Dupin Ring Cyclide", sdf: 'dupinCyclide', category: 'Surface',
    iters: 0, freq: 1.65, bound: 2.35, camDist: 5.2, maxSteps: 200, params: [ISO, COL, ANIM],
  },
  orthocircle: {
    id: 'orthocircle', label: "Orthocircle", sdf: 'orthocircle', category: 'Surface',
    // thin tubes + a steep degree-12 field: the |F|/|∇F| step overshoots the rods. Small cap to
    // catch the thin rods, big step budget so far (zoomed-out) rays still cross the bound.
    iters: 0, freq: 0.62, bound: 2.3, camDist: 5, maxSteps: 460, stepScale: 0.4, maxStep: 0.035, params: [ISO, COL, ANIM],
  },
  decocube: {
    id: 'decocube', label: "Decocube", sdf: 'decocube', category: 'Surface',
    iters: 0, freq: 0.5, bound: 2.3, camDist: 5.2, maxSteps: 340, stepScale: 0.5, maxStep: 0.06, params: [ISO, COL, ANIM],
  },
  endrassOctic: {
    id: 'endrassOctic', label: "Endrass Octic", sdf: 'endrassOctic', category: 'Surface',
    iters: 0, freq: 0.9, bound: 2.3, camDist: 5.2, maxSteps: 280, stepScale: 0.3, maxStep: 0.03, params: [ISO, COL, ANIM],
  },
  cassini: {
    id: 'cassini', label: "Cassini Surface", sdf: 'cassini', category: 'Surface',
    iters: 0, freq: 0.72, bound: 2.4, camDist: 5.4, maxSteps: 240, params: [ISO, COL, ANIM],
  },
  octicLattice: {
    id: 'octicLattice', label: 'Octic Node Lattice', sdf: 'octicLattice', category: 'Surface',
    // very high degree (product of three quartics) ⇒ ∇F swings hard near the nodes: strong under-relax + cap.
    iters: 0, freq: 0.7, bound: 2.6, camDist: 6, maxSteps: 300, stepScale: 0.3, maxStep: 0.03,
    params: [
      ISO,
      COL, // 0.5 ≈ warm gold/amber (matches the reference)
      { key: 'animate', label: 'morph', min: 0, max: 1, step: 0.01, default: 0.18 }, // gentle spin, stable lattice
    ],
  },

  // ── Spacetime: a gravitationally-lensed black hole (not an SDF — its own photon-geodesic marcher) ──
  blackhole: {
    id: 'blackhole', label: 'Black Hole (Gargantua)', sdf: 'blackhole', category: 'Spacetime',
    iters: 0, // not a fractal
    rs: 1.0, // event-horizon radius (geometric units)
    diskIn: 3.0, // ISCO = 6M = 3·r_s
    photonStep: 0.1, // adaptive dt = clamp(0.1·r, 0.02, 0.6)
    bound: 30.0, // photon escape radius
    camDist: 14.0, // initial camera distance (validated converged at maxSteps 160)
    maxSteps: 160, // photon-integration loop count (≥120 needed; 80 starves 34% of pixels)
    params: [
      { key: 'exposure', label: 'exposure', min: 0.1, max: 4, step: 0.05, default: 0.5 },
      { key: 'beaming', label: 'beaming', min: 0, max: 1, step: 0.01, default: 1 },
      { key: 'disk', label: 'disk size', min: 6, max: 16, step: 0.5, default: 7 },
      { key: 'colShift', label: 'colour', min: 0, max: 1, step: 0.01, default: 0 }, // 0 = warm/golden
    ],
  },

  // ── Volume: twigl-style volumetric-emission raymarch (non-SDF; domain-warped density + emission) ──
  plasmaOrb: {
    id: 'plasmaOrb', label: 'Plasma Orb', sdf: 'volumetric', sdf2: 'plasmaOrb', category: 'Volume',
    iters: 0, bound: 1.8, camDist: 3.6, maxSteps: 110, volStep: 0.05,
    params: [
      { key: 'scale', label: 'detail', min: 0.5, max: 2.5, step: 0.05, default: 1.7 },
      { key: 'absorb', label: 'density', min: 1, max: 8, step: 0.1, default: 3.5 },
      { key: 'exposure', label: 'glow', min: 0.5, max: 8, step: 0.05, default: 6 },
      { key: 'colShift', label: 'colour', min: 0, max: 1, step: 0.01, default: 0.3 }, // ≈ cyan/blue
    ],
  },
  everlasting: {
    id: 'everlasting', label: 'Everlasting Flower', sdf: 'volumetric', sdf2: 'flower', category: 'Bloom',
    iters: 0, bound: 1.6, camDist: 2.6, maxSteps: 130, volStep: 0.04, occlude: true, bloom: 0.15, // solid feathered petals (front-to-back), gentle glow
    params: [
      { key: 'petals', label: 'petals', min: 4, max: 24, step: 1, default: 12 },
      { key: 'scale', label: 'detail', min: 0.6, max: 2.2, step: 0.05, default: 1.15 },
      { key: 'absorb', label: 'density', min: 2, max: 12, step: 0.1, default: 9.0 },
      { key: 'exposure', label: 'glow', min: 0.3, max: 4, step: 0.05, default: 0.85 },
      COL,
    ],
  },

  nebula: {
    id: 'nebula', label: 'Nebula', sdf: 'volumetric', sdf2: 'nebula', category: 'Volume',
    iters: 0, bound: 3.0, camDist: 5.2, maxSteps: 88, volStep: 0.07,
    params: [
      { key: 'scale', label: 'detail', min: 0.4, max: 2.0, step: 0.05, default: 0.9 },
      { key: 'absorb', label: 'density', min: 1, max: 8, step: 0.1, default: 5 },
      { key: 'exposure', label: 'glow', min: 0.5, max: 6, step: 0.05, default: 3.4 },
      { key: 'colShift', label: 'colour', min: 0, max: 1, step: 0.01, default: 0.1 }, // ≈ violet/magenta
    ],
  },
  voxelCloud: {
    id: 'voxelCloud', label: 'Voxel Cloud', sdf: 'volumetric', sdf2: 'voxelCloud', category: 'Volume',
    iters: 0, bound: 2.2, camDist: 5.4, maxSteps: 190, volStep: 0.04, cells: 3.0, occlude: true,
    params: [
      { key: 'scale', label: 'detail', min: 0.3, max: 2.0, step: 0.05, default: 0.6 },
      { key: 'absorb', label: 'density', min: 1, max: 12, step: 0.1, default: 6.0 }, // higher → crisper opaque cubes
      { key: 'exposure', label: 'glow', min: 0.5, max: 6, step: 0.05, default: 1.8 },
      { key: 'edge', label: 'edges', min: 0, max: 1.5, step: 0.05, default: 0.5 },
      { key: 'colShift', label: 'colour', min: 0, max: 1, step: 0.01, default: 0.05 }, // ≈ warm/fire base
    ],
  },

  // ── Conformal: 2D complex maps w=f(z) coloured by a checkerboard of w (non-SDF, no marching) ──
  mobiusFlow: {
    id: 'mobiusFlow', label: 'Möbius Flow', sdf: 'conformal', sdf3: 'mobius', category: 'Conformal',
    iters: 0, bound: 1, camDist: 1, maxSteps: 1,
    params: [
      { key: 'px', label: 'fixed-pt₁ x', min: -1.5, max: 1.5, step: 0.01, default: -0.6 },
      { key: 'py', label: 'fixed-pt₁ y', min: -1.5, max: 1.5, step: 0.01, default: 0.2 },
      { key: 'qx', label: 'fixed-pt₂ x', min: -1.5, max: 1.5, step: 0.01, default: 0.7 },
      { key: 'qy', label: 'fixed-pt₂ y', min: -1.5, max: 1.5, step: 0.01, default: -0.3 },
      { key: 'lam', label: 'multiplier |λ|', min: 0.4, max: 2.5, step: 0.01, default: 1.15 },
      { key: 'lphase', label: 'λ twist', min: 0, max: 1, step: 0.01, default: 0.18 },
      { key: 'scale', label: 'checker', min: 1, max: 16, step: 0.1, default: 6 },
      { key: 'zoom', label: 'zoom', min: 0.3, max: 4, step: 0.05, default: 1.8 },
      { key: 'animate', label: 'spin', min: 0, max: 1, step: 0.01, default: 0.3 },
      COL,
    ],
  },
  inversion: {
    id: 'inversion', label: 'Inversion 1/z', sdf: 'conformal', sdf3: 'inverse', category: 'Conformal',
    iters: 0, bound: 1, camDist: 1, maxSteps: 1,
    params: [
      { key: 'scale', label: 'checker', min: 1, max: 16, step: 0.1, default: 5 },
      { key: 'zoom', label: 'zoom', min: 0.3, max: 4, step: 0.05, default: 1.6 },
      { key: 'animate', label: 'spin', min: 0, max: 1, step: 0.01, default: 0.3 },
      COL,
    ],
  },
  zSquared: {
    id: 'zSquared', label: 'Square z²', sdf: 'conformal', sdf3: 'square', category: 'Conformal',
    iters: 0, bound: 1, camDist: 1, maxSteps: 1,
    params: [
      { key: 'scale', label: 'checker', min: 1, max: 16, step: 0.1, default: 5 },
      { key: 'zoom', label: 'zoom', min: 0.3, max: 4, step: 0.05, default: 1.6 },
      { key: 'animate', label: 'spin', min: 0, max: 1, step: 0.01, default: 0.3 },
      COL,
    ],
  },
  complexExp: {
    id: 'complexExp', label: 'Exponential eᶻ', sdf: 'conformal', sdf3: 'cexp', category: 'Conformal',
    iters: 0, bound: 1, camDist: 1, maxSteps: 1,
    params: [
      { key: 'scale', label: 'checker', min: 1, max: 16, step: 0.1, default: 4 },
      { key: 'zoom', label: 'zoom', min: 0.3, max: 6, step: 0.05, default: 3.0 },
      { key: 'animate', label: 'spin', min: 0, max: 1, step: 0.01, default: 0.3 },
      COL,
    ],
  },
  joukowskiMap: {
    id: 'joukowskiMap', label: 'Joukowski ½(z+1/z)', sdf: 'conformal', sdf3: 'joukowski', category: 'Conformal',
    iters: 0, bound: 1, camDist: 1, maxSteps: 1,
    params: [
      { key: 'scale', label: 'checker', min: 1, max: 16, step: 0.1, default: 5 },
      { key: 'zoom', label: 'zoom', min: 0.3, max: 4, step: 0.05, default: 1.8 },
      { key: 'animate', label: 'spin', min: 0, max: 1, step: 0.01, default: 0.3 },
      COL,
    ],
  },

  // ── Newton fractal / polynomiography: per-pixel basins of Newton's method for zⁿ−1 (non-SDF) ──
  newtonFractal: {
    id: 'newtonFractal', label: 'Newton Fractal', sdf: 'newton', category: 'Conformal',
    iters: 40, bound: 1, camDist: 1, maxSteps: 1,
    params: [
      { key: 'fold', label: 'roots n', min: 3, max: 7, step: 1, default: 5 },
      { key: 'relax', label: 'over-relax a', min: 0.5, max: 2, step: 0.01, default: 1 },
      { key: 'zoom', label: 'zoom', min: 0.3, max: 4, step: 0.05, default: 1.5 },
      { key: 'animate', label: 'morph', min: 0, max: 1, step: 0.01, default: 0.3 },
      COL,
    ],
  },

  // ── Linework: morphing contour lines (isolines) of a folded sum-of-waves field (after Zach Lieberman) ──
  contourField: {
    id: 'contourField', label: 'Contour Field', sdf: 'contour', category: 'Linework',
    iters: 1, bound: 1, camDist: 1, maxSteps: 1,
    params: [
      { key: 'density', label: 'contours', min: 1, max: 10, step: 0.1, default: 3.2 },
      { key: 'warp', label: 'warp', min: 0, max: 1.2, step: 0.02, default: 0.5 },
      { key: 'thickness', label: 'line weight', min: 0.02, max: 0.45, step: 0.01, default: 0.16 },
      { key: 'zoom', label: 'zoom', min: 0.4, max: 4, step: 0.05, default: 1.6 },
      { key: 'animate', label: 'morph', min: 0, max: 1, step: 0.01, default: 0.5 },
      COL,
    ],
  },

  // ── Bloom: soft ink-diffusion field — translucent pigment lobes blooming on a light ground ──
  inkBloom: {
    id: 'inkBloom', label: 'Ink Bloom', sdf: 'inkBloom', category: 'Bloom',
    iters: 0, bound: 1, camDist: 1, maxSteps: 1, lobes: 6,
    params: [
      { key: 'softness', label: 'softness', min: 0.25, max: 1.2, step: 0.02, default: 0.42 },
      { key: 'warmth', label: 'warmth', min: 0, max: 1, step: 0.01, default: 0.55 },
      { key: 'bloom', label: 'bloom', min: 0.5, max: 3, step: 0.05, default: 1.5 },
      { key: 'zoom', label: 'zoom', min: 0.4, max: 3, step: 0.05, default: 1.7 },
      { key: 'animate', label: 'morph', min: 0, max: 1, step: 0.01, default: 0.4 },
      COL,
    ],
  },

  jellyfishBloom: {
    id: 'jellyfishBloom', label: 'Jellyfish Bloom', sdf: 'jellyfishBloom', category: 'Bloom',
    iters: 0, bound: 1, camDist: 1, maxSteps: 1, lobes: 6, bloom: 0.3, // abyssal dark + glowing bells → strong glow; lobes = swarm size
    params: [
      { key: 'glow', label: 'glow', min: 0.4, max: 2.5, step: 0.05, default: 1.3 },
      { key: 'pulse', label: 'pulse', min: 0, max: 1, step: 0.02, default: 0.6 },
      { key: 'zoom', label: 'zoom', min: 0.5, max: 2, step: 0.05, default: 1.35 },
      { key: 'animate', label: 'drift', min: 0, max: 1.2, step: 0.02, default: 0.6 },
      COL,
    ],
  },

  // ── Linework: barrier-grid moiré illusion — static gratings that read as rotation ──
  moire: {
    id: 'moire', label: 'Moiré Grid', sdf: 'moire', category: 'Linework',
    iters: 0, bound: 1, camDist: 1, maxSteps: 1,
    params: [
      { key: 'spokes', label: 'hashes', min: 20, max: 200, step: 2, default: 90 },
      { key: 'bars', label: 'barrier', min: 5, max: 60, step: 1, default: 26 },
      { key: 'zoom', label: 'zoom', min: 0.4, max: 2.5, step: 0.05, default: 1.0 },
      ANIM,
    ],
  },

  onsagerVortex: {
    id: 'onsagerVortex', label: 'Onsager Vortices', sdf: 'onsagerFlow', category: 'Fluid',
    iters: 0, bound: 1, camDist: 1, maxSteps: 1, beams: 16, bloom: 0.4, // vortex cores glow
    params: [
      { key: 'zoom', label: 'field of view', min: 0.6, max: 2, step: 0.02, default: 1.05 },
      { key: 'speed', label: 'flow rate', min: 0.1, max: 2.5, step: 0.05, default: 1 },
      { key: 'gain', label: 'contrast', min: 0.4, max: 2, step: 0.05, default: 1 },
    ],
  },
  screenedVortexGas: {
    id: 'screenedVortexGas', label: 'Screened Vortex Gas', sdf: 'screenedVortex', category: 'Fluid',
    iters: 0, bound: 1, camDist: 1, maxSteps: 1, beams: 48, bloom: 0.35, // vortex count (compile-time)
    params: [
      { key: 'zoom', label: 'field of view', min: 0.6, max: 2, step: 0.02, default: 1 },
      { key: 'speed', label: 'drift rate', min: 0.1, max: 2.5, step: 0.05, default: 1 },
      { key: 'screen', label: 'deformation radius', min: 0.15, max: 0.8, step: 0.01, default: 0.32 },
      { key: 'gain', label: 'contrast', min: 0.4, max: 2, step: 0.05, default: 1 },
    ],
  },
  opticalVortex: {
    id: 'opticalVortex', label: 'Optical Vortices', sdf: 'opticalVortex', category: 'Spectral',
    iters: 0, bound: 1, camDist: 1, maxSteps: 1, beams: 5, bloom: 0.5, // interference fringes glow
    params: [
      { key: 'zoom', label: 'field of view', min: 0.6, max: 2, step: 0.02, default: 1.1 },
      { key: 'drift', label: 'aperture drift', min: 0, max: 2.5, step: 0.05, default: 1 },
      { key: 'twist', label: 'phase spin', min: 0, max: 3, step: 0.05, default: 1 },
      { key: 'width', label: 'beam width', min: 0.5, max: 1.6, step: 0.05, default: 1 },
      { key: 'gain', label: 'intensity', min: 0.2, max: 3, step: 0.05, default: 1 },
    ],
  },
  gravLens: {
    id: 'gravLens', label: 'Gravitational Lens', sdf: 'gravLens', category: 'Spacetime',
    iters: 0, bound: 1, camDist: 1, maxSteps: 1, bloom: 0.35, // dark sky + bright ring → full glow
    params: [
      { key: 'mass', label: 'Einstein radius', min: 0.15, max: 0.8, step: 0.01, default: 0.42 },
      { key: 'zoom', label: 'zoom', min: 0.4, max: 2.5, step: 0.05, default: 1.0 },
      ANIM,
      COL,
    ],
  },

  // ── Kaleidoscope: an SDF tunnel folded into N mirror wedges, z-tiled into a fly-through ──
  kaleidoTunnel: {
    id: 'kaleidoTunnel', label: 'Kaleidoscope Tunnel', sdf: 'kaleidoTunnel', category: 'Kaleidoscope',
    iters: 0, bound: 18.0, camDist: 0.5, camDir: [0.12, 0.08, 1], maxSteps: 180, // near-axial: look down the throat
    params: [
      { key: 'symmetry', label: 'symmetry', min: 2, max: 16, step: 1, default: 6 },
      { key: 'twist', label: 'twist', min: -1.2, max: 1.2, step: 0.01, default: 0.25 },
      { key: 'speed', label: 'fly speed', min: 0, max: 6, step: 0.05, default: 2.0 },
      { key: 'cellScale', label: 'cell size', min: 1.0, max: 4.0, step: 0.05, default: 2.0 },
      COL,
    ],
  },
};

export function makeRaymarchFactory(s: RaymarchSystem): ArchetypeFactory {
  return {
    id: s.id,
    label: s.label,
    category: s.category ?? 'Fractal',
    kind: 'raymarch',
    params: s.params,
    defaultParticleCount: 1, // inert; the NullDriver ignores it
    defaultDt: 0.016,
    // Raymarch systems fill the screen with bright surfaces — the flow-system bloom default (0.4)
    // washes their detail out, so the family defaults far gentler; per-system override via s.bloom.
    bloom: s.bloom ?? 0.1,
    // Never called — bootstrap.makeDriver() routes raymarch ids to the raymarch renderer first.
    // Throwing documents the contract and guards against an accidental point-sim instantiation.
    create() {
      throw new Error(`raymarch archetype "${s.id}" is not a point simulation`);
    },
  };
}
