// ETHERSIM release history — the single source of truth for the in-app "What's New" popup and the
// About panel's version list. Each release lists the system ids it FIRST introduced (deep-linkable
// from the What's New cards) plus short notes for non-system changes. Reconstructed from git history;
// every one of the registered systems appears in exactly one release (verified). Newest-first.
//
// When you ship a new release: add a new entry at the TOP with the bumped version (matching
// src/version.ts), today's date, the new system ids, and any feature notes — then the What's New
// popup auto-shows it once per visitor (it compares APP_VERSION against a locally-stored last-seen).

export interface Release {
  version: string; // semver patch, matches src/version.ts (e.g. "0.1.33")
  date: string; // ISO date YYYY-MM-DD
  title: string; // short human headline
  summary: string; // 1-2 sentence blurb
  newSystems: string[]; // archetype ids first registered in this release (exact ids; deep-linkable)
  notes: string[]; // non-system changes (features/fixes), shown as bullets
}

export const RELEASES: Release[] = [
  {
      "version": "0.1.105",
      "date": "2026-10-09",
      "title": "Quantum — a field you never touch, and empty space that pushes",
      "summary": "A new Quantum category with two of the strangest results in physics, both computed rather than drawn. The Aharonov–Bohm effect: a shielded magnetic flux the electron never touches still shifts its interference fringes. And Casimir plates: the vacuum's zero-point field pushes two plates together, with the infinite mode sum tamed live to its finite answer.",
      "newSystems": [
          "aharonovBohm",
          "casimirPlates"
      ],
      "notes": [
          "Aharonov–Bohm Effect (Quantum): the time-dependent Schrödinger equation on a lattice, a double slit, and a shielded solenoid whose flux enters only as a Peierls phase. The fringes shift by exactly the flux in units of h/e (measured 0.250 at 0.25, 0.500 at 0.5) and return at a whole quantum; a no-flux run alongside shows the difference.",
          "Casimir Plates (Quantum): the zero-point field between and around two mirrors — only standing modes fit inside — with the pressure π²ħc/240d⁴ in real units (13 Pa at 100 nm, about an atmosphere at 10 nm) and the regularised 1-D mode sum computed to −π/24d."
      ]
  },
  {
      "version": "0.1.104",
      "date": "2026-10-09",
      "title": "Solids, plasma and stars — earthquakes, phonons, cracks, beams and a collapsing core",
      "summary": "The last five systems on the physics-teacher list, each checked against theory: P, S and Rayleigh waves from an earthquake; vibrations of a crystal lattice with its band gap and group velocity; a crack running through a brittle plate; two electron beams tearing into vortices in a particle-in-cell plasma; and a star in balance, then a core collapsing and bouncing. Also: exported images and video clips are the right way up again.",
      "newSystems": [
          "elasticWaves",
          "phonons",
          "fracture",
          "twoStream",
          "stellarCollapse"
      ],
      "notes": [
          "Elastic Waves (Earthquake) (Field): Virieux's velocity–stress scheme — P waves at α, S waves at α/√3, and the Rayleigh surface wave at 0.92β (measured 0.525α vs 0.531α); a soft sediment layer that traps and amplifies the shaking.",
          "Phonons (Lattice Vibrations) (Matter): a chain of springs and atoms integrated directly — normal modes match the dispersion relation to 4 decimals on both branches, and a wave packet's energy moves at the group velocity while its crests move at the phase velocity.",
          "Fracture (Brittle Crack) (Matter): a triangular spring lattice pulled taut with a notch — no crack below a threshold, a clean crack above it, branching under overload; tip speed shown against the Rayleigh speed.",
          "Two-Stream Instability (Plasma PIC) (Plasma): a particle-in-cell code in phase space, with the field energy's exponential growth compared live against the cold-beam growth rate (measured 0.345 vs 0.354 ωp).",
          "Star: Balance and Collapse (Cosmology): Lagrangian hydrodynamics of a Lane–Emden star that rings with Ritter's period scaling, and a toy core collapse that bounces at nuclear density and launches a shock — with what the toy leaves out.",
          "Fixed: exported PNG images and recorded clips (WebM / GIF) were upside down on WebGPU. Every export now follows the renderer's real row order."
      ]
  },
  {
      "version": "0.1.103",
      "date": "2026-10-09",
      "title": "Heat and fluids — gases, diffusion, percolation, floods, convection and instabilities",
      "summary": "Six more systems a physics course is built on, each checked against theory. Molecules relaxing to the Maxwell–Boltzmann distribution; heat spreading through copper and steel; the sudden percolation threshold; a dam-break flood; convection rolls switching on at the critical Rayleigh number; and the Kelvin–Helmholtz and Rayleigh–Taylor instabilities.",
      "newSystems": [
          "idealGas",
          "heatEquation",
          "percolation",
          "shallowWater",
          "rayleighBenard",
          "shearInstabilities"
      ],
      "notes": [
          "Ideal Gas (Maxwell–Boltzmann) (Matter): hard discs of two masses start at one speed and relax to Maxwell–Boltzmann; live speed histograms against theory, equipartition between the two kinds, and wall pressure against the ideal-gas law and the hard-disc equation of state. Hot walls heat or cool the gas.",
          "Heat Equation (Field): drops of heat spreading on an insulated plate (σ² grows by exactly 2Dt), a copper–steel plate settling into two ramps, and a plate relaxing to Laplace's equation — with isotherms.",
          "Percolation (Matter): random grids coloured by cluster, the spanning cluster in gold, and a fire that crosses only above p_c ≈ 0.5927; the critical cluster's fractal dimension measured near 91/48.",
          "Shallow Water (Dam Break) (Fluid): a second-order finite-volume flood that matches Stoker's exact dam-break solution, wrapping round pillars and spreading as a ring wave.",
          "Rayleigh–Bénard Convection (Fluid): a pseudo-spectral solver whose rolls switch on at exactly the critical Rayleigh number for the box; Nusselt number live.",
          "Kelvin–Helmholtz & Rayleigh–Taylor (Fluid): shear layers rolling into billows and heavy fluid falling through light in fingers and mushrooms, with growth rates checked against linear theory.",
          "Field panels can now stand upright and take any shape, and can keep a fixed colour scale."
      ]
  },
  {
      "version": "0.1.102",
      "date": "2026-10-09",
      "title": "Teaching staples — relativity, light, fields and three bodies",
      "summary": "Six systems that a physics course is built on, each checked against the textbook result it shows. Einstein's train and platform of light clocks; light cones and what a change of observer can and cannot change; a spinning black hole dragging space; Maxwell's equations solved live (antenna, phased array, double slit, glass); charged particles in electric and magnetic fields; and the three-body problem from Lagrange points to chaos.",
      "newSystems": [
          "specialRelativity",
          "lightCones",
          "kerrDragging",
          "maxwellFdtd",
          "chargedParticles",
          "threeBody"
      ],
      "notes": [
          "Train and Platform (Special Relativity) (Spacetime): rows of light clocks on a train and a platform, drawn exactly in the platform's, the train's or the midway frame — time dilation, length contraction, and clocks that disagree along a moving train; lightning strikes that are simultaneous for one observer and not the other.",
          "Light Cones (Causal Structure) (Spacetime): a 2+1 spacetime diagram swept through Lorentz boosts — events slide along hyperbolae and axes scissor, but no event ever changes its causal class; a spacelike event changes order with E, a timelike one never does.",
          "Kerr Black Hole (Frame Dragging) (Spacetime): exact zero-angular-momentum geodesics hooking round a spinning hole, drawn in horizon-crossing coordinates; light on circular tracks shows the static limit (backward light stands still at 2M, and goes forward inside); prograde and retrograde ISCOs and photon orbits.",
          "Maxwell's Equations (FDTD) (Field): Yee's method on a grid — one antenna, a steerable phased pair, Young's double slit (with a time-averaged intensity view) and refraction into glass. Fringe angles, Snell's law and the beam angle were checked against theory.",
          "Charged Particles in Fields (Plasma): the Boris pusher in four set-ups — cyclotron circles whose period doesn't depend on speed, E × B drift that is the same for every charge, a magnetic bottle with its loss cone, and the Earth's radiation belt with ions drifting west and electrons east.",
          "Three-Body Problem (Orbital): the Lagrange-point landscape with Trojan tadpoles and horseshoes (and Routh's stability limit), the figure-eight choreography, and Burrau's Pythagorean problem ending with the lightest body thrown out.",
          "Fixed: sliders that change a system's set-up (marked as rebuilding) now take effect straight away instead of only after switching away and back — for example the flume's stream speed Fr."
      ]
  },
  {
      "version": "0.1.101",
      "date": "2026-10-08",
      "title": "The physics of warp — flowing space, horizons, negative energy, and spinning shells",
      "summary": "Four systems for what a warp drive would really need. See a black hole as a river of space that light swims through; an Alcubierre bubble whose horizons trap light at its front wall and whose wall needs negative energy (with the classical estimate of how much); the same horizons made with water waves in a flume; and a spinning shell of matter dragging space around inside it.",
      "newSystems": [
          "riverSpace",
          "alcubierre",
          "warpFlume",
          "thirringShell"
      ],
      "notes": [
          "River of Space (Spacetime): Schwarzschild in Painlevé–Gullstrand form — space flows in at escape speed and light moves at c relative to it, so flashes are dragged lopsided, stand still at the horizon, and are swept inward inside it.",
          "Alcubierre Warp Bubble (Spacetime): light carried by the bubble's shift vector piles up at the front wall above light speed (Hiscock's horizons); York-time sheet; the negative-energy torus in the wall; Pfenning–Ford energy estimate in Jupiter masses.",
          "Analog Warp Bubble (Flume) (Spacetime): shallow-water waves on a flow shaped like the Alcubierre shift vector — the lab version of the same horizons (Fr 0.6 vs 1.6). First written with the Gravity MCP server for the AWB-1 flume design.",
          "Rotating Shell (Frame Dragging) (Spacetime): Thirring 1918 — inertial frames inside a spinning massive shell turn with it, so a pendulum's swing plane traces a rosette; the shape of the positive-energy 'physical warp drive' route.",
          "None of these makes anything faster than light; each says what it leaves out."
      ]
  },
  {
      "version": "0.1.100",
      "date": "2026-10-03",
      "title": "Rotation — why rackets flip, tops nod, the Earth wobbles and pendulums turn",
      "summary": "A new Rotation category for the physics of spinning things. See why a racket spun about its middle axis keeps flipping (and the saddle on the momentum sphere that causes it), the three ways a heavy top can nod as it precesses, Poinsot's picture of a free body as an egg rolling on a floor (the Earth's Chandler wobble), and Foucault's pendulum knocking down pegs as the Earth turns beneath it.",
      "newSystems": [
          "racketFlip",
          "heavyTop",
          "poinsot",
          "foucault"
      ],
      "notes": [
          "Why the Racket Flips (Rotation): three plates spun about their three principal axes — only the middle one flips (the Dzhanibekov / tennis-racket effect). The momentum sphere shows why: stable loops round the red and blue axes, a saddle X round the yellow one. Exact torque-free Euler equations + quaternion attitude.",
          "Heavy Top: Precession & Nutation (Rotation): Lagrange's top released three ways — pushed forward (waves), let go (cusps), pushed back (loops) — tracing its axis on a sphere.",
          "Poinsot's Rolling Ellipsoid (Rotation): the inertia ellipsoid rolls without slipping on the invariable plane; gold polhode on the body, pink herpolhode on the floor; set asymmetry to 0 for the Earth-like circle of the Chandler wobble.",
          "Foucault's Pendulum (Rotation): the swing plane turns at Ω·sin(latitude) — clockwise in the north, anticlockwise in the south, not at the equator — drawing a star on the floor and toppling a ring of pegs; the real period for your latitude is shown.",
          "New Rotation category; a shared rigid-body integrator (Euler's equations + quaternions, |L| held exact)."
      ]
  },
  {
      "version": "0.1.99",
      "date": "2026-10-02",
      "title": "Network shapes — islands, a charged sphere, cables, and Recamán's arches",
      "summary": "Four ways a network's structure becomes visible. A tangled hairball relaxes into community islands joined by weak ties; charges on a sphere settle into a near-hexagonal net that Euler's formula forces to carry exactly twelve defects; a thousand chords on a ring gather into cables routed through their hierarchy; and Recamán's go-back-if-you-can sequence draws itself as interlocking arches.",
      "newSystems": [
          "communityIslands",
          "thomson",
          "edgeBundling",
          "recaman"
      ],
      "notes": [
          "Community Islands (Network): a stochastic block model laid out live by springs and charges — the hairball unmixes into communities joined by white-gold bridges, and scrambles itself every so often to do it again. Knobs: communities, nodes, bridges, link pull, scramble period.",
          "Thomson Network (Network): N charges relaxed on a sphere, triangulated (convex hull = spherical Delaunay) and coloured by neighbour count — 5 red, 6 blue, 7 green. The topological charge Σ(6 − z) is always 12; above a few hundred charges the defects grow into scars.",
          "Edge Bundling (Network): Holten's hierarchical edge bundles — links routed through a group hierarchy as B-splines, bundling strength β breathing between straight chords and tight cables; colour runs from source group to target group.",
          "Recamán Arcs (Number): OEIS A005132 drawn as Numberphile's arc diagram, coloured by step, with a ripple running through the arches in jump order; lower arcs tilt out of the plane for depth."
      ]
  },
  {
      "version": "0.1.97",
      "date": "2026-09-25",
      "title": "Barabási–Albert Network — where hubs come from",
      "summary": "Add nodes to a network one at a time and let each newcomer wire preferentially to the nodes that already have the most links, and a few giant hubs emerge on their own — the scale-free, power-law structure behind the web, citations, and the connectivity people now point to when they call a 1665 combinatorial diagram an early neural net. Grown live, laid out in 3-D, edges drawn as glowing spokes. Opens a new Network category.",
      "newSystems": [
          "barabasiAlbert"
      ],
      "notes": [
          "Barabási–Albert Network (Network): nodes arrive one at a time and attach to m existing nodes with probability proportional to their current degree (preferential attachment). Hot gold hubs and cool blue spokes emerge with no design — a power-law degree distribution from a single rule.",
          "3-D force-directed layout (links attract, all nodes repel), edges rendered as point-chains, slow spin to show the hub-and-spoke skeleton. Knobs: node count, links-per-node (m), spin."
      ]
  },
  {
      "version": "0.1.96",
      "date": "2026-09-19",
      "title": "Collatz Coral — a rule this simple should not look this alive",
      "summary": "The Collatz conjecture: halve an even number, triple-plus-one an odd one, repeat, and every number is believed to fall to 1 — checked past 2^68, unproven for 87 years. Turn each number's descent around and draw it as a turtle bough (gentle left at an even step, harder right at an odd one) and, because every sequence ends 8→4→2→1, hundreds of independent walks weave into one branching coral. Opens the Number category's second system.",
      "newSystems": [
          "collatz"
      ],
      "notes": [
          "Collatz Coral (Number): reversed hailstone sequences drawn as continuous boughs from a shared root, dim at the stem and bright at each tip, so the crown blazes with fronds while the trunk stays a thin thread. The rarer odd numbers put the kinks that throw off new branches.",
          "Sway and sway-speed knobs give the coral a slow seaweed drift."
      ]
  },
  {
      "version": "0.1.95",
      "date": "2026-09-12",
      "title": "Fly Brain Cascade — a spiking brain, wired like a fly's",
      "summary": "The fly connectome's surprise (Shiu et al. 2024): put the simplest neuron model there is — leaky integrate-and-fire — on the real wiring and it predicts behaviour with no tuning. This is that experiment on a statistical connectome shaped like a Drosophila brain: neurons laid out by neuropil, wired by the known pathways, log-normal synapses, 10% inhibitory. Pick a sense, watch the activity cascade. Opens a new Neural category.",
      "newSystems": [
          "flyBrain"
      ],
      "notes": [
          "Fly Brain Cascade (Neural): 60k leaky integrate-and-fire neurons in paired optic lobes, antennal lobes, mushroom-body calyces and lobes, lateral horns, the central complex and the subesophageal zone; 1.2M synapses with distance-dependent delays. Spikes launch packets of light down their axons; adaptation makes each cascade rise and self-terminate.",
          "Stimulus selector (olfactory / visual / taste / spontaneous), drive, synaptic gain and inhibition knobs — gain ≈1.5 tips the brain from bursting cascades into sustained asynchronous firing.",
          "Browse/tab ordering now lists the Tiling, Number, Neural and Custom categories explicitly."
      ]
  },
  {
    "version": "0.1.94",
    "date": "2026-08-15",
    "title": "Luneburg Lens — focusing a wave with a gradient, not a curve",
    "summary": "A Luneburg lens bends light with no curved surface at all: its refractive index falls smoothly from centre to rim, n(r)=√(2−(r/R)²), so a plane wave is steered continuously to a point on the far side. We simulate the real 2-D wave equation with the wave speed baked from that profile, and — powered by a NEW field-texture renderer — draw the wavefronts as a smooth blue/orange field instead of a point cloud.",
    "newSystems": ["luneburgLens"],
    "notes": [
      "Luneburg Lens (Spectral): a leapfrog 2-D scalar wave equation ü=c(x,y)²∇²u with the wave speed set per cell from the Luneburg gradient index, a soft plane-wave source, and absorbing borders — watch straight wavefronts curl through the disk and pinch to a focus.",
      "New field-texture render path: systems exposing a 2-D scalar field now draw it as a smooth colour-mapped panel (a DataTexture with linear filtering) rather than 1-px points — continuous fields finally read as gap-free heatmaps. Unblocks the whole wave / reaction-diffusion / lattice family."
    ]
  },
  {
    "version": "0.1.93",
    "date": "2026-07-13",
    "title": "Drumhead — modes now ring at their true (inharmonic) pitch",
    "summary": "The circular-membrane system got the physics it was missing. Every Bessel mode now breathes at its OWN eigenfrequency (ω ∝ λ_{m,n}), so switching modes changes the pitch — and those ratios are inharmonic (1.59, 2.30, 2.92, 3.60…), which is exactly why a drum has no clear note. The readout shows each mode's f_{m,n}/f_{0,1}. Also relabeled from 'Circular Chladni Plate' (a drumhead is a membrane, not a stiff plate).",
    "newSystems": [],
    "notes": [
      "Drumhead (Bessel modes): modes ripple at their true relative frequency λ_{m,n}/λ_{0,1} instead of a fixed rate — the inharmonic overtone ratios that guide drum tuning; the readout now shows f_{m,n}/f_{0,1}. Renamed from 'Circular Chladni Plate' for physical accuracy (∇² membrane, not a ∇⁴ plate). Prompted by a Mathematica post; the underlying modes were already shipped, so this is a polish, not a duplicate."
    ]
  },
  {
    "version": "0.1.92",
    "date": "2026-07-13",
    "title": "Fix: Penrose Tiling froze the render",
    "summary": "The Penrose Tiling could lock up on load. Its archetype produced a different point count than the driver was told, so the worker wrote past the end of its buffer — filling positions with NaN, which stalls the GPU. Fixed by having the tiling honour the requested particle budget; it now also renders denser, brighter rhombus edges.",
    "newSystems": [],
    "notes": [
      "Fix: Penrose Tiling now respects the driver's particle count (no more count mismatch → no NaN vertex positions → no GPU stall). Bonus: edges are drawn with far more points, so the rhombi and ten-fold rosettes glow crisply."
    ]
  },
  {
    "version": "0.1.91",
    "date": "2026-07-13",
    "title": "Prime Spiral — number theory on a sunflower",
    "summary": "Place every integer on a sunflower — at radius √n and angle n×137.5° (the golden angle) — then light up the primes. The interlocking spiral families (parastichies) come purely from the irrational golden-angle spacing, and the primes flare ember-to-ivory through them while composites sink to a violet haze. Opens the number-theory domain.",
    "newSystems": ["primeSpiral"],
    "notes": [
      "Prime Spiral (Number): Vogel's phyllotaxis model (r=√n, θ=n·golden-angle) coloured by primality from a one-time Sieve of Eratosthenes — primes incandescent ember→ivory with a glowing core, composites a faint violet haze that reveals the Fibonacci spiral arms. A phyllotactic cousin of the Ulam spiral. Rescued from a real X post (the ‘million primality tests per frame' framing dropped as needless). From the exhaustive catalog-gap sweep."
    ]
  },
  {
    "version": "0.1.90",
    "date": "2026-07-13",
    "title": "Penrose Tiling — order that never repeats",
    "summary": "Roger Penrose's two rhombi (a fat and a thin) cover the plane only aperiodically: the pattern never repeats, yet has perfect five-fold symmetry and rigid long-range order — a 'forbidden' order that turned out to be real when quasicrystals were discovered in 1982 (Nobel 2011). Built by de Bruijn's pentagrid trick. Opens the aperiodic-tilings domain.",
    "newSystems": ["penrose"],
    "notes": [
      "Penrose Tiling (Tiling): the P3 rhombus tiling generated by de Bruijn's dual construction — overlay five families of parallel lines at 72°, and every intersection becomes one rhombus. Fat rhombi drawn warm, thin cool, as glowing edges so the ten-fold rosettes and non-repeating weave read directly. Rendered crisp as points-on-edges. From the exhaustive catalog-gap sweep; completes the first-five domain-openers."
    ]
  },
  {
    "version": "0.1.89",
    "date": "2026-07-13",
    "title": "Ising Model — a phase transition on a slider",
    "summary": "The simplest system in physics that has a phase transition. A lattice of spins wants to agree with its neighbours but is jostled by heat; below the Curie point Tc≈2.269 it spontaneously magnetizes into large domains, above it thermal noise wins, and exactly at Tc the domains go scale-free (critical opalescence). Real Metropolis Monte-Carlo, driven by a temperature slider. Opens the statistical-mechanics domain.",
    "newSystems": ["ising"],
    "notes": [
      "Ising Model (Matter): a 384² spin lattice evolved by checkerboard Metropolis Monte-Carlo with periodic boundaries — propose a flip, accept if it lowers the energy else with probability e^{−ΔE/T}. Spin-up glows warm, spin-down cool, so domain walls read directly; slide temperature through Tc≈2/ln(1+√2) to drive order↔disorder. Cell positions are jittered so the points fill domains as solid pointillist clouds. From the exhaustive catalog-gap sweep."
    ]
  },
  {
    "version": "0.1.88",
    "date": "2026-07-13",
    "title": "Double Pendulum Swarm — chaos you can watch detonate",
    "summary": "Tens of thousands of double pendulums start from almost exactly the same angle — a spread thinner than a pixel — so the swarm of bob-tips begins as a single dot. Sensitive dependence does the rest: the dot stretches to a filament, folds, and within a few swings detonates into a fog. The moment it smears is the Lyapunov horizon, made visible.",
    "newSystems": ["doublePendulumSwarm"],
    "notes": [
      "Double Pendulum Swarm (Oscillator): an ensemble of energy-conserving RK4 double pendulums with a hair-thin fan of start angles, plotted as lower-bob tips in REAL space (distinct from the phase-space Double Pendulum attractor). Colour baked across the bundle so the ordered rainbow shears and marbles as it mixes; the swarm periodically re-collapses to replay the divergence. From the exhaustive catalog-gap sweep."
    ]
  },
  {
    "version": "0.1.87",
    "date": "2026-07-13",
    "title": "Elementary CA — complexity from a three-cell rule",
    "summary": "Wolfram's proof that a trivial rule can make anything. A row of on/off cells updates from just its neighbours; the 8 answers, read as a byte, name the rule (0–255). Rule 90 draws the Sierpiński triangle, Rule 30 makes provable chaos, Rule 110 is Turing-complete — the whole discrete-CA domain, opened.",
    "newSystems": ["elementaryCA"],
    "notes": [
      "Elementary CA (Life): all 256 one-dimensional rules on a live rule-number slider, seeded from a single cell (or a random row) and grown row by row into the space-time diagram, then looped. Our first classic discrete cellular automaton (Lenia is the continuous cousin). From the exhaustive catalog-gap sweep."
    ]
  },
  {
    "version": "0.1.86",
    "date": "2026-07-13",
    "title": "Bifurcation Diagram — the road to chaos",
    "summary": "The most iconic image in chaos theory, and a genre the catalog never had: not a strange attractor (an endpoint) but a live control-parameter sweep. The logistic map's attractor doubles — 1, 2, 4, 8… — faster and faster until it dissolves into chaos at r≈3.5699, threaded with periodic windows. Coloured by the Lyapunov exponent.",
    "newSystems": ["bifurcation"],
    "notes": [
      "Bifurcation Diagram (Map): every point owns a fixed growth rate r and keeps iterating xₙ₊₁=r·xₙ(1−xₙ), so the continuously-resampled ensemble IS the period-doubling fig-tree — shimmering, with the period-3 window visible. Colour baked by the Lyapunov exponent λ=⟨ln|r(1−2x)|⟩ (cool stable, hot chaotic). Kicks off the gap-analysis-driven original-build era. From the exhaustive catalog-gap sweep."
    ]
  },
  {
    "version": "0.1.85",
    "date": "2026-07-11",
    "title": "Hopfion — the Hopf fibration made visible",
    "summary": "The Hopf map sends the 3-sphere onto the ordinary sphere, and the preimage of every point is a circle — with any two circles linked exactly once. Projected into 3-D those fibres become nested, interlocking tori: the ground-state texture of a topological soliton that really appears in ferromagnets, superfluids, knotted light and vortex knots. Rescued from an 'emergent-spacetime' post — the framework is fringe, but the hopfion underneath is real and gorgeous.",
    "newSystems": ["hopfion"],
    "notes": [
      "Hopfion (Field): great-circle fibres of the Hopf map, stereographically projected from S³ into R³ as a wheel of nested linked tori and coloured by base-sphere position. Turning the fibre phase is a rigid Hopf flow — every point slides along its own circle, so the whole knot appears to rotate without deforming. Winding-number control gives higher-order (torus-knot) hopfions."
    ]
  },
  {
    "version": "0.1.84",
    "date": "2026-07-11",
    "title": "Vascular SOM — a neural sheet meets a problem it can't solve perfectly",
    "summary": "The same self-organizing map, handed a harder problem: a branching vascular tree instead of a smooth sphere. A flat rectangular lattice can't wrap around every bifurcation while keeping all its neighbours consistent — so the sheet stretches, compresses and tears near the branch points. What looks like the algorithm struggling is really it revealing the limits of topology preservation.",
    "newSystems": ["vascularSom"],
    "notes": [
      "Vascular SOM (Life): the Kohonen map (best-matching-unit + shrinking Gaussian neighbourhood) trained on a recursive bifurcating tree rather than a sphere. Because a 2-D sheet cannot faithfully cover a branching topology, the blue neural mesh strains and tears between the tree's glowing gold branch-clusters — a companion to the sphere-draping SOM that shows where the assumptions break down."
    ]
  },
  {
    "version": "0.1.83",
    "date": "2026-07-11",
    "title": "Screened Vortex Gas — a gas that turns into weather",
    "summary": "The quasi-geostrophic cousin of Onsager: give each vortex a finite reach (the deformation radius) and its pull is screened off beyond it, so only neighbours interact. Same-sign vortices bind into rotating islands, opposite signs form translating pairs, and a whole turbulent weave emerges — the equivalent-barotropic model behind Jupiter's bands and ocean eddies.",
    "newSystems": ["screenedVortexGas"],
    "notes": [
      "Screened Vortex Gas (Fluid): a full-screen flow-field shader for the quasi-geostrophic point-vortex model — the streamfunction obeys a SCREENED Poisson equation (−∇²+R_d⁻²)ψ=q, so each vortex's Biot–Savart pull is cut off exponentially beyond the deformation radius (Yukawa screening). Dozens of same-sign vortices bind into co-rotating islands over a line-integral-convolution tracer weave, tinted jade↔emerald vs crimson↔copper by potential-vorticity sign. 'Deformation radius' controls how local the turbulence is."
    ]
  },
  {
    "version": "0.1.82",
    "date": "2026-07-11",
    "title": "Onsager Vortices — order from negative temperature",
    "summary": "In 1949 Onsager predicted that a gas of point vortices in a 2-D fluid, above a critical energy, reaches a NEGATIVE-temperature state where same-sign vortices clump into giant coherent domains — the opposite of how heat usually spreads things apart. Here two condensed domains counter-rotate, cyan against ember, their streamlines rendered as a true flow field.",
    "newSystems": ["onsagerVortex"],
    "notes": [
      "Onsager Vortices (Fluid): a full-screen flow-field shader — per pixel we sum the Biot–Savart velocity of two clusters of same-sign point vortices and paint their streamlines by line-integral convolution, tinted by the sign of the local vorticity (cyan ↷ vs ember ↶) with white-hot cores. Rendered as an exact continuum field rather than points, so the condensate reads as two clean counter-rotating domains. Flow rate + contrast live controls"
    ]
  },
  {
    "version": "0.1.81",
    "date": "2026-07-11",
    "title": "Self-Organizing Map \u2014 a neural sheet finds the shape of data",
    "summary": "A flat grid of neurons that knows nothing teaches itself the shape of the data: each sample pulls its best-matching neuron and its grid neighbours closer, and as the neighbourhood shrinks the sheet folds onto a sphere like an orange peel \u2014 order emerging from thousands of local nudges. Our first machine-learning system (Kohonen, 1982).",
    "newSystems": ["som"],
    "notes": [
      "Self-Organizing Map (Life): competitive learning \u2014 best-matching-unit search + a shrinking Gaussian neighbourhood kernel on the flat grid, learning rate and radius annealing down, so a tiny flat patch of neurons unfolds to drape a sphere of samples. Drawn as a live wireframe mesh over the data cloud. Live learning pace"
    ]
  },
  {
    "version": "0.1.80",
    "date": "2026-07-11",
    "title": "Spiral Whirl \u2014 a whole animation in one tweet",
    "summary": "A faithful port of a tsubuyaki-Processing one-liner by KAZ+OO: four thousand points on nested spirals, wound by a = i+t and swirled off-centre, turning into a lace of interleaved arcs. A reminder that a few lines of closed-form trig can hold a lot of motion.",
    "newSystems": ["spiralWhirl"],
    "notes": [
      "Spiral Whirl (Parametric): r = (i mod 200) + 99\u00b7sin(i\u00b2+t), angle a = i+t, a swirl offset 80\u00b7(sin(i+t), cos(3i+t)); densely sampled (the i\u00b2 wobble bucketed per integer so arcs stay crisp), white-to-pink. Faithfully after KAZ+OO (@KAZOOOps), credited in the docs. Live wind speed / swirl offset"
    ]
  },
  {
    "version": "0.1.79",
    "date": "2026-07-11",
    "title": "Optical Vortices \u2014 threads of darkness, rebuilt as a real field",
    "summary": "A phase vortex is a point where the wave winds a full turn and the amplitude must vanish. Interfere several with a tilted reference and the fringes FORK at every vortex core \u2014 the hologram signature of a phase singularity. Rebuilt as a full-screen shader that computes the genuine |\u03a3E|\u00b2, not a point cloud.",
    "newSystems": ["opticalVortex"],
    "notes": [
      "Optical Vortices (Spectral): a full-screen field shader \u2014 several drifting Laguerre\u2013Gauss vortex beams plus a tilted reference wave, showing I = |\u03a3E|\u00b2 per pixel, so the carrier fringes fork at every phase singularity (order = topological charge). Computes the real interference rather than dithering points. Live vortices / phase spin / drift / width / intensity"
    ]
  },
  {
    "version": "0.1.78",
    "date": "2026-07-08",
    "title": "Iterated Logarithm \u2014 the wall randomness never breaks",
    "summary": "A random walk spreads like \u221an on average \u2014 but its almost-sure record is bounded by the sharper \u00b1\u221a(2n log log n), Khinchin's law of the iterated logarithm, a wall it kisses infinitely often yet never permanently crosses. An ensemble of walks fans out against it, record-setters flaring orange at the boundary.",
    "newSystems": ["iteratedLog"],
    "notes": [
      "Iterated Logarithm (Sampler): our first stochastic-process system \u2014 an ensemble of Gaussian random walks whose density fills the Central-Limit \u221an bulk while the two LIL walls \u00b1\u221a(2n log log n) open above and below; a sweeping front traces the walks out in n, and paths that reach the wall flare orange. Live ensemble size / step variance / sweep rate"
    ]
  },
  {
    "version": "0.1.77",
    "date": "2026-07-08",
    "title": "Perihelion Precession \u2014 the orbit that never closes",
    "summary": "In Newton's gravity a bound orbit is a closed ellipse. In Einstein's it isn't: the ellipse slowly turns with every pass, tracing a rosette \u2014 the 43\u2033/century of Mercury that was General Relativity's first triumph, and the visible payoff of Gravity Well's caveat that curved TIME steers the slow orbit.",
    "newSystems": ["precession"],
    "notes": [
      "Perihelion Precession (Spacetime): exact Schwarzschild geodesics r(\u03c6) = p/(1 + e\u00b7cos k\u03c6) with k = \u221a(1\u22126M/p), so periapsis advances \u0394\u03d6 = 2\u03c0(1/k\u22121) per orbit and the path fills a rosette; bodies climb at the Kepler areal rate (fast at periapsis) past a bright photon ring at 3M. Live compactness / eccentricity / bodies / speed"
    ]
  },
  {
    "version": "0.1.76",
    "date": "2026-07-07",
    "title": "Black Hole Ringdown \u2014 spacetime rings like a bell",
    "summary": "Merge two black holes and the newborn horizon rings down, shedding gravitational waves in fading quasinormal tones whose pitch and decay encode only its final mass and spin. A spacetime membrane, struck at the centre, radiating a damped \u2113=2 quadrupole wave outward on retarded time.",
    "newSystems": ["ringdown"],
    "notes": [
      "Black Hole Ringdown (Spacetime): a wireframe membrane with a shallow throat; the dominant \u2113=2 quadrupole quasinormal mode radiates outward as a damped sinusoid A\u00b7e^{\u2212t/\u03c4}\u00b7cos(\u03c9t)\u00b7cos 2\u03b8 on retarded time (nothing outruns the wavefront), re-struck each cycle. Sim-clock reads the ringdown in milliseconds. Live ring amplitude / decay time / well depth / re-strike"
    ]
  },
  {
    "version": "0.1.75",
    "date": "2026-07-07",
    "title": "Gigantic Jet \u2014 lightning that fires into space",
    "summary": "The rarest transient luminous event: a blue-white leader punches out of a thunderstorm top and races to the ionosphere 90 km up in milliseconds, fanning into red tendrils \u2014 the shot astronaut Nichole Ayers caught from the ISS. Seen over the curved night limb with city lights, airglow and stars.",
    "newSystems": ["giganticJet"],
    "notes": [
      "Gigantic Jet (Atmosphere): an upward discharge as an event cycle (grow \u2192 flash \u2192 fade \u2192 dark) climbing the outward normal from a storm top to a fanned ionospheric crown; altitude-baked colour (blue-white leader \u2192 blue column \u2192 violet/red crown) over the orbital night limb with sodium-orange city lights, a red airglow band and stars. Live strike rate / crown spread"
    ]
  },
  {
    "version": "0.1.74",
    "date": "2026-07-06",
    "title": "Solar Corona \u2014 flares wake up",
    "summary": "The Sun has been throwing X-class flares across several active regions. Solar Corona gets a matching overhaul: blindingly bright, compact flare kernels erupt at active-region cores, the coronal loop arcades hug the disk, the limb glows brighter, and the old spray of prominences is calmed to let the flares dominate.",
    "newSystems": [],
    "notes": [
      "Solar Corona overhaul: added compact white-hot flare kernels (X-class brightening) at a couple of active regions; denser, lower coronal-loop arcades that hug the surface; a brighter limb; tamed prominence/CME eruptions; closer default framing so the disk fills the view"
    ]
  },
  {
    "version": "0.1.73",
    "date": "2026-07-06",
    "title": "Firefly Synchronization \u2014 a forest finding one pulse",
    "summary": "Thousands of fireflies arrive flashing at random and, over seconds, pull into perfect unison \u2014 no leader, just each nudging its rhythm toward the others. The Kuramoto model made literal: the emergence of sync you can watch, a companion to the abstract Kuramoto phase portrait.",
    "newSystems": ["fireflies"],
    "notes": [
      "Firefly Synchronization (Life): mean-field Kuramoto \u2014 each firefly's phase pulls toward the population's order parameter; above the critical coupling the swarm locks into one collective flash. Each firefly gathers into a bright luciferase-green blob when it flashes and parks out of sight when dark. The embodied twin of the abstract Kuramoto Sync system. Live coupling / freq spread / flash rate"
    ]
  },
  {
    "version": "0.1.72",
    "date": "2026-07-05",
    "title": "Aurora from Orbit \u2014 the ISS view",
    "summary": "The same aurora, seen from 400 km up: the auroral oval as a luminous ribbon following the curve of the planet, rays reaching up toward you, over a dark cloud-mottled night side with a razor-thin airglow limb and stars beyond. Chris Hadfield flew right through the upper tendrils.",
    "newSystems": ["auroraOrbit"],
    "notes": [
      "Aurora from Orbit (Atmosphere): the oval draped on a sphere with rays rising along the local outward normal so they lean over the limb; same altitude spectrum as the ground aurora (violet base \u2192 emerald body \u2192 red crown) with sawtooth precipitation; dim cloud-mottled night cap, a thin red-orange airglow limb, and a starfield beyond"
    ]
  },
  {
    "version": "0.1.71",
    "date": "2026-07-05",
    "title": "Newton Flow \u2014 the root-finder as a fluid",
    "summary": "Newton's method hides a fractal: colour each point by the root it converges to and the plane shatters into interlocking basins. Let the roots DRIFT and the basins come alive \u2014 fixed basin colours dragged into interleaving filaments as a softened, tanh-limited Newton correction sprays every particle toward its moving root.",
    "newSystems": ["newtonFlow"],
    "notes": [
      "Newton Flow (Field): P_t(z) = \u220f(z\u2212r_j(t)) with drifting roots; softened correction (\u03c3 keeps the step finite at the critical seams) and a tanh magnitude-limiter (the bounded 'explosion'); colour baked from the starting basin, respawn on arrival at a root. Live degree / drift / gain / softening"
    ]
  },
  {
    "version": "0.1.70",
    "date": "2026-07-05",
    "title": "Trigonometric Map \u2014 z\u00b2, folded through sine",
    "summary": "Two lines of arithmetic \u2014 x\u2032 = sin(x\u00b2\u2212y\u00b2+a), y\u2032 = cos(2xy+b) \u2014 whose arguments are the real and imaginary parts of z\u00b2. Bounded forever by sin and cos, every orbit settles onto a lacy attractor whose shape the two phases dial through an endless family of blooms. After Simone Conradi's density studies.",
    "newSystems": ["trigMap"],
    "notes": [
      "Trigonometric Map (Map): a complex square folded through sin/cos, iterated once per frame so the cloud samples the attractor's invariant density; the two phases drift so the figure continuously blooms and reforms; seed-angle hue wheel stains the dense regions. Live phase a / phase b / morph rate / zoom"
    ]
  },
  {
    "version": "0.1.69",
    "date": "2026-07-05",
    "title": "DNA Supercoiling \u2014 topology you can watch",
    "summary": "A closed double helix cannot change its linking number \u2014 only an enzyme cutting a strand can. White's theorem, Lk = Tw + Wr, means over-winding has nowhere to go but writhe: the axis buckles into a supercoil, and the base-pair twist slows to keep the total fixed. Two metres of DNA fold into every cell by exactly this rule.",
    "newSystems": ["dnaSupercoil"],
    "notes": [
      "DNA Supercoiling (Parametric): a closed superhelix wound n times on a torus, always genuinely closed so Lk stays an integer; an imposed strain cycles the coil amplitude, writhe rises from the coil geometry, and the base-pair twist takes up the remainder (Tw = Lk \u2212 Wr) \u2014 White's theorem made literal. Antiparallel amber backbones, red A\u00b7T and blue G\u00b7C rungs"
    ]
  },
  {
    "version": "0.1.68",
    "date": "2026-07-04",
    "title": "Hyperbolic Sphere \u2014 two geometries, one picture",
    "summary": "A hyperbolic grid from the Poincar\u00e9 disk, pushed through the stereographic projection: the diagonals become pole-to-pole loxodrome spirals, and sliding the grid along itself \u2014 an isometry of hyperbolic space \u2014 becomes the M\u00f6bius flow of the sphere. The pattern streams forever without changing shape.",
    "newSystems": ["hyperbolicSphere"],
    "notes": [
      "Hyperbolic Sphere (Conformal): band-model grid u \u00b1 p\u00b7v = k\u00b7c \u2192 log-spirals \u2192 loxodromes via inverse stereographic projection; the animation is a genuine loxodromic M\u00f6bius transformation with the poles as fixed points. Amber and blue families like KAZ+OO\u2019s p5.js original, which is credited in the docs"
    ]
  },
  {
    "version": "0.1.67",
    "date": "2026-07-04",
    "title": "Shepherd Moon \u2014 Daphnis and the Keeler Gap",
    "summary": "An 8-km moon holds open a 42-km gap in Saturn\u2019s A ring and raises kilometre-high waves on its edges \u2014 the ones whose shadows Cassini photographed at equinox. Pure Kepler shear doing sculpture: inner particles overtake, outer particles lag, and every pass past the moon leaves a scalloped wake.",
    "newSystems": ["daphnis"],
    "notes": [
      "Shepherd Moon (Orbital): exact Kepler orbits (\u03a9 \u221d a^{-3/2}), stationary wake in the moon\u2019s frame with the classic 3\u03c0\u00b7\u0394a edge-wave wavelength, trailing ahead on the inner edge and behind on the outer; inclination pulls the inner-edge waves into kilometre-high vertical walls; baked ringlet banding, 160k particles"
    ]
  },
  {
    "version": "0.1.66",
    "date": "2026-07-03",
    "title": "Aurora Borealis — stand under the polar night",
    "summary": "Solar-wind electrons crash down Earth's field lines and the upper atmosphere answers in atomic spectra: nitrogen's purple fringe, oxygen's emerald body, the forbidden red crown. A folded curtain of 110 field-aligned rays, doubled in a still lake below.",
    "newSystems": ["aurora"],
    "notes": [
      "Aurora Borealis (Plasma): ~110 field-aligned rays along a sinuous arc with travelling drapery folds; colours baked by the real altitude spectrum (N\u2082\u207a purple \u2192 O 557.7 nm green \u2192 O 630 nm red) with exponential luminosity falloff; desynchronised sawtooth precipitation down each ray; the whole sky mirrored in a rippling lake at 25% brightness"
    ]
  },
  {
    "version": "0.1.65",
    "date": "2026-07-02",
    "title": "One mind — the Bose–Einstein Condensate",
    "summary": "Schrödinger wrote that the multiplicity of minds 'is only apparent; in truth there is only one mind' — and the equation bearing his name describes matter doing exactly that. Cool the cloud and watch thousands of individual atoms fall into a single wavefunction that breathes as one thing.",
    "newSystems": ["bec"],
    "notes": [
      "Bose–Einstein Condensate (Matter): a full cooling cycle — thermal Lissajous cloud → atoms fall into the coherent core following the exact 3-D-trap law N₀/N = 1−(T/T_c)³ → the condensate breathes in perfect unison (one wavefunction, one motion) while stragglers still jitter → reheat and dissolve back into the many. Doc pairs the Schrödinger quote with the Gross–Pitaevskii equation"
    ]
  },
  {
    "version": "0.1.64",
    "date": "2026-07-02",
    "title": "System #200: the Gravity Well",
    "summary": "ETHERSIM's two-hundredth system is the most famous image in physics — the Sun denting the sheet, the planets circling the slope — done as honestly as the rubber sheet can be done: the membrane IS the Newtonian potential, every planet drags its own dimple, the orbits obey Kepler, and the Learn panel tells you what the analogy hides.",
    "newSystems": ["gravityWell"],
    "notes": [
      "Gravity Well (Orbital): membrane height = softened Newtonian potential of Sun + planets (each with a travelling dimple; a moon rides the blue planet's dimple around the funnel); real Kepler orbits (ω ∝ a^{-3/2}, inner worlds lap outer ones). The doc is candid about the analogy's limits — curved TIME, not the sheet, steers slow orbits",
      "🎉 The catalog reaches 200 systems"
    ]
  },
  {
    "version": "0.1.63",
    "date": "2026-07-02",
    "title": "Pulsar, Relativistic Jet + Multi-Species Lenia",
    "summary": "Three heavyweights: the lighthouse of a tilted pulsar magnetosphere, a black hole's kink-unstable jet, and a living dish of three competing Lenia species with ecological immigration.",
    "newSystems": ["pulsar", "relativisticJet", "multiLenia"],
    "notes": [
      "Pulsar (Plasma): exact vacuum-dipole field lines (r=L·sin²θ) around a white-hot neutron star, polar beams streaming from the TILTED magnetic poles — two rotations per frame make the lighthouse sweep — plus an unwinding pulsar-wind spiral. Live tilt / spin / shells / wind",
      "Relativistic Jet (Plasma): twin helical-field jets whose axis wobbles with a downstream-growing kink (m=1) instability, plasma streaming along opening helices (white spine → violet sheath, synchrotron-style) with bright knots racing outward. Live kink / twist / flow",
      "Multi-Species Lenia (Life): three Lenia fields in one dish, coupled by local competition — territories, chases, rainbow membranes — kept alive by ecological 'immigration' (collapsed species receive drifting propagules and reinvade). Live niches / competition / kernel radius"
    ]
  },
  {
    "version": "0.1.62",
    "date": "2026-07-02",
    "title": "Everlasting Flower — a volumetric bloom",
    "summary": "A flower made of glowing density instead of surfaces: feathery petal vanes grown from sin-octave turbulence in a log-spherical domain, composited front-to-back so the petals hold real silhouettes — in the spirit of Yohei Nishitsuji's one-tweet GLSL blooms.",
    "newSystems": ["everlasting"],
    "notes": [
      "Everlasting Flower (Bloom): the volumetric marcher gains a 'flower' field — self-similar log-spherical turbulence, pow-sharpened petal vanes that scallop the silhouette, position-keyed palette (cream heart, blush petals, green sepals), Beer–Lambert occlusion. Live petals / detail / density / glow / hue"
    ]
  },
  {
    "version": "0.1.61",
    "date": "2026-07-02",
    "title": "White Hole, Martian Clouds + Impact Fragmentation",
    "summary": "Three new systems: a horizon that only ejects (the time-reversed Schwarzschild solution), the iridescent mother-of-pearl clouds Curiosity photographed over Mars (opening a new Atmosphere category), and an asteroid shattering through a cascading fragmentation tree.",
    "newSystems": ["whiteHole", "marsClouds", "impactFragmentation"],
    "notes": [
      "White Hole (Spacetime): Flamm's-paraboloid funnel + molten horizon ring at r=2M + ejecta on ANALYTIC time-reversed rain-frame trajectories (r^{3/2} linear in proper time — no integrator, no drift). Completes the black hole / wormhole / white hole trilogy. Honestly labelled: never observed, possibly mathematics-only",
      "Martian Clouds (Atmosphere): noctilucent CO₂-ice clouds at twilight — gravity-wave trains rippling a wind-blown sheet, iridescent droplet-size bands baked per parcel (real Curiosity phenomenon, kept subtle like the real thing)",
      "Impact Fragmentation (Matter): an asteroid shattered by a projectile — a pre-planned cascading fragmentation tree (Grady–Kipp power-law sizes, generations of re-fracture), closed-form ballistic shards with rigid tumble, and a white-hot impact-ejecta fan. A fresh impact every replay",
      "New 'Atmosphere' category — a home for clouds, storms and sky optics to come"
    ]
  },
  {
    "version": "0.1.60",
    "date": "2026-07-02",
    "title": "Structure Formation — the movement of the entire universe",
    "summary": "The cosmos assembling itself: matter drains out of the voids onto sheets, filaments and glowing knots as 13.8 billion years tick past on the sim clock — then dark energy freezes the web in place. The Zel'dovich approximation with a real ΛCDM growth history, honestly implemented.",
    "newSystems": ["structureFormation"],
    "notes": [
      "Structure Formation (Cosmology): first-order Lagrangian perturbation theory — x = q + D(t)·ψ(q). Displacement field + each particle's destiny (web vs void) baked analytically; per frame only the ΛCDM growth factor advances (exact sinh scale factor + Carroll–Press–Turner D(a)), so cosmic history runs at 60 fps and growth genuinely freezes under dark-energy domination",
      "The sim clock runs in absolute cosmic time: T+13.8 Gyr is today — inspired by what the Rubin Observatory is now mapping across billions of galaxies"
    ]
  },
  {
    "version": "0.1.59",
    "date": "2026-07-02",
    "title": "Deep time — the sim clock",
    "summary": "Simulations now carry a physical clock: the telemetry panel shows honest elapsed time in real units. The Galaxy Collision is calibrated to the published Andromeda timeline — watch 'T + 4.3 Gyr' tick past as the disks first graze — and its encounter now runs to completion (merger + billions of years of remnant relaxation) before replaying.",
    "newSystems": [],
    "notes": [
      "Sim clock: any system can declare a physical time scale (factory.clock) and the telemetry panel shows 'sim time: T + … ' live — synced exactly to the integrator's fixed steps, pause- and speed-aware",
      "Galaxy Collision: calibrated to real gigayears (first Milky Way–Andromeda passage anchored at ≈4.3 Gyr, per van der Marel et al.); the encounter arc extended through the merger and long post-merger relaxation before replay; default pacing slowed so the eons read as eons"
    ]
  },
  {
    "version": "0.1.58",
    "date": "2026-07-01",
    "title": "Bioluminescence — the ocean answers",
    "summary": "Three living-light systems: a bioluminescent bay where invisible swimmers trail wakes of flashing dinoflagellates, a ctenophore whose rainbow is diffraction (not glow), and a jellyfish fountain of real Verlet-rope tendrils — ETHERSIM's first constraint-dynamics system.",
    "newSystems": ["bioBay", "combJelly", "jellyfishFountain"],
    "notes": [
      "Bioluminescent Bay (Life): dinoflagellate stimulus–response — invisible swimmers roam a dark bay and the water answers, wakes of cyan flashes blooming, diffusing and sinking into ambient sea-sparkle. After the bio bays of Vieques, Puerto Rico",
      "Comb Jelly (Life): eight comb rows as travelling rainbow point-trains — the metachronal diffraction wave of a real ctenophore (structural colour, not bioluminescence), on a glassy tumbling body",
      "Jellyfish Fountain (Life): a dome of tendrils, each a position-based Verlet rope pinned to a beating crown ring — pulses kick the dome outward and gravity settles it back"
    ]
  },
  {
    "version": "0.1.57",
    "date": "2026-07-01",
    "title": "Lightning — stepped leader & return stroke",
    "summary": "A full lightning strike as a dynamical system: a branching stepped leader crackles down from the cloud, the first branch to touch ground fires a white-hot return stroke UP the winning channel, the bolt decays, and a fresh tree grows — every strike different.",
    "newSystems": ["lightning"],
    "notes": [
      "Lightning (Plasma): dielectric-breakdown growth (the DLA family) with the real event cycle — stepped leader reveal, ground attachment, upward return stroke with per-frame crackle, decay, restrike. Live branchiness / wander / strike-rate; built to blaze under the new HDR bloom"
    ]
  },
  {
    "version": "0.1.56",
    "date": "2026-07-01",
    "title": "HDR bloom — everything glows",
    "summary": "A real HDR bloom post pass on the renderer: bright regions now bloom into soft halos, so every one of the 187 systems — and every screenshot, clip, and thumbnail — gets the luminous look of the reference art. The whole gallery has been re-rendered with it.",
    "newSystems": [],
    "notes": [
      "HDR bloom post-processing (TSL BloomNode) on the WebGPU renderer — the live view, screenshots, clips AND thumbnails all composite through it; per-system strength is tunable and ?bloom=0 disables it",
      "All 187 gallery thumbnails regenerated with the new look",
      "Fixed a subtle capture bug: offscreen renders (thumbnails/clips) outside the animation loop reused a stale frame with post-processing active — the node frame is now advanced manually"
    ]
  },
  {
    "version": "0.1.55",
    "date": "2026-06-30",
    "title": "Galaxy Collision — Milky Way × Andromeda",
    "summary": "A real gravitational simulation of the Andromeda–Milky Way merger: two disks of stars swing past each other, throw out tidal tails and bridges, and spiral into a single elliptical — the Toomre restricted N-body model, integrated live.",
    "newSystems": ["galaxyCollision"],
    "notes": [
      "Galaxy Collision (Cosmology): the classic Toomre & Toomre (1972) restricted N-body encounter — two massive cores orbit and merge (via dynamical friction) while clouds of test stars, feeling both cores, get flung into tidal tails and bridges. Live mass-ratio / pericenter / inclination / friction / speed. An actual integrated simulation, not a baked shape"
    ]
  },
  {
    "version": "0.1.54",
    "date": "2026-06-30",
    "title": "Solar eruptions + a 3-D galaxy",
    "summary": "Two upgrades: the Sun now erupts (animated prominences + CMEs, not just rotation), and the spiral galaxy gained real 3-D depth — a spheroidal bulge, a flaring disk, and an inclined view.",
    "newSystems": [],
    "notes": [
      "Solar Corona: active sites now ERUPT on a staggered cycle — confined prominences that rise and fall back, and coronal mass ejections that escape — flung out as curved plasma jets. New 'eruptions' rate control",
      "Spiral Galaxy: no longer a flat sheet — a 3-D spheroidal bulge, a disk with a flaring scale height, and a tilted view so the depth reads"
    ]
  },
  {
    "version": "0.1.53",
    "date": "2026-06-30",
    "title": "The active Sun + a spiral galaxy",
    "summary": "Two pieces of real astrophysics: the Sun's corona built from its magnetic loop structure, and a spiral galaxy whose arms are density waves (why the arms don't wind up — and why their distances keep getting revised).",
    "newSystems": ["solarCorona", "spiralGalaxy"],
    "notes": [
      "Solar Corona (Plasma): the Sun in 171 Å EUV, built from magnetism not fluid — coronal loops arcing between active-region footpoints in the sunspot latitude bands, a granular surface, polar plumes, a glowing limb, and slow rotation",
      "Spiral Galaxy (Cosmology): a density-wave spiral — stars on precessing elliptical orbits crowd into two arms and flow through them while the pattern turns at its own speed, with a central bar/bulge and pink star-forming knots. The generative answer to the 'winding problem'"
    ]
  },
  {
    "version": "0.1.52",
    "date": "2026-06-30",
    "title": "Moiré illusion + attractor swarms",
    "summary": "A barrier-grid moiré that reads as rotation, and two scatters of tumbling strange-attractor 'butterflies' (all-Lorenz, or a mixed menagerie). Plus: the Bloom piece is now the generic 'Ink Bloom'.",
    "newSystems": ["moire", "lorenzSwarm", "attractorMenagerie"],
    "notes": [
      "Moiré Grid (Linework): a fixed radial hash grating XOR'd with a sliding vertical barrier — the interference rosette sweeps as illusory rotation, though nothing actually turns. Live hashes / barrier density / speed",
      "Lorenz Butterfly Swarm (Attractor): a scatter of Lorenz attractors, each baked into a butterfly and tumbling on its own axis — a nod to the butterfly effect (and Sagan's butterflies who 'flutter for a day')",
      "Attractor Menagerie (Attractor): the same swarm across a mix of species — Lorenz, Rössler, Aizawa, Thomas, Halvorsen — to show the variety of bounded chaos",
      "Renamed 'Seedform' → 'Ink Bloom' and made it a generic watercolour/ink-diffusion piece (removed the prior artist attribution at the artist's request)"
    ]
  },
  {
    "version": "0.1.51",
    "date": "2026-06-30",
    "title": "Jellyfish Bloom — bioluminescence in the deep",
    "summary": "A drifting swarm of bioluminescent jellyfish: pulsing translucent bells trailing luminous tentacles, in cool living-light blues and violets over the abyss.",
    "newSystems": ["jellyfishBloom"],
    "notes": [
      "Jellyfish Bloom (Bloom): a per-pixel swarm of glowing medusae — each an elliptical bell (luminous rim + soft fill) pulsing in anti-phase (the jellyfish jet) with wavy tentacles, drifting over an abyssal gradient flecked with marine snow. Live glow / pulse / drift / hue"
    ]
  },
  {
    "version": "0.1.50",
    "date": "2026-06-30",
    "title": "Four new systems: light, lensing & a dandelion",
    "summary": "An optics-and-nature batch: a gravitational lens bending a starfield into an Einstein ring, two diffraction pieces (crossed-grating spokes and a dispersive wavefront), and a Fibonacci-packed dandelion blowball.",
    "newSystems": ["gravLens", "crossedDiffraction", "dispersionWave", "dandelion"],
    "notes": [
      "Gravitational Lens (Spacetime): a procedural sky bent by a point mass into an Einstein ring + arcs via the thin-lens map β=θ(1−rE²/|θ|²) — pure lensing, no disk/horizon (unlike the black-hole marcher). Live Einstein-radius / zoom / drift",
      "Crossed Diffraction (Spectral): white light through crossed gratings → a radiant lattice of spectral spokes (white zeroth order, blue→red within each diffraction order). After the OPN 'Image of the Week'",
      "Dispersion (Spectral): a point-source wavefront on a grainy domed bowl; crests propagate outward while the dispersed spectrum is baked by radius, so each crest recolours warm→cool as it travels. After hal09999",
      "Dandelion (Parametric): a blowball — seed stalks on a Fibonacci (golden-angle) sphere, each tipped with a pappus puff; the same packing nature uses for sunflower phyllotaxis"
    ]
  },
  {
    "version": "0.1.49",
    "date": "2026-06-30",
    "title": "Three new systems: string worldsheet, Stokes phase, Ink Bloom",
    "summary": "A daily-adds trio spanning physics and art: the 2-D sheet a relativistic string sweeps through spacetime, the saddle-point landscape behind the Stokes phenomenon, and a watercolour ink-bloom that opens a new Bloom category.",
    "newSystems": ["stringWorldsheet", "stokesPhase", "inkBloom"],
    "notes": [
      "String Worldsheet (Parametric): a vibrating string (sum of standing-wave harmonics, open or closed) swept through a static spacetime grid by retarded time — the present edge leads and its past trails, so the worldsheet flows. Live harmonics/tension/amplitude/sweep/window",
      "Stokes Phase Surface (Spectral): the cubic phase Φ=z³/3−sz as a 3-D monkey-saddle terrain, with the steepest-descent contours through its two saddles lit warm/cool — sweep arg(s) to cross the Stokes lines where a saddle's contribution switches on",
      "Ink Bloom (Bloom): a soft watercolour bloom of overlapping translucent pigment lobes (subtractive ink layering, so overlaps deepen to an inky heart)",
      "New 'Bloom' category (generative botanical / watercolour pieces)"
    ]
  },
  {
    "version": "0.1.48",
    "date": "2026-06-30",
    "title": "Capture Clip — share the motion (WebM + GIF)",
    "summary": "A new 'Clip ↗' export records a few seconds of the live animation as a WebM video and an animated GIF — because a still frame can't show the 3D motion. Watermarked and ready to post.",
    "newSystems": [],
    "notes": [
      "New 'Clip ↗' button (Snapshot controls): records ~5s of the live view and downloads BOTH a WebM (MediaRecorder) and an animated GIF (in-browser via gifenc), each watermarked (ETHERSIM · ethersim.ai · system) — a motion-faithful share asset a screenshot can't be",
      "Capture pauses the live loop for clean frames and renders at a compact clip resolution; everything is client-side (nothing uploaded)"
    ]
  },
  {
    "version": "0.1.47",
    "date": "2026-06-29",
    "title": "Contour Field — a new Linework category",
    "summary": "Morphing contour-line art (after Zach Lieberman): nested isolines of a folded, symmetric wave field, drawn as crisp white level-sets on black. Opens a new Linework category for generative line drawing.",
    "newSystems": ["contourField"],
    "notes": [
      "Contour Field (Linework): per-pixel level sets of an interference field — mirror-folded for crisp 4-fold symmetry, domain-warped for an organic quasi-3D drift, fwidth-anti-aliased lines. Live contours / warp / line-weight / zoom / morph",
      "New 'Linework' category (generative line-art / contour drawing)"
    ]
  },
  {
    "version": "0.1.46",
    "date": "2026-06-29",
    "title": "Three new systems: Newton fractal, root cloud, cymatics",
    "summary": "A daily-adds trio inspired by math art in the wild: polynomiography's flowing n-fold basins, Simone Conradi's polynomial-root clouds, and the standing-wave geometry of cymatics.",
    "newSystems": ["newtonFractal", "polynomialRoots", "cymatics"],
    "notes": [
      "Newton Fractal (Conformal): per-pixel basins of Newton's method for zⁿ−1 — flowing n-fold-symmetric ribbons, coloured by which root each point reaches and how long it took. Live fold/over-relaxation/zoom/morph",
      "Polynomial Root Cloud (Sampler): scatters the complex roots of thousands of random ±1 (Littlewood) or {−1,0,1} (Bohemian) polynomials, found via Durand–Kerner — the iconic fractal feather hugging the unit circle (after Simone Conradi's 40-million-root pieces)",
      "Cymatic Plate (Field): a Faraday-wave superposition of the circular eigenmode band near a drive frequency — dense shimmering interference rosettes, distinct from the single-mode Chladni drumhead",
      "Refactor: the Bessel-function helpers are now a shared module (src/archetypes/bessel.ts) used by both drumhead and cymatics"
    ]
  },
  {
    "version": "0.1.45",
    "date": "2026-06-29",
    "title": "Engine upgrade — Three.js r185",
    "summary": "ETHERSIM's WebGPU/TSL engine moves up to Three.js r185. A full 169-system smoke test — every family, on both the WebGPU and WebGL2-fallback backends — confirmed pixel-faithful parity, so nothing changes on screen; the upgrade just keeps us current on perf and TSL features.",
    "newSystems": [],
    "notes": [
      "Upgraded three.js r184 → r185 (WebGPU renderer + TSL node materials + GPU-compute). Verified: all 169 systems render correctly, GPU-compute attractors/maps/fields intact, raymarch surfaces/fractals/volumes intact, additive-blend glow at parity (no premultiplied-alpha regression), WebGL2 fallback OK",
      "Silenced a benign r185 TSL console warning on raymarch systems — wrapped an inline If() callback in braces so it no longer hands TSL an implicit return"
    ]
  },
  {
    "version": "0.1.44",
    "date": "2026-06-28",
    "title": "Symmetric icons gain depth",
    "summary": "The six symmetric-icon maps now sit on a radial 3D relief — depth that preserves their exact N-fold symmetry — completing the Map category's dimensionality. Plus an internal render-path cleanup.",
    "newSystems": [],
    "notes": [
      "Symmetric Icons (sanddollar, trinity, pentagram, hexagon, heptagon, clamshell): a radial relief z=f(R) adds 3D depth while keeping the N-fold rosette symmetry exact (CPU + GPU twins)",
      "Modernized the offline thumbnail/snapshot capture to renderer.render()/compute() (the deprecated renderAsync/computeAsync are gone — silences the console warning)"
    ]
  },
  {
    "version": "0.1.43",
    "date": "2026-06-28",
    "title": "Maps gain depth + Decaying Spiral reborn",
    "summary": "The attractor-image iterated maps now drape over a 3D relief so orbiting reveals real dimensionality, and the Decaying Spiral is rebuilt as a true 3D logarithmic funnel-coil. Canonical phase portraits (Hénon, Ikeda, the symmetric icons…) stay authentically flat.",
    "newSystems": [],
    "notes": [
      "Iterated maps: Clifford, de Jong, Svensson, Hopalong, Gumowski–Mira, Bedhead, King's Dream, Sprott Quadratic, Duffing, Gingerbreadman, Martin now drape over a 3D height-field relief (CPU + GPU twins); the face-on image is unchanged",
      "Left authentically 2D: Hénon, Lozi, Chirikov Standard, Zaslavsky, Tinkerbell, Ikeda, and the symmetric icons (their structure is only meaningful in the plane)",
      "Decaying Spiral: rebuilt as a genuine 3D logarithmic funnel-coil (uniform turns, exponentially-decaying radius, climbing) instead of a flat comet"
    ]
  },
  {
    "version": "0.1.42",
    "date": "2026-06-28",
    "title": "3D depth + fixes",
    "summary": "Several flat systems gain real 3D dimensionality when you orbit, DLA is fixed so its dendrite is actually visible, and the About panel scrollbar sits flush at the edge.",
    "newSystems": [],
    "notes": [
      "Magnetic Reconnection: extruded into a 3D current-sheet slab — the X-point null becomes a glowing X-line (opt-in guide-field helix on the jets)",
      "Fractal Flame: the chaos game lifted to a true 3D attractor (face-on flame preserved)",
      "Spiral of Theodorus: a shallow radial dome adds depth while the rosette still reads face-on",
      "Decaying Spiral: a 3D corrugation lifts the coil out of the plane",
      "DLA fix: the dendrite is pre-grown (frontier-launch + kill-radius) and framed from above, so it's immediately visible instead of an edge-on smudge; runs on the CPU path",
      "About panel: the vertical scrollbar now sits flush at the modal edge (no gap)"
    ]
  },
  {
    "version": "0.1.41",
    "date": "2026-06-28",
    "title": "Magnetic Reconnection",
    "summary": "A new Plasma category opens with the magnetic-reconnection X-point — blue field lines rush in, gold plasma jets blast out, and a blazing white null marks where they snap and splice.",
    "newSystems": [
      "reconnection"
    ],
    "notes": [
      "New Plasma category: reconnection — the X-point saddle flow v = (−αx, +βy) (streamfunction ψ = αxy); every particle a closed-form tracer, baked blue-inflow / gold-jet / white-null populations, jetBoost sets the outflow:inflow asymmetry"
    ]
  },
  {
    "version": "0.1.40",
    "date": "2026-06-28",
    "title": "Spiral of Theodorus",
    "summary": "Theodorus of Cyrene's 2,400-year-old √n staircase of right triangles, drift-deformed and mirrored into a glowing rotationally-symmetric flower of nested zigzag petals.",
    "newSystems": [
      "theodorus"
    ],
    "notes": [
      "theodorus (Parametric): the √n spiral of right triangles (vertex n at radius √n, angle Σ atan(1/√k)), drift-twisted + replicated M-fold into a flower; tube-swept per arm, coloured along the spectrum"
    ]
  },
  {
    "version": "0.1.39",
    "date": "2026-06-28",
    "title": "Cosmic Web",
    "summary": "A new Cosmology category opens with the largest structure that exists — watch a near-uniform universe fold into voids, filaments, and blazing cluster nodes via the Zel'dovich approximation.",
    "newSystems": [
      "cosmicWeb"
    ],
    "notes": [
      "New Cosmology category: cosmicWeb — Zel'dovich-approximation large-scale structure; particles ride frozen trajectories x = q + D·ψ(q) from one seeded Gaussian field, tinted by overdensity δ = −∇·ψ (void → filament → node)"
    ]
  },
  {
    "version": "0.1.38",
    "date": "2026-06-28",
    "title": "Pseudospectrum",
    "summary": "A new Spectral category opens with the resolvent-norm landscape of a non-normal matrix — eigenvalue cones rising from broad continents of near-instability that the eigenvalues alone never reveal.",
    "newSystems": [
      "pseudospectrum"
    ],
    "notes": [
      "New Spectral category: pseudospectrum — the height field 1/σ_min(zI−A) over the complex plane, exact closed form for a 2×2 non-normal A; |g| controls non-normality, drift wanders the eigenvalues"
    ]
  },
  {
    "version": "0.1.37",
    "date": "2026-06-27",
    "title": "Octic Node Lattice",
    "summary": "A new procedural algebraic surface — quartic axis-wells fused by a nodal-coupling term into a crystalline cell lattice, cropped to a sphere.",
    "newSystems": [
      "octicLattice"
    ],
    "notes": [
      "octicLattice (Surface): the implicit surface QxQyQz − 0.028(x²−y²)(y²−z²)(z²−x²) − 0.012xyz = 0, sphere-traced"
    ]
  },
  {
    "version": "0.1.36",
    "date": "2026-06-27",
    "title": "Fractal Flame",
    "summary": "The chaos game gains nonlinear variations — fractal flames, the glowing organic cousins of the Barnsley fern, with a seed to explore the family and N-fold symmetry.",
    "newSystems": [
      "fractalFlame"
    ],
    "notes": [
      "fractalFlame (Fractal): IFS chaos game + nonlinear variations (swirl, sinusoidal, horseshoe…), seed-selected with rotational symmetry"
    ]
  },
  {
    "version": "0.1.35",
    "date": "2026-06-27",
    "title": "Circular Chladni + Orbit Weave",
    "summary": "A circular drumhead (Bessel vibration modes) joins the Field family, and a new Orbital category opens with collective trajectories in a central well.",
    "newSystems": [
      "drumhead",
      "orbitWeave"
    ],
    "notes": [
      "drumhead: vibrating circular membrane — the Jₘ(λr)·cos(mθ) Bessel eigenmodes, mode picked by (n,m)",
      "New Orbital category: orbitWeave — closed elliptical orbits in a central harmonic potential, woven with long trails"
    ]
  },
  {
    "version": "0.1.34",
    "date": "2026-06-27",
    "title": "Vortex Funnel",
    "summary": "A draining-whirlpool funnel joins the Fluid family — a rippled surface that steepens into a glowing spiralling throat.",
    "newSystems": [
      "vortexFunnel"
    ],
    "notes": [
      "New Fluid system: a Rankine-vortex free surface with differential swirl and travelling ripples"
    ]
  },
  {
    "version": "0.1.33",
    "date": "2026-06-27",
    "title": "Three new families + in-app discoverability",
    "summary": "Adds a decay spiral, Chladni plate waves, and a kaleidoscope tunnel, plus a new in-app way to browse the whole catalog and read what changed.",
    "newSystems": [
      "decaySpiral",
      "chladniWave",
      "kaleidoTunnel"
    ],
    "notes": [
      "New: in-app What's New popup, Browse-all gallery, and About panel (license + attributions + version history)",
      "decaySpiral joins Parametric; chladniWave joins Field; kaleidoTunnel starts the Kaleidoscope category"
    ]
  },
  {
    "version": "0.1.32",
    "date": "2026-06-27",
    "title": "Conformal maps, Molecular Dynamics, HMC sampler",
    "summary": "Three new system families: complex-plane conformal maps, a molecular-dynamics crystal, and a Hamiltonian Monte Carlo sampler.",
    "newSystems": [
      "mobiusFlow",
      "inversion",
      "zSquared",
      "complexExp",
      "joukowskiMap",
      "crystal",
      "hmc"
    ],
    "notes": [
      "New Conformal category (Mobius flow, inversion, z-squared, complex exp, Joukowski)",
      "New Matter category (crystal) and Sampler category (HMC)"
    ]
  },
  {
    "version": "0.1.31",
    "date": "2026-06-27",
    "title": "Voxel Cloud volumetrics",
    "summary": "Adds a Voxel Cloud rendered with opt-in front-to-back occlusion volumetrics.",
    "newSystems": [
      "voxelCloud"
    ],
    "notes": [
      "Opt-in front-to-back occlusion volumetric path in the Volume category"
    ]
  },
  {
    "version": "0.1.30",
    "date": "2026-06-27",
    "title": "Dynamical billiard",
    "summary": "Adds a dynamical billiard with bounded specular reflection, opening the new Billiard category.",
    "newSystems": [
      "billiard"
    ],
    "notes": [
      "New Billiard category with bounded specular reflection"
    ]
  },
  {
    "version": "0.1.29",
    "date": "2026-06-27",
    "title": "Plasma Orb + Nebula volumetrics",
    "summary": "Two volumetric-emission raymarched systems start the new Volume category.",
    "newSystems": [
      "plasmaOrb",
      "nebula"
    ],
    "notes": [
      "New Volume category using volumetric-emission raymarching"
    ]
  },
  {
    "version": "0.1.28",
    "date": "2026-06-26",
    "title": "Gravitationally-lensed black hole",
    "summary": "Adds a gravitationally-lensed black hole as the first system in the new Spacetime raymarch category.",
    "newSystems": [
      "blackhole"
    ],
    "notes": [
      "New Spacetime category (raymarched gravitational lensing)"
    ]
  },
  {
    "version": "0.1.27",
    "date": "2026-06-26",
    "title": "Harmonograph + spherical Lissajous",
    "summary": "Two new parametric systems: a harmonograph and a spherical Lissajous curve.",
    "newSystems": [
      "harmonograph",
      "sphericalLissajous"
    ],
    "notes": [
      "Both added to the Parametric category"
    ]
  },
  {
    "version": "0.1.26",
    "date": "2026-06-26",
    "title": "Pendulum wave, Duffing, magnetic pendulum, K-S",
    "summary": "Four new systems spanning oscillators, driven chaos, and a reaction-diffusion field.",
    "newSystems": [
      "pendulumWave",
      "duffing",
      "magnetic-pendulum",
      "kuramotoSivashinsky"
    ],
    "notes": [
      "pendulumWave (Oscillator), duffing + magnetic-pendulum (Attractor), kuramotoSivashinsky (Field)"
    ]
  },
  {
    "version": "0.1.25",
    "date": "2026-06-26",
    "title": "One-shot install in the hero",
    "summary": "Surfaces the one-shot install flow directly in the landing hero.",
    "newSystems": [],
    "notes": [
      "Hero CTA now exposes the one-shot install command"
    ]
  },
  {
    "version": "0.1.24",
    "date": "2026-06-26",
    "title": "One-shot install UX + trust pages",
    "summary": "Adds a one-shot install experience and accompanying trust/info pages.",
    "newSystems": [],
    "notes": [
      "One-shot install UX",
      "Trust pages"
    ]
  },
  {
    "version": "0.1.23",
    "date": "2026-06-25",
    "title": "Demo interval slider",
    "summary": "Adds a demo interval slider and a fixed-width icon badge.",
    "newSystems": [],
    "notes": [
      "Demo interval slider",
      "Fixed-width icon badge"
    ]
  },
  {
    "version": "0.1.21",
    "date": "2026-06-25",
    "title": "Guide-geometry overlays + demo history",
    "summary": "Adds a guide-geometry overlay hook and prev/next history navigation in demo mode.",
    "newSystems": [],
    "notes": [
      "Guide-geometry overlay (factory.guides hook)",
      "Demo prev/next history"
    ]
  },
  {
    "version": "0.1.20",
    "date": "2026-06-25",
    "title": "Demo interactions: HUD + knob keys",
    "summary": "Demo mode gains a HUD, primary-knob key controls, and a pause split.",
    "newSystems": [],
    "notes": [
      "Demo HUD",
      "Primary-knob keyboard controls",
      "Pause split"
    ]
  },
  {
    "version": "0.1.19",
    "date": "2026-06-25",
    "title": "Demo screensaver mode",
    "summary": "Adds a screensaver-style demo with a details overlay, pause, and a Cmd-D shortcut.",
    "newSystems": [],
    "notes": [
      "Demo details overlay",
      "Pause + Cmd-D toggle"
    ]
  },
  {
    "version": "0.1.18",
    "date": "2026-06-25",
    "title": "Teal/orange palette + full-screen demo",
    "summary": "New teal/orange color palette and a full-screen demo mode.",
    "newSystems": [],
    "notes": [
      "Teal/orange palette",
      "Full-screen demo mode"
    ]
  },
  {
    "version": "0.1.17",
    "date": "2026-06-25",
    "title": "GPU twins for 4D conservative flows",
    "summary": "Adds vec4 GPU-compute twins for the 4D conservative-chaos flows.",
    "newSystems": [],
    "notes": [
      "vec4 GPU-compute kernels for the 4D conservative flows"
    ]
  },
  {
    "version": "0.1.16",
    "date": "2026-06-25",
    "title": "Conservative-chaos systems + deep-link sharing",
    "summary": "Adds conservative/Hamiltonian chaos systems and shareable URL deep links.",
    "newSystems": [
      "double-pendulum",
      "henon-heiles",
      "einstein-rosen"
    ],
    "notes": [
      "URL deep-link sharing",
      "double-pendulum + henon-heiles (Attractor), einstein-rosen (Parametric)"
    ]
  },
  {
    "version": "0.1.14",
    "date": "2026-06-24",
    "title": "Arrow-key view panning",
    "summary": "Adds arrow-key camera panning without rotation.",
    "newSystems": [],
    "notes": [
      "Arrow-key view panning (no rotation)"
    ]
  },
  {
    "version": "0.1.13",
    "date": "2026-06-24",
    "title": "Hearts-only favourites",
    "summary": "Simplifies favouriting to hearts-only and clarifies the share fallback.",
    "newSystems": [],
    "notes": [
      "Hearts-only favourites",
      "Clearer share fallback"
    ]
  },
  {
    "version": "0.1.12",
    "date": "2026-06-24",
    "title": "Keyboard shortcuts, sharing, feedback",
    "summary": "Adds keyboard shortcuts, social share, report-a-problem, and thumbs feedback.",
    "newSystems": [],
    "notes": [
      "Keyboard shortcuts",
      "Social share",
      "Report-a-problem",
      "Thumbs up/down feedback"
    ]
  },
  {
    "version": "0.1.11",
    "date": "2026-06-24",
    "title": "Gray-Scott + command palette & demo mode",
    "summary": "Adds the Gray-Scott reaction-diffusion field along with a command palette, demo mode, and a code viewer.",
    "newSystems": [
      "grayScottField"
    ],
    "notes": [
      "Command palette (Cmd-K)",
      "Demo mode",
      "Code viewer",
      "grayScottField joins the Field category"
    ]
  },
  {
    "version": "0.1.10",
    "date": "2026-06-24",
    "title": "Catalog surge: surfaces, maps & attractors to 136",
    "summary": "Four big batches add dozens of algebraic/minimal surfaces and parametric forms, then 13 more strange attractors and 13 more iterated maps, bringing the catalog to 136 systems.",
    "newSystems": [
      "barth",
      "dini",
      "goursat",
      "harmonic",
      "heart",
      "lissajous",
      "sunflower",
      "tanglecube",
      "torusknot",
      "boy",
      "breather",
      "cayley",
      "clebsch",
      "enneper",
      "fischerKoch",
      "hopf",
      "kuen",
      "kummer",
      "maurerRose",
      "orbital",
      "roman",
      "schwarzCLP",
      "astroidalEllipsoid",
      "catalan",
      "catenoidHelicoid",
      "dingDong",
      "henneberg",
      "lidinoid",
      "scherk",
      "sievert",
      "superToroid",
      "togliatti",
      "tooth",
      "toroidalSpiral",
      "whitneyUmbrella",
      "bohemianDome",
      "bourSurface",
      "cassini",
      "conicalSpiral",
      "crossCap",
      "decocube",
      "dupinCyclide",
      "endrassOctic",
      "monkeySaddle",
      "orthocircle",
      "pluckerConoid",
      "sphericalSpiral",
      "supershape3D",
      "lu",
      "chen-lee",
      "newton-leipnik",
      "burke-shaw",
      "rikitake",
      "shimizu-morioka",
      "rucklidge",
      "genesio-tesi",
      "arneodo",
      "finance",
      "sprott-b",
      "hindmarsh-rose",
      "sakarya",
      "icon-sanddollar",
      "icon-trinity",
      "icon-pentagram",
      "icon-hexagon",
      "icon-heptagon",
      "icon-clamshell",
      "gingerbreadman",
      "standard",
      "duffing-map",
      "kings-dream",
      "sprott-quadratic",
      "zaslavsky",
      "martin"
    ],
    "notes": [
      "+9, then +13, +13, +13 Surface/Parametric systems (algebraic & minimal surfaces, knots, phyllotaxis, harmonics, TPMS, cyclides, supershapes, Endrass octic)",
      "+13 strange attractors (Lu, Rikitake dynamo, Hindmarsh-Rose, etc.)",
      "+13 iterated maps (Field-Golubitsky symmetric icons + classic maps)",
      "README system count updated 42 to 136"
    ]
  },
  {
    "version": "0.1.5",
    "date": "2026-06-23",
    "title": "Surface & Parametric categories debut",
    "summary": "Introduces implicit isosurfaces (new Surface category) and a Parametric category seeded with the Fibonacci sphere and classic parametric surfaces.",
    "newSystems": [
      "chmutov",
      "gyroid",
      "neovius",
      "schoenIWP",
      "schwarzD",
      "schwarzP",
      "fibonacci",
      "klein",
      "mobius",
      "seashell",
      "superformula",
      "torus"
    ],
    "notes": [
      "New Surface category (gyroid, Schwarz P/D, Schoen I-WP, Neovius, Chmutov octic)",
      "New Parametric category (Fibonacci sphere + classics)",
      "Screenshot export, version & camera telemetry"
    ]
  },
  {
    "version": "0.1.3",
    "date": "2026-06-23",
    "title": "Oscillator synchrony + Kármán CFD",
    "summary": "Adds the Kuramoto synchronisation model, chimera states, and the Kármán vortex street CFD solver.",
    "newSystems": [
      "kuramoto",
      "chimera",
      "karman"
    ],
    "notes": [
      "Kuramoto + chimera (Oscillator)",
      "Karman vortex street Lattice-Boltzmann solver (Fluid), CPU + GPU",
      "GPU compute on by default; 3D relief for escape-time fractals"
    ]
  },
  {
    "version": "0.1.2",
    "date": "2026-06-22",
    "title": "3D fractals + 42nd system",
    "summary": "Adds a sphere-traced 3D fractal suite and the Lozi map, rounding the early catalog to 42 systems.",
    "newSystems": [
      "mandelbox",
      "mandelbulb",
      "menger",
      "qjulia",
      "lozi"
    ],
    "notes": [
      "3D sphere-traced fractals (Mandelbulb, Quaternion Julia, Mandelbox, Menger)",
      "Lozi map (the 42nd system)",
      "Standalone scrollytelling demo page"
    ]
  },
  {
    "version": "0.1.1",
    "date": "2026-06-22",
    "title": "Fractals, Lenia, DLA + Learn panel",
    "summary": "Adds the Fractal category (IFS chaos-game and escape-time), continuous-CA Lenia, diffusion-limited aggregation, and an in-app Learn panel.",
    "newSystems": [
      "barnsley-fern",
      "dragon",
      "sierpinski",
      "sierpinski-carpet",
      "mandelbrot",
      "julia",
      "burning-ship",
      "lenia",
      "dla"
    ],
    "notes": [
      "New Fractal category: IFS chaos-game (Barnsley fern, Sierpinski, dragon, carpet) + escape-time (Mandelbrot, Julia, Burning Ship)",
      "Lenia continuous CA (Field)",
      "Diffusion-limited aggregation",
      "In-app Learn panel (About / Math / Code), CPU + GPU paths"
    ]
  },
  {
    "version": "0.1.0b",
    "date": "2026-06-22",
    "title": "Emergent agents, fields & fluids",
    "summary": "Adds the Life category (Particle Life, Boids, slime mold) plus excitable-medium spiral waves and point-vortex flow.",
    "newSystems": [
      "particleLife",
      "boids",
      "slimeMold",
      "excitableMedium",
      "pointVortices"
    ],
    "notes": [
      "New Life category (Particle Life, Boids, Physarum slime mold) on a spatial-hash neighbor grid",
      "Excitable-medium spiral waves (Field) + point-vortex flow (Fluid)",
      "GPU compute kernels for maps, Life, Fluid and Field systems"
    ]
  },
  {
    "version": "0.1.0",
    "date": "2026-06-22",
    "title": "Initial release + catalog to 27",
    "summary": "First public build of ETHERSIM (the dynamical-systems visualizer) with four core archetypes, expanded the same day to 27 systems across attractor flows and iterated maps.",
    "newSystems": [
      "lorenz",
      "rossler",
      "aizawa",
      "thomas",
      "hyperOscillator",
      "nbody",
      "quantumFoam",
      "clifford",
      "de-jong",
      "svensson",
      "hopalong",
      "gumowski-mira",
      "tinkerbell",
      "ikeda",
      "henon",
      "bedhead",
      "pickover",
      "halvorsen",
      "chen",
      "dadras",
      "lorenz84",
      "rabinovich-fabrikant",
      "sprott-linz-f",
      "wang-four-wing",
      "bouali",
      "nose-hoover",
      "chua"
    ],
    "notes": [
      "Initial WebGPU engine: hyper-oscillator, N-body, quantum-foam, and strange-attractor archetypes (worker/SAB sim, fading trails, GPU-compute path, Lyapunov gate)",
      "Rename AETHER-SIM to ETHERSIM",
      "Expanded catalog to 27 systems: +10 attractor flows and +10 iterated maps",
      "GPU compute kernels for all 10 maps + restored GPU for all attractors"
    ]
  }
];

// The current/top release — what the "What's New" popup highlights by default.
export const LATEST_RELEASE: Release = RELEASES[0];
