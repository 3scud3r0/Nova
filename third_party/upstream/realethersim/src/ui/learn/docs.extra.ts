import type { SystemDoc } from './content';

// Curated learn-panel content for additional emergent systems (Lenia, DLA).
export const EXTRA_DOCS: Record<string, SystemDoc> = {
  'henon-heiles': {
    title: 'Hénon–Heiles',
    about:
      'In 1964 Michel Hénon and Carl Heiles asked whether a star orbiting in a galaxy conserves a third quantity beyond its energy and angular momentum. Their toy potential — a harmonic well with a cubic distortion that gives it three-fold symmetry — became one of the cleanest windows into *conservative* chaos. Unlike a strange attractor nothing dissipates: energy is exactly conserved and the motion fills a constant-energy surface. Below the escape energy E = 1/6 the orbits split into two coexisting worlds — orderly KAM tori and a chaotic sea — the shape chaos takes before it looks fully random.',
    howItWorks:
      'A particle moves in the potential V(x,y) = ½(x²+y²) + λ(x²y − ⅓y³). Hamilton’s equations turn the energy H into four coupled first-order ODEs for position (x,y) and momentum (px,py), integrated with RK4 across an ensemble of ~100k slightly different starting points. The equipotential V = 1/6 forms a triangle with three saddle channels; seed energies stay below it so every orbit remains bound. We render (x, y, px) — a 3-D slice of the 4-D phase space.',
    equations: [
      { label: 'Hamiltonian (energy)', latex: 'H = \\tfrac12(p_x^2+p_y^2) + \\tfrac12(x^2+y^2) + \\lambda\\,(x^2 y - \\tfrac13 y^3)' },
      { label: 'position', latex: '\\dot x = p_x, \\qquad \\dot y = p_y' },
      { label: 'momentum', latex: '\\dot p_x = -x - 2\\lambda x y, \\qquad \\dot p_y = -y - \\lambda(x^2 - y^2)' },
      { label: 'escape energy (λ=1)', latex: 'E_{\\text{esc}} = \\tfrac16' },
    ],
    params: [
      { key: 'lambda', symbol: '\\lambda', meaning: 'strength of the cubic (anharmonic) coupling; λ=1 is the classic case with escape energy 1/6' },
    ],
    code: `// H = ½(px²+py²) + ½(x²+y²) + λ(x²y − ⅓y³)
dx  = px;
dy  = py;
dpx = -x - 2*lambda*x*y;
dpy = -y - lambda*(x*x - y*y);`,
    links: [
      { label: 'Hénon–Heiles system (Wikipedia)', url: 'https://en.wikipedia.org/wiki/H%C3%A9non%E2%80%93Heiles_system' },
      { label: 'KAM theorem (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Kolmogorov%E2%80%93Arnold%E2%80%93Moser_theorem' },
    ],
  },
  'double-pendulum': {
    title: 'Double Pendulum',
    about:
      'A pendulum hanging from a pendulum — two rigid arms, one joint, gravity. It is the most famous demonstration of deterministic chaos: the equations are exact and reversible, yet two pendulums released from almost the same angle diverge into completely different motions within seconds. Here ~100k pendulums start from a tight cloud of nearly identical angles; watch it explode apart as sensitive dependence on initial conditions takes over. Like Hénon–Heiles it is conservative — energy is preserved, so the motion never settles onto an attractor.',
    howItWorks:
      'The state is four numbers: the two arm angles (θ1,θ2) and their angular velocities (ω1,ω2). The coupled Euler–Lagrange equations (equal masses and lengths) give the angular accelerations; RK4 advances every pendulum each frame. Because an arm can swing over the top, the raw angles grow without bound — so instead of plotting angles we render the lower bob’s actual Cartesian position (x₂,y₂), which always stays within reach, using the upper arm’s x as depth.',
    equations: [
      { label: 'angles evolve by their velocities', latex: '\\dot\\theta_1=\\omega_1,\\qquad \\dot\\theta_2=\\omega_2' },
      { label: 'angular acceleration · arm 1 (m=l=1, Δ=θ₁−θ₂)', latex: '\\dot\\omega_1 = \\frac{-3g\\sin\\theta_1 - g\\sin(\\theta_1-2\\theta_2) - 2\\sin\\Delta\\,(\\omega_2^2+\\omega_1^2\\cos\\Delta)}{3-\\cos 2\\Delta}' },
      { label: 'angular acceleration · arm 2', latex: '\\dot\\omega_2 = \\frac{2\\sin\\Delta\\,(2\\omega_1^2 + 2g\\cos\\theta_1 + \\omega_2^2\\cos\\Delta)}{3-\\cos 2\\Delta}' },
      { label: 'lower bob (rendered position, not an ODE)', latex: 'x_2=\\sin\\theta_1+\\sin\\theta_2,\\quad y_2=-\\cos\\theta_1-\\cos\\theta_2' },
    ],
    params: [
      { key: 'g', symbol: 'g', meaning: 'gravitational strength; sets the swing rate and how energetic (chaotic) the motion is' },
    ],
    code: `// equal masses & lengths; Δ = θ1 − θ2, den = 3 − cos(2Δ)
dω1 = (-3*g*sin(θ1) - g*sin(θ1-2θ2) - 2*sin(Δ)*(ω2² + ω1²*cos(Δ))) / den;
dω2 = ( 2*sin(Δ)*(2*ω1² + 2*g*cos(θ1) + ω2²*cos(Δ)) ) / den;`,
    links: [
      { label: 'Double pendulum (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Double_pendulum' },
      { label: 'Chaos theory (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Chaos_theory' },
    ],
  },
  pendulumWave: {
    title: 'Pendulum Wave',
    about:
      'The "pendulum snake" — a row of uncoupled pendulums whose lengths are tuned so that, in one fixed cycle, the longest completes a set number of swings and each shorter neighbour does exactly one more. Released together from a straight line they drift out of step into a travelling wave, tangle into what looks like chaos, then — because every period divides the cycle evenly — snap back into perfect alignment. It is the opposite of chaos: fully deterministic and exactly periodic, yet mesmerising. A staple science-museum demo (famously at Harvard).',
    howItWorks:
      'Each pendulum is an independent simple-harmonic oscillator with its own angular frequency ωᵢ = 2π(baseOsc + i)/T. No integrator is needed — the motion is the closed form θᵢ(t) = A·cos(ωᵢ t), which can never drift or blow up. Because every ωᵢ·T is an exact integer multiple of 2π, all phases realign every T seconds. We render the pendulums as hanging strings that swing in depth (z), so the travelling wave reads as a curtain rippling across the row.',
    equations: [
      { label: 'per-pendulum frequency (index i sets it)', latex: '\\omega_i = \\dfrac{2\\pi\\,(\\text{baseOsc} + i)}{T}' },
      { label: 'closed-form motion (no integration)', latex: '\\theta_i(t) = A\\,\\cos(\\omega_i\\,t)' },
      { label: 'exact re-synchronisation every cycle', latex: '\\omega_i\\,T = 2\\pi\\,(\\text{baseOsc}+i) \\in 2\\pi\\,\\mathbb{Z}' },
    ],
    params: [
      { key: 'baseOsc', symbol: 'n_0', meaning: 'swings the longest (first) pendulum makes per cycle; each successive one does +1' },
      { key: 'cycleTime', symbol: 'T', meaning: 'seconds for the whole row to drift apart and re-synchronise' },
      { key: 'amplitude', symbol: 'A', meaning: 'swing amplitude (radians)' },
    ],
    code: `// each pendulum i has its own frequency from its index
omega_i = 2*Math.PI * (baseOsc + i) / cycleTime;
phase_i = (phase_i + omega_i * dt) % (2*Math.PI);
theta_i = amplitude * Math.cos(phase_i);   // exact SHM`,
    links: [
      { label: 'Pendulum wave (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Pendulum_wave' },
      { label: 'Simple harmonic motion (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Simple_harmonic_motion' },
    ],
  },
  duffing: {
    title: 'Duffing (forced)',
    about:
      'A mass sitting in a double-well potential, gently damped and shaken by a periodic force — the textbook example of how a simple nonlinear oscillator slides into chaos. For the right drive, the particle hops between the two wells in a sequence that never repeats: tiny differences in starting point grow exponentially (a positive Lyapunov exponent). Strobe the motion once per drive cycle and the scattered points trace a fractal strange attractor.',
    howItWorks:
      'The driven equation ẍ + δẋ − x + x³ = γcos(ωt) is made autonomous by carrying the drive phase φ = ωt as a third variable, giving three first-order ODEs for (x, v, φ) integrated with RK4 across ~100k starting points. The cubic −x + x³ is the double well; δ damps; γ and ω set the forcing. The phase φ grows without bound, so for display it is wrapped to [−π, π) — the attractor folds neatly onto a phase cylinder.',
    equations: [
      { label: 'forced Duffing oscillator (double well)', latex: '\\ddot x + \\delta\\dot x - x + x^3 = \\gamma\\cos(\\omega t)' },
      { label: 'autonomous first-order form', latex: '\\dot x = v,\\quad \\dot v = -\\delta v + x - x^3 + \\gamma\\cos\\varphi,\\quad \\dot\\varphi = \\omega' },
      { label: 'drive phase wrapped for display', latex: '\\varphi \\;\\to\\; ((\\varphi \\bmod 2\\pi) + 2\\pi)\\bmod 2\\pi - \\pi' },
    ],
    params: [
      { key: 'delta', symbol: '\\delta', meaning: 'damping; small values let chaos persist, large values settle to a cycle' },
      { key: 'gamma', symbol: '\\gamma', meaning: 'drive amplitude; the main knob that pushes the system into chaos' },
      { key: 'omega', symbol: '\\omega', meaning: 'drive frequency' },
    ],
    code: `// state [x, v, φ];  φ = ωt carried so the system is autonomous
dx = v;
dv = -delta*v + x - x*x*x + gamma*Math.cos(phi);
dphi = omega;`,
    links: [
      { label: 'Duffing equation (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Duffing_equation' },
      { label: 'Strange attractor (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Attractor#Strange_attractor' },
    ],
  },
  'magnetic-pendulum': {
    title: 'Magnetic Pendulum',
    about:
      'An iron bob swings on a string above three magnets set at the corners of a triangle. Eventually friction parks it over one magnet — but which one depends so exquisitely on where it started that the map of "starting point → final magnet" is a fractal, with the three colours interwoven down to infinitely fine scales. Release a whole disc of ~100k bobs and watch them stream and settle into the three basins.',
    howItWorks:
      'Newton’s second law in the plane: a central spring-like pull toward the origin, linear friction, and an attraction to each magnet softened by a length h that removes the 1/r² blow-up at close range. The state is the bob’s position and velocity (x, y, vₓ, v_y), advanced with RK4. We render (x, y, |v|): the basin plane with speed as height, so fast bobs ride high and settling ones sink onto the magnet sites (drawn as rings).',
    equations: [
      { label: 'planar equation of motion', latex: '\\ddot{\\mathbf r} = -k\\,\\mathbf r - c\\,\\dot{\\mathbf r} + \\sum_{j=1}^{3} \\frac{s\\,(\\mathbf m_j - \\mathbf r)}{\\big(|\\mathbf m_j - \\mathbf r|^2 + h^2\\big)^{3/2}}' },
      { label: 'magnets on a unit triangle', latex: '\\mathbf m_j = \\big(\\cos\\theta_j,\\ \\sin\\theta_j\\big),\\quad \\theta_j = \\tfrac{\\pi}{2},\\ -\\tfrac{\\pi}{6},\\ \\tfrac{7\\pi}{6}' },
    ],
    params: [
      { key: 'k', symbol: 'k', meaning: 'central restoring strength (the “gravity” pulling the bob back to centre)' },
      { key: 'c', symbol: 'c', meaning: 'friction; higher values settle the bobs faster' },
      { key: 'h', symbol: 'h', meaning: 'magnet softening length — smooths the pull at close range (kept ≥ 0.12 for stability)' },
      { key: 'strength', symbol: 's', meaning: 'magnet strength' },
    ],
    code: `// softened pull toward each magnet (no 1/r² singularity)
let ax = -k*px - c*vx, ay = -k*py - c*vy;
for (const [mx,my] of magnets) {
  const dx=mx-px, dy=my-py, r2=dx*dx+dy*dy+h*h;
  const inv = strength / (r2*Math.sqrt(r2));   // = s / r2^1.5
  ax += dx*inv;  ay += dy*inv;
}`,
    links: [
      { label: 'Magnetic pendulum & fractal basins', url: 'https://en.wikipedia.org/wiki/Magnetic_pendulum' },
      { label: 'Basin of attraction (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Attractor#Basins_of_attraction' },
    ],
  },
  kuramotoSivashinsky: {
    title: 'Kuramoto–Sivashinsky',
    about:
      'One of the simplest equations that turns order into turbulence all by itself. Born from models of flame fronts and thin liquid films, it balances an instability that pumps energy into long, lazy waves against a strong damping that crushes short, sharp ones; the nonlinearity then shuffles energy between scales. The result is never-repeating, cell-like spatiotemporal chaos. Shown here as a scrolling space–time plot — each new row of the field slides toward you over time.',
    howItWorks:
      'The field u(x,t) on a periodic domain of length L obeys uₜ = −u·uₓ − uₓₓ − uₓₓₓₓ. The −uₓₓ term is anti-diffusion (it grows long waves); −uₓₓₓₓ is hyper-diffusion (it kills short ones). It is solved in Fourier space with ETDRK2: the stiff linear operator λ(k) = k² − k⁴ is integrated *exactly* via the integrating factor e^{λΔt}, so the fourth-derivative term doesn’t force an impossibly small timestep. Space is the x-axis, time is the depth axis, and the field height drives both the relief and the colour.',
    equations: [
      { label: 'Kuramoto–Sivashinsky equation', latex: 'u_t = -\\,u\\,u_x - u_{xx} - u_{xxxx}' },
      { label: 'linear operator in Fourier space (per wavenumber k)', latex: '\\lambda(k) = k^2 - k^4' },
      { label: 'exact linear step (integrating factor)', latex: '\\hat u \\;\\to\\; e^{\\lambda \\Delta t}\\,\\hat u \\;+\\; (\\text{nonlinear correction})' },
    ],
    params: [
      { key: 'domainL', symbol: 'L', meaning: 'domain length; chaos sets in around L ≈ 22 and grows richer (more cells) as L increases' },
      { key: 'relief', symbol: 'h_y', meaning: 'vertical scale of the rendered height field (cosmetic)' },
      { key: 'spaceN', symbol: 'N', meaning: 'spatial / spectral resolution (grid points)' },
      { key: 'timeM', symbol: 'M', meaning: 'rows of time history kept in the scrolling plot' },
    ],
    code: `// spectral ETDRK2: linear part λ=k²−k⁴ solved exactly
const lam = k*k - k*k*k*k;          // per wavenumber
E = Math.exp(lam*dt);               // exact linear factor
// nonlinear term  −½·∂ₓ(u²)  in spectral space = −½·i·k·FFT(u²)
// û_{n+1} = E·û + Q·N(û) + (N(a)−N(û))·f2   (Cox–Matthews)`,
    links: [
      { label: 'Kuramoto–Sivashinsky equation (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Kuramoto%E2%80%93Sivashinsky_equation' },
      { label: 'Exponential time differencing (Kassam & Trefethen)', url: 'https://people.maths.ox.ac.uk/trefethen/publication/PDF/2005_111.pdf' },
    ],
  },
  'einstein-rosen': {
    title: 'Einstein–Rosen Bridge',
    about:
      'In 1935 Einstein and Rosen rewrote the Schwarzschild solution — the geometry around a spherical mass — and found it describes two universes joined by a "bridge": a non-traversable wormhole. This is the picture of spacetime as a stretched rubber sheet, made precise. It is Flamm’s paraboloid: the curved 2-D space around a black hole, lifted into 3-D so its curvature is visible. The narrow waist is the throat (the horizon at r = 2M); the two flaring funnels are the two asymptotically flat sheets.',
    howItWorks:
      'Take the equatorial slice of the Schwarzschild metric at a frozen instant and ask which surface of revolution in flat 3-D has the same intrinsic geometry. The answer has height z(r) = √(8M(r − 2M)) for r ≥ 2M; reflecting it and gluing the two copies at the throat gives the full bridge. We sample by embedding height h rather than radius r (so the throat, where the surface turns vertical, stays smooth): r = 2M + h²/(8M), then sweep the angle φ around. A static surface — drag the mass and reach to reshape it.',
    equations: [
      { label: 'embedding height (Flamm’s paraboloid)', latex: 'z(r) = \\sqrt{8M\\,(r - 2M)}, \\qquad r \\ge 2M' },
      { label: 'radius at embedding height h (= z, sampled directly)', latex: 'r = 2M + \\frac{h^2}{8M}' },
      { label: 'surface of revolution', latex: '(x,\\,y,\\,z) = (r\\cos\\varphi,\\; h,\\; r\\sin\\varphi)' },
    ],
    params: [
      { key: 'mass', symbol: 'M', meaning: 'black-hole mass; sets the throat radius (2M) and how sharply the funnels flare' },
      { key: 'reach', symbol: 'h_{\\max}', meaning: 'how far each sheet extends from the throat' },
    ],
    code: `// Flamm's paraboloid, parametrized by embedding height h (both sheets):
const h   = (a*2 - 1) * reach;     // −reach … +reach
const r   = 2*M + (h*h) / (8*M);   // throat radius 2M
const phi = b * 2*Math.PI;
x = r*Math.cos(phi);  y = h;  z = r*Math.sin(phi);`,
    links: [
      { label: 'Einstein–Rosen bridge (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Einstein%E2%80%93Rosen_bridge' },
      { label: 'Schwarzschild metric (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Schwarzschild_metric' },
    ],
  },
  grayScottField: {
    title: 'Gray-Scott (Turing)',
    about:
      'The Gray-Scott reaction-diffusion system is the canonical model of Alan Turing’s 1952 idea that two chemicals diffusing and reacting can spontaneously break symmetry into stable patterns — the mechanism behind leopard spots, fish stripes, and seashell markings. Two substances U and V spread across a grid at different speeds while V autocatalyses (U + 2V → 3V) and decays. Sweeping just two numbers, the feed rate f and kill rate k, walks through Pearson’s whole zoo: solitons, spots, stripes, mazes, coral growth, and self-replicating "mitosis" cells.',
    howItWorks:
      'Each cell holds concentrations U and V. Every tick they diffuse (a 9-point Laplacian averages each cell toward its neighbours) at rates D_u and D_v, V is produced by the cubic reaction U·V² and removed at rate f+k, and U is fed back toward 1 at rate f. Because V diffuses slower than U, local peaks of V are reinforced while their surroundings are depleted — the short-range-activation / long-range-inhibition that Turing showed makes patterns. V drives the relief height and colour; the grid is toroidal so patterns wrap seamlessly.',
    equations: [
      { label: 'U (slow feed)', latex: '\\dot{U} = D_u\\nabla^2 U - U V^2 + f\\,(1 - U)' },
      { label: 'V (autocatalytic)', latex: '\\dot{V} = D_v\\nabla^2 V + U V^2 - (f + k)\\,V' },
      { label: '9-point Laplacian', latex: '\\nabla^2\\!\\approx 0.2\\!\\sum_{\\text{edge}} + 0.05\\!\\sum_{\\text{diag}} - 1' },
    ],
    params: [
      { key: 'feed', symbol: 'f', meaning: 'feed rate replenishing U; with k it selects the pattern (Pearson classification)' },
      { key: 'kill', symbol: 'k', meaning: 'removal rate of V; f≈k≈0.06 gives coral/mitosis, lower k gives spots & worms' },
      { key: 'diffU', symbol: 'D_u', meaning: 'diffusion rate of U (the fast inhibitor)' },
      { key: 'diffV', symbol: 'D_v', meaning: 'diffusion rate of V (the slow activator) — D_v < D_u is what enables patterns' },
      { key: 'relief', symbol: 'h', meaning: 'how far V displaces the grid into 3D relief' },
    ],
    code: `// per cell, 9-point Laplacian on a toroidal grid
const uvv = u*v*v;
uNext = u + (Du*lapU - uvv + f*(1 - u));
vNext = v + (Dv*lapV + uvv - (f + k)*v);`,
    links: [
      { label: 'Reaction–diffusion (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Reaction%E2%80%93diffusion_system' },
      { label: 'Turing pattern (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Turing_pattern' },
      { label: 'Pearson, Complex Patterns in a Simple System (1993)', url: 'https://www.science.org/doi/10.1126/science.261.5118.189' },
      { label: 'Karl Sims — Reaction-Diffusion tutorial', url: 'https://www.karlsims.com/rd.html' },
    ],
  },
  lenia: {
    title: 'Lenia',
    about:
      'Lenia generalises Conway’s Game of Life to a continuous world: smooth space, smooth time, and smooth states in [0,1] instead of on/off cells. From this continuity emerge astonishingly lifelike "creatures" — gliders, rotors, and self-repairing cells that swim and interact. Discovered by Bert Chan in 2019.',
    howItWorks:
      'Each step the field is convolved with a smooth ring-shaped kernel to measure each cell’s local neighbourhood density U; a bell-shaped growth function then grows cells where U is near μ and decays them otherwise. A [0,1] clamp keeps it bounded.',
    equations: [
      { label: 'neighbourhood potential (ring-kernel convolution)', latex: 'U = K * A' },
      { label: 'growth function (bell centred at μ)', latex: 'G(U) = 2\\,\\exp\\!\\left(-\\frac{(U-\\mu)^2}{2\\sigma^2}\\right) - 1' },
      { label: 'update (clamped to [0,1])', latex: 'A_{t+\\Delta t} = \\mathrm{clip}_{[0,1]}\\bigl(A + \\Delta t\\,G(U)\\bigr)' },
    ],
    params: [
      { key: 'mu', symbol: '\\mu', meaning: 'the neighbourhood density that cells thrive at (growth peak)' },
      { key: 'sigma', symbol: '\\sigma', meaning: 'how tolerant growth is — narrow σ = pickier, sharper creatures' },
      { key: 'rate', symbol: '\\Delta t', meaning: 'time step; how fast the field updates each tick' },
      { key: 'radius', symbol: 'R', meaning: 'kernel radius — the size of a cell’s neighbourhood (and its creatures)' },
    ],
    code: `// U = convolution of the field with a normalized ring kernel (peak at R/2)
// then grow toward density μ:
G = 2 * Math.exp(-0.5 * ((U - mu) / sigma) ** 2) - 1;
A = clamp(A + rate * G, 0, 1);`,
    links: [
      { label: 'Lenia (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Lenia' },
      { label: 'Chan 2019, Lenia — Biology of Artificial Life', url: 'https://arxiv.org/abs/1812.05433' },
    ],
  },
  dla: {
    title: 'Diffusion-Limited Aggregation',
    about:
      'DLA models growth by random diffusion: particles wander randomly until they bump into a growing cluster, then stick permanently. From a single seed this builds a branching, self-similar dendrite — the same process behind coral, frost on a window, lightning, mineral veins, and electrodeposition. The result is a fractal with dimension ≈ 1.71.',
    howItWorks:
      'Many walkers random-walk across the grid; whenever a walker lands next to the cluster it freezes there (with probability "stickiness"), then a fresh walker is released. Lower stickiness lets walkers penetrate deeper, giving denser, bushier growth.',
    equations: [
      { label: 'fractal mass–radius scaling (D ≈ 1.71 in 2D)', latex: 'N(R) \\sim R^{D}, \\qquad D \\approx 1.71' },
    ],
    params: [
      { key: 'stickiness', symbol: 'p', meaning: 'probability a walker freezes on contact — lower = denser, bushier clusters' },
      { key: 'walkers', symbol: 'M', meaning: 'number of simultaneous random walkers (growth speed)' },
    ],
    code: `// per walker: random-walk one cell; if any of the 8 neighbours is stuck, freeze:
if (anyNeighbourStuck && random() < stickiness) {
  grid[cell] = 1;     // join the cluster
  respawn(walker);    // release a fresh walker
} else {
  walker += randomStep();
}`,
    links: [
      { label: 'Diffusion-limited aggregation (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Diffusion-limited_aggregation' },
      { label: 'Witten & Sander 1981 (original paper)', url: 'https://journals.aps.org/prl/abstract/10.1103/PhysRevLett.47.1400' },
    ],
  },
  kuramoto: {
    title: 'Kuramoto Synchronisation',
    about:
      'Why do fireflies flash in unison, metronomes on a table drift into lockstep, and the cells of ' +
      'a heart beat together? Yoshiki Kuramoto’s 1975 model is the answer: a population of oscillators, ' +
      'each ticking at its own natural frequency, nudging one another through their average. Below a ' +
      'critical coupling they ignore each other and drift; past it, order erupts spontaneously and they ' +
      'snap into sync. Crank K up and watch the cylinder zip shut.',
    howItWorks:
      'Each oscillator i has a phase θᵢ and a fixed natural frequency ωᵢ (drawn here from a bell curve). ' +
      'Instead of every pair pulling on every other pair, all the pulling is summed into one global ' +
      '"mean field" — the order parameter r·e^{iψ}, the centroid of all the phases on the unit circle. ' +
      'r runs from 0 (total disorder) to 1 (perfect sync). Each oscillator is then pulled toward the ' +
      'mean phase with strength K·r. We map phase to angle around a cylinder and natural frequency to ' +
      'height, so the slow/fast wings keep drifting while the middle locks.',
    equations: [
      { label: 'oscillator dynamics', latex: '\\dot{\\theta_i} = \\omega_i + \\frac{K}{N}\\sum_{j} \\sin(\\theta_j - \\theta_i)' },
      { label: 'order parameter (mean field)', latex: 'r\\,e^{i\\psi} = \\frac{1}{N}\\sum_{j} e^{i\\theta_j}' },
      { label: 'mean-field form (what we integrate)', latex: '\\dot{\\theta_i} = \\omega_i + K\\,r\\,\\sin(\\psi - \\theta_i)' },
    ],
    params: [
      { key: 'coupling', symbol: 'K', meaning: 'coupling strength — the master knob; cross the critical value and sync erupts' },
      { key: 'omega0', symbol: '\\omega_0', meaning: 'mean natural frequency — how fast the synced cluster rotates' },
      { key: 'spread', symbol: '\\sigma', meaning: 'spread of natural frequencies — more disorder needs more coupling to sync' },
    ],
    code: `// global mean field over all oscillators (no all-pairs loop):
let mc = 0, ms = 0;
for (const t of theta) { mc += Math.cos(t); ms += Math.sin(t); }
mc /= N; ms /= N;                       // order parameter (cos, sin)
// each oscillator is pulled toward the mean phase:
for (let i = 0; i < N; i++) {
  const omega = omega0 + spread * g[i];           // its natural frequency
  const dtheta = omega + K * (ms * Math.cos(theta[i]) - mc * Math.sin(theta[i]));
  theta[i] += dtheta * dt;
}`,
    links: [
      { label: 'Kuramoto model (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Kuramoto_model' },
      { label: 'Strogatz — From Kuramoto to Crawford (2000)', url: 'https://www.sciencedirect.com/science/article/abs/pii/S0167278900000944' },
      { label: 'Steven Strogatz — Sync (TED talk)', url: 'https://www.ted.com/talks/steven_strogatz_the_science_of_sync' },
    ],
  },
  chimera: {
    title: 'Chimera States',
    about:
      'A chimera state is dynamical-systems heresy: take a ring of identical oscillators, couple them ' +
      'all in exactly the same way, and — instead of all syncing or all drifting — the ring ' +
      'spontaneously splits into a synchronised arc living right next to an incoherent, chaotic arc. ' +
      'Order and disorder coexisting on a perfectly symmetric ring. Discovered by Kuramoto & ' +
      'Battogtokh in 2002 and named (after the mythological part-lion-part-serpent) by Abrams & ' +
      'Strogatz in 2004; later seen in real chemical, mechanical, and optical experiments.',
    howItWorks:
      'Identical oscillators sit on a ring and couple NONLOCALLY — each feels its neighbours through a ' +
      'broad cosine kernel — with a phase lag α just under π/2. From a localized random kick the ring ' +
      'breaks symmetry: one arc locks into a smooth phase profile while the other never settles. The ' +
      'cosine kernel lets the nonlocal sum collapse into six global order-parameter sums, so it runs ' +
      'O(N). We draw a ring "crown" — angle = position, height = sin θ — so the coherent arc is a ' +
      'smooth band and the incoherent arc is jagged.',
    equations: [
      {
        label: 'nonlocal coupling on the ring',
        latex: '\\dot{\\theta_i} = \\omega - \\frac{1}{N}\\sum_{j} G(x_i - x_j)\\,\\sin(\\theta_i - \\theta_j + \\alpha)',
      },
      { label: 'cosine coupling kernel', latex: 'G(x) = 1 + A\\cos x' },
      { label: 'chimera regime', latex: '\\alpha \\lesssim \\tfrac{\\pi}{2}, \\qquad A > 0' },
    ],
    params: [
      { key: 'alpha', symbol: '\\alpha', meaning: 'phase lag (frustration); chimeras live just below π/2' },
      { key: 'kernelA', symbol: 'A', meaning: 'kernel anisotropy — how nonlocal/contrasted the coupling is' },
      { key: 'coupling', symbol: 'K', meaning: 'overall coupling strength' },
    ],
    code: `// cosine kernel ⇒ six global sums, so the nonlocal coupling is O(N):
let Sc=0,Ss=0, Scc=0,Scs=0, Ssc=0,Sss=0;
for (let j=0;j<N;j++){ const c=cos(th[j]),s=sin(th[j]);
  Sc+=c; Ss+=s; Scc+=cosx[j]*c; Scs+=cosx[j]*s; Ssc+=sinx[j]*c; Sss+=sinx[j]*s; }
// each oscillator integrates against the shared sums:
const termC = Sc/N + A*cosx[i]*Scc/N + A*sinx[i]*Ssc/N;
const termS = Ss/N + A*cosx[i]*Scs/N + A*sinx[i]*Sss/N;
const Ci = sin(th[i]+alpha)*termC - cos(th[i]+alpha)*termS;
th[i] -= K * Ci * dt;`,
    links: [
      { label: 'Chimera states (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Chimera_state' },
      { label: 'Abrams & Strogatz 2004 — Chimera states for coupled oscillators', url: 'https://journals.aps.org/prl/abstract/10.1103/PhysRevLett.93.174102' },
      { label: 'Kuramoto & Battogtokh 2002 (original)', url: 'https://www.j-npcs.org/abstracts/vol2002/v5no4/v5no4p380.html' },
    ],
  },
  karman: {
    title: 'Kármán Vortex Street',
    about:
      'Drive a steady flow past a blunt body — a bridge pier, a chimney, a cylinder — and above a ' +
      'critical speed the wake stops being steady: it sheds vortices alternately from each side, ' +
      'spinning in opposite directions, in a beautifully periodic double row. Théodore von Kármán ' +
      'explained its stability in 1911. It’s why flags flutter, power lines "sing", and why the ' +
      'Tacoma Narrows bridge tore itself apart.',
    howItWorks:
      'This is real CFD: a Lattice-Boltzmann solver (D2Q9). Instead of tracking velocity directly it ' +
      'evolves nine particle-population densities per cell — collide them toward local equilibrium, ' +
      'stream them to neighbours, bounce them off the cylinder — and the Navier–Stokes flow emerges. ' +
      'We colour each cell by its vorticity (the local spin), so the shed vortices light up red and ' +
      'blue. Drag Reynolds up and the wake transitions from steady, to gently waving, to full shedding.',
    equations: [
      { label: 'lattice Boltzmann (BGK collision + streaming)', latex: 'f_i(\\mathbf{x}+\\mathbf{e}_i, t+1) = f_i - \\tfrac{1}{\\tau}\\,(f_i - f_i^{\\,eq})' },
      { label: 'equilibrium distribution', latex: 'f_i^{\\,eq} = w_i\\,\\rho\\left[1 + 3(\\mathbf{e}_i\\!\\cdot\\!\\mathbf{u}) + \\tfrac{9}{2}(\\mathbf{e}_i\\!\\cdot\\!\\mathbf{u})^2 - \\tfrac{3}{2}|\\mathbf{u}|^2\\right]' },
      { label: 'Reynolds & Strouhal numbers', latex: '\\mathrm{Re} = \\frac{U D}{\\nu}, \\qquad \\mathrm{St} = \\frac{f D}{U} \\approx 0.2' },
      { label: 'viscosity ↔ relaxation time', latex: '\\nu = \\tfrac{1}{3}\\left(\\tau - \\tfrac{1}{2}\\right)' },
    ],
    params: [
      { key: 'reynolds', symbol: '\\mathrm{Re}', meaning: 'Reynolds number = inertia/viscosity; raise it to push from steady flow into vortex shedding' },
      { key: 'speed', symbol: 'U', meaning: 'inflow speed (lattice units); sets how fast vortices shed and travel' },
    ],
    code: `// D2Q9 lattice Boltzmann, per cell, per step:
// 1) macroscopic moments
rho = sum(f);  ux = sum(f*ex)/rho;  uy = sum(f*ey)/rho;
// 2) collide toward equilibrium (BGK), τ from Reynolds
for (i=0;i<9;i++) f[i] += (feq(i, rho, ux, uy) - f[i]) / tau;
// 3) stream to neighbours; bounce back off the cylinder + walls
fnew[c][i] = isSolid(c - e_i) ? f[c][opp[i]] : f[c - e_i][i];
// colour by vorticity ω = ∂uy/∂x − ∂ux/∂y  → red / blue`,
    links: [
      { label: 'Kármán vortex street (Wikipedia)', url: 'https://en.wikipedia.org/wiki/K%C3%A1rm%C3%A1n_vortex_street' },
      { label: 'Lattice Boltzmann methods (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Lattice_Boltzmann_methods' },
    ],
  },
  lozi: {
    title: 'Lozi Map',
    about:
      'A piecewise-linear cousin of the Hénon map: swap the x² term for |x|. That sharp absolute value turns the smooth Hénon curve into an attractor built from straight segments — and made the Lozi map one of the first strange attractors proven rigorously to be chaotic.',
    howItWorks: 'A single 2D point is fed through the map a hundred thousand times; it settles onto the angular, self-similar attractor.',
    equations: [{ label: '', latex: '\\begin{aligned} x_{n+1} &= 1 - a\\,|x_n| + y_n \\\\ y_{n+1} &= b\\,x_n \\end{aligned}' }],
    params: [
      { key: 'a', symbol: 'a', meaning: 'fold strength (the |x| coefficient); ~1.7 is chaotic' },
      { key: 'b', symbol: 'b', meaning: 'how much of x carries into y (area contraction)' },
    ],
    code: `o[0] = 1 - p.a * Math.abs(x[0]) + x[1];
o[1] = p.b * x[0];`,
    links: [{ label: 'Lozi map (Wikipedia)', url: 'https://en.wikipedia.org/wiki/L%C3%B4zi_map' }],
  },
  "lu": {
    "title": "Lü Attractor",
    "about": "The Lü system is a chaotic flow introduced by Jinhu Lü and Guanrong Chen in 2002 as the 'critical' bridge connecting the Lorenz and Chen attractors within a unified family of three-dimensional quadratic systems. Sitting at the transition between the two, it produces a striking double-scroll butterfly whose two lobes the trajectory weaves between unpredictably. It arose from control-theory research into how a single parameter can morph one canonical chaotic system continuously into another, and it has since become a standard testbed for chaos synchronization and secure-communication schemes.",
    "howItWorks": "Three coupled quadratic ODEs drive each particle. The first equation is a linear diffusive coupling pulling x toward y at rate a. The nonlinear cross-terms x*z and x*y inject the stretching-and-folding that makes the flow chaotic, while c and b set the rotation/decay of the y and z modes. The cloud of initial conditions collapses onto a thin two-lobed manifold; sensitive dependence (largest Lyapunov exponent ≈ 1.4) then smears nearby points apart, so the ensemble traces the full double-scroll. Integrated with RK4 at dt = 0.004.",
    "equations": [
      {
        "label": "dx/dt",
        "latex": "\\dot{x} = a\\,(y - x)"
      },
      {
        "label": "dy/dt",
        "latex": "\\dot{y} = c\\,y - x\\,z"
      },
      {
        "label": "dz/dt",
        "latex": "\\dot{z} = x\\,y - b\\,z"
      }
    ],
    "params": [
      {
        "key": "a",
        "symbol": "a",
        "meaning": "Diffusive coupling rate pulling x toward y (canonical 36)."
      },
      {
        "key": "b",
        "symbol": "b",
        "meaning": "Linear damping of the z mode (canonical 3)."
      },
      {
        "key": "c",
        "symbol": "c",
        "meaning": "Self-gain of the y mode; the bridge parameter tuning between Lorenz- and Chen-like regimes (canonical 20)."
      }
    ],
    "code": "function deriv(o, x, p) {\n  o[0] = p.a * (x[1] - x[0]);\n  o[1] = p.c * x[1] - x[0] * x[2];\n  o[2] = x[0] * x[1] - p.b * x[2];\n}",
    "links": [
      {
        "label": "Wikipedia: Multiscroll attractor (Lu)",
        "url": "https://en.wikipedia.org/wiki/Multiscroll_attractor"
      },
      {
        "label": "Lü & Chen, A New Chaotic Attractor Coined (2002)",
        "url": "https://doi.org/10.1142/S0218127402004620"
      },
      {
        "label": "Sprott: Chaos and Time-Series Analysis",
        "url": "http://sprott.physics.wisc.edu/chaos/"
      }
    ]
  },
  "chen-lee": {
    "title": "Chen-Lee Attractor",
    "about": "The Chen-Lee system was derived in 2003 by Hsien-Keng Chen and Ching-I Lee as the equations of motion for a rigid body rotating about its center of mass with a feedback torque — essentially a chaotic gyroscope. It is the Euler rigid-body system augmented with linear damping/forcing terms, and for the right gains the spinning body never settles into steady rotation but tumbles forever along a butterfly-like manifold. Because it models real angular momentum dynamics, it has been used to study chaotic motion in mechanical gyros and as a testbed for chaos synchronization and secure communication.",
    "howItWorks": "Each axis carries a linear self-term (a, b, c) plus the quadratic cross-coupling of a rotating rigid body: the -y*z, +x*z, and +x*y/3 terms are the Euler gyroscopic torques that exchange angular momentum between axes. With a=5 (expansion), b=-10 (strong damping) and c=-0.38 (weak damping) the flow stretches along x and y while contracting in z, folding the trajectory back on itself to produce a bounded chaotic set. Particles seeded near (1,1,1) spread across a two-lobed manifold roughly 30 units wide in x and centered at z about 9.25.",
    "equations": [
      {
        "label": "dx/dt",
        "latex": "\\dot{x} = a\\,x - y\\,z"
      },
      {
        "label": "dy/dt",
        "latex": "\\dot{y} = b\\,y + x\\,z"
      },
      {
        "label": "dz/dt",
        "latex": "\\dot{z} = c\\,z + \\dfrac{x\\,y}{3}"
      }
    ],
    "params": [
      {
        "key": "a",
        "symbol": "a",
        "meaning": "Expansion gain on the x (first principal) axis; positive, stretches the flow."
      },
      {
        "key": "b",
        "symbol": "b",
        "meaning": "Damping on the y axis; strongly negative, contracts angular momentum."
      },
      {
        "key": "c",
        "symbol": "c",
        "meaning": "Weak damping on the z axis; slightly negative, sets the vertical thickness of the attractor."
      }
    ],
    "code": "function deriv([x, y, z], { a, b, c }) {\n  return [\n    a * x - y * z,\n    b * y + x * z,\n    c * z + (x * y) / 3,\n  ];\n}\n// a = 5, b = -10, c = -0.38",
    "links": [
      {
        "label": "Sprott — Chaotic Flows",
        "url": "http://sprott.physics.wisc.edu/chaos/chaos.htm"
      },
      {
        "label": "Chen & Lee (2004), Chaos Solitons Fractals",
        "url": "https://doi.org/10.1016/S0960-0779(03)00237-X"
      },
      {
        "label": "Wikipedia — List of chaotic maps",
        "url": "https://en.wikipedia.org/wiki/List_of_chaotic_maps"
      }
    ]
  },
  "newton-leipnik": {
    "title": "Newton–Leipnik attractor",
    "about": "The Newton–Leipnik system models a rigid body in free rotation under linear feedback control — essentially Euler's equations for a spinning body with a feedback torque added. Introduced by R. B. Leipnik and T. A. Newton in 1981 while studying the attractors that arise when classical mechanics meets control theory, it is famous for displaying two coexisting strange attractors shaped like a pair of folded, interleaving disks. Depending on initial conditions a trajectory settles onto one disk or the other, making it a textbook example of multistability.",
    "howItWorks": "The three equations are the angular-momentum (Euler) equations of a rotating rigid body, with the bilinear gyroscopic couplings (the 10*y*z, 5*x*z and -5*x*y terms) and linear feedback damping (-a*x, -0.4*y, +b*z). The small positive b feeds a little energy back along z while the cross terms continually fold the flow, so the trajectory never settles: it stretches and folds onto a thin chaotic sheet. The motion is bounded but never repeats, and the largest Lyapunov exponent is positive, the signature of deterministic chaos.",
    "equations": [
      {
        "label": "dx/dt",
        "latex": "\\dot{x} = -a\\,x + y + 10\\,y\\,z"
      },
      {
        "label": "dy/dt",
        "latex": "\\dot{y} = -x - 0.4\\,y + 5\\,x\\,z"
      },
      {
        "label": "dz/dt",
        "latex": "\\dot{z} = b\\,z - 5\\,x\\,y"
      }
    ],
    "params": [
      {
        "key": "a",
        "symbol": "a",
        "meaning": "Linear damping on the x angular-momentum component (canonical 0.4)."
      },
      {
        "key": "b",
        "symbol": "b",
        "meaning": "Linear feedback gain on the z component; small and positive (canonical 0.175) to sustain chaos."
      }
    ],
    "code": "function deriv(o, x, p) {\n  o[0] = -p.a * x[0] + x[1] + 10 * x[1] * x[2];\n  o[1] = -x[0] - 0.4 * x[1] + 5 * x[0] * x[2];\n  o[2] = p.b * x[2] - 5 * x[0] * x[1];\n}",
    "links": [
      {
        "label": "Wikipedia: Newton–Leipnik system",
        "url": "https://en.wikipedia.org/wiki/Newton%E2%80%93Leipnik_system"
      },
      {
        "label": "Wolfram MathWorld: Newton-Leipnik Equations",
        "url": "https://mathworld.wolfram.com/Newton-LeipnikEquations.html"
      }
    ]
  },
  "burke-shaw": {
    "title": "Burke-Shaw Attractor",
    "about": "The Burke-Shaw system is a tightly wound chaotic flow introduced by Bill Burke and Robert Shaw in the early 1980s as a variant of the Lorenz equations rescaled for a single coupling constant. Its trajectory winds into a symmetric, twisted double-spiral torus, two interlocked horns of thread that the path crosses between unpredictably. The flow is invariant under the reflection (x, y, z) -> (-x, -y, z), giving the attractor its mirror-symmetric, knotted appearance. With s = 10 and v = 4.272 it is a textbook strange attractor: bounded, aperiodic, and sensitively dependent on initial conditions.",
    "howItWorks": "A single coupling constant s links the three coordinates: x and y are pulled toward each other and damped, while the bilinear terms s*x*z and s*x*y feed energy back through the z channel, offset by a constant forcing v. The competition between linear damping and the nonlinear cross-coupling never settles, so nearby trajectories diverge exponentially (positive Lyapunov exponent) while remaining trapped in a compact region. Integrating the ODE with RK4 and seeding a cloud of initial conditions collapses that cloud onto the twisted toroidal manifold.",
    "equations": [
      {
        "label": "dx/dt",
        "latex": "\\dot{x} = -s\\,(x + y)"
      },
      {
        "label": "dy/dt",
        "latex": "\\dot{y} = -y - s\\,x\\,z"
      },
      {
        "label": "dz/dt",
        "latex": "\\dot{z} = s\\,x\\,y + v"
      }
    ],
    "params": [
      {
        "key": "s",
        "symbol": "s",
        "meaning": "Coupling/damping constant; sets the strength of the linear pull and the bilinear cross-terms. Canonical value 10."
      },
      {
        "key": "v",
        "symbol": "v",
        "meaning": "Constant forcing on the z equation; tunes the vertical drive that sustains chaos. Canonical value 4.272."
      }
    ],
    "code": "function deriv(o, x, p) {\n  o[0] = -p.s * (x[0] + x[1]);\n  o[1] = -x[1] - p.s * x[0] * x[2];\n  o[2] = p.s * x[0] * x[1] + p.v;\n}",
    "links": [
      {
        "label": "Wikipedia: List of chaotic maps",
        "url": "https://en.wikipedia.org/wiki/List_of_chaotic_maps"
      },
      {
        "label": "Sprott — Chaos and Time-Series Analysis",
        "url": "http://sprott.physics.wisc.edu/chaos/comchaos.htm"
      },
      {
        "label": "3D-Meier: Burke-Shaw attractor",
        "url": "http://www.3d-meier.de/tut19/Seite35.html"
      }
    ]
  },
  "rikitake": {
    "title": "Rikitake Dynamo",
    "about": "The Rikitake two-disk dynamo is a coupled pair of Faraday disk generators wired so each disk's current feeds the other's field coil, proposed by Tsuneji Rikitake in 1958 as the simplest mechanical analogue of Earth's self-exciting geodynamo. Its three-dimensional flow spontaneously and irregularly reverses the sign of the disk currents, mimicking the unpredictable polarity reversals recorded in the geomagnetic field. The state wanders chaotically between two lobes of opposite magnetic polarity, never settling into a periodic rhythm of flips. It remains a textbook caricature of why the planet's magnetic north has flipped hundreds of times over geologic history.",
    "howItWorks": "Two homopolar disk dynamos share their currents (x and y) and a common rotation-rate difference (z). Each current is linearly damped by mechanical friction (-mu*x, -mu*y) but driven by the product of the other disk's field and the shaft speed; the speed z is forced by a constant applied torque (the +1 term) and braked by the Lorenz-like coupling -x*y. The competition between steady forcing and nonlinear back-reaction prevents any fixed equilibrium or clean limit cycle, so the trajectory chaotically swaps between the two current-polarity lobes — the model's geomagnetic 'reversals.'",
    "equations": [
      {
        "label": "disk current 1",
        "latex": "\\dot{x} = -\\mu\\,x + z\\,y"
      },
      {
        "label": "disk current 2",
        "latex": "\\dot{y} = -\\mu\\,y + (z - a)\\,x"
      },
      {
        "label": "shaft speed",
        "latex": "\\dot{z} = 1 - x\\,y"
      }
    ],
    "params": [
      {
        "key": "mu",
        "symbol": "\\mu",
        "meaning": "Mechanical/ohmic damping of both disk currents; larger mu suppresses the dynamo."
      },
      {
        "key": "a",
        "symbol": "a",
        "meaning": "Asymmetry / coupling offset between the two disks that breaks their symmetry and sets the reversal regime."
      }
    ],
    "code": "function deriv(o, x, p) {\n  o[0] = -p.mu * x[0] + x[2] * x[1];\n  o[1] = -p.mu * x[1] + (x[2] - p.a) * x[0];\n  o[2] = 1 - x[0] * x[1];\n}",
    "links": [
      {
        "label": "Wikipedia: Rikitake system",
        "url": "https://en.wikipedia.org/wiki/Rikitake_system"
      },
      {
        "label": "Sprott — Chaotic Dynamics",
        "url": "https://sprott.physics.wisc.edu/chaos/abstracts/rikitake.htm"
      },
      {
        "label": "Rikitake (1958), Math. Proc. Camb. Phil. Soc.",
        "url": "https://doi.org/10.1017/S0305004100033223"
      }
    ]
  },
  "shimizu-morioka": {
    "title": "Shimizu–Morioka attractor",
    "about": "A deceptively simple three-equation system introduced by Tatsuya Shimizu and Naomichi Morioka in 1980 to capture the essential geometry of the Lorenz attractor near the onset of chaos. It arises as a normal-form reduction describing the dynamics of the Lorenz system at large Rayleigh number, stripping the original convection model down to its symmetric butterfly skeleton. The flow is invariant under the reflection (x,y,z)→(−x,−y,z), so its two lobes are mirror images — a compact Lorenz-like butterfly. It is a touchstone in bifurcation theory for studying how a Lorenz attractor is born and destroyed.",
    "howItWorks": "The first equation makes y the velocity of x, so the (x,y) pair behaves like a damped oscillator whose stiffness is modulated by z through the x·(1−z) term. The variable z is driven up by x² (a nonlinear feedback that grows whenever the trajectory swings wide) and relaxed back by the linear −b·z damping. When a trajectory gains energy and z rises past 1, the effective spring force flips sign and ejects the orbit toward the opposite lobe; the symmetry of the equations means it can land on either wing, and the sensitive switching between them is the source of the chaos.",
    "equations": [
      {
        "label": "dx/dt",
        "latex": "\\dot{x} = y"
      },
      {
        "label": "dy/dt",
        "latex": "\\dot{y} = x(1 - z) - a\\,y"
      },
      {
        "label": "dz/dt",
        "latex": "\\dot{z} = -b\\,z + x^{2}"
      }
    ],
    "params": [
      {
        "key": "a",
        "symbol": "a",
        "meaning": "Damping of the x–y oscillator; smaller a sustains larger swings. Chaotic at a≈0.75."
      },
      {
        "key": "b",
        "symbol": "b",
        "meaning": "Relaxation rate of z back toward zero; sets how quickly the energy feedback decays. Chaotic at b≈0.45."
      }
    ],
    "code": "function deriv(o, x, p) {\n  o[0] = x[1];\n  o[1] = x[0] * (1 - x[2]) - p.a * x[1];\n  o[2] = -p.b * x[2] + x[0] * x[0];\n}",
    "links": [
      {
        "label": "Wikipedia — Multiscroll / Lorenz-like attractors",
        "url": "https://en.wikipedia.org/wiki/Multiscroll_attractor"
      },
      {
        "label": "Sprott — Chaotic flows",
        "url": "https://sprott.physics.wisc.edu/chaos/comchaos.htm"
      },
      {
        "label": "Shimizu–Morioka system (Scholarpedia, Shilnikov)",
        "url": "http://www.scholarpedia.org/article/Shimizu-Morioka_system"
      }
    ]
  },
  "rucklidge": {
    "title": "Rucklidge Attractor",
    "about": "In 1992 the applied mathematician Alastair Rucklidge derived this three-variable system as a model of thermal convection in a fluid layer that conducts electricity and sits in an imposed vertical magnetic field. The magnetic field and a constraint of zero net horizontal flow suppress most modes, leaving a compact set of equations whose single quadratic feedback term still drives the convection rolls into chaos. The result is a graceful butterfly-like manifold, kin to Lorenz, that wanders unpredictably between two lobes without ever exactly repeating.",
    "howItWorks": "The state (x, y, z) tracks the amplitudes of the dominant convection mode, its rate of change, and a measure of how much the rolls distort the temperature profile. The linear terms damp x and z while the parameter a pumps energy in through y; the nonlinear couplings -y*z and y*y bend the flow so trajectories never settle, looping around two unstable foci. Integrated with RK4 at dt=0.01, a cloud of initial conditions collapses onto the thin chaotic sheet within a few thousand steps.",
    "equations": [
      {
        "label": "dx/dt",
        "latex": "\\dot{x} = -k\\,x + a\\,y - y\\,z"
      },
      {
        "label": "dy/dt",
        "latex": "\\dot{y} = x"
      },
      {
        "label": "dz/dt",
        "latex": "\\dot{z} = -z + y^{2}"
      }
    ],
    "params": [
      {
        "key": "k",
        "symbol": "k",
        "meaning": "Linear damping of the convection amplitude x (canonical k = 2)."
      },
      {
        "key": "a",
        "symbol": "a",
        "meaning": "Driving / forcing strength feeding energy through y; sets the chaos onset (canonical a = 6.7)."
      }
    ],
    "code": "function deriv(s, p) {\n  const [x, y, z] = s;\n  return [\n    -p.k * x + p.a * y - y * z,\n    x,\n    -z + y * y,\n  ];\n}",
    "links": [
      {
        "label": "Wikipedia: Rucklidge attractor (Multiscroll/list of chaotic maps)",
        "url": "https://en.wikipedia.org/wiki/List_of_chaotic_maps"
      },
      {
        "label": "Rucklidge, J. Fluid Mech. 237 (1992): Chaos in magnetoconvection",
        "url": "https://doi.org/10.1017/S0022112092003392"
      },
      {
        "label": "Sprott — Chaotic Systems gallery",
        "url": "http://sprott.physics.wisc.edu/sa.htm"
      }
    ]
  },
  "genesio-tesi": {
    "title": "Genesio–Tesi Attractor",
    "about": "The Genesio–Tesi system is a third-order autonomous jerk attractor introduced in 1992 by Roberto Genesio and Alberto Tesi as a deliberately simple testbed for studying the onset of chaos via the harmonic-balance method. Stripped down to a single scalar jerk equation with one quadratic nonlinearity, it shows how an unremarkable cubic feedback loop — position, velocity, acceleration — can spiral into deterministic chaos. Because its three feedback gains map directly onto the coefficients of a characteristic polynomial, it became a favorite reference model in control theory for predicting and stabilizing chaotic behavior.",
    "howItWorks": "The system is a 'jerk' form: x is position, y = ẋ is velocity, and z = ẏ is acceleration, so ż is the jerk (the time-derivative of acceleration). The jerk is a linear combination of the three states with gains c, b, a, plus a single quadratic term x². The quadratic term creates a second fixed point and folds trajectories back on themselves; the linear gains keep the flow bounded but dissipative, so the cloud of initial conditions collapses onto a thin, scroll-like manifold while remaining sensitive to initial conditions.",
    "equations": [
      {
        "label": "ẋ",
        "latex": "\\dot{x} = y"
      },
      {
        "label": "ẏ",
        "latex": "\\dot{y} = z"
      },
      {
        "label": "ż",
        "latex": "\\dot{z} = -c\\,x - b\\,y - a\\,z + x^{2}"
      }
    ],
    "params": [
      {
        "key": "a",
        "symbol": "a",
        "meaning": "Damping gain on acceleration z (jerk feedback); near 0.44 the dissipation is weak enough to sustain chaos."
      },
      {
        "key": "b",
        "symbol": "b",
        "meaning": "Gain on velocity y; together with a and c it sets the characteristic polynomial whose Routh–Hurwitz balance governs the chaotic onset."
      },
      {
        "key": "c",
        "symbol": "c",
        "meaning": "Gain on position x; controls the spacing of the two fixed points at x=0 and x=c."
      }
    ],
    "code": "function deriv(o, x, p) {\n  o[0] = x[1];\n  o[1] = x[2];\n  o[2] = -p.c * x[0] - p.b * x[1] - p.a * x[2] + x[0] * x[0];\n}",
    "links": [
      {
        "label": "Sprott — Chaotic Flows (jerk systems)",
        "url": "http://sprott.physics.wisc.edu/chaos/abschaos.htm"
      },
      {
        "label": "Genesio & Tesi 1992 (Automatica) — harmonic balance & chaos",
        "url": "https://doi.org/10.1016/0005-1098(92)90177-H"
      },
      {
        "label": "Wikipedia — Jerk (physics): chaotic jerk systems",
        "url": "https://en.wikipedia.org/wiki/Jerk_(physics)#Chaotic_jerk_systems"
      }
    ]
  },
  "arneodo": {
    "title": "Arneodo Attractor",
    "about": "The Arneodo attractor is a third-order \"jerk\" system — a single nonlinear differential equation in the third derivative of position — introduced by Alain Arneodo, Pierre Coullet and Charles Tresser in the early 1980s while studying how simple smooth flows give birth to chaos through cascades of period-doubling bifurcations. Its only nonlinearity is a cubic term, making it one of the algebraically simplest dissipative systems known to exhibit a strange attractor. The flow folds the trajectory back on itself around two symmetric wings, weaving a delicate ribboned structure that is symmetric under reflection through the origin.",
    "howItWorks": "The state is a position x and its first two time-derivatives (velocity y and acceleration z), so the system is literally one scalar jerk equation rewritten as three first-order ODEs. The linear terms a·x, −b·y and −z set up an unstable oscillation, while the cubic −x³ acts as a soft restoring force that bends large excursions back toward the center. The competition between linear expansion and cubic confinement stretches and folds the flow, producing sensitive dependence on initial conditions (largest Lyapunov exponent ≈ 0.23) and a bounded two-lobed chaotic set.",
    "equations": [
      {
        "label": "x'",
        "latex": "\\dot{x} = y"
      },
      {
        "label": "y'",
        "latex": "\\dot{y} = z"
      },
      {
        "label": "z'",
        "latex": "\\dot{z} = a\\,x - b\\,y - z - x^{3}"
      }
    ],
    "params": [
      {
        "key": "a",
        "symbol": "a",
        "meaning": "Linear restoring/expansion gain on x; at a≈5.5 the origin is a saddle-focus and the flow becomes chaotic."
      },
      {
        "key": "b",
        "symbol": "b",
        "meaning": "Linear damping coupling on the velocity term y; near b≈3.5 it balances folding against dissipation to sustain the strange attractor."
      }
    ],
    "code": "function deriv(o, x, p) {\n  o[0] = x[1];                       // x' = y\n  o[1] = x[2];                       // y' = z\n  o[2] = p.a * x[0]                  // z' = a*x - b*y - z - x^3\n       - p.b * x[1]\n       - x[2]\n       - x[0] * x[0] * x[0];\n}",
    "links": [
      {
        "label": "Arneodo–Coullet–Tresser (Wikipedia: List of chaotic maps / jerk systems)",
        "url": "https://en.wikipedia.org/wiki/Multiscroll_attractor"
      },
      {
        "label": "Sprott — Chaotic Flows (jerk systems)",
        "url": "http://sprott.physics.wisc.edu/chaos/comchaos.htm"
      },
      {
        "label": "Jerk system (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Jerk_(physics)#Jerk_systems_in_chaos_theory"
      }
    ]
  },
  "finance": {
    "title": "Finance",
    "about": "The Finance attractor is a three-dimensional chaotic system distilled from a model of a small macroeconomic economy, where the state variables track the interest rate, the investment demand, and the price index. Introduced by Chinese economists Ma and Chen around 2001 in their study of nonlinear dynamics in economic systems, it captures how the interplay of savings, investment, and pricing can produce irregular, never-repeating booms and busts even with fixed policy parameters. Its butterfly-like double-scroll shape is a vivid reminder that endogenous chaos, not just external shocks, can drive market unpredictability.",
    "howItWorks": "Each particle is a tiny economy whose three coordinates (interest rate x, investment demand y, price index z) evolve under coupled feedback. The quadratic terms x*x couple price pressure to interest rates and create the saturation that folds trajectories back, while the linear damping (b*y, c*z) prevents runaway growth. The cloud of 100k initial conditions collapses onto a thin chaotic manifold and is integrated forward with RK4; nearby economies diverge exponentially (positive Lyapunov exponent ~0.09), so the long-run path is deterministic yet practically unpredictable.",
    "equations": [
      {
        "label": "interest rate",
        "latex": "\\dot{x} = z + (y - a)\\,x"
      },
      {
        "label": "investment demand",
        "latex": "\\dot{y} = 1 - b\\,y - x^{2}"
      },
      {
        "label": "price index",
        "latex": "\\dot{z} = -x - c\\,z"
      }
    ],
    "params": [
      {
        "key": "a",
        "symbol": "a",
        "meaning": "Saving amount / interest-rate self-feedback (canonical 0.001)"
      },
      {
        "key": "b",
        "symbol": "b",
        "meaning": "Per-unit investment cost / investment damping (canonical 0.2)"
      },
      {
        "key": "c",
        "symbol": "c",
        "meaning": "Elasticity of demand of commercial markets / price-index damping (canonical 1.1)"
      }
    ],
    "code": "function deriv([x, y, z], { a, b, c }) {\n  return [\n    z + (y - a) * x,   // interest rate\n    1 - b * y - x * x, // investment demand\n    -x - c * z,        // price index\n  ];\n}",
    "links": [
      {
        "label": "Sprott — Chaotic Systems list",
        "url": "http://sprott.physics.wisc.edu/chaos/"
      },
      {
        "label": "Ma & Chen finance chaos model (Wikipedia: List of chaotic maps / flows)",
        "url": "https://en.wikipedia.org/wiki/List_of_chaotic_maps"
      },
      {
        "label": "MathWorld — Strange Attractor",
        "url": "https://mathworld.wolfram.com/StrangeAttractor.html"
      }
    ]
  },
  "sprott-b": {
    "title": "Sprott B",
    "about": "In 1994, physicist Julien C. Sprott ran an algebraic search for the simplest possible chaotic flows, hunting for three-dimensional systems with the fewest terms that still produce strange attractors. Case B was one of the nineteen minimal systems he catalogued: just five terms and a single quadratic cross-coupling, yet it folds and stretches phase space into a butterfly-like chaotic set. With no free parameters, its chaos is intrinsic to the algebra rather than tuned in. It is a textbook example that elegant chaos needs almost nothing.",
    "howItWorks": "The flow couples the three coordinates through two quadratic products. The z-velocity is driven by a constant forcing of 1 minus the product x*y, which injects energy and bends trajectories back on themselves; the y-equation is a simple linear relaxation of x toward y; and the x-velocity is the product y*z, which mixes the other two axes. This combination of constant forcing, linear damping, and quadratic mixing stretches nearby trajectories apart (positive Lyapunov exponent) while folding them back into a bounded region, the signature of a strange attractor.",
    "equations": [
      {
        "label": "dx/dt",
        "latex": "\\dot{x} = y\\,z"
      },
      {
        "label": "dy/dt",
        "latex": "\\dot{y} = x - y"
      },
      {
        "label": "dz/dt",
        "latex": "\\dot{z} = 1 - x\\,y"
      }
    ],
    "params": [
      {
        "key": "s",
        "symbol": "s",
        "meaning": "Uniform time-rate scaling of the whole vector field (identity at s=1); s>1 speeds the flow, s<1 slows it, leaving the attractor geometry unchanged."
      }
    ],
    "code": "function deriv(o, x, p) {\n  o[0] = p.s * (x[1] * x[2]);      // dx = y*z\n  o[1] = p.s * (x[0] - x[1]);      // dy = x - y\n  o[2] = p.s * (1 - x[0] * x[1]);  // dz = 1 - x*y\n}",
    "links": [
      {
        "label": "Sprott — Simplest Dissipative Chaotic Flow",
        "url": "https://sprott.physics.wisc.edu/pubs/paper207.pdf"
      },
      {
        "label": "Sprott chaotic flows (collection)",
        "url": "https://sprott.physics.wisc.edu/chaos/comchaos.htm"
      },
      {
        "label": "Wikipedia — Attractor",
        "url": "https://en.wikipedia.org/wiki/Attractor"
      }
    ]
  },
  "hindmarsh-rose": {
    "title": "Hindmarsh–Rose",
    "about": "The Hindmarsh–Rose system is a phenomenological model of a single spiking-bursting neuron, devised by James Hindmarsh and Malcolm Rose in 1984 to reproduce the rhythmic firing patterns seen in mollusc neurons. A fast voltage-recovery subsystem (x, y) generates rapid action-potential spikes while a slow adaptation current (z) modulates them, gating the neuron between quiescence and dense bursts. For canonical parameters and external drive I=3.2 the slow feedback never settles, so the spike trains repeat aperiodically on a folded chaotic manifold.",
    "howItWorks": "x is the membrane potential, y a fast recovery (spiking) variable, and z a slow adaptation current. The cubic -a·x³ + b·x² term gives the fast x–y loop its excitable, self-resetting spike. Because r is tiny (0.006), z drifts slowly: it rises during a burst, eventually suppressing spiking, then decays to release the next burst. The mismatch in timescales between the fast spikes and the slow gate makes the burst lengths and timings chaotic, tracing a thin sheet that is wide in x and y but very shallow in z.",
    "equations": [
      {
        "label": "membrane potential",
        "latex": "\\dot{x} = y - a x^3 + b x^2 - z + I"
      },
      {
        "label": "fast recovery",
        "latex": "\\dot{y} = c - d x^2 - y"
      },
      {
        "label": "slow adaptation",
        "latex": "\\dot{z} = r\\,(s\\,(x - x_r) - z)"
      }
    ],
    "params": [
      {
        "key": "a",
        "symbol": "a",
        "meaning": "cubic gain of the fast spike (sets spike sharpness)"
      },
      {
        "key": "b",
        "symbol": "b",
        "meaning": "quadratic gain of the fast spike"
      },
      {
        "key": "c",
        "symbol": "c",
        "meaning": "baseline of the recovery variable y"
      },
      {
        "key": "d",
        "symbol": "d",
        "meaning": "quadratic damping of recovery y"
      },
      {
        "key": "s",
        "symbol": "s",
        "meaning": "coupling strength of x into the slow current z"
      },
      {
        "key": "xr",
        "symbol": "x_r",
        "meaning": "resting potential the adaptation current references"
      },
      {
        "key": "r",
        "symbol": "r",
        "meaning": "slow-timescale rate (small => long bursts)"
      },
      {
        "key": "I",
        "symbol": "I",
        "meaning": "external injected current / drive"
      }
    ],
    "code": "function deriv(o, x, p) {\n  o[0] = x[1] - p.a*x[0]**3 + p.b*x[0]**2 - x[2] + p.I;\n  o[1] = p.c - p.d*x[0]**2 - x[1];\n  o[2] = p.r * (p.s*(x[0] - p.xr) - x[2]);\n}",
    "links": [
      {
        "label": "Wikipedia: Hindmarsh–Rose model",
        "url": "https://en.wikipedia.org/wiki/Hindmarsh%E2%80%93Rose_model"
      },
      {
        "label": "Scholarpedia: Hindmarsh-Rose model",
        "url": "http://www.scholarpedia.org/article/Hindmarsh-Rose_model"
      }
    ]
  },
  "sakarya": {
    "title": "Sakarya Attractor",
    "about": "The Sakarya system is a two-wing chaotic flow introduced in 2010 by Turkish researchers (named for the Sakarya region/university), proposed as a simple three-dimensional autonomous system whose quadratic cross-coupling produces a butterfly-like double-scroll attractor. Each of its three equations couples a different pair of state variables multiplicatively, so the trajectory is repeatedly folded and stretched between two lobes. Like the Lorenz and Chen systems it has been studied as a candidate for chaos-based secure communication and pseudo-random generation. Its largest Lyapunov exponent is solidly positive, giving the hallmark sensitive dependence on initial conditions.",
    "howItWorks": "Three first-order ODEs evolve a single point in phase space. Linear damping terms (-x, -y, +z) set the local contraction/expansion, while the bilinear terms y*z, a*x*z and -b*x*y inject the nonlinear folding that bends the flow back on itself instead of letting it escape. The net volume contracts on average (the divergence of the field is -1, dissipative), yet nearby trajectories diverge exponentially, so the orbit settles onto a fractal two-wing set rather than a point or a closed loop. We integrate with classical RK4 at dt=0.01; an ensemble of initial conditions all collapse onto the same attractor manifold.",
    "equations": [
      {
        "label": "dx/dt",
        "latex": "\\dot{x} = -x + y + yz"
      },
      {
        "label": "dy/dt",
        "latex": "\\dot{y} = -x - y + a\\,xz"
      },
      {
        "label": "dz/dt",
        "latex": "\\dot{z} = z - b\\,xy"
      }
    ],
    "params": [
      {
        "key": "a",
        "symbol": "a",
        "meaning": "Strength of the x·z coupling feeding the y-equation; canonical 0.4. Drives the asymmetric stretching between the two wings."
      },
      {
        "key": "b",
        "symbol": "b",
        "meaning": "Strength of the x·y feedback damping z; canonical 0.3. Controls the folding that closes the orbit back onto the attractor."
      }
    ],
    "code": "function deriv(o, x, p) {\n  o[0] = -x[0] + x[1] + x[1] * x[2];\n  o[1] = -x[0] - x[1] + p.a * x[0] * x[2];\n  o[2] = x[2] - p.b * x[0] * x[1];\n}",
    "links": [
      {
        "label": "Sprott — Chaotic Flows (3D quadratic systems catalog)",
        "url": "http://sprott.physics.wisc.edu/chaos/comchaos.htm"
      },
      {
        "label": "Wikipedia — List of chaotic maps & attractors",
        "url": "https://en.wikipedia.org/wiki/List_of_chaotic_maps"
      },
      {
        "label": "MathWorld — Strange Attractor",
        "url": "https://mathworld.wolfram.com/StrangeAttractor.html"
      }
    ]
  },
  "icon-sanddollar": {
    "title": "Icon · sanddollar",
    "about": "A symmetric icon from Michael Field and Martin Golubitsky's 'Symmetry in Chaos'. The plane is treated as the complex number z = x + iy, and a single polynomial map — equivariant under the dihedral group — is iterated a million times by a swarm of points. Because the map commutes with rotation by 2π/5, the resulting strange attractor is forced into a five-fold mandala: a chaotic orbit that nonetheless paints a perfectly symmetric flower. This particular tuning (λ = -2.34) blooms into a dense, lace-like five-petalled disc reminiscent of a sand dollar's radial test.",
    "howItWorks": "Each step computes zz̄ = x²+y² and the complex power (x+iy)⁴ (unrolled), whose real part times one more factor of z gives Re(z⁵). A scalar amplitude p = λ + α·zz̄ + β·Re(z⁵) modulates the radial push, while γ injects the z⁴ term and ω adds a swirl. Because every ingredient is built from rotationally-invariant quantities (zz̄, z⁵, z⁴), rotating any orbit point by 2π/5 yields another orbit point — so 100k seeds settle onto a set with exact five-fold rotational symmetry.",
    "equations": [
      {
        "label": "modulus & power",
        "latex": "z\\bar{z} = x^2 + y^2,\\quad (z_r + i z_i) = (x+iy)^4,\\quad z_n = x\\,z_r - y\\,z_i = \\operatorname{Re}(z^5)"
      },
      {
        "label": "amplitude",
        "latex": "p = \\lambda + \\alpha\\, z\\bar{z} + \\beta\\, z_n"
      },
      {
        "label": "x'",
        "latex": "x' = p\\,x + \\gamma\\, z_r - \\omega\\, y"
      },
      {
        "label": "y'",
        "latex": "y' = p\\,y - \\gamma\\, z_i + \\omega\\, x"
      }
    ],
    "params": [
      {
        "key": "lambda",
        "symbol": "λ",
        "meaning": "Linear gain / contraction; drives the overall radius and onset of chaos (-2.34 here)."
      },
      {
        "key": "alpha",
        "symbol": "α",
        "meaning": "Coupling to the squared modulus zz̄; the isotropic nonlinear restoring term."
      },
      {
        "key": "beta",
        "symbol": "β",
        "meaning": "Coupling to Re(z⁵); injects the five-fold angular harmonic that shapes the petals."
      },
      {
        "key": "gamma",
        "symbol": "γ",
        "meaning": "Weight of the z⁴ (z_r, z_i) term; adds the higher-order symmetric distortion."
      },
      {
        "key": "omega",
        "symbol": "ω",
        "meaning": "Rotational swirl coupling x↔y; 0 keeps reflection symmetry, nonzero twists the mandala."
      }
    ],
    "code": "const zzbar = x*x + y*y;\nconst a2 = x*x - y*y, b2 = 2*x*y;\nconst zr = a2*a2 - b2*b2, zi = 2*a2*b2; // (x+iy)^4\nconst zn = x*zr - y*zi;                 // Re(z^5)\nconst p = lambda + alpha*zzbar + beta*zn;\nx2 = p*x + gamma*zr - omega*y;\ny2 = p*y - gamma*zi + omega*x;",
    "links": [
      {
        "label": "Symmetry in Chaos (Field & Golubitsky)",
        "url": "https://en.wikipedia.org/wiki/Symmetry_in_Chaos"
      },
      {
        "label": "Symmetric icon / attractor (Paul Bourke)",
        "url": "https://paulbourke.net/fractals/icon/"
      },
      {
        "label": "Attractor — Wikipedia",
        "url": "https://en.wikipedia.org/wiki/Attractor"
      },
      {
        "label": "Martin Golubitsky",
        "url": "https://en.wikipedia.org/wiki/Martin_Golubitsky"
      }
    ]
  },
  "icon-trinity": {
    "title": "Icon · trinity",
    "about": "A symmetric icon from Field and Golubitsky's \"Symmetry in Chaos,\" tuned to threefold rotational symmetry (D3 / Z3). The map iterates a single point through a polynomial built from the complex power z^n, and the chaotic orbit — averaged over a million bounces — settles into a lacy mandala that looks identical when spun by 120°. Each visited pixel is colored by how often the wandering point lands there, turning deterministic chaos into a stained-glass rosette. This is the n=3 'trinity' member of that family: three-armed, square-bounded, centered on the origin.",
    "howItWorks": "From the point z = x + iy the map forms three real invariants of the rotation group: zzbar = |z|² (rotation-invariant), and the real and imaginary parts of z² and z³ (the complex power, unrolled here for n=3). A scalar p = lambda + alpha·|z|² + beta·Re(z³) scales the radial push, gamma couples in z^{n-1} = z² to break the map away from a pure spiral, and omega adds a rotation. Because every term commutes with rotation by 2π/3, the attractor it carves out inherits exact threefold symmetry. Seed near the origin, discard the first ~1000 iterates as transient, then accumulate.",
    "equations": [
      {
        "label": "complex power (n=3)",
        "latex": "z_r = x^2 - y^2,\\quad z_i = 2xy,\\quad |z|^2 = x^2 + y^2,\\quad z_n = x\\,z_r - y\\,z_i"
      },
      {
        "label": "radial scalar",
        "latex": "p = \\lambda + \\alpha\\,|z|^2 + \\beta\\,z_n"
      },
      {
        "label": "x'",
        "latex": "x' = p\\,x + \\gamma\\,z_r - \\omega\\,y"
      },
      {
        "label": "y'",
        "latex": "y' = p\\,y - \\gamma\\,z_i + \\omega\\,x"
      }
    ],
    "params": [
      {
        "key": "lambda",
        "symbol": "λ",
        "meaning": "Linear gain on the radial push; the dominant stability/scale control."
      },
      {
        "key": "alpha",
        "symbol": "α",
        "meaning": "Coefficient of |z|² — quadratic radial feedback that bounds the orbit."
      },
      {
        "key": "beta",
        "symbol": "β",
        "meaning": "Coefficient of Re(zⁿ); injects the n-fold angular modulation."
      },
      {
        "key": "gamma",
        "symbol": "γ",
        "meaning": "Coupling of z^{n-1} into the output; sharpens the petal structure."
      },
      {
        "key": "omega",
        "symbol": "ω",
        "meaning": "Rotation term; twists the arms and tunes chirality."
      }
    ],
    "code": "const zr=x*x-y*y, zi=2*x*y, zz=x*x+y*y, zn=x*zr-y*zi;\nconst p=lambda+alpha*zz+beta*zn;\nx=p*x+gamma*zr-omega*y;\ny=p*y-gamma*zi+omega*x;",
    "links": [
      {
        "label": "Symmetric icons (Field & Golubitsky)",
        "url": "https://en.wikipedia.org/wiki/Symmetry_in_Chaos"
      },
      {
        "label": "Symmetric Chaos — MathWorld",
        "url": "https://mathworld.wolfram.com/SymmetricChaos.html"
      },
      {
        "label": "Sprott: Symmetric Icons",
        "url": "http://sprott.physics.wisc.edu/fractals/icons/"
      },
      {
        "label": "Cyclic / dihedral symmetry group",
        "url": "https://en.wikipedia.org/wiki/Cyclic_symmetry_in_three_dimensions"
      }
    ]
  },
  "icon-pentagram": {
    "title": "Icon · Pentagram",
    "about": "A symmetric icon from Michael Field and Martin Golubitsky's 'Symmetry in Chaos.' Take a single point, square the radius, raise the complex number to the fifth power, and feed the result back as a nonlinear kick — millions of iterations later the wandering orbit has painted a five-fold mandala that no single step ever planned. The chaos is locally unpredictable yet globally obeys the dihedral symmetry baked into the z^n term, so a pentagram-petalled flower emerges from pure feedback. Rotating the finished cloud by 72 degrees leaves it unchanged.",
    "howItWorks": "Each step works in the complex plane with z = x + iy. The map computes the squared modulus zz̄ = x²+y², the real part of z⁵ (which carries the 5-fold symmetry), and a state-dependent scalar p = λ + α·zz̄ + β·Re(z⁵). It then pushes z outward/inward by p while adding a rotated copy of z⁴ scaled by γ and a rigid rotation scaled by ω. Because every term is built from powers of z that are invariant (or equivariant) under rotation by 2π/5, the attractor the orbit settles onto inherits exact C₅ rotational symmetry. With β=ω=0 the symmetry is the full dihedral D₅, giving the mirror-symmetric pentagram.",
    "equations": [
      {
        "label": "modulus",
        "latex": "z\\bar{z} = x^2 + y^2"
      },
      {
        "label": "z^4 (unrolled)",
        "latex": "z_r = x^4 - 6x^2y^2 + y^4,\\quad z_i = 4xy(x^2 - y^2)"
      },
      {
        "label": "n-fold term",
        "latex": "z_n = \\operatorname{Re}(z^5) = x\\,z_r - y\\,z_i"
      },
      {
        "label": "scalar",
        "latex": "p = \\lambda + \\alpha\\,z\\bar{z} + \\beta\\,z_n"
      },
      {
        "label": "iterate",
        "latex": "x' = p\\,x + \\gamma\\,z_r - \\omega\\,y,\\quad y' = p\\,y - \\gamma\\,z_i + \\omega\\,x"
      }
    ],
    "params": [
      {
        "key": "lambda",
        "symbol": "λ",
        "meaning": "Linear gain on the current point; sets overall expansion/contraction and the size of the attractor."
      },
      {
        "key": "alpha",
        "symbol": "α",
        "meaning": "Cubic radial nonlinearity (couples to zz̄); the dominant chaos/folding control."
      },
      {
        "key": "beta",
        "symbol": "β",
        "meaning": "Couples to Re(zⁿ); breaks reflection to give a chiral spin while keeping rotational symmetry."
      },
      {
        "key": "gamma",
        "symbol": "γ",
        "meaning": "Strength of the symmetry-creating zⁿ⁻¹ kick that imprints the five petals."
      },
      {
        "key": "omega",
        "symbol": "ω",
        "meaning": "Rigid rotation per step; nonzero twists the pattern, destroying mirror symmetry."
      }
    ],
    "code": "const x2=x*x, y2=y*y;\nconst zr=x2*x2-6*x2*y2+y2*y2;      // Re(z^4)\nconst zi=4*x*y*(x2-y2);             // Im(z^4)\nconst zn=x*zr-y*zi;                 // Re(z^5)\nconst p=lambda+alpha*(x2+y2)+beta*zn;\nconst nx=p*x+gamma*zr-omega*y;\nconst ny=p*y-gamma*zi+omega*x;\nx=nx; y=ny;",
    "links": [
      {
        "label": "Symmetry in Chaos (Field & Golubitsky)",
        "url": "https://en.wikipedia.org/wiki/Symmetry_in_Chaos"
      },
      {
        "label": "Symmetric icon / chaotic attractor",
        "url": "https://mathworld.wolfram.com/StrangeAttractor.html"
      },
      {
        "label": "Cyclic / dihedral symmetry group",
        "url": "https://en.wikipedia.org/wiki/Dihedral_group"
      },
      {
        "label": "Sprott — Strange Attractors",
        "url": "http://sprott.physics.wisc.edu/sa.htm"
      }
    ]
  },
  "icon-hexagon": {
    "title": "Icon · hexagon",
    "about": "A symmetric icon from Field and Golubitsky's book \"Symmetry in Chaos\" — a chaotic map deliberately engineered so its strange attractor obeys an exact rotational symmetry. This one carries the dihedral/cyclic symmetry of order six, so the orbit paints a six-petalled mandala that is unchanged when you spin the page by 60°. Each point is fed through a complex polynomial whose terms are individually invariant under the sixfold rotation group, so chaos and crystalline order coexist on the same picture. Field and Golubitsky popularised these 'symmetric icons' in the early 1990s as proof that deterministic chaos can be made beautiful and orderly at once.",
    "howItWorks": "Treat the point (x,y) as a complex number z = x + iy. Each step builds three rotation-invariant quantities: the squared modulus z·z̄ = x²+y², and the real and imaginary parts of zⁿ (here n=6) via the complex power z⁵ (=z^{n-1}). A radial gain p = λ + α·(z z̄) + β·Re(zⁿ) scales the point, while the γ term injects the symmetric polynomial z^{n-1} and the ω term adds a small rotation. Because every term respects the 60° rotation, the whole map commutes with that rotation, and the attractor it settles onto must share the symmetry. Iterate ~1.5M times, discard the transient, and the cloud fills a sixfold mandala.",
    "equations": [
      {
        "label": "modulus",
        "latex": "z\\bar z = x^2 + y^2"
      },
      {
        "label": "complex power",
        "latex": "z^{n-1} = (x+iy)^{5} = z_r + i\\,z_i"
      },
      {
        "label": "n-th real part",
        "latex": "z_n = \\operatorname{Re}(z^{n}) = x\\,z_r - y\\,z_i"
      },
      {
        "label": "gain",
        "latex": "p = \\lambda + \\alpha\\,z\\bar z + \\beta\\,z_n"
      },
      {
        "label": "x'",
        "latex": "x' = p\\,x + \\gamma\\,z_r - \\omega\\,y"
      },
      {
        "label": "y'",
        "latex": "y' = p\\,y - \\gamma\\,z_i + \\omega\\,x"
      }
    ],
    "params": [
      {
        "key": "lambda",
        "symbol": "\\lambda",
        "meaning": "Linear feedback gain; the dominant contraction/expansion term that sets the overall size of the attractor."
      },
      {
        "key": "alpha",
        "symbol": "\\alpha",
        "meaning": "Coupling to the squared radius z z̄; controls radial bunching of the petals."
      },
      {
        "key": "beta",
        "symbol": "\\beta",
        "meaning": "Coupling to Re(zⁿ); modulates the sharpness and reach of the sixfold lobes."
      },
      {
        "key": "gamma",
        "symbol": "\\gamma",
        "meaning": "Strength of the symmetric polynomial z^{n-1}; imprints the actual n-fold petal structure."
      },
      {
        "key": "omega",
        "symbol": "\\omega",
        "meaning": "Small antisymmetric rotation term; breaks the reflection symmetry to give a chiral pinwheel (Z_n rather than D_n)."
      }
    ],
    "code": "const X=x[0], Y=x[1];\nconst zzbar=X*X+Y*Y;\nconst x2=X*X-Y*Y, y2=2*X*Y;        // z^2\nconst x4=x2*x2-y2*y2, y4=2*x2*y2;   // z^4\nconst zr=x4*X-y4*Y, zi=x4*Y+y4*X;   // z^5 = z^(n-1)\nconst zn=X*zr-Y*zi;                  // Re(z^6)\nconst p=lambda+alpha*zzbar+beta*zn;\no[0]=p*X+gamma*zr-omega*Y;\no[1]=p*Y-gamma*zi+omega*X;",
    "links": [
      {
        "label": "Symmetric icon (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Symmetry_in_Chaos"
      },
      {
        "label": "Field & Golubitsky, Symmetry in Chaos",
        "url": "https://www.maths.manchester.ac.uk/~mdc/MartinGolubitskySymmetryInChaos.html"
      },
      {
        "label": "Paul Bourke — Symmetric icons / chaos",
        "url": "https://paulbourke.net/fractals/icons/"
      },
      {
        "label": "Clifford Pickover (attractors)",
        "url": "https://en.wikipedia.org/wiki/Clifford_A._Pickover"
      }
    ]
  },
  "icon-heptagon": {
    "title": "Icon · heptagon",
    "about": "A symmetric icon from Field and Golubitsky's \"Symmetry in Chaos\" — chaotic dynamics tamed by an enforced symmetry group. Each iterate runs a point through a complex polynomial whose terms are invariant under rotation by 2π/7, so the strange attractor it traces is forced into a seven-fold mandala. The chaos lives in the radial fine structure; the heptagonal lattice is exact. The result looks less like a fractal and more like a stained-glass rose window grown from a single equation.",
    "howItWorks": "Treat the plane as the complex plane z = x + iy. The map mixes the rotation-invariant scalars |z|² and Re(zⁿ) into a radial gain p, then advances z while folding in the degree-(n−1) term zⁿ⁻¹ (here n = 7). Because every term commutes with multiplication by a 7th root of unity, applying the map and then rotating by 2π/7 gives the same set as rotating first — the attractor must carry D₇ symmetry. 100k points seeded near the origin all relax onto the same icon.",
    "equations": [
      {
        "label": "Rotation-invariant gain",
        "latex": "p = \\lambda + \\alpha\\,(x^2+y^2) + \\beta\\,\\mathrm{Re}\\,(x+iy)^7"
      },
      {
        "label": "x update",
        "latex": "x' = p\\,x + \\gamma\\,\\mathrm{Re}\\,(x+iy)^6 - \\omega\\,y"
      },
      {
        "label": "y update",
        "latex": "y' = p\\,y - \\gamma\\,\\mathrm{Im}\\,(x+iy)^6 + \\omega\\,x"
      }
    ],
    "params": [
      {
        "key": "lambda",
        "symbol": "λ",
        "meaning": "linear radial gain — overall expansion of the basin"
      },
      {
        "key": "alpha",
        "symbol": "α",
        "meaning": "quadratic |z|² feedback that bends orbits back inward"
      },
      {
        "key": "beta",
        "symbol": "β",
        "meaning": "strength of the Re(zⁿ) symmetry-locking term"
      },
      {
        "key": "gamma",
        "symbol": "γ",
        "meaning": "weight of the zⁿ⁻¹ term that sculpts the seven petals"
      },
      {
        "key": "omega",
        "symbol": "ω",
        "meaning": "rotational shear, breaking the mirror to a pure swirl"
      }
    ],
    "code": "function step(x, y, {lambda, alpha, beta, gamma, omega}) {\n  const zzbar = x*x + y*y;\n  let zr = 1, zi = 0;            // accumulate (x+iy)^6\n  for (let k = 0; k < 6; k++) { const r = zr*x - zi*y, i = zr*y + zi*x; zr = r; zi = i; }\n  const zn = zr*x - zi*y;        // Re((x+iy)^7)\n  const p = lambda + alpha*zzbar + beta*zn;\n  return [p*x + gamma*zr - omega*y, p*y - gamma*zi + omega*x];\n}",
    "links": [
      {
        "label": "Symmetry in Chaos (Field & Golubitsky)",
        "url": "https://en.wikipedia.org/wiki/Symmetry_in_Chaos"
      },
      {
        "label": "Attractor — Wikipedia",
        "url": "https://en.wikipedia.org/wiki/Attractor"
      },
      {
        "label": "Sprott: Symmetric Icons",
        "url": "http://sprott.physics.wisc.edu/fractals/icons/"
      },
      {
        "label": "Dihedral group D₇ — MathWorld",
        "url": "https://mathworld.wolfram.com/DihedralGroup.html"
      }
    ]
  },
  "icon-clamshell": {
    "title": "Icon · Clamshell",
    "about": "A symmetric icon from Field and Golubitsky's \"Symmetry in Chaos\" — a chaotic map deliberately engineered to commute with a cyclic rotation group, so its strange attractor is forced into a perfect mandala. This instance carries four-fold (C4) rotational symmetry: every chaotic point landed by the orbit has three rotated twins, and the densest petals fold inward like the ribbed lip of a clamshell. The map is the n=4 case of the general Field–Golubitsky icon family, built around a complex polynomial in z = x + iy whose nonlinear feedback both stretches (chaos) and rotates (symmetry).",
    "howItWorks": "Treat the state as a complex number z = x + iy. Compute the symmetric radial term zzbar = |z|² and the n-fold angular term zn = Re(zⁿ); together with z^(n-1) these build a real scaling factor p = lambda + alpha·zzbar + beta·zn. The new point is p·z plus a gamma-weighted z^(n-1) twist and an omega-weighted 90° rotation. Because every term is invariant (or equivariant) under rotation by 2π/4, the chaotic attractor inherits exact C4 symmetry. For n=4 the complex power z^(n-1)=z³ is unrolled: zr = x³−3xy², zi = 3x²y−y³.",
    "equations": [
      {
        "label": "radial & angular invariants",
        "latex": "z\\bar z = x^2+y^2,\\quad z_r+iz_i=(x+iy)^3,\\quad z_n=x\\,z_r-y\\,z_i"
      },
      {
        "label": "scaling factor",
        "latex": "p=\\lambda+\\alpha\\,z\\bar z+\\beta\\,z_n"
      },
      {
        "label": "x update",
        "latex": "x' = p\\,x+\\gamma\\,z_r-\\omega\\,y"
      },
      {
        "label": "y update",
        "latex": "y' = p\\,y-\\gamma\\,z_i+\\omega\\,x"
      }
    ],
    "params": [
      {
        "key": "lambda",
        "symbol": "λ",
        "meaning": "Linear scaling / overall gain; tunes the attractor between contraction and chaotic spread."
      },
      {
        "key": "alpha",
        "symbol": "α",
        "meaning": "Coupling to the rotation-invariant radius |z|², controlling radial nonlinearity."
      },
      {
        "key": "beta",
        "symbol": "β",
        "meaning": "Coupling to the n-fold angular term Re(zⁿ); sharpens the petal lobes."
      },
      {
        "key": "gamma",
        "symbol": "γ",
        "meaning": "Strength of the z^(n-1) symmetric twist that imprints the C4 arms."
      },
      {
        "key": "omega",
        "symbol": "ω",
        "meaning": "Infinitesimal-rotation term breaking reflection symmetry, giving the swirl/handedness."
      }
    ],
    "code": "function step(x, y, {lambda, alpha, beta, gamma, omega}) {\n  const zr = x*x*x - 3*x*y*y;      // Re(z^3)\n  const zi = 3*x*x*y - y*y*y;      // Im(z^3)\n  const zn = x*zr - y*zi;          // Re(z^4)\n  const zzbar = x*x + y*y;         // |z|^2\n  const p = lambda + alpha*zzbar + beta*zn;\n  return [ p*x + gamma*zr - omega*y,\n           p*y - gamma*zi + omega*x ];\n}",
    "links": [
      {
        "label": "Symmetry in Chaos (Field & Golubitsky)",
        "url": "https://en.wikipedia.org/wiki/Symmetric_icon"
      },
      {
        "label": "Symmetric icons — Paul Bourke",
        "url": "https://paulbourke.net/fractals/icons/"
      },
      {
        "label": "Attractor — Wikipedia",
        "url": "https://en.wikipedia.org/wiki/Attractor"
      },
      {
        "label": "Strange attractors — Sprott",
        "url": "http://sprott.physics.wisc.edu/sa.htm"
      }
    ]
  },
  "gingerbreadman": {
    "title": "Gingerbreadman Map",
    "about": "A deceptively simple piecewise-linear map whose only nonlinearity is a single absolute value, yet it carpets the plane with a chaotic sea pocked by ghostly hexagonal islands of stability. Devil Pickover popularized it in the 1980s, and Roger Bourke's plots gave it its name: the speckled chaotic region traces the rough outline of a gingerbread man. It is area-preserving (conservative), so unlike dissipative strange attractors it has no shrinking basin — every orbit wanders forever on its own invariant set, either a stable island ring or the surrounding chaotic ocean.",
    "howItWorks": "Each step replaces the point (x, y) with (1 - y + |x|, y becomes the old x). The fold introduced by |x| is the sole source of chaos: it reflects the left half-plane, and the linear shear then stretches and re-stacks the plane. Because the Jacobian determinant is exactly 1 everywhere, areas are preserved — orbits neither collapse to an attractor nor blow up to infinity, instead filling a measure-positive chaotic sea threaded with quasi-periodic islands. Seeding a cloud in the sea near (-0.1, 0) lights up the full speckled body.",
    "equations": [
      {
        "label": "x update",
        "latex": "x_{n+1} = 1 - y_n + |x_n|"
      },
      {
        "label": "y update",
        "latex": "y_{n+1} = x_n"
      }
    ],
    "params": [
      {
        "key": "s",
        "symbol": "s",
        "meaning": "Fold strength multiplying |x| (s = 1 is the canonical area-preserving Gingerbreadman; other values warp the sea)."
      }
    ],
    "code": "o[0] = 1 - x[1] + s*Math.abs(x[0]); o[1] = x[0];",
    "links": [
      {
        "label": "Wikipedia: Gingerbreadman map",
        "url": "https://en.wikipedia.org/wiki/Gingerbreadman_map"
      },
      {
        "label": "Wolfram MathWorld: Gingerbreadman Map",
        "url": "https://mathworld.wolfram.com/GingerbreadmanMap.html"
      },
      {
        "label": "Clifford Pickover, Computers, Pattern, Chaos and Beauty",
        "url": "https://en.wikipedia.org/wiki/Clifford_A._Pickover"
      }
    ]
  },
  "standard": {
    "title": "Standard (Chirikov) Map",
    "about": "Born from Boris Chirikov's 1969 study of how chaos creeps into nearly-integrable systems, the standard map is the discrete heartbeat of the kicked rotor: a free-spinning pendulum that receives a sharp gravitational kick once per period. It is the universal local model for the transition to chaos in Hamiltonian systems, the prototype on which the Chirikov resonance-overlap criterion was forged. Living on the torus [0,2π)², its phase portrait at the kick strength K=1.2 is a stunning mosaic of order and disorder: smooth KAM curves and nested island chains float untouched inside a turbulent chaotic sea. Seeding particles across the whole torus paints the entire portrait at once.",
    "howItWorks": "Each step the momentum p receives a kick K·sin(x) that depends on the current angle x, then the angle advances by the updated momentum. Both coordinates are wrapped modulo 2π onto the torus. For small K the motion stays on invariant KAM curves (integrable-like); as K grows these curves break up one by one. At K=1.2 the last great barriers are already shattered, leaving a connected chaotic sea riddled with surviving elliptic islands — the signature mixed phase space of Hamiltonian chaos.",
    "equations": [
      {
        "label": "Momentum kick",
        "latex": "p_{n+1} = (p_n + K\\sin x_n) \\bmod 2\\pi"
      },
      {
        "label": "Angle advance",
        "latex": "x_{n+1} = (x_n + p_{n+1}) \\bmod 2\\pi"
      }
    ],
    "params": [
      {
        "key": "K",
        "symbol": "K",
        "meaning": "Kick strength / nonlinearity. K≈0.9716 is the critical value where the last KAM curve breaks; K=1.2 gives a mixed sea-plus-islands portrait."
      }
    ],
    "code": "const TAU = 2*Math.PI;\nlet np = (y + K*Math.sin(x)) % TAU; if (np<0) np+=TAU;\nlet nx = (x + np) % TAU; if (nx<0) nx+=TAU;\nx = nx; y = np;",
    "links": [
      {
        "label": "Wikipedia: Standard map",
        "url": "https://en.wikipedia.org/wiki/Standard_map"
      },
      {
        "label": "Wikipedia: Chirikov criterion",
        "url": "https://en.wikipedia.org/wiki/Chirikov_criterion"
      },
      {
        "label": "Scholarpedia: Chirikov standard map",
        "url": "http://www.scholarpedia.org/article/Chirikov_standard_map"
      },
      {
        "label": "MathWorld: Standard Map",
        "url": "https://mathworld.wolfram.com/StandardMap.html"
      }
    ]
  },
  "duffing-map": {
    "title": "Duffing Map",
    "about": "The Duffing map is the discrete-time cousin of the Duffing oscillator, the classic forced nonlinear spring that Georg Duffing studied in 1918 to model structures that stiffen as they bend. Stripping the differential equation down to a two-step recurrence keeps its defining cubic restoring force y³, and that single nonlinearity is enough to fold the plane into a strange attractor. At a=2.75, b=0.2 the orbit settles onto a thin, twice-folded chaotic ribbon with perfect odd symmetry about the origin. It is a textbook example of how a smooth mechanical system, once sampled in time, becomes a fractal.",
    "howItWorks": "Each step shifts the old y into the new x, then drives the new y by a linear stretch a·y, a memory term -b·x that feeds the previous position back in, and a cubic -y³ that bends large excursions back toward the center. The competition between the linear amplification and the cubic restoring force stretches and folds the state cloud on every iteration, so points seeded near the origin spread out and converge onto the same attractor.",
    "equations": [
      {
        "label": "x update",
        "latex": "x_{n+1} = y_n"
      },
      {
        "label": "y update",
        "latex": "y_{n+1} = -b\\,x_n + a\\,y_n - y_n^{3}"
      }
    ],
    "params": [
      {
        "key": "a",
        "symbol": "a",
        "meaning": "Linear amplification of y; raising it widens the attractor and tunes the route into chaos."
      },
      {
        "key": "b",
        "symbol": "b",
        "meaning": "Damping / feedback strength coupling the previous x back into y (acts like the oscillator's friction)."
      }
    ],
    "code": "const nx = y;\nconst ny = -b*x + a*y - y*y*y;\nx = nx; y = ny;",
    "links": [
      {
        "label": "Duffing map (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Duffing_map"
      },
      {
        "label": "Duffing equation (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Duffing_equation"
      },
      {
        "label": "Duffing Differential Equation (MathWorld)",
        "url": "https://mathworld.wolfram.com/DuffingDifferentialEquation.html"
      }
    ]
  },
  "kings-dream": {
    "title": "King's Dream",
    "about": "Clifford Pickover devised this trigonometric quadratic map and gave it the evocative name \"The King's Dream\" in his books on visual mathematics and computer art. Each point is folded through a pair of sine waves whose interference weaves a delicate, lacework attractor with crisp two-fold (180°) rotational symmetry. Like Pickover's other dream maps it has no physical origin — it is pure aesthetic exploration of how simple iterated sines can spin chaos into ornament. Sweeping the four parameters morphs the figure between webs, swirls, and ribbed shells.",
    "howItWorks": "Start a swarm of points near the origin and repeatedly apply the map. The two output coordinates each mix a sine of the other coordinate with a scaled sine of the same coordinate, so x feeds y and y feeds x through frequencies b and a. The orbit never escapes — every term is a bounded sine — yet the folding is sensitive to initial conditions, so the cloud spreads across a fractal-like attractor instead of a single curve. Because the map commutes with (x,y)→(−x,−y), the rendered set is symmetric under a half-turn about the center.",
    "equations": [
      {
        "label": "x update",
        "latex": "x_{n+1} = \\sin(b\\,y_n) + c\\,\\sin(b\\,x_n)"
      },
      {
        "label": "y update",
        "latex": "y_{n+1} = \\sin(a\\,x_n) + d\\,\\sin(a\\,y_n)"
      }
    ],
    "params": [
      {
        "key": "a",
        "symbol": "a",
        "meaning": "frequency of the sines driving the y update (acts on x and y)"
      },
      {
        "key": "b",
        "symbol": "b",
        "meaning": "frequency of the sines driving the x update (acts on y and x)"
      },
      {
        "key": "c",
        "symbol": "c",
        "meaning": "self-coupling weight of sin(b·x) in the x update"
      },
      {
        "key": "d",
        "symbol": "d",
        "meaning": "self-coupling weight of sin(a·y) in the y update"
      }
    ],
    "code": "const nx = Math.sin(b*y) + c*Math.sin(b*x);\nconst ny = Math.sin(a*x) + d*Math.sin(a*y);\nx = nx; y = ny;",
    "links": [
      {
        "label": "Clifford Pickover — Wikipedia",
        "url": "https://en.wikipedia.org/wiki/Clifford_A._Pickover"
      },
      {
        "label": "Pickover attractor — Wikipedia",
        "url": "https://en.wikipedia.org/wiki/Pickover_attractor"
      },
      {
        "label": "Sprott — Strange Attractors: Creating Patterns in Chaos",
        "url": "http://sprott.physics.wisc.edu/sa.htm"
      }
    ]
  },
  "sprott-quadratic": {
    "title": "Sprott Quadratic",
    "about": "In the early 1990s physicist Julien C. Sprott ran a now-famous computer search through the space of simple quadratic maps, asking a blunt question: how common is chaos? He let a program iterate the general two-dimensional quadratic recurrence with coefficients drawn from a coarse alphabet, kept only the sets whose orbits stayed bounded yet had a positive Lyapunov exponent, and harvested thousands of strange attractors — each a unique fractal lacework. This map is one such survivor: twelve plain numbers, two parabolic update rules, and an orbit that never repeats but never escapes, tracing out a folded, asymmetric web.",
    "howItWorks": "Each point is pushed through two coupled quadratic polynomials in x and y. Stretching (the positive Lyapunov exponent measured at ~0.34) pulls nearby points apart while the bounded basin folds them back, so a cloud of 100k seeds settles onto the same intricate attractor. Because every term — constant, linear, square, and cross-product — is tunable, nudging any coefficient continuously reshapes or destroys the figure; most settings blow up to infinity, which is exactly why Sprott's filtered catalog is special.",
    "equations": [
      {
        "label": "x next",
        "latex": "x' = a_0 + a_1 x + a_2 x^2 + a_3 xy + a_4 y + a_5 y^2"
      },
      {
        "label": "y next",
        "latex": "y' = a_6 + a_7 x + a_8 x^2 + a_9 xy + a_{10} y + a_{11} y^2"
      }
    ],
    "params": [
      {
        "key": "a0",
        "symbol": "a₀",
        "meaning": "x constant offset"
      },
      {
        "key": "a1",
        "symbol": "a₁",
        "meaning": "x linear-in-x weight"
      },
      {
        "key": "a2",
        "symbol": "a₂",
        "meaning": "x quadratic x² weight (fold strength)"
      },
      {
        "key": "a3",
        "symbol": "a₃",
        "meaning": "x cross xy weight (shear coupling)"
      },
      {
        "key": "a4",
        "symbol": "a₄",
        "meaning": "x linear-in-y weight"
      },
      {
        "key": "a5",
        "symbol": "a₅",
        "meaning": "x quadratic y² weight"
      },
      {
        "key": "a6",
        "symbol": "a₆",
        "meaning": "y constant offset"
      },
      {
        "key": "a7",
        "symbol": "a₇",
        "meaning": "y linear-in-x weight"
      },
      {
        "key": "a8",
        "symbol": "a₈",
        "meaning": "y quadratic x² weight"
      },
      {
        "key": "a9",
        "symbol": "a₉",
        "meaning": "y cross xy weight"
      },
      {
        "key": "a10",
        "symbol": "a₁₀",
        "meaning": "y linear-in-y weight"
      },
      {
        "key": "a11",
        "symbol": "a₁₁",
        "meaning": "y quadratic y² weight"
      }
    ],
    "code": "const X = x, Y = y;\nx = a0 + a1*X + a2*X*X + a3*X*Y + a4*Y + a5*Y*Y;\ny = a6 + a7*X + a8*X*X + a9*X*Y + a10*Y + a11*Y*Y;",
    "links": [
      {
        "label": "Sprott — Strange Attractors: Creating Patterns in Chaos",
        "url": "http://sprott.physics.wisc.edu/sa.htm"
      },
      {
        "label": "J. C. Sprott home page (chaos & attractor catalogs)",
        "url": "http://sprott.physics.wisc.edu/"
      },
      {
        "label": "Wikipedia — Attractor (strange attractors)",
        "url": "https://en.wikipedia.org/wiki/Attractor"
      },
      {
        "label": "Wikipedia — Lyapunov exponent",
        "url": "https://en.wikipedia.org/wiki/Lyapunov_exponent"
      }
    ]
  },
  "zaslavsky": {
    "title": "Zaslavsky Map",
    "about": "The Zaslavsky map is a dissipative kicked-rotor model introduced by George M. Zaslavsky in the 1970s to study Hamiltonian chaos and the emergence of stochastic webs in nearly-integrable systems. Each step kicks the phase x on a circle (the mod-1 torus) while the conjugate variable y is simultaneously driven by a cosine impulse and bled away by an exponential damping factor e^(-gamma). The competition between the resonant kick and the dissipation folds the orbit into a filamentary fractal attractor — a torn, leaf-like sheet that is the dissipative cousin of Zaslavsky's famous symmetric stochastic web. Tuning gamma sets how hard the strange attractor is squeezed against the y=0 axis.",
    "howItWorks": "x lives on a circle and is advanced by a constant drift nu plus a y-dependent term and a phase-dependent cosine kick, then wrapped back into [0,1) by the mod operation. y is the kicked-and-damped momentum: it receives the same cosine kick (scaled by eps) and is then multiplied by the contraction factor e^(-gamma) < 1, which guarantees a bounded attractor. The auxiliary constant mu = (1 - e^(-gamma))/gamma couples the damping strength into the x-update so the map reduces smoothly to the conservative standard map as gamma -> 0. Stretching from the kick plus folding from the wrap and contraction produces sensitive dependence and a fractal limit set.",
    "equations": [
      {
        "label": "phase (mod 1)",
        "latex": "x_{n+1} = \\left(x_n + \\nu\\,(1 + \\mu\\,y_n) + \\varepsilon\\,\\nu\\,\\mu\\,\\cos(2\\pi x_n)\\right)\\bmod 1"
      },
      {
        "label": "damped momentum",
        "latex": "y_{n+1} = e^{-\\gamma}\\left(y_n + \\varepsilon\\,\\cos(2\\pi x_n)\\right)"
      },
      {
        "label": "coupling constant",
        "latex": "\\mu = \\dfrac{1 - e^{-\\gamma}}{\\gamma}"
      }
    ],
    "params": [
      {
        "key": "nu",
        "symbol": "\\nu",
        "meaning": "Phase drift / kick strength on the circle; sets how far x advances each step."
      },
      {
        "key": "eps",
        "symbol": "\\varepsilon",
        "meaning": "Perturbation amplitude of the cosine kick driving both x and y."
      },
      {
        "key": "gamma",
        "symbol": "\\gamma",
        "meaning": "Dissipation rate; the momentum is contracted by e^(-gamma) each step (gamma -> 0 is the conservative limit)."
      }
    ],
    "code": "const e = Math.exp(-gamma);\nconst m = (1 - e) / gamma;\nconst c = Math.cos(2 * Math.PI * x);\nconst n = x + nu * (1 + m * y) + eps * nu * m * c;\nx = n - Math.floor(n);   // mod 1\ny = e * (y + eps * c);",
    "links": [
      {
        "label": "Wikipedia: Zaslavskii map",
        "url": "https://en.wikipedia.org/wiki/Zaslavskii_map"
      },
      {
        "label": "Scholarpedia: Zaslavsky web map (G. Zaslavsky)",
        "url": "http://www.scholarpedia.org/article/Zaslavsky_web_map"
      },
      {
        "label": "Sprott: Strange Attractors",
        "url": "http://sprott.physics.wisc.edu/sa.htm"
      }
    ]
  },
  "martin": {
    "title": "Martin (Hopalong)",
    "about": "Barry Martin's 'sine Hopalong' map, popularized by A.K. Dewdney in Scientific American's Computer Recreations column (September 1986) under the name 'hopalong'. This sine variant replaces the classic square-root term with x' = y - sin(x), y' = a - x, so a single point 'hops' across the plane tracing a delicate, lace-like orbital fractal. Despite being deterministic and almost trivially simple, the orbit never settles: it weaves an infinitely detailed filigree of interleaved curves that looks hand-stitched. It is a cousin of the Gingerbreadman and Pickover orbital maps.",
    "howItWorks": "Each step is an algebraic shear-and-fold: the new x subtracts sin of the old x from the old y, and the new y is the constant a minus the old x. The sin term injects a smooth periodic nonlinearity while the y' = a - x term recycles position into velocity, so the point keeps hopping without ever escaping to infinity or locking into a short cycle. Seeding 100k particles near the origin and iterating in lockstep paints the whole attractor at once; trails connect successive hops into the characteristic woven filaments.",
    "equations": [
      {
        "label": "x update",
        "latex": "x_{n+1} = y_n - \\sin(x_n)"
      },
      {
        "label": "y update",
        "latex": "y_{n+1} = a - x_n"
      }
    ],
    "params": [
      {
        "key": "a",
        "symbol": "a",
        "meaning": "Additive offset feeding old x back into the next y; sets the overall scale and lacing density of the orbital pattern (a=4 gives a rich ~10x10 filigree)."
      }
    ],
    "code": "let nx = y - Math.sin(x);\nlet ny = a - x;\nx = nx; y = ny;",
    "links": [
      {
        "label": "Hopalong attractor (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Barry_Martin_(computer_scientist)"
      },
      {
        "label": "Dewdney, 'Computer Recreations' (Sci. Am., Sep 1986)",
        "url": "https://www.scientificamerican.com/issue/sa/1986/09-01/"
      },
      {
        "label": "Pickover, Computers, Pattern, Chaos and Beauty",
        "url": "https://en.wikipedia.org/wiki/Clifford_A._Pickover"
      },
      {
        "label": "Sprott, Strange Attractors",
        "url": "http://sprott.physics.wisc.edu/sa.htm"
      }
    ]
  },
  billiard: {
    "title": "Dynamical Billiard",
    "about": "A billiard is the simplest chaos experiment: a point particle flies in a straight line inside a bounded table and bounces off the walls by the mirror law. Nothing is random — yet the SHAPE of the wall decides everything. In a circle the motion is integrable: every orbit hugs a fixed inner circle (a caustic) and traces a tidy rosette forever. Round the ends into a stadium and it turns provably chaotic — one orbit fills the whole table and two that start a hair apart diverge exponentially. Release tens of thousands of particles and the trails paint the line between order and chaos.",
    "howItWorks": "Each particle carries a position and velocity in the plane and drifts at constant speed. When a straight step would cross the wall, the exact crossing point is found (by bisection) and the velocity is reflected about the inward wall normal n via v ← v − 2(v·n)n — the specular mirror law, which conserves speed exactly, so the billiard is energy-preserving and never settles. The boundary is selectable: a circle (integrable — it also conserves angular momentum, pinning each orbit to a caustic of radius |r×v|/|v|), a Bunimovich stadium (two semicircular caps on a rectangle — provably ergodic and mixing), or a regular polygon (triangle/pentagon/hexagon). Particles are seeded uniformly inside with random launch directions at one fixed speed; colour is set by launch angle so families stay legible, and the long fading trails are the actual visualization — they fill a frozen annulus for the circle and the whole table for the chaotic shapes.",
    "equations": [
      {
        "label": "free flight (constant velocity between walls)",
        "latex": "\\mathbf{r}(t) = \\mathbf{r}_0 + \\mathbf{v}\\,t"
      },
      {
        "label": "specular reflection at the wall (inward normal n)",
        "latex": "\\mathbf{v}_{\\text{out}} = \\mathbf{v}_{\\text{in}} - 2(\\mathbf{v}_{\\text{in}}\\cdot\\mathbf{n})\\,\\mathbf{n}"
      },
      {
        "label": "speed is conserved (elastic, energy-preserving)",
        "latex": "\\lVert\\mathbf{v}_{\\text{out}}\\rVert = \\lVert\\mathbf{v}_{\\text{in}}\\rVert"
      },
      {
        "label": "circle: each orbit keeps a fixed caustic radius (integrable)",
        "latex": "r_{\\text{caustic}} = \\dfrac{\\lvert \\mathbf{r}\\times\\mathbf{v}\\rvert}{\\lVert\\mathbf{v}\\rVert}"
      }
    ],
    "params": [
      {
        "key": "shape",
        "symbol": "\\partial\\Omega",
        "meaning": "boundary table shape — circle is integrable (frozen rosettes); stadium and polygons are chaotic (orbits fill the table)"
      },
      {
        "key": "drag",
        "symbol": "\\gamma",
        "meaning": "optional per-step speed decay; 0 = the pure energy-conserving billiard (walls stay perfectly elastic)"
      },
      {
        "key": "pointSize",
        "symbol": "\\rho",
        "meaning": "on-screen size of the moving particle heads"
      }
    ],
    "code": "// free flight to the wall, then reflect about the inward normal n\n// (the exact crossing time is found by bisection so particles never leak)\nconst vdotn = vx*n.x + vy*n.y;\nvx -= 2*vdotn*n.x;   // v_out = v_in - 2 (v_in . n) n\nvy -= 2*vdotn*n.y;   // |v| unchanged - speed is conserved",
    "links": [
      {
        "label": "Dynamical billiards (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Dynamical_billiards"
      },
      {
        "label": "Bunimovich stadium (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Bunimovich_stadium"
      },
      {
        "label": "Specular reflection (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Specular_reflection"
      }
    ]
  },
  crystal: {
    "title": "Crystallization",
    "about": "A molecular-dynamics sandbox: point atoms attract and repel through the Lennard-Jones potential, the simplest model of a real substance. Cool it and the gas spontaneously orders into a close-packed hexagonal lattice — a crystal; heat it and the lattice melts back into a liquid then a gas. Unlike emergent particle toys, this minimises a genuine energy whose floor is the crystal.",
    "howItWorks": "Each atom carries a position and velocity. Every step the pairwise Lennard-Jones force — a steep short-range repulsion plus a gentler medium-range attraction — is summed over near neighbours (found in O(n) by a spatial-hash cell list, with a soft-core clamp so the r→0 singularity can't explode), and positions advance by symplectic velocity-Verlet. A Berendsen thermostat gently rescales the velocities toward the target temperature, so the temperature slider drives the phase: low = solid crystal, medium = liquid, high = gas. Atoms reflect off a box; colour runs cool (slow, crystalline) to warm (fast, molten).",
    "equations": [
      {
        "label": "Lennard-Jones pair potential",
        "latex": "U(r) = 4\\varepsilon\\left[\\left(\\tfrac{\\sigma}{r}\\right)^{12} - \\left(\\tfrac{\\sigma}{r}\\right)^{6}\\right]"
      },
      {
        "label": "pair force (−dU/dr, projected)",
        "latex": "F(r) = \\dfrac{24\\varepsilon}{r}\\left[2\\left(\\tfrac{\\sigma}{r}\\right)^{12} - \\left(\\tfrac{\\sigma}{r}\\right)^{6}\\right]"
      },
      {
        "label": "equilibrium spacing (lattice constant)",
        "latex": "r_{\\min} = 2^{1/6}\\,\\sigma"
      },
      {
        "label": "Berendsen thermostat rescale",
        "latex": "\\lambda = \\sqrt{1 + \\tfrac{\\Delta t}{\\tau}\\left(\\tfrac{T_0}{T} - 1\\right)}"
      }
    ],
    "params": [
      {
        "key": "temperature",
        "symbol": "T_0",
        "meaning": "thermostat target: 0 freezes to a crystal, high melts to a gas"
      },
      {
        "key": "epsilon",
        "symbol": "\\varepsilon",
        "meaning": "bond well depth — cohesion / stiffness of the crystal"
      },
      {
        "key": "spacing",
        "symbol": "\\sigma",
        "meaning": "atomic diameter — scales the lattice constant"
      },
      {
        "key": "gravity",
        "symbol": "g",
        "meaning": "optional downward pull (sedimentation / settling)"
      }
    ],
    "code": "// Lennard-Jones force over cell-list neighbours, soft-core clamped\nconst sr2 = sigma2 / max(r2, rmin2);      // (σ/r)², never below 0.85σ\nconst sr6 = sr2**3, sr12 = sr6*sr6;\nconst fOverR = 24*eps*(2*sr12 - sr6)/r2;  // >0 = repel at small r\nax += -fOverR*dx; ay += -fOverR*dy;\n// velocity-Verlet + Berendsen thermostat → anneal / melt",
    "links": [
      {
        "label": "Lennard-Jones potential (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Lennard-Jones_potential"
      },
      {
        "label": "Molecular dynamics (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Molecular_dynamics"
      },
      {
        "label": "Crystallization (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Crystallization"
      }
    ]
  },
  hmc: {
    "title": "Hamiltonian Monte Carlo",
    "about": "Hamiltonian Monte Carlo, the workhorse sampler behind modern Bayesian statistics, made visible. To draw samples from a probability distribution π(q), HMC treats −log π as a potential energy, gives each sample a random momentum, and lets it roll along the frictionless physics of a Hamiltonian — coasting across high-probability regions far more efficiently than a random walk. Thousands of independent samplers explore the same target at once, and their cloud converges to π itself.",
    "howItWorks": "Each particle is a phase-space point (position q, momentum p) with energy H = U(q) + ½|p|², where U = −log π. A symplectic LEAPFROG integrator advances it along a constant-energy contour for L steps; then the momentum is resampled from a Gaussian and a METROPOLIS test accepts or rejects the move (comparing H before and after, reverting q on reject) — which exactly corrects the integrator's small energy drift, guaranteeing the cloud's density equals π. A target selector swaps the potential between a Gaussian, a banana (Rosenbrock), a bimodal mixture, and a ring; the guide overlay traces π's contours.",
    "equations": [
      {
        "label": "augmented Hamiltonian (U = −log π)",
        "latex": "H(q,p) = U(q) + \\tfrac12\\,\\lVert p\\rVert^2"
      },
      {
        "label": "Hamilton's equations",
        "latex": "\\dot q = \\dfrac{\\partial H}{\\partial p} = p, \\qquad \\dot p = -\\dfrac{\\partial H}{\\partial q} = -\\nabla U(q)"
      },
      {
        "label": "leapfrog (symplectic) step",
        "latex": "p_{1/2} = p - \\tfrac{\\varepsilon}{2}\\nabla U(q),\\quad q' = q + \\varepsilon p_{1/2},\\quad p' = p_{1/2} - \\tfrac{\\varepsilon}{2}\\nabla U(q')"
      },
      {
        "label": "Metropolis acceptance after L steps",
        "latex": "a = \\min\\!\\big(1,; e^{\\,H_0 - H_1}\\big)"
      }
    ],
    "params": [
      {
        "key": "distribution",
        "symbol": "\\pi",
        "meaning": "target density to sample: Gaussian / banana / bimodal / donut"
      },
      {
        "key": "stepSize",
        "symbol": "\\varepsilon",
        "meaning": "leapfrog step length — too large lowers the acceptance rate"
      },
      {
        "key": "leapSteps",
        "symbol": "L",
        "meaning": "leapfrog steps per proposal before the Metropolis test + momentum refresh"
      }
    ],
    "code": "// one leapfrog step of H = U + ½|p|², U = −log π\np.x -= 0.5*eps*gradU(q).x;  p.y -= 0.5*eps*gradU(q).y;\nq.x += eps*p.x;             q.y += eps*p.y;\np.x -= 0.5*eps*gradU(q).x;  p.y -= 0.5*eps*gradU(q).y;\n// every L steps: resample p ~ N(0,1); accept w.p. min(1, exp(H0−H1)), else revert q",
    "links": [
      {
        "label": "Hamiltonian Monte Carlo (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Hamiltonian_Monte_Carlo"
      },
      {
        "label": "Metropolis–Hastings (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Metropolis%E2%80%93Hastings_algorithm"
      },
      {
        "label": "Rosenbrock function (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Rosenbrock_function"
      }
    ]
  },
  chladniWave: {
    title: 'Faraday / Chladni Plate',
    about:
      'Sprinkle sand on a metal plate, draw a violin bow across its edge, and the grains skitter away from the parts that are vibrating and pile up along the still lines — leaving a stark, symmetric figure. These are Chladni patterns, the visible shape of a standing wave on a plate. Here the plate is a square membrane pinned at its rim; by default it rings in one clean eigenmode, showing a regular lattice of vibrating hills (antinodes) separated by motionless nodal lines. Turn up the Faraday drive and the plate is instead shaken from below — a parametric forcing that pumps energy into many modes at once and tips the surface into churning, ever-shifting cymatics.',
    howItWorks:
      'The height u of each grid cell obeys the damped wave equation, integrated in time by a leapfrog scheme that keeps a copy of the previous step so the second time-derivative is centred and energy-preserving. The spatial term is the discrete Laplacian (a 5-point stencil: the four neighbours minus four times the centre). A fixed (Dirichlet) rim, u = 0 on every edge, forces clean plate eigenmodes. The stiffness k is the Mathieu term: a constant baseline plus a sinusoidal Faraday drive ε·sin(ωt) — when ε = 0 the seeded eigenmode simply rings forever; when ε > 0 the periodic stiffness parametrically amplifies subharmonic modes (the Mathieu instability) and the pattern goes chaotic. A small cubic term βu³ saturates the growth so the driven amplitude stays bounded, and the dimensionless wave speed (a Courant number) is capped so the explicit scheme can never blow up. The surface is drawn as a displaced point grid — height y = u·relief — coloured by |u| so nodal lines (u ≈ 0) read dark and antinodes glow bright.',
    equations: [
      {
        label: 'driven plate wave equation',
        latex: '\\ddot{u} = c^{2}\\nabla^{2}u - k(t)\\,u - \\beta u^{3} - \\gamma\\dot{u}'
      },
      {
        label: 'Mathieu (Faraday) stiffness',
        latex: 'k(t) = k_0 + \\varepsilon\\,\\sin(\\omega t)'
      },
      {
        label: 'discrete Laplacian (5-point)',
        latex: '\\nabla^{2}u_{ij} \\approx u_{i\\pm1,j} + u_{i,j\\pm1} - 4u_{ij}'
      },
      {
        label: 'leapfrog time step',
        latex: 'u^{\\,n+1} = 2u^{\\,n} - u^{\\,n-1} + \\ddot{u}\\,\\Delta t^{2} - \\gamma\\,(u^{\\,n}-u^{\\,n-1})'
      },
      {
        label: 'fixed rim (Dirichlet)',
        latex: 'u = 0 \\quad\\text{on the boundary}'
      },
      {
        label: 'seeded eigenmode (mode m)',
        latex: 'u_0 \\propto \\sin\\!\\tfrac{(m{+}1)\\pi x}{W}\\,\\sin\\!\\tfrac{m\\pi y}{W}'
      }
    ],
    params: [
      {
        key: 'mode',
        symbol: 'm',
        meaning: 'which clean Chladni figure to ring — seeds the (m+1, m) plate eigenmode (rebuilds the field)'
      },
      {
        key: 'waveSpeed',
        symbol: 'c',
        meaning: 'dimensionless wave-Courant number c·Δt; sets the oscillation rate, capped so the explicit scheme stays stable'
      },
      {
        key: 'damping',
        symbol: '\\gamma',
        meaning: 'velocity damping — 0 lets the plate ring forever (a clean static figure); higher slowly bleeds energy away'
      },
      {
        key: 'driveFreq',
        symbol: '\\omega',
        meaning: 'frequency of the Faraday (Mathieu) forcing that shakes the plate'
      },
      {
        key: 'driveAmp',
        symbol: '\\varepsilon',
        meaning: 'Faraday drive depth — 0 = a single clean eigenmode; raising it parametrically pumps many modes into chaotic cymatics'
      },
      {
        key: 'relief',
        symbol: 'r',
        meaning: 'vertical exaggeration of the height map u·r — how tall the antinode hills stand'
      }
    ],
    code: "const C2 = waveSpeed*waveSpeed;                  // (c·dt)², dimensionless\nconst k = K0 + driveAmp*Math.sin(driveFreq*t);  // Mathieu parametric stiffness\nfor (each interior cell c) {\n  const lap = u[L]+u[R]+u[U]+u[D] - 4*u[c];     // 5-point Laplacian\n  const acc = C2*lap - k*u[c] - BETA*u[c]**3;   // wave + stiffness + cubic\n  let next = 2*u[c] - uPrev[c] + acc - gamma*(u[c]-uPrev[c]); // leapfrog\n  if (next > 4) next = 4; else if (next < -4) next = -4;      // self-healing clamp\n  uNext[c] = next;\n}\n// rim u=0 (Dirichlet); rotate the three buffers; y = u·relief, colour by |u|",
    links: [
      {
        label: 'Chladni figures (Wikipedia)',
        url: 'https://en.wikipedia.org/wiki/Ernst_Chladni#Chladni_figures'
      },
      {
        label: 'Faraday wave (Wikipedia)',
        url: 'https://en.wikipedia.org/wiki/Faraday_wave'
      },
      {
        label: 'Mathieu equation (Wikipedia)',
        url: 'https://en.wikipedia.org/wiki/Mathieu_function'
      }
    ]
  },
  vortexFunnel: {
    title: 'Vortex Funnel',
    about:
      'The shape water makes as it drains: a wide, gently rippled surface that dips inward and steepens into a slender throat — a whirlpool, or bathtub vortex. Points ride that free surface, the dense bright band at the lip glowing orange while the spiralling throat runs white down to its narrow waist. A slow differential swirl winds the arms (the centre turns faster than the rim, as real vortices do) and travelling ripples animate the surface.',
    howItWorks:
      'Each point is pinned to a fixed radius on a surface of revolution and only its angle and height evolve, so the figure stays crisp and its colour — keyed to radius — never smears. The height profile is a Lorentzian dimple z = −depth·c²/(r²+c²): near the centre it is parabolic (like the solid-body rotating core of a Rankine vortex), and far out it falls off like 1/r² (the irrotational free surface of an ideal drain). The swirl is differential, Ω(r) ∝ 1/r, so inner rings overtake outer ones and the seeded spiral arms wind up over time. A small radius-growing travelling wave rides on top for the look of moving water. Colour is assigned once by radius (white throat → saturated amber lip → dark-red rim); because every point keeps its radius, that radial gradient holds even as the funnel turns.',
    equations: [
      {
        label: 'free-surface funnel (Lorentzian dimple)',
        latex: 'z(r) = -\\,d\\,\\dfrac{c^{2}}{r^{2} + c^{2}}'
      },
      {
        label: 'ideal drain limits (core ↔ skirt)',
        latex: 'z \\approx -d\\Big(1 - \\tfrac{r^{2}}{c^{2}}\\Big)\\ (r\\!\\ll\\! c),\\qquad z \\approx -d\\,\\tfrac{c^{2}}{r^{2}}\\ (r\\!\\gg\\! c)'
      },
      {
        label: 'differential swirl',
        latex: '\\theta(r,t) = \\theta_0 + \\Omega(r)\\,t,\\qquad \\Omega(r) \\propto \\dfrac{1}{r}'
      },
      {
        label: 'travelling surface ripple',
        latex: '\\Delta z = a\\,\\dfrac{r}{R}\\,\\cos(k r - \\omega t)'
      },
      {
        label: 'position',
        latex: '(x,y,z) = \\big(r\\cos\\theta,\\ z(r) + \\Delta z,\\ r\\sin\\theta\\big)'
      }
    ],
    params: [
      {
        key: 'depth',
        symbol: 'd',
        meaning: 'how deep the funnel plunges — the height drop from rim to throat'
      },
      {
        key: 'throat',
        symbol: 'c',
        meaning: 'Lorentzian core radius — small = a tight, pinched throat; large = a broad shallow bowl'
      },
      {
        key: 'swirl',
        symbol: '\\Omega_0',
        meaning: 'differential rotation rate (0 = a still funnel you orbit); inner rings spin faster ∝ 1/r'
      },
      {
        key: 'ripple',
        symbol: 'a',
        meaning: 'amplitude of the travelling surface waves rippling outward across the rim'
      },
      {
        key: 'turns',
        symbol: 'N',
        meaning: 'how many times the seeded arms wind from throat to rim (spiral tightness)'
      }
    ],
    code: "const c2 = throat*throat;\nfor (each point at fixed radius r) {\n  const u = r / RMAX;\n  const om = swirl / (u + 0.18);            // differential: inner faster (Ω ∝ 1/r)\n  const th = theta0 + om * t;\n  const funnel = -depth * (c2 / (r*r + c2)); // Lorentzian dimple → narrow throat\n  const wave = ripple * u * Math.cos(6*r - 2.2*t); // travelling ripples\n  pos = [r*Math.cos(th), funnel + wave, r*Math.sin(th)];\n}\n// colour fixed by radius u: white throat → amber lip → dark rim (uploaded once)",
    links: [
      {
        label: 'Whirlpool / vortex (Wikipedia)',
        url: 'https://en.wikipedia.org/wiki/Whirlpool'
      },
      {
        label: 'Rankine vortex (Wikipedia)',
        url: 'https://en.wikipedia.org/wiki/Rankine_vortex'
      },
      {
        label: 'Free surface of a rotating fluid (Wikipedia)',
        url: 'https://en.wikipedia.org/wiki/Bucket_argument'
      }
    ]
  },
  flyBrain: {
      "title": "Fly Brain Cascade",
      "about": "In 2024 the complete wiring diagram of a fruit-fly brain — about 140,000 neurons and 50 million synapses — was finished, and something surprising followed. Researchers dropped the SIMPLEST possible neuron model onto that wiring, a leaky integrate-and-fire cell that just sums its inputs and fires when they cross a threshold, with no tuning at all — and the model predicted real behaviour. Stimulate the sugar-tasting neurons in the simulation and the proboscis-extension motor neurons fire, exactly as in a living fly. The wiring itself was doing the computing. We cannot ship fifty million synapses, so this is the same experiment on a statistical stand-in: neurons are laid out by neuropil in the shape of a fly brain — the big paired optic lobes, the antennal lobes where smell arrives, the mushroom-body calyces and lobes (the fly's memory centre), the lateral horns, the central complex on the midline, and the subesophageal zone that drives taste and feeding — and wired by the known pathways between them. Choose a sense and watch the activity cascade: smell goes antennal lobe → mushroom body and lateral horn → the rest of the brain; vision floods the optic lobes first.",
      "howItWorks": "Every neuron is a leaky integrator: its membrane potential decays toward rest, synaptic inputs push it up, and when it crosses threshold it fires, resets, and goes refractory for a few steps. Each spike is delivered to the neuron's 20 out-synapses after a delay proportional to the distance to the target, through a circular delay line; synaptic weights are drawn log-normally (a heavy tail of a few very strong synapses, as the real connectome shows) and one cell in ten is inhibitory. Targets are chosen by a pathway table — antennal lobe → calyx and lateral horn, calyx → mushroom-body lobes, optic lobe mostly to itself and onward to the central brain, everything eventually to the subesophageal zone — with paired structures wired mostly ipsilaterally. A spike also launches packets of light along its first few axons, so you see the signal travel. Spike-frequency adaptation is what makes it cascade rather than seize: each burst raises an after-current that shuts the neuron down, so a wave of activity sweeps through, exhausts itself and dies before the next stimulus pulse. The stimulus is a breathing Poisson drive into the chosen sensory neuropil. Raise the gain and the brain crosses into sustained asynchronous firing; cut the inhibition and it does the same.",
      "equations": [
          {
              "label": "leaky integrate-and-fire membrane",
              "latex": "\\tau\\,\\dot v_i = -v_i + I_i(t) - \\beta\\,a_i, \\qquad v_i \\ge 1 \\;\\Rightarrow\\; v_i \\to 0,\\; a_i \\to a_i + 1"
          },
          {
              "label": "delayed synaptic delivery",
              "latex": "I_j(t) \\mathrel{+}= \\sum_{i \\to j} w_{ij}\\,\\delta\\!\\left(t - t_i^{\\text{spike}} - d_{ij}\\right), \\qquad d_{ij} \\propto |x_j - x_i|"
          },
          {
              "label": "log-normal synaptic weights, 10% inhibitory",
              "latex": "w_{ij} = \\pm g\\,e^{\\sigma\\xi - \\sigma^2/2}, \\qquad \\xi \\sim \\mathcal N(0,1)"
          }
      ],
      "params": [
          {
              "key": "stimulus",
              "symbol": "\\text{stim}",
              "meaning": "which sensory neuropil is driven: antennal lobes (smell), optic lobes (vision), subesophageal zone (taste), or none"
          },
          {
              "key": "drive",
              "symbol": "\\lambda",
              "meaning": "strength of the Poisson input into the stimulated region"
          },
          {
              "key": "gain",
              "symbol": "g",
              "meaning": "synaptic strength — ≈1 gives self-terminating cascades, ≈1.5 sustained firing"
          },
          {
              "key": "balance",
              "symbol": "g_I/g_E",
              "meaning": "inhibitory synapse strength relative to excitatory"
          },
          {
              "key": "rate",
              "symbol": "n",
              "meaning": "network steps per rendered frame"
          }
      ],
      "code": "// one step of the whole-brain LIF network\nfor each neuron i:\n  I = delayLine[now][i];  delayLine[now][i] = 0   // inputs arriving this step\n  v[i] = v[i]*exp(-1/tau) + I - beta*a[i];  a[i] *= 0.96\n  if (v[i] >= 1 && !refractory) {\n    v[i] = 0; a[i] += 1;                          // spike, adapt\n    for each synapse (j, w, d) of i: delayLine[now + d][j] += w\n    launch light packets i -> j along the first few axons\n  }",
      "links": [
          {
              "label": "Shiu et al. 2024 — a Drosophila computational brain model (Nature)",
              "url": "https://www.nature.com/articles/s41586-024-07763-9"
          },
          {
              "label": "FlyWire — the whole-brain fly connectome",
              "url": "https://flywire.ai/"
          },
          {
              "label": "Leaky integrate-and-fire neuron",
              "url": "https://en.wikipedia.org/wiki/Biological_neuron_model#Leaky_integrate-and-fire"
          }
      ]
  },
  luneburgLens: {
    title: 'Luneburg Lens',
    about:
      "A lens with no lens shape. Every ordinary lens bends light with a curved surface; a Luneburg lens is a flat disk that bends it with a GRADIENT instead — its refractive index is highest at the centre and falls smoothly to the value of empty space at the rim, following the beautifully simple law n(r) = √(2 − (r/R)²). Because light travels slower where the index is higher, a wave crossing the disk has its inner parts held back while its outer parts race ahead, and the whole wavefront curls around and converges to a perfect point — remarkably, right on the opposite surface of the lens. And it does this for a wave coming from ANY direction, which is why real Luneburg lenses (built as onion-like shells of dielectric) are prized for radar and satellite antennas: one ball focuses signals from all over the sky at once.",
    howItWorks:
      "We solve the genuine two-dimensional wave equation, ü = c(x,y)²∇²u, by leapfrog time-stepping on a grid — but the wave speed c is not constant. Inside the lens we bake it from the Luneburg profile, c = c₀/n(r), so the core is slow and the rim is vacuum-fast; outside, it is c₀ everywhere. A soft line source on the left launches a steady plane wave (added, not clamped, so it stays transparent to waves passing back through it), and a quadratic 'sponge' of damping around the border absorbs everything that reaches the edge, so no reflection bounces back to muddy the picture. Rather than dots, the field is drawn as a smooth colour map — orange crests, blue troughs — so you watch straight wavefronts enter, bend continuously through the disk, and squeeze to a bright focus on the far side. Stability is automatic: the vacuum Courant number is the cap, and the slower core only makes the scheme more stable.",
    equations: [
      { label: 'the Luneburg gradient index', latex: 'n(r) = \\sqrt{2 - (r/R)^2}, \\qquad 0 \\le r \\le R' },
      { label: '2-D scalar wave equation with a varying speed', latex: '\\partial_{tt} u = c(x,y)^2\\,\\nabla^2 u, \\qquad c = c_0 / n(r)' },
      { label: 'every parallel ray meets at the far surface', latex: '\\text{plane wave} \\;\\longrightarrow\\; \\text{focus at } r = R' },
    ],
    params: [
      { key: 'frequency', symbol: '\\omega', meaning: 'source frequency — lower ω = longer wavelength' },
      { key: 'courant', symbol: 'c_0', meaning: 'vacuum wave speed (the stability cap, ≤ 0.5)' },
      { key: 'gain', symbol: 'g', meaning: 'colour contrast of the field' },
      { key: 'relief', symbol: 'h', meaning: 'kept for the point fallback; the field render is flat' },
    ],
    code: "// bake the wave speed from the Luneburg index, then leapfrog the wave equation\nif (r < R)  n = sqrt(2 - (r/R)^2);  c = c0 / n;   // slow core, fast rim\nelse        c = c0;\nu_next = 2*u - u_prev + c*c * laplacian(u);        // 2nd-order wave eq\n// soft plane-wave source on the left; absorbing sponge at the borders",
    links: [
      { label: 'Luneburg lens', url: 'https://en.wikipedia.org/wiki/Luneburg_lens' },
      { label: 'Gradient-index (GRIN) optics', url: 'https://en.wikipedia.org/wiki/Gradient-index_optics' },
      { label: 'Finite-difference wave equation', url: 'https://en.wikipedia.org/wiki/Finite_difference_method' },
    ],
  },
  drumhead: {
    title: 'Drumhead (Bessel Modes)',
    about:
      "The standing waves of a real drum. A circular MEMBRANE clamped at its rim (a drumhead — not a stiff Chladni plate, which bends by a different, fourth-order law) rings in its own family of modes, the Bessel eigenmodes, whose still lines are m straight diameters crossed by concentric circles. Pick a mode with the two sliders and the membrane settles into it, rippling up and down. Crucially, each mode has its OWN frequency, and — unlike a string's neat 1:2:3 harmonics — a drum's overtones are INHARMONIC (ratios like 1.59, 2.30, 2.92, 3.60…). That is exactly why a drum has no clear pitch, and why tuning one is an art: this is the maths behind it. The readout shows each mode's ratio f_{m,n}/f_{0,1}, and the surface now breathes at that true relative rate.",
    howItWorks:
      "The standing waves of a membrane fixed at its rim are uₘₙ(r,θ,t) = Jₘ(λₘₙ·r)·cos(mθ)·cos(ωₘₙt), where Jₘ is the order-m Bessel function and λₘₙ is its n-th positive zero — chosen precisely so the rim r=1 is a node (Jₘ(λₘₙ)=0). The angular factor cos(mθ) vanishes on m evenly-spaced diameters; the radial factor vanishes on n−1 interior circles (the earlier zeros of Jₘ), unevenly spaced and bunched toward the rim — the signature of a real drum, not the even rings of a naive sine. The temporal frequency is set by the SAME zero, ωₘₙ ∝ λₘₙ, so the fundamental (m=0,n=1) uses λ=2.405 and every other mode's pitch is λₘₙ/2.405 times higher — the inharmonic ratios shown in the readout. Points are laid on an area-uniform polar grid, displaced in height by u·cos(ωₘₙt), and coloured once by |u| (gold antinode lobes, dark nodal lines). Bessel is evaluated only when you change the mode; each frame is a cheap cosine scale.",
    equations: [
      { label: 'circular membrane eigenmode', latex: 'u_{mn}(r,\\theta,t) = J_m(\\lambda_{mn}\\,r)\\,\\cos(m\\theta)\\,\\cos(\\omega t)' },
      { label: 'fixed rim (node) sets λ', latex: 'J_m(\\lambda_{mn}) = 0\\quad(\\lambda_{mn}=\\text{the }n\\text{-th zero of }J_m)' },
      { label: 'nodal set', latex: 'm\\text{ diameters } (\\cos m\\theta=0)\\ +\\ (n{-}1)\\text{ circles } (J_m(\\lambda_{mn}r)=0)' },
      { label: 'inharmonic overtone ratio (the drum-tuning point)', latex: '\\frac{f_{m,n}}{f_{0,1}} = \\frac{\\lambda_{m,n}}{\\lambda_{0,1}} = \\frac{\\lambda_{m,n}}{2.40483\\ldots}' },
    ],
    params: [
      { key: 'circles', symbol: 'n', meaning: 'number of concentric nodal circles (radial nodes) — selects the n-th zero of Jₘ' },
      { key: 'diameters', symbol: 'm', meaning: 'number of nodal diameters (angular nodes) — the order of the Bessel function Jₘ' },
      { key: 'relief', symbol: 'r', meaning: 'vertical exaggeration of the mode shape u·relief' },
      { key: 'speed', symbol: '\\dot t', meaning: 'base tempo — each mode then ripples at its true relative frequency λₘₙ/λ₀₁' },
    ],
    code: "// eigenmode (computed once per mode change; per frame is just a cos(ωt) scale)\nconst lambda = besselJzero(m, nCircles + 1); // (nCircles+1)-th zero of J_m ⇒ rim is a node\nfor (each point on an area-uniform polar disk at (r, θ)) {\n  const u = besselJn(m, lambda * r) * Math.cos(m * θ); // r ∈ [0,1]\n  // height y = u * cos(ω t) * relief ; colour once by |u| (gold lobes, dark nodes)\n}",
    links: [
      { label: 'Vibrations of a circular membrane (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Vibrations_of_a_circular_membrane' },
      { label: 'Chladni figures (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Ernst_Chladni#Chladni_figures' },
      { label: 'Bessel function (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Bessel_function' },
    ],
  },
  orbitWeave: {
    title: 'Orbit Weave',
    about:
      "Collective trajectories. A swarm of test particles, each on its own orbit in a single central well, traced with long luminous trails. Because every orbit is a closed ellipse threaded through the centre, the trails pile up into a glowing sphere with a radiant core and faint radial streaks — structure emerging from many simple paths at once.",
    howItWorks:
      "A particle in a central HARMONIC force F = −k·x (Hooke's law, pulling toward the origin) has an exact closed solution: an ellipse centred on the origin, x(t) = a·cos(ωt)·Û + b·sin(ωt)·V̂. Each particle is given a random orbit plane (Û,V̂ — orthonormal), a random reach a (biased toward an outer shell), a random phase, and a slightly different rate so the ensemble shimmers rather than freezes. The 'orbit width' slider sets the semi-minor axis b = ecc·a: near zero the ellipses collapse to near-radial slivers that plunge through the centre and shoot back out to radius a, so their trails read as radial streaks; toward one they fatten into circles. It's closed-form, so it is unconditionally bounded (|x| ≤ a) and never blows up; colour is fixed per particle.",
    equations: [
      { label: 'central harmonic force', latex: '\\ddot{\\mathbf{x}} = -\\omega^{2}\\,\\mathbf{x}' },
      { label: 'closed-form orbit (an ellipse)', latex: '\\mathbf{x}(t) = a\\cos(\\omega t)\\,\\hat{\\mathbf U} + b\\sin(\\omega t)\\,\\hat{\\mathbf V}' },
      { label: 'orbit width', latex: 'b = \\text{ecc}\\cdot a,\\qquad \\hat{\\mathbf U}\\perp\\hat{\\mathbf V},\\ |\\hat{\\mathbf U}|=|\\hat{\\mathbf V}|=1' },
    ],
    params: [
      { key: 'ecc', symbol: 'b/a', meaning: 'orbit width — near 0 = radial slivers (streaks through the centre), 1 = circular orbits' },
      { key: 'speed', symbol: '\\omega', meaning: 'how fast the particles glide along their orbits' },
      { key: 'shell', symbol: 'R', meaning: 'overall radius the orbits reach (rebuilds the ensemble)' },
    ],
    code: "// each particle: a fixed ellipse in a random plane (Û ⟂ V̂), traced with long trails\nconst ang = omega_i * t + phase_i;\nconst c = a_i * Math.cos(ang);\nconst s = a_i * ecc * Math.sin(ang); // ecc → 0 ⇒ near-radial sliver through the origin\npos = c*U + s*V; // closed ellipse, |pos| ≤ a_i (always bounded)",
    links: [
      { label: 'Harmonic oscillator (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Harmonic_oscillator' },
      { label: 'Central force (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Central_force' },
      { label: 'Orbit (dynamics) (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Orbit' },
    ],
  },
  fractalFlame: {
    title: 'Fractal Flame',
    about:
      "Fractal flames (Scott Draves, 1992) are the glowing, organic cousins of the Barnsley fern. Same idea — the 'chaos game' of an iterated function system — but each map adds a NONLINEAR twist (a 'variation' like swirl, sinusoidal, or horseshoe) after its affine step. Those twists bend the self-similar copies into flowing, feathered, flame-like structures. Scrub the seed to wander a whole family of them; set the symmetry for mandalas.",
    howItWorks:
      "A single point hops forever: each step it picks a weighted-random function and applies it, and its current location is plotted. Run hundreds of thousands of points at once and the additive density traces out the attractor (bright where the orbit lingers — the glow). Each function here is an affine contraction toward one vertex of a regular N-gon, followed by a nonlinear variation Vⱼ — keeping the maps contractive guarantees the figure stays bounded, while placing them around a ring keeps it spread and gives clean N-fold symmetry (every vertex carries a rotated copy of the same generator). Colour is fixed per point as a narrow hue band around a seed-chosen base (a wide band would additively wash to white), so dense cores read pale and sparse filaments keep the tint.",
    equations: [
      { label: 'chaos game (one step)', latex: '\\mathbf{x} \\leftarrow F_{i}(\\mathbf{x}),\\quad i\\sim\\text{weighted random}' },
      { label: 'flame function = affine + variation', latex: 'F_i(\\mathbf{x}) = V_{j}\\big(A_i\\,\\mathbf{x} + \\mathbf{t}_i\\big)' },
      { label: 'some variations Vⱼ', latex: 'V_{\\sin}=(\\sin x,\\ \\sin y),\\quad V_{\\text{swirl}}=(x\\sin r^2 - y\\cos r^2,\\ x\\cos r^2 + y\\sin r^2)' },
      { label: 'N-fold symmetry', latex: '\\mathbf{t}_i \\text{ at angle } \\tfrac{2\\pi k}{N},\\ A_i \\text{ rotated to match}' },
    ],
    params: [
      { key: 'flame', symbol: 's', meaning: 'seed — picks the affine maps + variations; scrub it to explore a whole family of flames' },
      { key: 'symmetry', symbol: 'N', meaning: 'rotational fold count — the flame is invariant under a 2π/N turn (mandala symmetry)' },
    ],
    code: "// chaos game with nonlinear variations (N-gon-vertex generators ⇒ bounded + N-fold symmetric)\nfor (each particle) {\n  const m = pickWeighted(funcs);            // a flame function\n  const px = m.a*x + m.b*y + m.e;           // affine\n  const py = m.c*x + m.d*y + m.f;\n  [x, y] = variation(m.v, px, py);          // nonlinear twist (swirl, sinusoidal, …)\n}\n// plot all particles with additive blending → density is the glow; colour fixed by index",
    links: [
      { label: 'Fractal flame (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Fractal_flame' },
      { label: 'The Fractal Flame Algorithm (Draves & Reckase, PDF)', url: 'https://flam3.com/flame_draves.pdf' },
      { label: 'Iterated function system (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Iterated_function_system' },
    ],
  },
  pseudospectrum: {
    title: 'Pseudospectrum',
    about:
      "The eigenvalues of a matrix tell you where it is exactly singular — but for a NON-NORMAL matrix they lie. Add a vanishingly small perturbation and the spectrum can lurch a long way; the matrix behaves as if it had eigenvalues nowhere near the real ones. The honest picture is the pseudospectrum: not isolated points but a whole landscape over the complex plane measuring how CLOSE zI−A comes to singular at every z. We render that landscape — sharp cones spike up at the true eigenvalues, and around a strongly non-normal matrix they swell into broad 'continents' of near-instability that the eigenvalues alone never reveal.",
    howItWorks:
      "Closeness-to-singular is measured by the smallest singular value σ_min(zI−A); its reciprocal 1/σ_min is the resolvent norm, which blows up exactly at the eigenvalues. The height field is that resolvent norm sampled across the plane (tanh-saturated so the cones stay finite, with rounded rather than clipped tips). For a 2×2 upper-triangular A = [[a, g],[0, d]] the singular values of M = zI−A have a closed form — σ_min² is the smaller root of λ² − tr(MᴴM)λ + |det M|² = 0 — so the whole grid is exact and cheap, no per-cell SVD. The eigenvalues sit at z = a and z = d (the two cones); the off-diagonal g is the non-normality — crank it and the cones merge into one wide plateau of pseudo-instability. With drift on, the eigenvalues wander along slow Lissajous orbits and the terrain breathes, grows, and splits. Colour is keyed to height: orange valleys and contour rings in the basin, teal up the cone bodies, white at the eigenvalue tips.",
    equations: [
      { label: 'resolvent norm = height', latex: 'h(z) = \\dfrac{1}{\\sigma_{\\min}(zI - A)}' },
      { label: 'ε-pseudospectrum (the level sets)', latex: '\\Lambda_\\varepsilon(A) = \\{\\, z \\in \\mathbb{C} : \\sigma_{\\min}(zI - A) \\le \\varepsilon \\,\\}' },
      { label: 'σ_min via MᴴM, M = zI − A', latex: '\\sigma_{\\min}^2 = \\tfrac12\\big(T - \\sqrt{T^2 - 4D}\\big),\\quad T = \\operatorname{tr}(M^{H}M),\\ D = |\\det M|^2' },
      { label: 'upper-triangular A (g = non-normality)', latex: 'A = \\begin{bmatrix} a & g \\\\ 0 & d \\end{bmatrix},\\quad \\det M = (z-a)(z-d)' },
    ],
    params: [
      { key: 'matrix', symbol: 'seed', meaning: 'picks where the two eigenvalues a, d sit — scrub it to wander different two-cone layouts' },
      { key: 'nonNormal', symbol: '|g|', meaning: 'the off-diagonal magnitude — how non-normal A is; raise it to swell and merge the pseudospectral continents' },
      { key: 'relief', symbol: 'h·', meaning: 'vertical exaggeration of the resolvent landscape' },
      { key: 'drift', symbol: 'ω', meaning: 'speed the eigenvalues wander along slow orbits, so the terrain morphs' },
    ],
    code: "// resolvent-norm height over the complex plane, exact for a 2x2 upper-triangular A=[[a,g],[0,d]]\nfor (each grid cell z = x + i*y) {\n  const m11 = |z - a|**2, m22 = |z - d|**2;   // M = zI - A\n  const T = m11 + m22 + g*g;                   // tr(M^H M)\n  const D = m11 * m22;                         // |det M|^2 = |(z-a)(z-d)|^2\n  const smin2 = 0.5 * (T - Math.sqrt(T*T - 4*D));\n  h = HMAX * Math.tanh(0.35 / (Math.sqrt(smin2) + 0.02));  // 1/sigma_min, saturated\n}\n// displace a point grid by h, colour by height (orange basin -> teal cones -> white tips)",
    links: [
      { label: 'Pseudospectrum (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Pseudospectrum' },
      { label: 'Trefethen & Embree — Spectra and Pseudospectra', url: 'https://press.princeton.edu/books/hardcover/9780691119465/spectra-and-pseudospectra' },
      { label: 'Non-normal matrix (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Normal_matrix' },
    ],
  },
  cosmicWeb: {
    title: 'Cosmic Web',
    about:
      "The matter of the universe isn't scattered evenly — gravity has spun it into a vast filigree of empty VOIDS, the SHEETS and FILAMENTS that drape between them, and the blazing NODES (galaxy clusters) where filaments cross. This is the cosmic web, the largest structure that exists. It grew from almost nothing: tiny density ripples in the early universe, amplified by gravity over billions of years. (The eerie resemblance to a slice of brain tissue is a real and much-noted coincidence.) Here it's grown from a single seed — scrub the growth dial and watch a near-uniform cosmos fold into the web before your eyes.",
    howItWorks:
      "Rather than an expensive N-body force solve, this uses the ZEL'DOVICH APPROXIMATION — the classic first-order theory of how structure forms. Start with particles on a regular grid q. Build one Gaussian random displacement field ψ(q) = −∇φ from a band-limited cosmological power spectrum (synthesized here as a sum of hundreds of Fourier modes, so it's exact and seedable with no FFT). Then every particle simply slides along a STRAIGHT, frozen trajectory x(q) = q + D·ψ(q), where the single scalar D is the linear growth factor — cosmic time. As D increases, matter streams down-gradient and piles up: first into sheets, then filaments, then dense knots, exactly where the field was already overdense. Each particle is tinted once by the overdensity it's destined for, δ(q) = −∇·ψ: underdense voids fall to near-black, the pile-ups glow orange along the filaments, and the densest crossings blaze yellow-white. Because that overdensity is a fixed property of q, the colour is baked at build and the web is unconditionally bounded and fully reproducible from the seed.",
    equations: [
      { label: 'Zel’dovich trajectory (q = grid, D = growth)', latex: '\\mathbf{x}(\\mathbf{q}, D) = \\mathbf{q} + D\\,\\boldsymbol{\\psi}(\\mathbf{q})' },
      { label: 'displacement = −gradient of the potential', latex: '\\boldsymbol{\\psi}(\\mathbf{q}) = -\\nabla\\varphi = \\textstyle\\sum_m A_m\\,\\hat{\\mathbf{k}}_m \\sin(\\mathbf{k}_m\\!\\cdot\\!\\mathbf{q} + \\phi_m)' },
      { label: 'overdensity (the colour key)', latex: '\\delta(\\mathbf{q}) = -\\nabla\\!\\cdot\\!\\boldsymbol{\\psi} = -\\textstyle\\sum_m A_m\\,|\\mathbf{k}_m|\\cos(\\mathbf{k}_m\\!\\cdot\\!\\mathbf{q} + \\phi_m)' },
      { label: 'mode power spectrum', latex: 'A_m \\propto \\sqrt{P(k)}\\,/\\,k,\\qquad P(k) = k\\,e^{-(k/k_{\\mathrm{cut}})^2}' },
    ],
    params: [
      { key: 'field', symbol: 'seed', meaning: 'which random universe — scrub it to grow a different web from a different initial field' },
      { key: 'growth', symbol: 'D', meaning: 'the growth factor (cosmic time): how far structure has collapsed. Low = smooth, high = sharp web' },
      { key: 'webScale', symbol: 'k', meaning: 'spatial frequency of the structure — small = a few fat filaments, large = a fine intricate web' },
      { key: 'contrast', symbol: '—', meaning: 'the void fraction: where the dark floor ends, i.e. how much of the volume reads as empty void' },
    ],
    code: "// Zel'dovich approximation: particles ride frozen trajectories x = q + D*psi(q)\n// psi = sum of Fourier modes of the Gaussian displacement field (built once, per seed)\nfor (each grid point q) {\n  let psi = [0,0,0], div = 0;\n  for (each mode m) {\n    const th = dot(k[m], q) + phase[m];\n    psi += u[m] * amp[m] * Math.sin(th);     // displacement -grad(phi)\n    div += amp[m] * kmag[m] * Math.cos(th);  // divergence of psi\n  }\n  delta = -div;                              // overdensity -> colour (void->filament->node)\n}\n// per frame: x = q + D*psi  (D ramps up = structure forming); colour fixed by delta",
    links: [
      { label: 'Observable universe / large-scale structure (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Observable_universe#Large-scale_structure' },
      { label: 'Zel’dovich approximation (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Zeldovich_pancake' },
      { label: 'The cosmic web (Bond, Kofman & Pogosyan 1996)', url: 'https://www.nature.com/articles/380603a0' },
    ],
  },
  reconnection: {
    title: 'Magnetic Reconnection',
    about:
      "In a plasma — the Sun's corona, Earth's magnetosphere, a fusion reactor — magnetic field lines pointing in opposite directions can collide, snap, and splice into new connections. That reconnection dumps the stored magnetic energy explosively, flinging out high-velocity plasma JETS (this is what drives solar flares and auroral substorms). Right at the heart of it sits a magnetic null shaped like an X: field rushes IN along one axis and is expelled OUT along the perpendicular axis. This is that X-point, live: blue field lines streaming in from the sides, gold jets blasting out top and bottom, and a blazing white null where they meet.",
    howItWorks:
      "Near the null the plasma flow is the simplest possible 2D saddle (hyperbolic stagnation point), the linearised core of reconnection. Take the streamfunction ψ = α·x·y; the divergence-free velocity is v = (∂ψ/∂y, −∂ψ/∂x) = (−α·x, +α·y) — slow inflow squeezing toward the null along x, accelerating outflow ejected along y. Making the outflow faster than the inflow (β = α·jetBoost on the y-component) gives the reconnection asymmetry that reads as 'releasing jets'. Every particle is a massless tracer of this closed-form field (O(n), no pairwise solve) and rides a fixed streamline forever. Three baked populations paint the neon X: BLUE tracers fill the horizontal inflow wedges (|x|>|y|) and respawn when they cross the diagonal separatrix; GOLD tracers form the vertical jet beams, seeded log-uniformly along the beam so the exponential outflow reads as a smooth steady jet; a WHITE knot marks the null, kept bright by the pile-up where the flow stalls (v→0). Respawn is deterministic (no RNG in the step) so the flow streams perpetually and can never blow up.",
    equations: [
      { label: 'X-point streamfunction', latex: '\\psi(x,y) = \\alpha\\,x\\,y' },
      { label: 'plasma velocity (inflow x, jets y)', latex: '\\mathbf{v} = \\nabla\\times\\psi\\hat{z} = (-\\alpha x,\\ +\\beta y)' },
      { label: 'streamlines (hyperbolae)', latex: '|x|^{\\beta}\\,|y|^{\\alpha} = \\text{const}' },
      { label: 'reconnection asymmetry', latex: '\\beta = \\alpha\\cdot\\text{jetBoost}\\quad(\\text{outflow} > \\text{inflow})' },
    ],
    params: [
      { key: 'rate', symbol: '\\alpha', meaning: 'reconnection rate — strength of the inflow/outflow (how fast field rushes in and jets blast out)' },
      { key: 'jetBoost', symbol: '\\beta/\\alpha', meaning: 'outflow-to-inflow asymmetry — how much faster the jets are ejected than the field flows in' },
      { key: 'inflowSpan', symbol: 'h', meaning: 'thickness of the blue inflow band around the x-axis' },
      { key: 'guideTwist', symbol: 'B_z', meaning: 'guide-field twist — spins the outflow jets into helices (0 = straight jets)' },
    ],
    code: "// X-point saddle flow: every particle is a tracer of v = (-alpha*x, +beta*y)\nconst beta = alpha * jetBoost;          // outflow faster than inflow\nfor (each particle) {\n  x += -alpha * x * dt;                  // inflow squeezes toward the null along x\n  y +=  beta  * y * dt;                  // jets accelerate outward along y\n  // deterministic respawn keeps each tracer in its wedge -> crisp X, bounded, perpetual\n  if (leftItsZone(x, y, role)) { x = home.x; y = home.y; }\n}\n// colour ONCE by role: blue inflow wedges, gold jet beams, white null core",
    links: [
      { label: 'Magnetic reconnection (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Magnetic_reconnection' },
      { label: 'Sweet–Parker & Petschek models', url: 'https://en.wikipedia.org/wiki/Magnetic_reconnection#Sweet%E2%80%93Parker_model' },
      { label: 'Saddle / hyperbolic stagnation point', url: 'https://en.wikipedia.org/wiki/Saddle_point' },
    ],
  },
  polynomialRoots: {
    title: 'Polynomial Root Cloud',
    about: "Take a polynomial whose coefficients are all just +1 or −1 (a Littlewood polynomial), find its complex roots, and plot them as dots. One polynomial gives a handful of dots — but plot the roots of every such polynomial up to some degree and a breathtaking fractal emerges: a dense feathered ring hugging the unit circle |z|=1, pocked with holes at the roots of unity and laced with self-similar filaments. This is the picture behind Simone Conradi's \"40,000,000 polynomial roots\" pieces and John Baez's \"Beauty of Roots\". Here many random ±1 (or {−1,0,1} Bohemian) polynomials are sampled and every root of each is scattered into the plane.",
    howItWorks: "Each polynomial's d roots are found simultaneously by the Durand–Kerner (Weierstrass) method: seed d estimates on a circle of radius ≈1 (the roots cluster near |z|=1), then iterate z_i ← z_i − p(z_i)/∏_{j≠i}(z_i−z_j) until they converge — a parallel Newton that pulls every estimate toward a distinct root at once. Thousands of random polynomials are solved at build (deterministically, from the seed) and their roots accumulated. Points are coloured ONCE by proximity to the unit circle and local density: the sparse purple field off the ring, orange filaments where roots crowd, white-hot on the densest ridge. A gentle density-driven relief lifts the ring out of the plane so the cloud is orbitable, not a flat wafer.",
    equations: [
      { label: 'Littlewood / Bohemian polynomial', latex: 'p(z) = \\sum_{k=0}^{d} a_k\\,z^{k}, \\qquad a_k \\in \\{-1,+1\\}\\ \\text{(or } \\{-1,0,1\\}\\text{)}' },
      { label: 'Durand–Kerner (simultaneous root iteration)', latex: 'z_i \\;\\leftarrow\\; z_i - \\frac{p(z_i)}{\\prod_{j\\neq i}(z_i - z_j)}' },
      { label: 'roots concentrate near the unit circle', latex: '|z| \\to 1 \\quad \\text{as } d \\to \\infty' },
    ],
    params: [
      { key: 'degree', symbol: 'd', meaning: 'polynomial degree → roots per polynomial (higher = tighter, more intricate ring)' },
      { key: 'coeffFamily', symbol: 'a_k', meaning: 'coefficient set: Littlewood ±1 (dense feather) or Bohemian {−1,0,1} (sparser, more lattice-like)' },
      { key: 'relief', symbol: 'h', meaning: 'density-driven height lift (0 = the classic flat plot)' },
      { key: 'jitter', symbol: '\\epsilon', meaning: 'thin out-of-plane thickness so the disc is not a perfect plane' },
    ],
    code: "// at build: solve K = N/d random ±1 polynomials, scatter all roots\nfor (s in 0..K) {\n  for (k in 0..d) coeff[k] = (rand < 0.5) ? -1 : 1;   // Littlewood\n  durandKerner(coeff, d, zr, zi);     // all d roots at once\n  for (k in 0..d) { re[w]=zr[k]; im[w]=zi[k]; w++; }\n}\n// colour once by |z|≈1 proximity + local density (purple -> orange -> white)\n// position: x=Re, y=Im, z = relief * density",
    links: [
      { label: 'Littlewood polynomial (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Littlewood_polynomial' },
      { label: 'The Beauty of Roots (John Baez)', url: 'https://math.ucr.edu/home/baez/roots/' },
      { label: 'Durand–Kerner method (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Durand%E2%80%93Kerner_method' },
    ],
  },
  cymatics: {
    title: 'Cymatic Plate',
    about: "Vibrate a shallow dish of water and the surface organises into stunning standing-wave patterns — concentric rings, radial spokes and dense interference fringes that sharpen into n-fold rosettes at the right frequency. This is cymatics, and the physics is Faraday waves: a parametric (up-and-down) drive doesn't excite one clean mode like a struck drumhead — it excites the whole BAND of circular eigenmodes near resonance at once, and their superposition is the intricate moiré. Unlike the Chladni drumhead (a single pure Bessel mode), this sums many modes for the busy, shimmering water-surface look.",
    howItWorks: "The circular eigenmodes are uₘₙ(r,θ)=Jₘ(λₘₙ·r)·cos(mθ), with λₘₙ the n-th zero of the Bessel function Jₘ (so the rim is a node, like a meniscus pinned to the dish). We pick the K modes whose eigenvalue λ (∝ frequency) lies nearest a drive frequency Ω, weighted by exp(−damping·|λ−Ω|), and restrict m to multiples of a chosen symmetry n so the rosette is crisply n-fold. Each mode beats at its own frequency ωₖ∝λₖ, so the summed field shimmers and drifts rather than just breathing. The Bessel spatial factors are computed once per mode change; per frame is only Σ cos(ωₖt). Viewed from above as a glowing intensity plate (cool indigo nodes → cyan → white crests), with a gentle relief so it shimmers.",
    equations: [
      { label: 'circular membrane eigenmode', latex: 'u_{mn}(r,\\theta) = J_m(\\lambda_{mn}\\,r)\\,\\cos(m\\theta), \\quad J_m(\\lambda_{mn}) = 0' },
      { label: 'Faraday-band superposition', latex: 'u(r,\\theta,t) = \\sum_{k} a_k\\,J_{m_k}(\\lambda_k r)\\,\\cos(m_k\\theta)\\,\\cos(\\omega_k t)' },
      { label: 'resonance weighting around the drive Ω', latex: 'a_k = e^{-\\,d\\,|\\lambda_k - \\Omega|}, \\qquad \\omega_k \\propto \\lambda_k' },
    ],
    params: [
      { key: 'drive', symbol: '\\Omega', meaning: 'drive frequency — selects which band of modes resonates (the cymatic "note")' },
      { key: 'modes', symbol: 'K', meaning: 'how many superposed modes (more = denser interference moiré)' },
      { key: 'symmetry', symbol: 'n', meaning: 'forces m ≡ 0 (mod n) → a crisp n-fold rosette' },
      { key: 'damping', symbol: 'd', meaning: 'band width: high = energy concentrated near Ω (sharper), low = broad blur' },
      { key: 'relief', symbol: 'h', meaning: 'surface height (kept gentle so the top-down plate shimmers)' },
      { key: 'speed', symbol: '\\nu', meaning: 'global time-rate of the mode oscillations' },
    ],
    code: "// per mode-change: pick K modes with lambda nearest the drive, store spatial factors\nfor (m = 0; m <= 10n; m += symmetry)\n  for (nr in 1..14) candidates.push({ m, lam: besselJzero(m, nr) });\nchosen = sortByNearest(candidates, drive).slice(0, K);\nfor (mode of chosen) {\n  a = exp(-damping*|lam - drive|);  omega = lam;\n  spatial[i] = a * besselJ(m, lam*r) * cos(m*theta);   // per disk point\n}\n// per frame: u_i = sum_k spatial[k,i] * cos(omega_k * t);  y = u * relief",
    links: [
      { label: 'Cymatics (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Cymatics' },
      { label: 'Faraday wave (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Faraday_wave' },
      { label: 'Vibrations of a circular membrane', url: 'https://en.wikipedia.org/wiki/Vibrations_of_a_circular_membrane' },
    ],
  },
  stokesPhase: {
    title: 'Stokes Phase Surface',
    about:
      "When a physicist evaluates an integral like ∫e^{Φ(z)/ħ}dz in the limit of small ħ, almost all of the answer comes from a handful of SADDLE POINTS of the phase Φ — the method of steepest descent. The eerie part is the Stokes phenomenon: as you slowly turn a parameter, a saddle's contribution can switch on or off discontinuously, even though everything in sight is smooth. This surface makes it geometric. We take the textbook cubic phase Φ(z;s) = z³/3 − s·z over the complex plane and render its real part as a 3-D landscape — a monkey-saddle terrain with two saddle points at z± = ±√s — then light up the steepest-descent paths through them (warm from one saddle, cool from the other). Scrub the argument of s and watch the two descent contours swing into alignment as a saddle's contribution switches across a Stokes line.",
    howItWorks:
      "Over a patch of the complex z-plane we compute Φ = z³/3 − s·z and split it: the height of the terrain is the saturated real part h = HMAX·tanh(ReΦ/HMAX) (the cubic blows up, so tanh caps it into a bounded, finite landscape). The two saddles sit where Φ′(z) = z²−s = 0, i.e. z± = ±√s. Through each saddle runs a steepest-DESCENT contour — the curve along which ImΦ stays constant (= ImΦ at that saddle) while ReΦ falls away fastest; that is the path the integral actually follows. We bake a glow wherever ImΦ ≈ ImΦ(z±) on the descending side, warm orange for z₊ and cool cyan for z₋, plus a bright marker blob at each saddle. The Stokes condition — where a hidden exponential switches on — is Im(Φ(z₊)−Φ(z₋)) = 0, i.e. Im(s^{3/2}) = 0, which happens at arg(s) ∈ {0, 2π/3, 4π/3}. Sweep arg(s) and the two descent curves rotate until they meet at exactly those angles. The terrain and glow recompute only when |s| or arg(s) change; per frame is just a gentle vertical breathing.",
    equations: [
      { label: 'cubic phase over the complex plane', latex: '\\Phi(z; s) = \\tfrac{1}{3}z^{3} - s\\,z' },
      { label: 'saddle points (Φ′ = 0)', latex: "\\Phi'(z) = z^{2} - s = 0 \\;\\Rightarrow\\; z_\\pm = \\pm\\sqrt{s}" },
      { label: 'terrain height (saturated real part)', latex: 'h = H\\,\\tanh\\!\\big(\\operatorname{Re}\\Phi / H\\big)' },
      { label: 'steepest-descent contour through a saddle', latex: '\\operatorname{Im}\\Phi(z) = \\operatorname{Im}\\Phi(z_\\pm), \\quad \\operatorname{Re}\\Phi \\le \\operatorname{Re}\\Phi(z_\\pm)' },
      { label: 'Stokes condition (exponential switches on)', latex: '\\operatorname{Im}\\big(\\Phi(z_+) - \\Phi(z_-)\\big) = 0 \\;\\Leftrightarrow\\; \\arg(s) \\in \\{0, \\tfrac{2\\pi}{3}, \\tfrac{4\\pi}{3}\\}' },
    ],
    params: [
      { key: 'smag', symbol: '|s|', meaning: 'magnitude of s → saddle separation z±=±√|s| (how far apart the two saddles sit)' },
      { key: 'stokes', symbol: '\\arg s', meaning: 'sweeps the argument of s through [0,2π); crossing 0, 2π/3, 4π/3 are the Stokes lines' },
      { key: 'glowWidth', symbol: 'w', meaning: 'width of the steepest-descent glow band around each contour' },
      { key: 'relief', symbol: 'h', meaning: 'vertical exaggeration of the terrain' },
      { key: 'speed', symbol: '\\nu', meaning: 'rate of the gentle vertical breathing' },
    ],
    code: "// per |s|/arg(s) change: build the terrain h=ReΦ and the descent-glow colours\nconst sRe = smag*Math.cos(arg), sIm = smag*Math.sin(arg);\nconst rePhi = (x,y) => x**3/3 - x*y*y - sRe*x + sIm*y;   // Re Φ\nconst imPhi = (x,y) => x*x*y - y**3/3 - sRe*y - sIm*x;   // Im Φ\nconst [zx, zy] = [Math.sqrt(smag)*Math.cos(arg/2),       // saddle z₊ = √s\n                  Math.sqrt(smag)*Math.sin(arg/2)];\nconst imP = imPhi(zx, zy);                                // Im Φ on z₊ contour\nfor (each grid point (x,y)) {\n  h = HMAX*Math.tanh(rePhi(x,y)/HMAX);                    // bounded height\n  glow = Math.exp(-(imPhi(x,y)-imP)**2 / w**2)            // steepest-descent path\n         * (rePhi(x,y) <= rePhi(zx,zy)+0.2 ? 1 : 0.15);   // descending side only\n}",
    links: [
      { label: 'Method of steepest descent (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Method_of_steepest_descent' },
      { label: 'Stokes phenomenon (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Stokes_phenomenon' },
      { label: 'Saddle point (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Saddle_point' },
    ],
  },
  dispersionWave: {
    title: 'Dispersion',
    about:
      "Drop a pebble in still water and rings spread out; do it in a DISPERSIVE medium — where the wave speed depends on wavelength — and something stranger happens: the colours separate. Long and short wavelengths travel at different speeds, so a single white disturbance fans out into a chirp of colour sorted by distance. This is that, rendered as a slowly tumbling grainy bowl: a white-hot point source on the surface, concentric crests rippling outward, and the spectrum smeared across the radius so each crest recolours as it travels — a homage to the diffraction-bloom photographs of generative artist hal09999.",
    howItWorks:
      "A grid of points is laid out on a shallow domed disk (a Fibonacci sunflower packing, jittered so it reads as soft grain rather than a lattice). A source sits off-centre; the height of each point is a travelling radial wave z = A·e^{−γr}·cos(kr − ωt), so crests propagate outward from the source as time advances (this is the only thing that animates — point colours can only be uploaded once, so the motion lives in the geometry). The colour is the dispersed spectrum BAKED by radius: warm at the core, sweeping red → magenta → blue → cyan outward, which is physically what dispersion does — it sorts wavelengths by distance. A dense cluster at the source blooms it white-hot. The bowl has real depth (a base dome) so it reads as 3-D from any angle, and it rocks gently rather than spinning flat. Bounded for all time.",
    equations: [
      { label: 'travelling radial wave (the relief)', latex: 'z(r,t) = A\\,e^{-\\gamma r}\\cos(k\\,r - \\omega t)' },
      { label: 'dispersion: speed depends on wavelength', latex: 'v_{\\text{phase}} = \\frac{\\omega}{k} = v(\\lambda) \\;\\Rightarrow\\; \\text{colours sort by distance}' },
      { label: 'spectrum baked by radius (hue)', latex: 'H(r) = H_0 - \\Delta\\,(r/r_{\\max})^{1.6}' },
      { label: 'domed bowl (depth from every angle)', latex: 'z_{\\text{base}} = D\\,\\big(1 - (r_c/R)^{2}\\big)' },
    ],
    params: [
      { key: 'wavelength', symbol: 'k', meaning: 'spatial frequency — how many concentric rings' },
      { key: 'dispersion', symbol: '\\Delta', meaning: 'how far the spectrum spreads from warm core to cool rim' },
      { key: 'offset', symbol: 's', meaning: 'how far off-centre the point source sits' },
      { key: 'speed', symbol: '\\omega', meaning: 'how fast the crests propagate outward' },
      { key: 'amp', symbol: 'A', meaning: 'relief height of the ripple' },
      { key: 'falloff', symbol: '\\gamma', meaning: 'ripple decay — low = the wave reaches farther across the bowl' },
      { key: 'spin', symbol: '\\nu', meaning: 'rocking rate of the bowl' },
    ],
    code: "// per point: travelling radial wave on a domed bowl, dispersed colour baked by radius\nconst dome = D * (1 - (rc*rc)/(R*R));            // base bowl (depth)\nconst ripple = amp * Math.exp(-r*falloff) * Math.cos(k*r - omega*t);\nconst z = dome + ripple + grain;\n// colour baked once, by distance from the source (the dispersed spectrum):\nconst hue = 0.14 - dispersion * Math.pow(r/rMax, 1.6);   // warm core → cool rim\n// dense white-hot cluster at the source → over-exposed bloom",
    links: [
      { label: 'Dispersion (optics) (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Dispersion_(optics)' },
      { label: 'Wave packet (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Wave_packet' },
      { label: 'hal09999 (generative artist)', url: 'https://twitter.com/hal09999' },
    ],
  },
  crossedDiffraction: {
    title: 'Crossed Diffraction',
    about:
      "Shine a white point source through a diffraction grating — a surface ruled with fine parallel lines — and the light fans into a row of spectra at fixed angles. CROSS two gratings (or use a 2-D mesh) and those rows fire off in several directions at once, turning a single white dot into a radiant lattice of rainbow spokes. It's a classic optics-bench demonstration (and a favourite of the Optics & Photonics community): the centre stays white, and every spoke carries the spectrum repeated, order after order, spreading wider as it goes.",
    howItWorks:
      "A grating with line spacing d sends wavelength λ into bright orders at angles sin θ_m = m·λ/d. The zeroth order (m=0) passes straight through undeviated — that's the white centre, where all colours overlap. Each higher order m is a little spectrum, and because the deflection grows with λ, blue lands nearest the centre and red farthest; higher orders sit farther out and spread wider. Crossed gratings give several such rows at once, so we scatter points along a set of radial spokes, place them at radius ∝ order, and colour each by its wavelength (blue inner → red outer within every order). Soft point blobs give the out-of-focus 'bokeh' look of the photographs; a gentle spin keeps it alive. A flat optical figure, bounded by construction.",
    equations: [
      { label: 'grating equation', latex: 'd\\,\\sin\\theta_m = m\\,\\lambda, \\qquad m = 0, \\pm 1, \\pm 2, \\dots' },
      { label: 'zeroth order is undeviated (white centre)', latex: 'm = 0 \\;\\Rightarrow\\; \\theta_0 = 0 \\ \\text{for all } \\lambda' },
      { label: 'each order is a spectrum (blue inner, red outer)', latex: 'r_m(\\lambda) \\propto m\\,\\lambda \\;\\Rightarrow\\; r(\\text{blue}) < r(\\text{red})' },
    ],
    params: [
      { key: 'arms', symbol: 'N', meaning: 'number of grating-direction spokes' },
      { key: 'orders', symbol: 'M', meaning: 'how many diffraction orders along each spoke' },
      { key: 'spacing', symbol: 'd^{-1}', meaning: 'radial gap between orders (∝ inverse grating constant)' },
      { key: 'spread', symbol: '\\Delta\\lambda', meaning: 'chromatic smear within an order (grows with order)' },
      { key: 'spin', symbol: '\\nu', meaning: 'gentle rotation rate' },
    ],
    code: "// scatter points across the diffraction lattice, colour by wavelength\nconst th = (arm / arms) * 2*Math.PI;            // grating direction\nconst m  = 1 + (order % orders);                 // diffraction order\nconst t  = Math.random();                        // spectral fraction (0=blue, 1=red)\nconst r  = spacing * (m + (t - 0.5) * spread);   // blue inner, red outer\nconst hue = 0.66 * (1 - t);                       // blue → green → red\n// plus a tight white cluster at the centre = the zeroth order",
    links: [
      { label: 'Diffraction grating (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Diffraction_grating' },
      { label: 'Diffraction (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Diffraction' },
      { label: 'Optics & Photonics News', url: 'https://www.optica-opn.org/' },
    ],
  },
  lorenzSwarm: {
    title: 'Lorenz Butterfly Swarm',
    about:
      "The Lorenz attractor is the shape chaos made famous — two spiralling lobes a trajectory hops between, never repeating, forever bounded: the original 'butterfly.' It also named the butterfly EFFECT, the idea that a tiny nudge grows into a wholly different future. This is a swarm of them: a scatter of Lorenz butterflies, each frozen mid-flight and tumbling at its own angle — a nod to Sagan's line that we are 'like butterflies who flutter for a day and think it is forever.'",
    howItWorks:
      "Each butterfly is a Lorenz trajectory ẋ=σ(y−x), ẏ=x(ρ−z)−y, ż=xy−βz (with the classic σ=10, ρ=28, β=8/3), integrated once at build after discarding its transient, so a few thousand points trace out the two-lobed attractor. That point cloud is centred, normalised to a common size, given a random 3-D orientation, and dropped onto a scattered ring. Nothing re-integrates per frame — the shape is baked; each butterfly simply tumbles about its own random axis (a Rodrigues rotation), so the swarm drifts and turns while every wing keeps its exact chaotic form. White on black. Bounded (the Lorenz system is dissipative).",
    equations: [
      { label: 'Lorenz system (each butterfly)', latex: '\\dot{x} = \\sigma(y-x), \\quad \\dot{y} = x(\\rho - z) - y, \\quad \\dot{z} = xy - \\beta z' },
      { label: 'classic parameters', latex: '\\sigma = 10, \\quad \\rho = 28, \\quad \\beta = \\tfrac{8}{3}' },
      { label: 'per-frame tumble (Rodrigues)', latex: '\\mathbf{v}\' = \\mathbf{v}\\cos\\theta + (\\mathbf{k}\\times\\mathbf{v})\\sin\\theta + \\mathbf{k}(\\mathbf{k}\\cdot\\mathbf{v})(1-\\cos\\theta)' },
    ],
    params: [
      { key: 'count', symbol: 'M', meaning: 'number of butterflies in the swarm' },
      { key: 'scatter', symbol: 'R', meaning: 'radius of the ring the butterflies are scattered on' },
    ],
    code: "// each butterfly: bake a Lorenz trajectory, orient it, scatter it; per frame just tumble\nlet [x,y,z] = [0.1, 0, 0.1];\nfor (w in 0..800) step();               // discard transient\nfor (i in 0..K) { step(); pts[i] = [x,y,z]; }   // bake the butterfly\nnormalise(pts); orient(pts, randomFrame); place(pts, ringCentre);\n// per frame: rotate each butterfly about its own axis by rate*t (Rodrigues)",
    links: [
      { label: 'Lorenz system (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Lorenz_system' },
      { label: 'Butterfly effect (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Butterfly_effect' },
      { label: 'Attractor (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Attractor' },
    ],
  },
  attractorMenagerie: {
    title: 'Attractor Menagerie',
    about:
      "A cabinet of curiosities for chaos: a scatter of DIFFERENT strange attractors, each tumbling in its own little frame. Where the Lorenz swarm repeats one species, this mixes the zoo — Lorenz's butterfly, Rössler's folded band, the Aizawa torus-knot, the ghostly cyclic-symmetric Thomas, and Halvorsen's three-fold spiral — so you can see at a glance how many distinct forms bounded chaos can take.",
    howItWorks:
      "Same machinery as the Lorenz swarm, but each butterfly draws from a different ODE. The build cycles through five species — Lorenz, Rössler, Aizawa, Thomas, and Halvorsen — integrating each with its own suitable timestep, discarding the transient, and baking a few thousand points into the attractor's shape. Every cloud is normalised to a common size (so a sprawling Lorenz and a compact Rössler sit together), given a random orientation, scattered on a ring, and tumbled per frame. The shapes are fixed; only the rotation animates. All five systems are dissipative, so the swarm stays bounded.",
    equations: [
      { label: 'Rössler', latex: '\\dot{x} = -y - z, \\quad \\dot{y} = x + a y, \\quad \\dot{z} = b + z(x - c)' },
      { label: 'Thomas (cyclically symmetric)', latex: '\\dot{x} = \\sin y - b x, \\quad \\dot{y} = \\sin z - b y, \\quad \\dot{z} = \\sin x - b z' },
      { label: 'Halvorsen (cyclically symmetric)', latex: '\\dot{x} = -a x - 4y - 4z - y^{2}, \\ \\text{(and cyclic in } x,y,z)' },
    ],
    params: [
      { key: 'count', symbol: 'M', meaning: 'number of attractors in the swarm' },
      { key: 'scatter', symbol: 'R', meaning: 'radius of the ring they are scattered on' },
    ],
    code: "// like the Lorenz swarm, but butterfly b uses species[b % 5]:\n// ['lorenz','rossler','aizawa','thomas','halvorsen'] — each with its own dt\nconst sp = MENAGERIE[b % MENAGERIE.length];\nfor (i in 0..K) { [x,y,z] = stepSpecies(sp, x,y,z, DT[sp]); pts[i] = [x,y,z]; }\nnormalise(pts); orient(pts); scatter(pts); // per frame: tumble",
    links: [
      { label: 'List of chaotic maps / attractors', url: 'https://en.wikipedia.org/wiki/List_of_chaotic_maps' },
      { label: 'Rössler attractor (Wikipedia)', url: 'https://en.wikipedia.org/wiki/R%C3%B6ssler_attractor' },
      { label: 'Thomas’ cyclically symmetric attractor', url: 'https://en.wikipedia.org/wiki/Thomas%27_cyclically_symmetric_attractor' },
    ],
  },
  solarCorona: {
    title: 'Solar Corona',
    about:
      "The Sun in extreme ultraviolet — the way space telescopes like SDO watch it storm. What glows isn't fire but million-degree plasma trapped on MAGNETIC FIELD LINES. Each active region is a pair of opposite-polarity sunspots (magnetic footpoints), and coronal loops arch between them along the field, brightening when the region flares. Scattered across the disk in the ±30° latitude bands where sunspots emerge, with a mottled granular surface, a glowing limb, and plumes at the poles where the field opens to the solar wind. Lit in the teal of the 171 Å channel.",
    howItWorks:
      "Rather than simulate the plasma fluid, we build the magnetic structure it rides. A Fibonacci-sphere shell of points makes the granular surface (limb-brightened for free by additive density where the line of sight grazes the shell). Active regions are placed at sunspot latitudes; each is a fan of coronal loops, and every loop is a semicircular arc between two footpoints — a great-circle path (slerp) lifted to a height that grows with the footpoint separation, brightest and whitest at the feet. A couple of regions host a FLARE KERNEL — a compact, blindingly white-hot core standing in for an X-class flare brightening, ringed by a low, intense post-flare loop crown. A handful of active sites also ERUPT: on a staggered cycle they fling out hot plasma along a height envelope — a rise-and-fall arc for confined prominences, or an ever-rising escape for a coronal mass ejection — drifting tangentially into a curved jet. Near the poles, short near-radial streamers stand in for open-field plumes; a faint outer shell gives the corona its glow; and the whole disk turns with the ~25-day rotation. Bounded by construction.",
    equations: [
      { label: 'coronal loop = arc between magnetic footpoints', latex: '\\mathbf{r}(s) = \\big(R + H\\sin\\pi s\\big)\\,\\operatorname{slerp}(\\mathbf{f}_+, \\mathbf{f}_-, s), \\quad s \\in [0,1]' },
      { label: 'footpoints straddle the region centre', latex: '\\mathbf{f}_\\pm = \\mathbf{c}\\cos\\delta \\pm \\hat{\\mathbf{d}}\\sin\\delta' },
      { label: 'active regions in the sunspot bands', latex: '\\lvert\\text{lat}\\rvert \\in [10^\\circ,\\ 42^\\circ]' },
      { label: 'eruption height envelope over phase τ', latex: 'h(\\tau) = s\\cdot\\begin{cases} \\tau & \\text{CME (escapes)} \\\\ 4\\tau(1-\\tau) & \\text{prominence (falls back)} \\end{cases}' },
    ],
    params: [
      { key: 'regions', symbol: 'n', meaning: 'number of active regions (sunspot loop bundles)' },
      { key: 'loopHeight', symbol: 'H', meaning: 'how high the coronal loops arch above the surface' },
      { key: 'activity', symbol: '\\alpha', meaning: 'share of the corona spent on loops vs the quiet surface' },
      { key: 'eruptions', symbol: '\\omega_e', meaning: 'how often the active sites erupt (prominence + CME cycle rate)' },
      { key: 'spin', symbol: '\\nu', meaning: 'solar rotation rate' },
    ],
    code: "// each active region: a fan of loops between two magnetic footpoints\nconst f_plus  = c*cos(sep) + dir*sin(sep);   // footpoints straddle region centre c\nconst f_minus = c*cos(sep) - dir*sin(sep);\nfor (s in 0..1) {                             // arc from foot to foot\n  const base = slerp(f_plus, f_minus, s);     // great-circle path\n  const rad  = R + H*sin(PI*s);               // lifted into a loop\n  point = base * rad;  brightness = hot at the feet, teal along the crown\n}",
    links: [
      { label: 'Corona (Sun) (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Corona' },
      { label: 'Coronal loop (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Coronal_loop' },
      { label: 'Solar Dynamics Observatory (171 Å)', url: 'https://en.wikipedia.org/wiki/Solar_Dynamics_Observatory' },
    ],
  },
  spiralGalaxy: {
    title: 'Spiral Galaxy',
    about:
      "Spiral arms are one of astronomy's great illusions: they are not rivers of stars but WAVES. If they were solid structures, they'd wind up into a tight coil within a few rotations — the 'winding problem.' Density-wave theory (Lindblad; Lin & Shu) resolves it: the arms are a standing wave, a slowly-rotating pattern of denser regions that stars drift into and out of, like cars bunching through a traffic jam. It's also why measuring an arm's exact distance is so slippery — recent X-ray work pushed the Milky Way's outer arms up to 10% farther than we thought. You're not measuring a wall; you're measuring a wave.",
    howItWorks:
      "Each star rides a slightly elliptical orbit centred on the galaxy. The trick is that every orbit's ellipse is rotated a bit more than the one just inside it — the orientation winds with radius (θ₀ = pitch·a). Where neighbouring ellipses crowd, stars pile up along two spiral loci: the arms. Per frame each star advances along its orbit (a flat rotation curve, so orbital speed ∝ 1/radius), while the whole set of ellipse orientations precesses rigidly at the 'pattern speed' — so the arm pattern turns slowly while stars stream through it. The innermost ellipses are nearly aligned, forming the central bar; a bright bulge anchors the centre; pink knots mark star-forming regions. Colour runs warm-white in the bulge to blue in the outer arms. Bounded (every orbit is closed).",
    equations: [
      { label: 'orbit ellipse, orientation winds with radius', latex: '\\theta_0(a) = \\text{pitch}\\cdot a + \\Omega_p\\, t' },
      { label: 'star position (ellipse of semi-axes a, b=a(1−e))', latex: '\\begin{pmatrix}x\\\\y\\end{pmatrix} = R(\\theta_0)\\begin{pmatrix}a\\cos\\psi\\\\ b\\sin\\psi\\end{pmatrix}' },
      { label: 'orbital phase (flat rotation curve)', latex: '\\psi(t) = \\psi_0 + \\frac{V_0}{a + a_c}\\,t' },
      { label: 'the arm is a pattern, not the stars', latex: '\\Omega_p \\ne \\Omega_\\star(a) \\;\\Rightarrow\\; \\text{stars flow through the arms}' },
    ],
    params: [
      { key: 'pitch', symbol: 'k', meaning: 'how fast the ellipse orientation winds with radius → arm tightness' },
      { key: 'eccentricity', symbol: 'e', meaning: 'how elliptical the orbits are (stronger bar + arms)' },
      { key: 'patternSpeed', symbol: '\\Omega_p', meaning: 'rotation speed of the arm pattern (independent of the stars)' },
      { key: 'orbitSpeed', symbol: 'V_0', meaning: 'orbital speed of the stars along their ellipses' },
    ],
    code: "// each star: an ellipse whose orientation winds with radius; stars flow, pattern precesses\nconst psi = psi0 + (V0 / (a + CORE)) * t;      // orbital phase (flat rotation curve)\nconst th0 = pitch * a + patternSpeed * t;       // ellipse orientation (winds + precesses)\nconst b = a * (1 - ecc);\nconst ex = a*cos(psi), ey = b*sin(psi);\nx = cos(th0)*ex - sin(th0)*ey;                  // ellipses crowd → spiral arms\ny = sin(th0)*ex + cos(th0)*ey;",
    links: [
      { label: 'Density wave theory (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Density_wave_theory' },
      { label: 'Spiral galaxy / winding problem', url: 'https://en.wikipedia.org/wiki/Spiral_galaxy#Winding_problem' },
      { label: 'Lin–Shu density wave theory', url: 'https://en.wikipedia.org/wiki/Lin%E2%80%93Shu_density_wave_theory' },
    ],
  },
  galaxyCollision: {
    title: 'Galaxy Collision',
    about:
      "The Milky Way and Andromeda (M31) are falling toward each other at about 110 km/s and will begin to merge in roughly 4–5 billion years, coalescing into a single elliptical galaxy sometimes nicknamed 'Milkomeda.' This is the classic way to simulate that encounter — the RESTRICTED N-body model Alar and Juri Toomre used in 1972 to explain the bizarre bridges and tails of interacting galaxies (the Antennae, the Mice). Two massive cores carry the galaxies; clouds of near-massless stars ride around them; and gravity does the rest, flinging out the great tidal tails and drawing bridges of stars between the two before they finally settle into one.",
    howItWorks:
      "Two point cores hold the mass and orbit each other on an elliptical encounter. Around each is a disk of test stars on near-circular orbits (softened Kepler speeds), the two disks tilted at different angles. Each star feels the gravity of BOTH cores but not of the other stars — that's the 'restricted' problem, and it's what makes it cheap: an O(N) force evaluation, integrated with a symplectic step. As the cores swing through pericenter, the differential tug across each disk is exactly a tidal force: the near side is pulled in, the far side flung out, drawing the long curved tidal tails and a bridge between the galaxies. A little dynamical friction drains the orbit so the cores spiral in and merge; then the encounter replays. Everything is recentred on the barycentre so it stays framed. Bounded (softened gravity, clamped kicks). THE CLOCK: the sim runs in model units, calibrated so the default orbit's first close passage lands at the published ≈4.3 billion years from today — the 'sim time' readout in the telemetry panel counts real gigayears (T + 4.3 Gyr as the disks first graze, the merger a few Gyr later, then billions of years of the remnant relaxing into shells before the encounter replays).",
    equations: [
      { label: 'a test star feels both cores (softened)', latex: '\\ddot{\\mathbf{r}} = \\sum_{k=1}^{2} G M_k \\frac{\\mathbf{R}_k - \\mathbf{r}}{\\big(\\lvert\\mathbf{R}_k - \\mathbf{r}\\rvert^{2} + \\varepsilon^{2}\\big)^{3/2}}' },
      { label: 'the cores orbit each other', latex: '\\ddot{\\mathbf{R}}_1 = G M_2 \\frac{\\mathbf{R}_2-\\mathbf{R}_1}{\\lvert\\mathbf{R}_2-\\mathbf{R}_1\\rvert^{3}} - \\gamma\\,\\dot{\\mathbf{R}}_1 \\ \\text{(dynamical friction)}' },
      { label: 'disk stars start on circular orbits', latex: 'v_c(r) = \\sqrt{\\tfrac{G M_k}{\\sqrt{r^{2}+\\varepsilon^{2}}}}' },
    ],
    params: [
      { key: 'massRatio', symbol: 'M_2/M_1', meaning: 'Andromeda-to-Milky-Way mass ratio' },
      { key: 'pericenter', symbol: 'r_p', meaning: 'closest approach of the two cores (smaller = a more violent, tail-throwing passage)' },
      { key: 'inclination', symbol: 'i', meaning: 'tilt of Andromeda\'s disk relative to the orbit plane' },
      { key: 'friction', symbol: '\\gamma', meaning: 'dynamical friction — how fast the orbit decays into the final merger' },
      { key: 'speed', symbol: 's', meaning: 'playback speed of the multi-billion-year encounter' },
    ],
    code: "// restricted N-body: two cores orbit; each star feels both, integrated per frame\nfor (sub of substeps) {\n  integrateCores(sdt);                     // mutual gravity + dynamical-friction drag\n  for (star of stars) {\n    let a = grav(coreA, star) + grav(coreB, star);   // softened 1/r²\n    star.v += a * sdt;  star.x += star.v * sdt;      // symplectic Euler\n  }\n}\n// tidal tails + bridges emerge; friction spirals the cores together → merger",
    links: [
      { label: 'Andromeda–Milky Way collision (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Andromeda%E2%80%93Milky_Way_collision' },
      { label: 'Toomre & Toomre 1972 (galactic bridges & tails)', url: 'https://ui.adsabs.harvard.edu/abs/1972ApJ...178..623T/abstract' },
      { label: 'Interacting galaxy (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Interacting_galaxy' },
    ],
  },
  lightning: {
    title: 'Lightning',
    about:
      "A cloud-to-ground strike is dielectric breakdown, and its shape is Laplacian growth — the same physics family as our DLA dendrite. A STEPPED LEADER crackles downward from the cloud in discrete stochastic steps, branching into a faint fractal tree (fractal dimension ≈ 1.7, per the dielectric-breakdown model of Niemeyer, Pietronero & Wiesmann). Then the part nobody sees coming: the flash you photograph is not the leader coming down but the RETURN STROKE going UP — the instant one branch attaches to ground, a white-hot surge races back up the winning channel at a third the speed of light, and the losing branches never brighten. Then it all decays, and the next strike grows a different tree.",
    howItWorks:
      "Each strike generates a fresh branching tree from a deterministic seed: a walker steps downward with momentum, a downward pull, and strong lateral wander (the jagged kinks), stochastically forking side branches; the first branch to reach the ground wins. Colours upload once, so the whole cycle is choreographed with POSITIONS: unborn channel points park inside the cloud clump (fattening its glow), then fly to their tree positions in birth order — the stepped leader. On attachment, a reservoir of white-hot points floods the MAIN CHANNEL from the ground up (the return stroke), jittering every frame so the channel crackles. In decay everything retracts into the cloud, a dark beat passes, and a new tree grows with the current branchiness/wander. The HDR bloom pass does the rest.",
    equations: [
      { label: 'dielectric-breakdown growth rule (DBM)', latex: 'p(\\text{site}) \\propto \\lvert\\nabla\\varphi\\rvert^{\\eta}, \\qquad \\nabla^2\\varphi = 0' },
      { label: 'stepped leader: biased random walk', latex: '\\hat{\\mathbf{d}}_{k+1} = \\operatorname{norm}\\big(\\mu\\,\\hat{\\mathbf{d}}_k - \\beta\\,\\hat{\\mathbf{y}} + w\\,\\boldsymbol{\\xi}\\big)' },
      { label: 'fractal dimension of the discharge', latex: 'D \\approx 1.7 \\ (\\eta = 1)' },
      { label: 'return stroke: only the attached channel fires', latex: 'v_{\\text{return}} \\sim c/3, \\quad \\text{ground} \\to \\text{cloud}' },
    ],
    params: [
      { key: 'branchiness', symbol: 'p_b', meaning: 'side-branch probability per step — how bushy the next strike grows' },
      { key: 'wander', symbol: 'w', meaning: 'lateral randomness of the leader — how jagged the channel kinks' },
      { key: 'speed', symbol: '\\nu', meaning: 'strike rate — how fast the grow → flash → decay cycle runs' },
    ],
    code: "// per strike: grow a branching leader tree (deterministic seed), find the grounded channel\nwhile (walkers) {\n  dir = norm(0.42*dir + down*(0.38+0.42*rnd) + wander*(rnd-0.5));\n  step(dir); if (rnd < branchiness) fork();\n  if (y <= GROUND) { mainChannel = backtrackParents(); break; }\n}\n// cycle (positions only — colours are baked):\n// GROW: reveal tree points in birth order (unborn park in the cloud)\n// FLASH: white-hot pool floods mainChannel ground→up, per-frame crackle jitter\n// DECAY: retract to cloud → dark beat → next strike",
    links: [
      { label: 'Lightning (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Lightning' },
      { label: 'Dielectric breakdown model', url: 'https://en.wikipedia.org/wiki/Dielectric_breakdown_model' },
      { label: 'Stepped leader & return stroke (NWS)', url: 'https://www.weather.gov/safety/lightning-science-return-stroke' },
    ],
  },
  bioBay: {
    title: 'Bioluminescent Bay',
    about:
      "In a handful of bays on Earth — Mosquito Bay in Vieques, Puerto Rico most famously — the water is so thick with dinoflagellates that it answers touch with light. Each single cell carries a luciferin flash triggered by MECHANICAL SHEAR: nothing glows until something moves, and then everything does. Put your hand in and the water lights around it; a paddle stroke, a fish, a wave — each trails a wake of cold blue fire that blooms and fades. The flash is thought to be a burglar alarm: startle the grazer, light it up for its own predators. This is that stimulus–response, simulated: invisible swimmers roam the dark surface, and the plankton answer.",
    howItWorks:
      "The bay is a dark plane of near-invisible plankton speckle with a gentle swell. Invisible swimmers roam bounded organic paths (two-tone Lissajous curves), each faintly aglow — coated, like anything moving in these bays, in flashing plankton. The wakes come from a pool of flash points on staggered recycle offsets: while a slot is lit it holds the exact spot the swimmer passed (its activation time stays fixed as the clock advances — the phase trick), rising with the flash and diffusing outward as it sinks; when its glow ends it parks in a deep scattered layer, where thousands of spent points thin into the bay's faint ambient sea-sparkle. Colours never change after upload — the entire flash-and-fade is choreographed with positions. Bounded ∀t.",
    equations: [
      { label: 'the flash is a shear response', latex: '\\text{flash} \\iff \\dot{\\gamma} > \\dot{\\gamma}_c \\quad \\text{(luciferin–luciferase, triggered mechanically)}' },
      { label: 'swimmer path (bounded organic roam)', latex: '\\mathbf{s}(t) = \\big(a\\sin(\\omega_1 t{+}\\phi) + b\\sin(\\omega_2 t{+}\\phi\'),\\ \\dots\\big)' },
      { label: 'a lit slot holds its wake spot', latex: '\\tau = (t + o_i) \\bmod T < g \\;\\Rightarrow\\; \\mathbf{x}_i = \\mathbf{s}(t - \\tau) \\ \\text{(constant while lit)}' },
    ],
    params: [
      { key: 'swimmers', symbol: 'n', meaning: 'how many invisible bodies stir the bay' },
      { key: 'glow', symbol: 'g', meaning: 'flash duration — how long each disturbed patch burns (wake length)' },
      { key: 'stir', symbol: '\\nu', meaning: 'how fast the swimmers roam' },
    ],
    code: "// flash pool on staggered recycle: lit slots hold the swimmer's past position\nconst phase = (t + offset_i) % CYCLE;\nif (phase < glow) {\n  const wake = swimPos(t - phase);        // constant while this slot burns\n  const u = phase / glow;                  // 0 → 1 across the flash\n  pos = wake + jitter * (0.015 + 0.11*u*u);   // diffuse outward\n  pos.y = surface + rise(u) - sink(u);         // bloom up, settle down\n} else {\n  pos = deepPark_i;                        // spent → faint ambient sea-sparkle\n}",
    links: [
      { label: 'Mosquito Bay, Vieques (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Mosquito_Bay' },
      { label: 'Dinoflagellate bioluminescence', url: 'https://en.wikipedia.org/wiki/Dinoflagellate#Bioluminescence' },
      { label: 'Bioluminescence (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Bioluminescence' },
    ],
  },
  combJelly: {
    title: 'Comb Jelly',
    about:
      "The ctenophore's rainbow is one of the ocean's best misdirections: it is NOT bioluminescence. Eight meridional COMB ROWS of beating cilia — the largest cilia in the animal kingdom, fused into paddle-like plates — act as moving diffraction gratings. As metachronal waves of beating sweep down each row, the diffracted colour sweeps with them: shimmering rainbow bands travelling aft along a glassy, almost invisible body. Comb jellies are also among the oldest animal lineages on Earth — possibly the sister group to ALL other animals — drifting and shimmering for 700 million years.",
    howItWorks:
      "The body is a translucent prolate ellipsoid rendered as a sparse pale speckle (translucency by low point density), breathing gently and tumbling about a tilted axis. Each of the eight comb rows is a TRAIN of points on a meridian: colours are baked once, cycling through the spectrum three times along each row's slot order, and the whole train marches aft (u ← u + wave·t, wrapped) — so the rainbow bands physically travel down the row exactly as the metachronal wave does on the animal. Per-point tangential jitter gives the rows their comb-plate width; a slight outward lift keeps them riding just proud of the body. Bounded by construction.",
    equations: [
      { label: 'diffraction from the cilia grating', latex: 'd\\,\\sin\\theta_m = m\\,\\lambda \\quad \\text{(structural colour, not emission)}' },
      { label: 'metachronal wave down each row', latex: 'u_i(t) = (u_i^0 + v\\,t) \\bmod 1, \\qquad \\theta = u\\,\\pi\\,u_{\\max}' },
      { label: 'comb row on the ellipsoid meridian', latex: '\\mathbf{x} = \\big(a\\sin\\theta\\cos\\varphi_r,\\ b\\cos\\theta,\\ a\\sin\\theta\\sin\\varphi_r\\big), \\quad \\varphi_r = \\tfrac{2\\pi r}{8}' },
    ],
    params: [
      { key: 'wave', symbol: 'v', meaning: 'metachronal wave speed — how fast the rainbow sweeps down the rows' },
      { key: 'tumble', symbol: '\\nu', meaning: 'slow drift-tumble of the animal' },
      { key: 'pulse', symbol: 'p', meaning: 'gentle body breathing' },
    ],
    code: "// each comb row: a rainbow train of points marching down the meridian\nconst u = (u0_i + t * wave) % 1;          // the train marches aft\nconst theta = u * PI * 0.86;               // pole → near the mouth\nconst phi = (row / 8) * TAU;               // eight rows\npos = ellipsoid(theta, phi) * (1 + lift_i);\n// colour was BAKED by slot order (3 spectral repeats per row) —\n// as the train moves, the rainbow bands travel: the diffraction wave",
    links: [
      { label: 'Ctenophora (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Ctenophora' },
      { label: 'Metachronal rhythm (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Metachronal_rhythm' },
      { label: 'Structural coloration (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Structural_coloration' },
    ],
  },
  jellyfishFountain: {
    title: 'Jellyfish Fountain',
    about:
      "A dome of luminous tendrils that beats like a jellyfish bell — every strand a real rope simulation, not a keyframed curve. This is ETHERSIM's first constraint-dynamics system: position-based Verlet ropes, the workhorse of cloth and hair in games, here grown into the 'jellyfish fountain' form beloved of the creative-coding world (Artem Korenevych's Atokirina seeds among them) — radial tendrils launched outward, arcing over, and dangling into a breathing dome.",
    howItWorks:
      "Each tendril is a chain of nodes integrated with VERLET dynamics: the velocity is implicit in the previous position (x ← x + (x−x_prev)·damping + a·dt²), which makes ropes unconditionally stable to constrain. After integration, a few constraint passes pull every segment back to its rest length — each pass moves both endpoints toward compliance, roots immovable. The roots pin to a crown ring that BEATS: a sharp bell-pulse envelope widens the ring and fires an outward 'ejection pressure' down the strands; the kick propagates through the constraints, gravity and damping settle the dome back between beats, and an ambient current sways everything. Render points are interpolated densely along the segments (a few dozen per rope segment), colour-graded once from warm crown to cyan tips. Bounded — pinned, damped, and a rope can never exceed its own length.",
    equations: [
      { label: 'Verlet step (velocity is implicit)', latex: '\\mathbf{x}\\leftarrow \\mathbf{x} + (\\mathbf{x} - \\mathbf{x}_{prev})\\,\\delta + \\mathbf{a}\\,dt^2' },
      { label: 'distance constraint (per segment, iterated)', latex: '\\Delta = \\frac{\\lVert\\mathbf{x}_b - \\mathbf{x}_a\\rVert - L}{\\lVert\\mathbf{x}_b - \\mathbf{x}_a\\rVert}\\,(\\mathbf{x}_b - \\mathbf{x}_a), \\quad \\mathbf{x}_{a,b} \\mp\\!= \\tfrac{\\Delta}{2}' },
      { label: 'bell beat (crown pulse envelope)', latex: 'B(t) = \\max\\big(0, \\sin(2\\pi\\nu t)\\big)^3' },
    ],
    params: [
      { key: 'strands', symbol: 'S', meaning: 'number of tendrils around the crown (re-seeds the dome)' },
      { key: 'pulse', symbol: '\\nu', meaning: 'bell beat rate — each pulse kicks the dome outward' },
      { key: 'gravity', symbol: 'g', meaning: 'how hard the tendrils dangle' },
      { key: 'sway', symbol: 'w', meaning: 'ambient water current' },
    ],
    code: "// per tendril: Verlet integrate, then constrain segment lengths (root pinned)\nfor (k in 1..K) {\n  const v = (x[k] - prev[k]) * 0.985;      // implicit velocity + damping\n  prev[k] = x[k];\n  x[k] += v + (g + ejection*beat + sway) * dt*dt;\n}\nx[0] = crownRing(beat);                     // pinned to the pulsing crown\nfor (iter of 3) for (k in 1..K)\n  enforce |x[k] - x[k-1]| = L;              // position-based rope\n// render: dozens of glow points lerped along each segment",
    links: [
      { label: 'Verlet integration (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Verlet_integration' },
      { label: 'Position-based dynamics (Müller et al.)', url: 'https://matthias-research.github.io/pages/publications/posBasedDyn.pdf' },
      { label: 'Atokirina — Artem Korenevych (@artcreativecode)', url: 'https://x.com/artcreativecode' },
    ],
  },
  structureFormation: {
    title: 'Structure Formation',
    about:
      "How the universe got its shape. At recombination the cosmos was smooth to one part in 100,000; today it is a vast web of galaxy filaments wrapped around enormous voids — the structure that surveys like the Rubin Observatory's LSST are now mapping across billions of galaxies. The bridge between those two states is gravity amplifying the primordial ripples, and its textbook model is the ZEL'DOVICH APPROXIMATION (1970): every parcel of matter simply coasts along a straight line set at the beginning, x = q + D(t)·ψ(q). Where those lines converge, matter piles into sheets ('Zel'dovich pancakes'), then filaments, then the glowing knots where clusters live; where they diverge, the voids empty. The sim clock runs in real gigayears — T+13.8 Gyr is today — and because dark energy freezes the growth factor, you can watch cosmic construction slow and STOP a few tens of Gyr from now: the web's final form.",
    howItWorks:
      "First-order Lagrangian perturbation theory, honestly implemented. A displacement potential is synthesised from a few dozen random plane-wave modes with power tilted toward the largest scales; its gradient gives each particle a fixed displacement vector ψ(q), and its divergence gives the local convergence −∇·ψ — the particle's DESTINY, computed analytically at build time: positive convergence means it will land on the web (coloured warm and bright), negative means it drains into a void (dim blue). The field is normalised so the rms convergence reaches ≈1.25 at D=1 — by today the 1σ regions have shell-crossed into caustics. Per frame only one scalar advances: the ΛCDM growth factor D(t), from the exact flat-universe scale factor a(t) ∝ sinh^{2/3}(t/t_Λ) and the Carroll–Press–Turner fit for D(a). Every particle then moves by a single multiply-add — 13.8 Gyr of cosmology at 60 fps, with dark energy's growth freeze built into the curve.",
    equations: [
      { label: "Zel'dovich approximation (straight-line coasting)", latex: '\\mathbf{x}(t) = \\mathbf{q} + D(t)\\,\\boldsymbol{\\psi}(\\mathbf{q})' },
      { label: 'shell-crossing → caustics (the web)', latex: 'D\\,\\lvert\\nabla\\!\\cdot\\!\\boldsymbol{\\psi}\\rvert \\;\\gtrsim\\; 1' },
      { label: 'flat ΛCDM scale factor', latex: 'a(t) = \\Big(\\tfrac{\\Omega_m}{\\Omega_\\Lambda}\\Big)^{1/3} \\sinh^{2/3}\\!\\big(t/t_\\Lambda\\big)' },
      { label: 'linear growth (Carroll–Press–Turner)', latex: 'D(a) \\propto a\\,\\frac{\\tfrac{5}{2}\\Omega_m(a)}{\\Omega_m(a)^{4/7} - \\Omega_\\Lambda(a) + \\big(1+\\tfrac{\\Omega_m(a)}{2}\\big)\\big(1+\\tfrac{\\Omega_\\Lambda(a)}{70}\\big)}' },
    ],
    params: [
      { key: 'largeScale', symbol: 'n_s', meaning: 'spectral tilt — how much of the power sits in the biggest waves (bigger sheets and voids)' },
      { key: 'strength', symbol: '\\sigma', meaning: 'clustering amplitude — how far past shell-crossing the web collapses' },
      { key: 'speed', symbol: '\\nu', meaning: 'cosmic time rate, in gigayears per second' },
    ],
    code: "// build once: displacement field + each particle's destiny (both analytic)\nfor (mode of MODES) { psi -= (k/|k|)*A*sin(k·q + χ);  conv += |k|*A*cos(k·q + χ); }\nnormalise(psi) so rms(conv) = 1.25 at D=1;    // today = a shell-crossed web\ncolour by conv: collapsing → warm bright, void-bound → dim blue\n// per frame: ONE scalar of cosmology, one multiply-add per particle\nconst a = cbrt(Om/Ol) * sinh(t/tL)**(2/3);     // ΛCDM expansion\nconst D = carrollPressTurner(a);                // growth (freezes under Λ)\nx = q + strength * D * psi;",
    links: [
      { label: "Zel'dovich approximation (Wikipedia)", url: 'https://en.wikipedia.org/wiki/Zeldovich_approximation' },
      { label: 'Large-scale structure (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Observable_universe#Large-scale_structure' },
      { label: 'Vera C. Rubin Observatory / LSST', url: 'https://en.wikipedia.org/wiki/Vera_C._Rubin_Observatory' },
    ],
  },
  whiteHole: {
    title: 'White Hole',
    about:
      "The time-reverse of a black hole — and the other half of the same exact geometry. The full Schwarzschild solution of general relativity contains both: a region whose horizon everything can enter but nothing can leave, and its mirror, a region whose horizon everything can LEAVE but nothing can enter. A white hole doesn't pull the universe in; it pours itself out. Honesty first: no white hole has ever been observed, and it may be an idealised solution nature never builds (it requires a past singularity already in place). But the mathematics is exact — general relativity permits a horizon that only ejects — and this is that mathematics, drawn: Flamm's paraboloid for the spatial geometry, a molten ring at r = 2M, and matter erupting along exact time-reversed free-fall paths.",
    howItWorks:
      "The funnel is the true spatial cross-section of the Schwarzschild geometry — Flamm's paraboloid, w(r) = 2√(2M(r−2M)) — the same embedding our wormhole uses for its bridge, sampled as a faint gridded point mesh. The horizon sits at the throat lip, r_s = 2M, drawn as a dense molten ring (the bloom pass makes it blaze). The ejecta are the physics: radial free-fall REVERSED. Infalling 'rain-frame' matter obeys dr/dτ = −√(2M/r); flip the sign and the exact solution has r^{3/2} advancing linearly in proper time — so each particle's whole flight is analytic (no integration, no drift): it erupts through the horizon at escape speed and decelerates forever as it climbs, never able to return, exactly as an infalling particle could never have escaped. A little angular momentum fans the fountain into spirals that tighten near the throat; phase-staggered launches make the streams continuous.",
    equations: [
      { label: 'Schwarzschild metric (outside the horizon)', latex: 'ds^2 = -\\Big(1-\\tfrac{2M}{r}\\Big)dt^2 + \\Big(1-\\tfrac{2M}{r}\\Big)^{-1}dr^2 + r^2 d\\Omega^2' },
      { label: 'the horizon (G = c = 1)', latex: 'r_s = 2M' },
      { label: 'time-reversed rain-frame flight', latex: '\\frac{dr}{d\\tau} = +\\sqrt{\\tfrac{2M}{r}} \\;\\Rightarrow\\; r^{3/2}(\\tau) = r_s^{3/2} + \\tfrac{3}{2}\\sqrt{2M}\\,\\tau' },
      { label: "Flamm's paraboloid (the funnel)", latex: 'w(r) = 2\\sqrt{2M\\,(r - 2M)}' },
    ],
    params: [
      { key: 'mass', symbol: 'M', meaning: 'the mass — sets the horizon radius r_s = 2M and reshapes the funnel' },
      { key: 'spin', symbol: 'L', meaning: 'angular momentum of the ejecta — fans the fountain into spirals' },
      { key: 'speed', symbol: '\\nu', meaning: 'eruption rate (playback of the analytic flights)' },
    ],
    code: "// ejecta: EXACT time-reversed free-fall (no integrator — r^{3/2} is linear in τ)\nconst tau = (t*rate + phase_i) % 1;              // staggered, continuous streams\nconst r = (rs**1.5 + tau*(RMAX**1.5 - rs**1.5))**(2/3);  // erupts fast, climbs slow\nconst th = theta_i + spin*(1 - r/RMAX)*2.2;      // spirals tighten near the throat\ny = flamm(r);                                     // ride the embedding surface\n// horizon ring at r = 2M: dense molten points — the surface nothing re-enters",
    links: [
      { label: 'White hole (Wikipedia)', url: 'https://en.wikipedia.org/wiki/White_hole' },
      { label: 'Schwarzschild metric (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Schwarzschild_metric' },
      { label: "Flamm's paraboloid", url: 'https://en.wikipedia.org/wiki/Schwarzschild_metric#Flamm.27s_paraboloid' },
    ],
  },
  marsClouds: {
    title: 'Martian Clouds',
    about:
      "In 2021 the Curiosity rover looked up at twilight and photographed something wonderful: noctilucent 'mother-of-pearl' clouds shimmering in pastel bands, 60–80 km above a desert planet — some of them made of CO₂ ice, dry-ice clouds glowing after sunset. The iridescence is honest optics, the same physics as Earth's rare polar stratospheric clouds: in a young cloud all the droplets are nearly the SAME size, and each size diffracts sunlight into its own angle — so bands of uniform droplet size paint bands of soft colour. (The famous internet versions of this image tend to be oversaturated; the real thing is subtle pearl pinks, teals and golds, and that's what we model.) It opens ETHERSIM's Atmosphere family.",
    howItWorks:
      "A thin, patchy cloud sheet rides high over a dim rust horizon. Its undulation is a train of atmospheric GRAVITY WAVES — buoyancy oscillations, the wave-trains thin Martian air carries especially cleanly — implemented as a few coherent interfering waves that ripple the sheet while a steady wind advects it (with a seamless wrap). The iridescence is baked per cloud parcel, which is physically right: droplet size is a property of the parcel, so the colour bands ride the wind with the cloud. A slowly-varying droplet-size proxy across the sheet sets the hue (pearl teal ↔ pink ↔ gold), band cores — where sizes are most uniform — get the most saturation, and a patchy density field keeps the edges wispy and dim. Colours upload once; the waves and the wind do all the moving.",
    equations: [
      { label: 'iridescence: diffraction angle set by droplet size', latex: '\\theta_{\\text{scatter}} \\sim \\frac{\\lambda}{\\pi\\, d} \\;\\Rightarrow\\; \\text{uniform } d \\text{ → pure colour bands}' },
      { label: 'gravity-wave train (buoyancy oscillations)', latex: 'y(x,z,t) = Y_0 + \\sum_i A_i \\sin(\\mathbf{k}_i\\!\\cdot\\!\\mathbf{x} \\mp \\omega_i t)' },
      { label: 'wind advection (parcels carry their colour)', latex: 'x(t) = x_0 + v_w t \\ (\\text{mod } L)' },
    ],
    params: [
      { key: 'bands', symbol: 'n_b', meaning: 'droplet-size band frequency — how many colour bands cross the sheet' },
      { key: 'waviness', symbol: 'A', meaning: 'gravity-wave amplitude — how strongly the sheet undulates' },
      { key: 'wind', symbol: 'v_w', meaning: 'drift speed of the cloud deck' },
      { key: 'shimmer', symbol: '\\omega', meaning: 'wave speed — how fast the undulations travel' },
    ],
    code: "// per parcel (baked): droplet-size band → mother-of-pearl colour, patchy density → wisps\nconst b = (x*0.9 + z*0.55)*bands + 0.8*sin(1.7x − 2.4z);\nhue = 0.52 + 0.16·sin(b) + 0.09·sin(2.3b);      // teal ↔ pink ↔ gold pastels\nsat peaks at band cores (uniform droplets);  light ∝ density²\n// per frame: gravity waves + wind (colours ride the parcel)\nx = wrap(x0 + wind·t);\ny = Y0 + Σ A_i·sin(k_i·(x,z) ∓ ω_i·t);",
    links: [
      { label: 'Curiosity’s iridescent clouds (NASA)', url: 'https://www.nasa.gov/solar-system/nasas-curiosity-rover-captures-shining-clouds-on-mars/' },
      { label: 'Noctilucent cloud (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Noctilucent_cloud' },
      { label: 'Cloud iridescence (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Cloud_iridescence' },
    ],
  },
  impactFragmentation: {
    title: 'Impact Fragmentation',
    about:
      "What happens when something hits an asteroid hard enough to shatter it. This is the physics behind ASTEROID FAMILIES — whole clans of asteroids on similar orbits that are the shards of one ancient collision (the Karin cluster is a famous, datable example) — and behind NASA's DART mission, which deliberately rammed a moonlet to test the momentum transfer. The deep result is that fragmentation is CASCADING and statistical: the first break leaves big fragments laced with internal cracks that fail again, and again, so the final fragment sizes follow a power law, N(>s) ∝ s^(−α) — the Grady–Kipp / Turcotte picture that fits everything from crushed rock in a fault zone to the size spectrum of asteroid belts.",
    howItWorks:
      "Every impact is planned as a complete fragmentation TREE before it plays: Voronoi-style seeds partition the body into first-generation fragments; each gets a kick (mostly radial, plus a shove along the impact axis, strongest near the impact point — momentum share) and a random tumble; then, with probability set by 'fragility', fragments are scheduled to crack again a moment later into smaller children that inherit their parent's motion plus their own smaller kick. Because the whole tree is decided up front, every fragment's flight is CLOSED-FORM — piecewise-ballistic centres plus a rigid Rodrigues tumble — and each rock point simply follows its deepest-born ancestor. The projectile is a cluster of white-hot points that streaks in and, at the moment of contact, becomes the impact-ejecta fan (a cone of debris with a few fast and many slow grains). The cloud drifts, the cycle wraps, and a fresh impact is planned from a new seed.",
    equations: [
      { label: 'fragment-size distribution (fragmentation power law)', latex: 'N(>s) \\propto s^{-\\alpha}' },
      { label: 'cascading failure: generations of re-fracture', latex: '\\text{gen}_0 \\to \\text{gen}_1 \\to \\text{gen}_2 \\quad (p_{\\text{split}} = \\text{fragility})' },
      { label: 'piecewise-ballistic fragment flight + rigid tumble', latex: '\\mathbf{x}(t) = \\mathbf{c}_b + \\mathbf{v}\\,(t - t_b) + R_{\\hat{\\mathbf{k}}}\\big(\\omega (t-t_b)\\big)\\,\\mathbf{r}' },
    ],
    params: [
      { key: 'fragility', symbol: 'p', meaning: 'probability each fragment cracks again — how deep the cascade runs' },
      { key: 'power', symbol: 'E', meaning: 'impact energy — fragment kicks and ejecta speeds' },
      { key: 'spin', symbol: '\\omega', meaning: 'fragment tumble rates' },
      { key: 'speed', symbol: '\\nu', meaning: 'replay rate of the event cycle' },
    ],
    code: "// plan the whole event up front (deterministic per replay), then play it closed-form\nseeds = voronoiSeeds(body);                   // gen-1 fragments\nkick  = 0.6·radial + 0.4·awayFromImpact, ∝ 1/(0.35+d);  // momentum share\nif (rnd < fragility) schedule gen-2 split at t_b, kids inherit v + smaller kick\n// per frame: every point follows its deepest-born ancestor\nx = c_b + v·(t−t_b) + Rodrigues(axis, ω·(t−t_b))·offset;\n// projectile → ejecta fan at contact: cone of white-hot grains, few fast, many slow",
    links: [
      { label: 'Asteroid family (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Asteroid_family' },
      { label: 'DART — Double Asteroid Redirection Test', url: 'https://en.wikipedia.org/wiki/Double_Asteroid_Redirection_Test' },
      { label: 'Rubble pile (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Rubble_pile' },
    ],
  },
  pulsar: {
    title: 'Pulsar',
    about:
      "A pulsar is a city-sized star heavier than the Sun, spinning up to hundreds of times a second, wrapped in a magnetic field a trillion times Earth's. Its radio beams pour from the MAGNETIC poles — and because the magnetic axis is tilted against the spin axis, the beams sweep space like a lighthouse. If one happens to cross Earth, we receive a metronome tick so regular that the first one found (Jocelyn Bell Burnell, 1967) was half-seriously labelled LGM-1 — 'little green men.' Pulsars are now used as galactic-scale clocks to hunt gravitational waves; and in the most magnetic ones, X-ray polarisation missions like IXPE are finding hints of true quantum-vacuum effects (vacuum birefringence) — quantum mechanics showing up in astrophysics for real.",
    howItWorks:
      "The magnetosphere is baked in the MAGNETIC frame and turned by two rotations per frame — first tilt (α, about z), then spin (Ωt, about the vertical): the sweep IS the physics. Field lines are the exact vacuum-dipole shape, r(θ) = L·sin²θ, sampled as points over several L-shells and two dozen meridian planes (the teal cage). The beams are cones of points streaming outward from the two magnetic poles, phase-cycled so they flow continuously; where the tilted beam axis sweeps past your viewpoint, you get the pulse. In the spin equator an Archimedean spiral of plasma unwinds — the pulsar wind, corotating at launch and trailing as it flies out, sprinkler-style. A dense white-hot ball marks the star (the bloom pass turns it into a beacon).",
    equations: [
      { label: 'dipole field line (L-shell)', latex: 'r(\\theta) = L\\,\\sin^2\\theta' },
      { label: 'the lighthouse: beams along the tilted magnetic axis', latex: '\\hat{\\mathbf{m}}(t) = R_y(\\Omega t)\\, R_z(\\alpha)\\, \\hat{\\mathbf{y}}' },
      { label: 'pulse period = spin period', latex: 'P = \\frac{2\\pi}{\\Omega}' },
      { label: 'wind spiral (corotating at launch, trailing outward)', latex: '\\varphi(r) = \\varphi_0 + \\Omega t - k\\,(r - r_0)' },
    ],
    params: [
      { key: 'tilt', symbol: '\\alpha', meaning: 'angle between the spin and magnetic axes — 0 = aligned (no pulses), large = wide lighthouse sweep' },
      { key: 'spin', symbol: '\\Omega', meaning: 'rotation rate' },
      { key: 'shells', symbol: 'L', meaning: 'how many dipole field-line shells are drawn' },
      { key: 'wind', symbol: 'v_w', meaning: 'pulsar-wind outflow rate' },
    ],
    code: "// bake everything in the MAGNETIC frame; per frame: tilt about z, then spin about y\nplace(p_local):\n  p1 = Rz(tilt) · p_local        // magnetic axis leans by α\n  p  = Ry(spin·t) · p1           // the whole magnetosphere turns — the lighthouse\n// field lines: r(θ) = L·sin²θ per shell × 24 meridians (points, not lines)\n// beams: cones at the magnetic poles, points phase-cycling outward\n// wind: Archimedean spiral in the SPIN equator (sprinkler)",
    links: [
      { label: 'Pulsar (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Pulsar' },
      { label: 'Jocelyn Bell Burnell & LGM-1', url: 'https://en.wikipedia.org/wiki/PSR_B1919%2B21' },
      { label: 'IXPE — vacuum birefringence hints', url: 'https://en.wikipedia.org/wiki/Vacuum_birefringence' },
    ],
  },
  relativisticJet: {
    title: 'Relativistic Jet',
    about:
      "Accreting black holes don't only swallow — they launch. Twisted magnetic fields collimate infalling plasma into twin beams fired along the spin axis at nearly the speed of light; M87's jet stretches five thousand light-years and has been imaged from its launch point by the Event Horizon Telescope. Two pieces of real physics give jets their look: the HELICAL FIELD the rotation winds around the beam (plasma streams along it like thread on a screw), and the KINK INSTABILITY — a current-carrying magnetic column is unstable to a corkscrew (m=1) displacement that grows downstream, so the whole jet wiggles like a firehose. The bright blobs are internal shocks — knots like M87's HST-1 — racing outward.",
    howItWorks:
      "Each jet is a bundle of helical strands around a central axis. The AXIS itself is displaced by the kink mode: a helical offset whose amplitude grows as (distance)^1.5 and whose phase rides outward with the flow — the growing corkscrew wobble of the real instability. Each strand is a helix around that wobbling axis, its radius opening downstream (the jet decollimates slowly), its phase advancing with time so plasma visibly STREAMS. Colour is baked by strand radius like a synchrotron map: white-hot spine, orange mid-layers, violet sheath. Knots are coherent point-blobs that ride the same kinked axis faster than the ambient flow and swell as they travel. A white accretion blob marks the engine. Every motion is an analytic phase — no integration, bounded by construction.",
    equations: [
      { label: 'kink (m=1) displacement, growing downstream', latex: '\\boldsymbol{\\xi}(x) = A\\,x^{3/2}\\big(\\cos(kx - \\omega t),\\ \\sin(kx - \\omega t)\\big)' },
      { label: 'helical field strands around the kinked axis', latex: '\\mathbf{r}(x) = \\boldsymbol{\\xi}(x) + \\rho(x)\\big(\\cos\\phi_h, \\sin\\phi_h\\big), \\quad \\phi_h = \\tau x + \\omega_h t' },
      { label: 'opening angle: the sheath decollimates', latex: '\\rho(x) = \\rho_0 + \\rho_1 x' },
    ],
    params: [
      { key: 'kink', symbol: 'A', meaning: 'amplitude of the kink instability — how hard the jet wiggles' },
      { key: 'twist', symbol: '\\tau', meaning: 'helical winding of the field strands' },
      { key: 'speed', symbol: 'v', meaning: 'flow speed of plasma and knots along the jet' },
    ],
    code: "// per strand point: stream along the kinked axis, wound on an opening helix\nconst a = (phase_i + t*0.11*speed) % 1;          // axial fraction (streams outward)\nconst [ky, kz] = kink * 0.34 * a^1.5 * [cos, sin](a·k − ω·t);   // growing corkscrew\nconst rh = (0.04 + 0.24a) * radiusClass_i;        // helix opens downstream\ny = ky + rh·cos(φ_i + twist·x + ω_h·t);  z = kz + rh·sin(…);\n// knots: coherent blobs riding the same axis, faster + swelling",
    links: [
      { label: 'Astrophysical jet (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Astrophysical_jet' },
      { label: "M87's jet (Wikipedia)", url: 'https://en.wikipedia.org/wiki/Messier_87#Jet' },
      { label: 'Kink instability (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Kink_instability' },
    ],
  },
  multiLenia: {
    title: 'Multi-Species Lenia',
    about:
      "Lenia is the continuous cellular automaton whose smooth dynamics grow startlingly lifelike cells. Run THREE Lenia fields in one dish — three species, each with its own growth niche — and couple them by local competition, and the dish becomes an ecosystem: territories form, organisms of different colours chase, absorb and displace one another, and where membranes overlap the colours blend. (Honest scoping: this is multi-species Lenia with pointwise competitive coupling — the pragmatic cousin of Bert Chan's full multi-channel Lenia, which couples species through cross-channel convolution kernels.) One more ecological ingredient keeps the dish alive: IMMIGRATION. Lenia survival is famously sensitive — a species that collapses would leave dead space forever — so a collapsed species occasionally receives a few drifting propagules, ecology's 'rescue effect', and reinvades.",
    howItWorks:
      "Each species is a full Lenia field: state in [0,1] on a shared toroidal grid, convolved each step with a smooth ring kernel to get a potential U, then nudged by a Gaussian growth G(U) centred on the species' own niche μₖ. The species interact through a pointwise competition term — each one's growth is suppressed in proportion to how dense the OTHERS are at that cell — which is what carves territories and drives the chases. Every ~24 steps each species' total mass is checked; a collapsed species gets a deterministic sprinkle of new propagule blobs. Rendering keeps the colours-bake-once rule: every grid cell owns three points (pure red, green, blue — one per species); a species' state LIFTS its point into the dish as relief, and where a species is absent its point parks in an off-camera reservoir. Overlapping membranes blend additively into the rainbow seams.",
    equations: [
      { label: 'Lenia update per species', latex: 'f_k \\leftarrow \\mathrm{clip}\\Big(f_k + r\\big[G_k(K * f_k) - c\\sum_{j\\ne k} f_j\\big]\\Big)' },
      { label: 'ring kernel + Gaussian growth', latex: 'K(r) = e^{-\\frac{(r-0.5R)^2}{2(0.15R)^2}}, \\qquad G_k(u) = 2e^{-\\frac{(u-\\mu_k)^2}{2\\sigma_k^2}} - 1' },
      { label: "immigration (ecology's rescue effect)", latex: '\\bar{f_k} < \\epsilon \\;\\Rightarrow\\; \\text{inject propagules}' },
    ],
    params: [
      { key: 'mu', symbol: '\\mu', meaning: 'base growth niche (each species offsets it slightly)' },
      { key: 'sigma', symbol: '\\sigma', meaning: 'niche width — tolerance around μ' },
      { key: 'rate', symbol: 'r', meaning: 'update rate (time resolution of the dynamics)' },
      { key: 'compete', symbol: 'c', meaning: 'cross-species suppression — 0 = peaceful coexistence, high = turf wars' },
      { key: 'radius', symbol: 'R', meaning: 'kernel radius — the organisms’ characteristic size' },
    ],
    code: "// three Lenia fields on one torus, coupled by pointwise competition\nfor (k of species) {\n  U = ringKernel ⊛ f[k];                       // smooth neighbourhood potential\n  f[k] += rate * ( G(U; μ_k, σ_k) − compete·(f[j] + f[l]) );\n  clip f[k] to [0,1];\n}\nevery 24 steps: if mean(f[k]) < ε → inject propagule blobs (immigration)\n// display: cell (x,z) owns 3 points (R,G,B); y = state·relief, absent → parked off-camera",
    links: [
      { label: 'Lenia (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Lenia' },
      { label: 'Bert Chan — Lenia and expanded universe', url: 'https://arxiv.org/abs/2005.03742' },
      { label: 'Rescue effect (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Rescue_effect' },
    ],
  },
  gravityWell: {
    title: 'Gravity Well',
    about:
      "The most famous image in physics outreach: the Sun dents a stretched sheet, and the planets circle the slope. Let's be honest about it up front — it is an ANALOGY, and physicists love to point out its sins: it explains gravity using gravity (the ball 'falls' into the dent because of the very force being illustrated), and real planetary orbits owe far more to curved TIME than to curved space — clocks tick slower deeper in the well, and that gradient is what steers slow-moving bodies. But the picture also gets real things right, and this version does those right: the sheet's depth is the actual Newtonian potential, every planet digs its own little travelling dimple (watch the moon ride its planet's dimple around the Sun's funnel), and the orbits obey Kepler exactly — the inner worlds visibly lap the outer ones. ETHERSIM system #200.",
    howItWorks:
      "The membrane's height is the softened Newtonian potential of every body, y ∝ Φ = −Σ GMᵢ/rᵢ — so the Sun digs the deep funnel and the planets carve small moving dimples (amplified; at true scale they'd be invisible). The membrane is a jittered point grid with a woven brightness pattern for the lattice look, re-evaluated in closed form each frame under the moving bodies. Planets ride circular Kepler orbits with angular speed ω ∝ a^{−3/2} (the real third law), each drawn as a small shaded ball resting on the sheet; one moon circles the blue planet, tracing epicycles through the big well. The bloom pass turns the Sun into the glowing anchor of the whole picture.",
    equations: [
      { label: 'sheet height = (softened) Newtonian potential', latex: 'y(x,z) \\propto \\Phi = -\\sum_i \\frac{G M_i}{\\sqrt{r_i^2 + \\epsilon^2}}' },
      { label: "Kepler's third law (the orbits are honest)", latex: '\\omega \\propto a^{-3/2}' },
      { label: 'what the sheet hides: curved time steers slow orbits', latex: 'd\\tau \\approx dt\\sqrt{1 + \\tfrac{2\\Phi}{c^2}}' },
    ],
    params: [
      { key: 'depth', symbol: '\\Phi_0', meaning: 'well depth — the potential scale of the membrane' },
      { key: 'speed', symbol: '\\nu', meaning: 'orbital time rate' },
      { key: 'planets', symbol: 'n', meaning: 'how many planets (each with its own dimple)' },
    ],
    code: "// membrane: closed-form potential under the moving bodies, every frame\ny(x,z) = -depth * ( 1/√(r_sun²+ε²) + Σ m_k·A/√(r_k²+ε′²) );\n// planets: real Kepler circles — inner worlds lap outer ones\nθ_k(t) = θ0_k + speed·t / a_k^{3/2};   planet rests ON the sheet at its own dimple\n// moon: circles the blue planet, riding its dimple around the big funnel",
    links: [
      { label: 'Gravity well (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Gravity_well' },
      { label: 'The rubber-sheet analogy and its limits', url: 'https://en.wikipedia.org/wiki/Spacetime#Curvature_of_spacetime' },
      { label: 'Gravitational time dilation (what really steers orbits)', url: 'https://en.wikipedia.org/wiki/Gravitational_time_dilation' },
    ],
  },
  bec: {
    title: 'Bose–Einstein Condensate',
    about:
      "Schrödinger once wrote that the multiplicity of minds 'is only apparent; in truth there is only one mind.' Whatever you make of his philosophy, the equation that bears his name describes matter doing exactly that. Cool a trapped gas of bosonic atoms below a critical temperature and they stop being individuals: their wavefunctions overlap and a macroscopic fraction of the gas collapses into ONE quantum state — a single wavefunction, thousands of atoms wide, that you can photograph. Predicted by Bose and Einstein in 1924–25, first achieved by Cornell & Wieman and Ketterle in 1995 (Nobel 2001), and governed by the Gross–Pitaevskii equation — a nonlinear Schrödinger equation. The multiplicity was only apparent.",
    howItWorks:
      "The trap cycles: cool → hold → reheat → repeat. Above T_c every atom rides its own classical Lissajous orbit in a slightly anisotropic harmonic trap, with orbit sizes shrinking as √T while the gas cools. Below T_c the condensed fraction follows the REAL 3-D harmonic-trap law, N₀/N = 1 − (T/T_c)³ — implemented exactly: each atom carries a uniform threshold uᵢ and smoothly falls out of its thermal orbit into the ground-state Gaussian the moment the growing fraction sweeps past its number. And here is the point of the whole system: the condensed atoms breathe in perfect UNISON — one breathing phase shared by every atom in the core, because one wavefunction can only move as one thing — while the remaining thermal atoms still jitter independently around them. Then the trap reheats and the one dissolves back into the many. Colours bake once: ember-orange for the reluctant thermal halo, cyan-white for the coherent heart.",
    equations: [
      { label: 'condensed fraction (3-D harmonic trap — exact)', latex: '\\frac{N_0}{N} = 1 - \\Big(\\frac{T}{T_c}\\Big)^{3}' },
      { label: 'the condensate wavefunction (Gross–Pitaevskii)', latex: 'i\\hbar\\,\\partial_t \\psi = \\Big(-\\tfrac{\\hbar^2}{2m}\\nabla^2 + V + g\\lvert\\psi\\rvert^2\\Big)\\psi' },
      { label: 'thermal orbits shrink as the gas cools', latex: 'A_i \\propto \\sqrt{T}' },
      { label: 'one state, one motion (the unison breathing)', latex: '\\psi(\\mathbf{r},t) = \\sqrt{N_0}\\,\\phi_0(\\mathbf{r})\\,e^{-i\\mu t/\\hbar}' },
    ],
    params: [
      { key: 'cooling', symbol: '\\nu', meaning: 'speed of the cool → hold → reheat cycle' },
      { key: 'trap', symbol: '\\omega', meaning: 'trap frequency — orbit and breathing rates' },
      { key: 'coherence', symbol: 'A_b', meaning: 'amplitude of the condensate’s unison breathing mode' },
    ],
    code: "// per atom: a thermal orbit and a place in the one wavefunction — blended by the REAL law\nconst frac = T < Tc ? 1 − (T/Tc)³ : 0;             // condensed fraction\nthermal_i = A_i·√T · lissajous(ω, φ_i, t);          // individual jitter\ncore_i    = gaussianOffset_i * breathe(t);           // ONE breathing phase for all\nk = smoothstep((frac − u_i)/0.07);                   // falls in when the fraction passes u_i\nx_i = mix(thermal_i, core_i, k);                     // the many become the one",
    links: [
      { label: 'Bose–Einstein condensate (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Bose%E2%80%93Einstein_condensate' },
      { label: 'Gross–Pitaevskii equation (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Gross%E2%80%93Pitaevskii_equation' },
      { label: 'Schrödinger, Mind and Matter (1958)', url: 'https://en.wikipedia.org/wiki/Mind_and_Matter_(book)' },
    ],
  },
  aurora: {
    title: 'Aurora Borealis',
    about:
      "Stand under a polar night sky and the physics is written overhead in atomic spectra. Electrons from the solar wind, funnelled along Earth's magnetic field lines, crash into the upper atmosphere and light it up like a billboard for quantum mechanics: nitrogen ions paint the purple-magenta fringe along the lower border near 95 km, atomic oxygen's 557.7 nm line makes the emerald body of the curtain from 100 to 250 km, and above that oxygen's 'forbidden' 630 nm red line takes over — a transition so slow (110-second lifetime) that it only survives where the air is too thin to interrupt it with collisions. The rays you see ARE the field lines; the folds are waves travelling along the arc. Below, a still lake doubles the sky.",
    howItWorks:
      "The curtain is a sheet of ~110 field-aligned rays hanging along a sinuous arc. Each particle bakes a position along the arc, an altitude drawn heavily toward the bright lower border, and a colour set once by the altitude-dependent spectrum — purple fringe, emerald body, red crown — with brightness falling off exponentially above the lower border, just as real auroral luminosity profiles do. All motion is closed-form: two long travelling waves plus a fine ripple fold the arc (the drapery), a slight altitude-dependent lean tips the curtain, and each particle slides down its field line on a desynchronised sawtooth — the visible signature of electron precipitation. Half the cloud is the sky; the other half is its mirror below the waterline, dimmed, blue-shifted, and shimmered by a gentle ripple. Turn up 'activity' for a substorm; flatten 'curtain folds' for a quiet homogeneous arc.",
    equations: [
      { label: 'the green line — atomic oxygen (100–250 km)', latex: '\\mathrm{O}(^1S) \\rightarrow \\mathrm{O}(^1D) + h\\nu \\;(557.7\\,\\mathrm{nm})' },
      { label: 'the red crown — forbidden, 110 s lifetime', latex: '\\mathrm{O}(^1D) \\rightarrow \\mathrm{O}(^3P) + h\\nu \\;(630.0\\,\\mathrm{nm})' },
      { label: 'electrons spiral along field lines into the poles', latex: 'm\\,\\dot{\\mathbf{v}} = q\\,\\mathbf{v} \\times \\mathbf{B}' },
      { label: 'luminosity falls off above the lower border', latex: 'I(h) \\propto e^{-h/H}' },
    ],
    params: [
      { key: 'activity', symbol: '\\nu', meaning: 'substorm tempo — drift, folding, and precipitation rate' },
      { key: 'folds', symbol: 'A_f', meaning: 'amplitude of the travelling folds in the curtain' },
      { key: 'streamers', symbol: 's', meaning: 'depth of the downward precipitation streaming' },
    ],
    code: "// each atom of sky: a place on the arc, an altitude, a spectrum — then closed-form drapery\nz(s,t) = A_f·[0.5·sin(6.8s + 0.33t) + 0.28·sin(3.1s − 0.21t)] + ripple(s,t);  // folds\ny_i(t) = h_i·H − s·saw(φ_i + 0.14t);              // precipitation down the field line\ncolour(h): purple (N₂⁺, h<0.18) → emerald (O 557.7 nm) → red (O 630 nm, h>0.62);\nreflection: (x + ripple, −0.92·y, z) at 25% brightness — the lake",
    links: [
      { label: 'Aurora (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Aurora' },
      { label: 'Forbidden lines & the 630 nm red (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Forbidden_mechanism' },
      { label: 'Birkeland currents — the field-aligned circuit', url: 'https://en.wikipedia.org/wiki/Birkeland_current' },
    ],
  },
  daphnis: {
    title: 'Shepherd Moon',
    about:
      "Daphnis is eight kilometres across — a boulder, by planetary standards — yet it single-handedly holds open the 42-kilometre Keeler Gap in Saturn's A ring and sculpts waves along both edges, some standing more than a kilometre tall out of a ring that is elsewhere only ten metres thick. Cassini photographed the waves and, at Saturn's 2009 equinox, the long shadows they cast across the ring plane. Nothing here is exotic: it is Kepler's third law doing sculpture. Ring particles just inside the gap orbit faster than Daphnis, particles outside orbit slower, so the whole ring streams past the little moon and every particle receives one small gravitational kick per pass.",
    howItWorks:
      "Every particle rides an exact Kepler orbit (Ω ∝ a^{-3/2} — pure shear, no integrator). The kick each one receives at closest approach launches an epicycle, and because neighbouring streamlines drift apart at a rate set by their orbital separation, the epicycles organise into a stationary wake in the moon's frame: scalloped edge waves with the classic azimuthal wavelength 3π·Δa — one epicyclic bounce per synodic drift — trailing AHEAD of the moon on the inner (faster) edge and BEHIND it on the outer (slower) edge, and damping downstream as ring collisions thermalise the perturbation. Daphnis' slight orbital inclination pulls the inner-edge response out of the ring plane: those are the vertical walls whose equinox shadows Cassini caught. The ringlet banding is baked into the colours; raise 'moon mass' to deepen the scallops, 'inclination' to raise the walls.",
    equations: [
      { label: 'Kepler shear — inner faster, outer slower', latex: '\\Omega(a) \\propto a^{-3/2}' },
      { label: 'edge-wave wavelength (radial distance sets the beat)', latex: '\\lambda = 3\\pi\\,\\Delta a' },
      { label: 'each kick launches an epicycle at frequency \\kappa \\approx \\Omega', latex: '\\delta r = A\\,e^{-(d-g)/w}\\cos\\!\\big(\\tfrac{2\\chi a}{3\\Delta a}\\big)' },
      { label: 'Hill radius — the moon\u2019s sphere of sculpting influence', latex: 'r_H = a\\big(\\tfrac{m}{3M}\\big)^{1/3}' },
    ],
    params: [
      { key: 'mass', symbol: 'm', meaning: 'Daphnis\u2019 mass — sets the wave amplitude' },
      { key: 'tilt', symbol: 'i', meaning: 'orbital inclination — height of the vertical walls' },
      { key: 'speed', symbol: '\\Omega_0', meaning: 'orbital tempo of the whole ring' },
    ],
    code: "// stationary wake in the moon's frame — closed form, no integrator\n\u03b8_i(t) = \u03b8\u2080 + \u03a9\u2080 a^{-3/2} t;                    // Kepler shear\n\u03c7 = downstream angle since last moon encounter (sign flips across the gap);\namp = m\u00b7e^{-(d-g)/w} \u00b7 onset(\u03c7) \u00b7 e^{-0.32\u03c7};      // edge-peaked, damped downstream\nr = a + amp\u00b7cos(2\u03c7a/3\u0394a);  y = i\u00b7amp\u00b7sin(2\u03c7a/3\u0394a);  // scallops + walls",
    links: [
      { label: 'Daphnis (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Daphnis_(moon)' },
      { label: 'Keeler Gap edge waves', url: 'https://en.wikipedia.org/wiki/Keeler_Gap' },
      { label: 'Cassini: the wave-maker at equinox (NASA)', url: 'https://science.nasa.gov/resource/daphnis-and-its-waves/' },
    ],
  },
  hyperbolicSphere: {
    title: 'Hyperbolic Sphere',
    about:
      "Two geometries share one picture. Start in the hyperbolic plane — the Poincaré disk, where 'straight lines' are circular arcs meeting the boundary at right angles — and rule it with a square grid. Then push the whole thing through the stereographic projection onto a sphere. The grid's diagonal lines become LOXODROMES: the double-spiral families that wind from pole to pole crossing every meridian at the same angle (the rhumb lines a ship follows on a constant compass bearing). And here is the part worth staring at: sliding the grid along itself is an ISOMETRY of the hyperbolic plane, so on the sphere the whole pattern streams from one pole to the other forever without ever changing shape. That streaming is a loxodromic Möbius transformation — the same flow that classifies the dynamics of every conformal map of the sphere.",
    howItWorks:
      "Work in the band coordinates w = u + iv (the conformal logarithm of the half-plane, ζ = e^w): curves of constant u are true hyperbolic geodesics, and u → u + t is an exact one-parameter isometry — a dilation of the half-plane. The grid here is the two diagonal families u ± p·v = k·c; exponentiating gives logarithmic spirals in the plane, and the inverse stereographic projection (2ζ, |ζ|²−1)/(|ζ|²+1) wraps them onto the sphere as amber and blue loxodrome families with the poles as the flow's two fixed points. Each frame just evaluates the closed form with u shifted by the flow — the Möbius transformation IS the animation. Curves recycle pole-to-pole through a band wrap; the polar bunching you see is the honest metric distortion of the stereographic map. 'Spiral pitch' tilts the families toward meridians (pitch → 0) or tight coils; 'grid spacing' re-rules the hyperbolic plane live.",
    equations: [
      { label: 'band model — u-translation is an isometry', latex: 'w = u + iv, \\quad \\zeta = e^{w}, \\quad u \\mapsto u + t' },
      { label: 'inverse stereographic projection onto the sphere', latex: 'P(\\zeta) = \\frac{(2\\,\\mathrm{Re}\\,\\zeta,\\; 2\\,\\mathrm{Im}\\,\\zeta,\\; |\\zeta|^2 - 1)}{|\\zeta|^2 + 1}' },
      { label: 'the grid: two diagonal families \\to loxodromes', latex: 'u \\pm p\\,v = k\\,c' },
      { label: 'the flow on the sphere: loxodromic M\u00f6bius', latex: 'z \\mapsto \\lambda z, \\quad \\lambda = e^{t}' },
    ],
    params: [
      { key: 'flow', symbol: 't', meaning: 'speed of the M\u00f6bius flow from pole to pole' },
      { key: 'pitch', symbol: 'p', meaning: 'loxodrome pitch — meridian-like to tightly coiled' },
      { key: 'grid', symbol: 'c', meaning: 'spacing of the hyperbolic grid lines' },
    ],
    code: "// the animation IS a M\u00f6bius transformation — evaluate, never integrate\nu = k\u00b7c \u00b1 p\u00b7v + flow\u00b7t;          // slide the hyperbolic grid along itself\n\u03b6 = e^{u+iv};                      // band \u2192 plane: log-spirals\nP = (2Re\u03b6, |\u03b6|\u00b2\u22121, 2Im\u03b6)/(|\u03b6|\u00b2+1); // plane \u2192 sphere: loxodromes\n// amber family winds one way, blue the other; poles are the two fixed points",
    links: [
      { label: 'Poincar\u00e9 disk model (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Poincar%C3%A9_disk_model' },
      { label: 'Loxodrome / rhumb line (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Rhumb_line' },
      { label: 'M\u00f6bius transformations classified (Wikipedia)', url: 'https://en.wikipedia.org/wiki/M%C3%B6bius_transformation#Classification' },
      { label: 'Inspired by KAZ+OO\u2019s p5.js sketch', url: 'https://openprocessing.org/user/489845' },
    ],
  },
  dnaSupercoil: {
    title: 'DNA Supercoiling',
    about:
      "Two metres of DNA fold into every one of your cells, and the folding is governed by a theorem. A closed double helix has a linking number Lk — how many times the two strands wind around each other — and Lk is a TOPOLOGICAL invariant: you cannot change it by bending, coiling, or stretching the molecule; only an enzyme that cuts a strand (a topoisomerase) can. White's theorem then splits that fixed integer into two geometric parts that trade freely: Lk = Tw + Wr, the twist of the strands about the axis plus the writhe of the axis coiling through space. Over- or under-wind the helix and the strain has nowhere to go but writhe — the axis buckles into a supercoil. It is the same instability you feel overtwisting a phone cord, and it is how the genome packs, unpacks, and reads itself.",
    howItWorks:
      "The helix axis is modelled as a closed superhelix wound n times on a torus, so the loop is always genuinely closed (Lk stays an integer, as topology demands). An imposed strain cycles the coil amplitude ρ from zero — a flat ring, where every bit of the linking is TWIST and the base-pair ladder winds fast — up to a fully buckled supercoil, where the geometric writhe of the coiled axis absorbs much of the linking and the base-pair twist visibly SLOWS to keep Lk = Tw + Wr fixed — then relaxes back. The writhe is read straight from the coil geometry; the twist is whatever is left over, exactly as White's theorem requires. Two amber sugar-phosphate backbones spiral in antiparallel, with red A·T and blue G·C rungs bridging them. Raise 'strain' to drive it deeper into supercoil; 'linking number' sets Lk; 'super-turns' rebuilds the coil with more windings.",
    equations: [
      { label: 'the topological invariant (White / C\u0103lug\u0103reanu\u2013Fuller)', latex: 'Lk = Tw + Wr' },
      { label: 'Lk is fixed for a closed molecule', latex: '\\Delta Lk = 0 \\;\\Rightarrow\\; \\Delta Tw = -\\Delta Wr' },
      { label: 'strain drives twist into writhe as the axis buckles', latex: 'Wr(\\rho) = \\frac{n\\,x}{1+x}, \\quad x = \\frac{n\\rho}{R}' },
      { label: 'base-pair twist takes up the remainder', latex: 'Tw = Lk - Wr(\\rho)' },
    ],
    params: [
      { key: 'supercoil', symbol: '\\rho', meaning: 'imposed strain \u2014 how deep into supercoil the axis buckles' },
      { key: 'linking', symbol: 'Lk', meaning: 'linking number \u2014 the conserved topological integer' },
      { key: 'coils', symbol: 'n', meaning: 'super-turns of the coiled axis (rebuild)' },
      { key: 'relax', symbol: '\\nu', meaning: 'rate of the strain\u2013relaxation cycle' },
    ],
    code: "// White's theorem, made literal: hold Lk fixed, let twist give way to writhe\n\u03c1(t) = strain \u00b7 (1 \u2212 cos \u03bd t)/2;          // imposed strain cycles the coil amplitude\nWr = n\u00b7x/(1+x),  x = n\u03c1/R;                 // writhe read from the coiled-axis geometry\nTw = Lk \u2212 Wr;                              // whatever linking writhe doesn't absorb stays twist\naxis = superhelix(n, \u03c1);  ladder winds at rate Tw around it;  // base pairs slow as the coil grows",
    links: [
      { label: 'DNA supercoil (Wikipedia)', url: 'https://en.wikipedia.org/wiki/DNA_supercoil' },
      { label: 'Linking number & White\u2019s theorem', url: 'https://en.wikipedia.org/wiki/Linking_number' },
      { label: 'Writhe (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Writhe' },
      { label: 'Topoisomerase \u2014 the enzymes that change Lk', url: 'https://en.wikipedia.org/wiki/Topoisomerase' },
    ],
  },
  trigMap: {
    title: 'Trigonometric Map',
    about:
      "Some of the richest pictures in mathematics come from the simplest rules, iterated. This is a two-line map on the plane: take a point (x, y), and replace it with (sin(x²\u2212y²+a), cos(2xy+b)). Its two arguments, x²\u2212y² and 2xy, are precisely the real and imaginary parts of z² \u2014 so this is a complex squaring folded through sine and cosine. Because sin and cos never leave [\u22121, 1], every orbit is trapped forever in the unit square, and the endlessly folded trajectory settles onto an invariant density: a lacy attractor whose entire shape is dialled by the two phases a and b. It is a cousin of the classic Clifford and de Jong attractors, and (after Simone Conradi's numpy density studies) an inexhaustible source of form.",
    howItWorks:
      "Every particle is one orbit of the map, iterated once per frame; together the cloud samples the attractor's invariant measure, brightest where the density piles up. The two phases a and b drift slowly, so the whole attractor continuously blooms, tears and reforms \u2014 no two moments are the same figure. Each particle's colour is baked from the angle of its seed, a hue wheel that mixes as distant orbits are folded together, staining the dense regions. Set 'phase a' and 'phase b' to explore the family by hand, 'morph rate' to speed or freeze the drift, 'zoom' to fill the frame.",
    equations: [
      { label: 'the map (a complex square, folded through sin/cos)', latex: 'x_{n+1} = \\sin(x_n^2 - y_n^2 + a), \\quad y_{n+1} = \\cos(2 x_n y_n + b)' },
      { label: 'the arguments are Re and Im of z\u00b2', latex: 'z^2 = (x^2 - y^2) + i\\,(2xy)' },
      { label: 'bounded forever \u2014 the trap', latex: '|x_n| \\le 1, \\;\, |y_n| \\le 1 \\;\\; \\forall n' },
    ],
    params: [
      { key: 'phaseA', symbol: 'a', meaning: 'first phase \u2014 reshapes the attractor' },
      { key: 'phaseB', symbol: 'b', meaning: 'second phase \u2014 reshapes the attractor' },
      { key: 'morph', symbol: '\\nu', meaning: 'rate the phases drift and the figure morphs' },
      { key: 'zoom', symbol: 's', meaning: 'scale of the attractor in the frame' },
    ],
    code: "// one map, iterated \u2014 the cloud becomes the attractor's density\na = a\u2080 + 0.08\u00b7sin(0.05\u03bd t);  b = b\u2080 + 0.08\u00b7cos(0.041\u03bd t);  // gentle drift\nx' = sin(x\u00b2 \u2212 y\u00b2 + a);   y' = cos(2xy + b);              // z\u00b2, folded\n// colour baked by seed angle; density = brightness under additive blending",
    links: [
      { label: 'List of chaotic maps (Wikipedia)', url: 'https://en.wikipedia.org/wiki/List_of_chaotic_maps' },
      { label: 'Clifford & de Jong attractors', url: 'http://paulbourke.net/fractals/clifford/' },
      { label: 'Simone Conradi (@S_Conradi)', url: 'https://twitter.com/S_Conradi' },
    ],
  },
  newtonFlow: {
    title: 'Newton Flow',
    about:
      "Newton's method \u2014 the schoolbook root-finder, z \u2192 z \u2212 P(z)/P\u2032(z) \u2014 hides a fractal. Colour every starting point in the complex plane by which root it eventually lands on, and the plane shatters into interlocking basins whose boundary is a Julia set: infinitely detailed, and where three or more basins always meet, all of them meet at once. Here the polynomial's roots are not fixed \u2014 they DRIFT, P_t(z) = \u220f(z \u2212 r_j(t)) \u2014 so the basins are alive, their boundaries rippling as the roots wander. It is the frontier where a tame algorithm turns chaotic.",
    howItWorks:
      "Each particle flows continuously along a softened Newton correction toward whichever moving root currently captures it. Two safeguards tame the raw iteration: a softening term \u03c3 keeps the step finite near the critical points where P\u2032 vanishes (the seams between basins), and a tanh limiter caps each step's length \u2014 the 'explosion', a bounded spray instead of a divergent leap. A particle's colour is baked from the root it belonged to at the start, so as the roots migrate the fixed basin colours are dragged into interleaving filaments; when a particle reaches a root (or is flung past the edge) it respawns in the plane, feeding the flow. Raise 'roots' for a higher-degree polynomial (rebuild), 'root drift' to stir the basins, 'step gain' and 'softening' to sharpen or smear the flow.",
    equations: [
      { label: 'the moving polynomial', latex: 'P_t(z) = \\prod_j \\big(z - r_j(t)\\big)' },
      { label: 'softened Newton correction (finite at critical points)', latex: '\\xi = z - \\zeta\\,\\frac{P(z)\\,\\overline{P\\,\\prime(z)}}{|P\\,\\prime(z)|^2 + \\sigma^2}' },
      { label: 'magnitude-limited step (the bounded spray)', latex: 'z_{n+1} = z_n + \\tanh(|u|)\\,\\frac{u}{|u| + \\varepsilon}, \\quad u = \\xi - z_n' },
    ],
    params: [
      { key: 'roots', symbol: 'd', meaning: 'number of roots \u2014 polynomial degree (rebuild)' },
      { key: 'drift', symbol: '\\omega', meaning: 'how fast the roots wander' },
      { key: 'gain', symbol: '\\zeta', meaning: 'Newton step gain' },
      { key: 'soften', symbol: '\\sigma', meaning: 'softening at the basin seams' },
    ],
    code: "// P and P\u2032 by product accumulation, then a softened, magnitude-limited Newton step\nfor each root r_j:  dP = dP\u00b7(z\u2212r_j) + P;  P = P\u00b7(z\u2212r_j);\nu = \u03b6\u00b7P\u00b7conj(P\u2032)/(|P\u2032|\u00b2 + \u03c3\u00b2);         // finite even where P\u2032 = 0\nz \u2212= u \u00b7 tanh(|u|)/(|u| + \u03b5);              // bounded spray toward the moving root\n// colour baked from the starting basin; respawn on arrival",
    links: [
      { label: 'Newton fractal (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Newton_fractal' },
      { label: "Newton's method (Wikipedia)", url: 'https://en.wikipedia.org/wiki/Newton%27s_method' },
      { label: 'Julia set (the basin boundary)', url: 'https://en.wikipedia.org/wiki/Julia_set' },
    ],
  },
  auroraOrbit: {
    title: 'Aurora from Orbit',
    about:
      "The same aurora, seen from 400 kilometres up. From the ISS you look down and outward along the curve of the planet, and the auroral oval \u2014 the ring of light around the magnetic pole \u2014 becomes a luminous ribbon following the horizon, its rays reaching UP toward you. Chris Hadfield described flying right through the upper tendrils. Below is the dark, cloud-mottled night side; along the very edge of the world, a razor-thin band of red-orange airglow (the hydroxyl layer near 90 km, glowing whether or not the aurora is out); above it, the black of space and the stars.",
    howItWorks:
      "The scene is built on a sphere: the auroral oval is a sinuous curve draped on the planet's surface, and its field-aligned rays rise along the local outward normal \u2014 so seen from just outside the sphere they lean over the limb exactly as the real curtain does. The rays carry the same altitude spectrum as the ground-level aurora (violet nitrogen base \u2192 emerald oxygen body \u2192 the slow red 630 nm crown) and stream downward on a desynchronised sawtooth \u2014 the precipitation of electrons. The night side is a dim, cloud-mottled cap; a thin arc of red-orange airglow rides the visible limb; stars sit on a far shell. All colours bake once; the oval's drape and the rays' fall live in positions. 'Activity' drives the substorm tempo, 'oval folds' the meander of the ribbon.",
    equations: [
      { label: 'the oval drapes on the planet (sphere cap)', latex: 'y(x,z) = -R_p + \\sqrt{R_p^2 - x^2 - z^2}' },
      { label: 'rays rise along the local outward normal', latex: '\\hat{\\mathbf{n}} = (\\mathbf{P} - \\mathbf{C})/R_p' },
      { label: 'the same green line \u2014 atomic oxygen', latex: '\\mathrm{O}(^1S)\\to\\mathrm{O}(^1D) + h\\nu\\;(557.7\\,\\mathrm{nm})' },
    ],
    params: [
      { key: 'activity', symbol: '\\nu', meaning: 'substorm tempo \u2014 drift and precipitation rate' },
      { key: 'folds', symbol: 'A_f', meaning: 'meander of the auroral oval along the limb' },
    ],
    code: "// oval draped on the sphere; rays climb the outward normal over the limb\nbase = surface(x, z) on the planet cap;  n = (base \u2212 centre)/R_p;\nray  = base + n\u00b7(h \u2212 precip\u00b7saw(\u03c6 + 0.14t));   // violet base \u2192 green \u2192 red crown\n+ dim cloud-mottled night cap, a thin red-orange airglow limb, and stars",
    links: [
      { label: 'Aurora from the ISS (NASA)', url: 'https://www.nasa.gov/image-feature/aurora-from-the-space-station' },
      { label: 'Airglow (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Airglow' },
      { label: 'Auroral oval (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Aurora#Auroral_oval' },
    ],
  },
  fireflies: {
    title: 'Firefly Synchronization',
    about:
      "In the forests of Southeast Asia \u2014 and a few valleys in Tennessee \u2014 thousands of fireflies flash in perfect unison: a wave of light, then dark, then light, night after night, with no leader and no signal but each other's glow. It is one of nature's clearest demonstrations of spontaneous synchronization. Each firefly is an oscillator that nudges its own rhythm a little toward the flashes it sees; below a threshold of coupling they blink at random, but above it the whole population locks into one shared pulse. The same mathematics governs pacemaker cells, clapping audiences, coupled metronomes and power grids \u2014 it is the Kuramoto model, and this is its most literal face.",
    howItWorks:
      "Every firefly carries a phase \u03b8 advancing at its own natural frequency \u03c9, plus a pull toward the population's mean phase \u2014 the Kuramoto mean-field coupling. The order parameter r (how aligned the phases are) starts near zero: they arrive out of step, a scatter of random sparks. As the coupling K does its work, r climbs toward one and the flashes gather into a single collective pulse. Each firefly is drawn as a small cluster of points that gathers into a bright blob at the instant it flashes (\u03b8 near 0) and is parked out of sight while dark, so brightness is written in presence, not colour; the glow is the ~560 nm yellow-green of luciferase, baked once. This is the same law the abstract Kuramoto Sync system draws as a phase portrait on a cylinder \u2014 here it is the swarm itself. Raise 'coupling' past the transition to lock them; widen 'freq spread' to make sync harder.",
    equations: [
      { label: 'Kuramoto mean-field coupling', latex: '\\dot{\\theta}_i = \\omega_i + \\frac{K}{N}\\sum_j \\sin(\\theta_j - \\theta_i)' },
      { label: 'order parameter (0 = incoherent, 1 = locked)', latex: 'r\\,e^{i\\psi} = \\frac{1}{N}\\sum_j e^{i\\theta_j}' },
      { label: 'so each firefly feels the mean field', latex: '\\dot{\\theta}_i = \\omega_i + K\\,r\\,\\sin(\\psi - \\theta_i)' },
      { label: 'synchronization above a critical coupling', latex: 'K > K_c \\;\\Rightarrow\\; r \\to 1' },
    ],
    params: [
      { key: 'coupling', symbol: 'K', meaning: 'how strongly each firefly is pulled toward the others' },
      { key: 'spread', symbol: '\\sigma_\\omega', meaning: 'spread of natural flash frequencies (heterogeneity)' },
      { key: 'rate', symbol: '\\omega_0', meaning: 'overall flash tempo' },
    ],
    code: "// mean-field Kuramoto: each firefly pulls toward the population's mean phase\n(m_c, m_s) = mean(cos\u03b8, sin\u03b8);            // the order parameter\n\u03b8_i += dt\u00b7(\u03c9_i + K\u00b7(m_s\u00b7cos\u03b8_i \u2212 m_c\u00b7sin\u03b8_i));  // = \u03c9_i + K\u00b7r\u00b7sin(\u03c8\u2212\u03b8_i)\nflash = exp(\u22122.6\u00b7(1\u2212cos\u03b8_i));           // bright only near \u03b8 = 0 \u2014 gather the blob, else park it",
    links: [
      { label: 'Firefly synchronization (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Firefly#Synchronization' },
      { label: 'Kuramoto model (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Kuramoto_model' },
      { label: 'Strogatz & Mirollo: pulse-coupled oscillators', url: 'https://en.wikipedia.org/wiki/Synchronization_of_chaos' },
    ],
  },
  giganticJet: {
    title: 'Gigantic Jet',
    about:
      "Lightning mostly goes down. But a whole hidden family of discharges \u2014 sprites, blue jets, ELVES, and the rarest of all, GIGANTIC JETS \u2014 fire UPWARD from the tops of thunderstorms into the near-space above. A gigantic jet is the tallest: a blue-white leader punches out of the storm around 20 km and races all the way to the ionosphere near 90 km in a few milliseconds, fanning into red-tinged tendrils where it reaches the charged upper atmosphere. In 2025 astronaut Nichole Ayers caught the clearest photo of one ever taken from space \u2014 which is the vantage here: the curved night limb, city lights and lightning glinting in the cloud deck, stars overhead, and the jet leaping toward you.",
    howItWorks:
      "The scene is built on a planet-sphere like our Aurora from Orbit: a dim cloud-mottled night surface studded with warm sodium-orange city clusters, a thin red-orange airglow limb, and a starfield beyond. The jet itself is an EVENT, animated the way our Lightning is \u2014 a cycle of grow \u2192 flash \u2192 fade \u2192 dark: a leader climbs the outward normal from the storm top, wandering slightly, and above two-thirds height it splays into a crown of tendrils at the ionosphere. Its colour bakes by altitude \u2014 blue-white at the leader, blue up the column, violet-to-red at the crown \u2014 while a flickering blue-white storm glow marks the base. Raise 'strike rate' for more frequent jets, 'crown spread' to widen the ionospheric fan.",
    equations: [
      { label: 'a transient luminous event bridging storm-top to ionosphere', latex: '\\sim 20\\,\\text{km} \\;\\longrightarrow\\; \\sim 90\\,\\text{km}, \\quad \\Delta t \\sim \\text{ms}' },
      { label: 'colour by altitude (leader \u2192 crown)', latex: '\\text{blue-white} \\to \\text{blue} \\to \\text{violet/red}' },
      { label: 'event cycle (as in Lightning)', latex: '\\text{grow} \\to \\text{flash} \\to \\text{fade} \\to \\text{dark}' },
    ],
    params: [
      { key: 'rate', symbol: 'f', meaning: 'how often the jet fires' },
      { key: 'branch', symbol: 'A_c', meaning: 'spread of the ionospheric crown tendrils' },
    ],
    code: "// an upward discharge as an event cycle, over the orbital night limb\nfront = grow/flash/fade envelope(t);          // the leader climbs, holds, then fades\nif (s <= front) climb along the outward normal from the storm top;\nif (s > 0.6) splay into a crown of tendrils at the ionosphere;\ncolour bakes by altitude: blue-white leader \u2192 blue column \u2192 violet/red crown",
    links: [
      { label: 'Upper-atmospheric lightning (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Upper-atmospheric_lightning' },
      { label: 'Gigantic jet', url: 'https://en.wikipedia.org/wiki/Gigantic_jet' },
      { label: 'Transient luminous events (NASA)', url: 'https://science.nasa.gov/science-research/earth-science/transient-luminous-events/' },
    ],
  },
  ringdown: {
    title: 'Black Hole Ringdown',
    about:
      "Strike a bell and it rings in fading tones. Merge two black holes and the newborn horizon does the same: it RINGS DOWN, shedding its distortion as gravitational waves in a handful of decaying tones called quasinormal modes \u2014 damped sinusoids A\u00b7e^{\u2212t/\u03c4}\u00b7cos(\u03c9t). The remarkable part is that the frequencies \u03c9 and decay times \u03c4 depend on NOTHING but the remnant's final mass and spin, so reading them off a LIGO signal tells you exactly what merged \u2014 physicists call it black-hole spectroscopy. When spacetime strikes a black hole, the black hole answers with its own gravitational sound.",
    howItWorks:
      "Spacetime is drawn as a membrane \u2014 a wireframe lattice with a shallow central well for the remnant and a warm accretion glow in the throat. Each cycle the centre is struck, and the dominant \u2113=2 quadrupole mode radiates outward as a damped sinusoid, carried on RETARDED time (the disturbance at radius r is delayed by r/c, so nothing outruns the wavefront) \u2014 an expanding, two-lobed ripple that fades as it goes, plus a faster-decaying overtone. The ring damps toward a quiescent sheet and is struck again. The height is pure closed form, re-evaluated each frame. 'Ring amplitude' sets how hard it is struck, 'decay time' the \u03c4 of the tones, 'well depth' the throat, 're-strike' the cadence.",
    equations: [
      { label: 'a quasinormal tone \u2014 a damped sinusoid', latex: 'h(t) = A\\,e^{-t/\\tau}\\cos(\\omega t + \\phi)' },
      { label: 'the dominant \u2113=2 quadrupole, radiating out (retarded time)', latex: 'h(r,\\theta,t) \\propto e^{-t_r/\\tau}\\cos(\\omega t_r)\\cos 2\\theta, \\quad t_r = t - r/c' },
      { label: '\u03c9 and \u03c4 depend only on final mass and spin', latex: '(\\omega, \\tau) = F(M_f, a_f)' },
    ],
    params: [
      { key: 'ringing', symbol: 'A', meaning: 'amplitude the horizon is struck with' },
      { key: 'decay', symbol: '\\tau', meaning: 'decay time of the quasinormal tones' },
      { key: 'depth', symbol: 'M_f', meaning: 'depth of the remnant\u2019s throat' },
      { key: 'period', symbol: 'T', meaning: 'cadence of re-striking the bell' },
    ],
    code: "// a spacetime membrane ringing in its quasinormal modes\nwell = \u2212depth / \u221a(r\u00b2 + a);                       // the remnant's shallow throat\nt_r  = t \u2212 r/c;                                 // retarded time \u2014 waves obey the light cone\nring = A\u00b7e^{\u2212t_r/\u03c4}\u00b7env(r)\u00b7cos(\u03c9\u00b7t_r)\u00b7cos(2\u03b8);      // \u2113=2 quadrupole, radiating out\nheight = well + ring;                           // re-struck each cycle, damping to quiescence",
    links: [
      { label: 'Quasinormal mode (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Quasinormal_mode' },
      { label: 'Black-hole spectroscopy (ringdown)', url: 'https://en.wikipedia.org/wiki/Tests_of_general_relativity#Ringdown' },
      { label: 'What LIGO hears in a merger', url: 'https://www.ligo.caltech.edu/page/what-is-lw' },
    ],
  },
  precession: {
    title: 'Perihelion Precession',
    about:
      "In Newton's gravity a bound orbit is a closed ellipse: the planet returns to periapsis and retraces the exact same path forever. In Einstein's, it does not. Near a mass the orbit still looks elliptical, but the ellipse's long axis slowly TURNS with each pass, so the path never closes \u2014 it fills out a rosette. Mercury does this by an anomalous 43 arcseconds per century, a discrepancy Newton could not explain and General Relativity nailed exactly in 1915: it was Einstein's first triumph. It is also the visible payoff of the honest caveat under our Gravity Well ([[gravityWell]]) \u2014 it is curved TIME, not a dented rubber sheet, that steers the slow orbit.",
    howItWorks:
      "Each body follows an exact Schwarzschild geodesic, whose shape has a beautifully simple closed form: r(\u03c6) = p/(1 + e\u00b7cos k\u03c6), the same conic as Kepler's but with the true anomaly running at rate k = \u221a(1 \u2212 6M/p) < 1. Because k is a hair below one, the radial cycle (periapsis to periapsis) takes slightly MORE than a full turn, so periapsis advances by \u0394\u03d6 = 2\u03c0(1/k \u2212 1) every orbit \u2014 and the orbit traces a rosette instead of closing. Each body's whole rosette is baked as a trail, with a bright marker climbing it at the real Kepler areal rate (fast at periapsis, slow at apoapsis); a bright photon ring at 3M marks the light-bending edge of the dark hole. Push 'compactness' to bring the orbits closer to the hole (dramatically more precession); stable bound orbits need p > 6 + 2e.",
    equations: [
      { label: 'the Schwarzschild orbit \u2014 a conic with a slow anomaly', latex: 'r(\\varphi) = \\frac{p}{1 + e\\cos(k\\varphi)}, \\quad k = \\sqrt{1 - 6M/p}' },
      { label: 'periapsis advances every revolution', latex: '\\Delta\\varpi = 2\\pi\\Big(\\tfrac{1}{k} - 1\\Big)' },
      { label: 'Mercury \u2014 GR\u2019s first triumph', latex: '43\\,\\text{arcsec}/\\text{century}' },
      { label: 'stable bound orbits only', latex: 'p > 6 + 2e' },
    ],
    params: [
      { key: 'compact', symbol: 'p', meaning: 'compactness \u2014 closer to the hole means far more precession' },
      { key: 'ecc', symbol: 'e', meaning: 'orbital eccentricity' },
      { key: 'orbits', symbol: 'n', meaning: 'number of test bodies (rebuild)' },
      { key: 'speed', symbol: 'v', meaning: 'orbital pace' },
    ],
    code: "// an exact Schwarzschild geodesic \u2014 a conic whose anomaly runs slow, so it never closes\nk = \u221a(1 \u2212 6M/p);                      // the relativistic factor, just below 1\nr(\u03c6) = p / (1 + e\u00b7cos(k\u03c6));          // Kepler's conic, but precessing\n\u0394\u03d6 = 2\u03c0(1/k \u2212 1) per orbit;            // periapsis advances \u2192 a rosette\nmarker climbs at d\u03c6/dt \u221d \u221ap / r\u00b2       // Kepler areal speed: fast at periapsis",
    links: [
      { label: 'Apsidal / perihelion precession (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Apsidal_precession' },
      { label: 'Tests of GR: Mercury\u2019s perihelion', url: 'https://en.wikipedia.org/wiki/Tests_of_general_relativity#Perihelion_precession_of_Mercury' },
      { label: 'Schwarzschild geodesics', url: 'https://en.wikipedia.org/wiki/Schwarzschild_geodesics' },
    ],
  },
  iteratedLog: {
    title: 'Iterated Logarithm',
    about:
      "How far can pure randomness wander before it hits a wall? Add up independent coin-flips \u2014 a centered random walk S\u2099 = X\u2081 + \u2026 + X\u2099 with mean 0 and variance 1 \u2014 and on average it spreads like \u221an (the Central Limit Theorem). But that is only its typical width. Khinchin's Law of the Iterated Logarithm pins down its ALMOST-SURE record: the walk's running extreme is bounded by \u00b1\u221a(2n log log n), a curve it touches infinitely often yet never permanently crosses. The doubly-nested logarithm grows so achingly slowly that the wall is barely wider than \u221an, and yet it is exact \u2014 one of the most delicate results in probability.",
    howItWorks:
      "An ensemble of independent random walks fans out from the origin, each a running sum of Gaussian increments (baked once, so the whole picture is deterministic). Their density fills the middle as the Central-Limit Gaussian (the faint \u221an reference), while the two bright LIL walls \u00b1\u221a(2n log log n) open above and below. A sweeping front traces the walks out in n; wherever a path reaches up and kisses the wall it flares orange \u2014 a momentary record-setter, exactly the rare excursions the law is about. Raise 'ensemble' for more walks, 'step variance' to widen every increment, 'sweep rate' to trace them faster.",
    equations: [
      { label: 'the walk and its typical (CLT) width', latex: 'S_n = \\sum_{i=1}^{n} X_i, \\qquad S_n \\sim \\sqrt{n}' },
      { label: 'Khinchin\u2019s law of the iterated logarithm', latex: '\\limsup_{n\\to\\infty} \\frac{S_n}{\\sqrt{2n\\log\\log n}} = +1' },
      { label: '\u2026 and symmetrically below', latex: '\\liminf_{n\\to\\infty} \\frac{S_n}{\\sqrt{2n\\log\\log n}} = -1' },
    ],
    params: [
      { key: 'walks', symbol: 'K', meaning: 'size of the random-walk ensemble' },
      { key: 'diffuse', symbol: '\\sigma^2', meaning: 'variance of each step' },
      { key: 'speed', symbol: 'v', meaning: 'rate the sweeping front traces the walks' },
    ],
    code: "// an ensemble of random walks against the almost-sure wall\nfor each walk: S += \u03c3\u00b7gaussian();               // running sum of increments\nwall(n) = \u221a(2n\u00b7log(log n));                  // the LIL envelope\nif (|S| > 0.82\u00b7wall) flare orange;             // a record-setter kissing the wall\nfront sweeps in n \u2192 the fan is traced out left to right",
    links: [
      { label: 'Law of the iterated logarithm (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Law_of_the_iterated_logarithm' },
      { label: 'Aleksandr Khinchin', url: 'https://en.wikipedia.org/wiki/Aleksandr_Khinchin' },
      { label: 'Random walk (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Random_walk' },
    ],
  },
  som: {
    title: 'Self-Organizing Map',
    about:
      "A self-organizing map begins as a blank sheet of neurons \u2014 a 2-D grid of weight vectors that know nothing about the data around them. Feed it samples and it teaches itself their shape: for each sample it finds the single best-matching neuron, then pulls that neuron AND its grid neighbours a little closer. As the neighbourhood of influence slowly shrinks, the sheet bends and folds until it drapes over the hidden geometry of the data \u2014 all while keeping neurons that were neighbours on the flat grid neighbours in space. It is one of the most elegant examples of competitive learning: global order emerging, with no supervisor, from thousands of tiny local nudges. Invented by the Finnish scientist Teuvo Kohonen in 1982.",
    howItWorks:
      "A grid of neurons starts as a tiny flat patch and learns to wrap a sphere of sample points. Each training step draws a few samples; for each, the best-matching unit c = argminᵢ‖x \u2212 wᵢ‖ is found by a nearest-weight search, and every neuron is moved wᵢ \u2190 wᵢ + \u03b7\u00b7h_{ci}\u00b7(x \u2212 wᵢ), where the neighbourhood kernel h_{ci} = exp(\u2212\u2016gridᵢ \u2212 grid_c\u2016\u00b2 / 2\u03c3\u00b2) falls off with distance ON THE GRID (not in space). The radius \u03c3 and the learning rate \u03b7 both anneal downward over training, so the sheet first unfolds coarsely and then refines \u2014 draping over the sphere like an orange peel, folds and all. It renders as a live wireframe (points strung along the grid edges) over a faint cloud of the data being learned. Nudge 'learning pace' to speed or slow the training.",
    equations: [
      { label: 'best-matching unit for a sample', latex: 'c = \\arg\\min_i \\lVert x - w_i \\rVert' },
      { label: 'update the winner and its grid neighbours', latex: 'w_i \\leftarrow w_i + \\eta(t)\\,h_{ci}(t)\\,(x - w_i)' },
      { label: 'the neighbourhood kernel (distance ON the grid)', latex: 'h_{ci} = \\exp\\!\\Big(-\\tfrac{\\lVert r_i - r_c\\rVert^2}{2\\sigma(t)^2}\\Big)' },
      { label: '\u2026 with \u03c3 and \u03b7 annealing over training', latex: '\\sigma(t)\\downarrow, \\quad \\eta(t)\\downarrow' },
    ],
    params: [
      { key: 'rate', symbol: '\u03bd', meaning: 'pace of the training (samples per frame)' },
    ],
    code: "// competitive learning: find the winner, pull it + its grid neighbours toward the sample\nc = argmin_i |x \u2212 w_i|;                    // best-matching neuron (nearest weight)\nh = exp(\u2212|grid_i \u2212 grid_c|\u00b2 / 2\u03c3\u00b2);          // neighbourhood on the FLAT grid\nw_i += \u03b7\u00b7h\u00b7(x \u2212 w_i);                        // move winner + neighbours; \u03c3, \u03b7 anneal down\n// the flat sheet folds onto the data's shape while keeping its neighbourhood order",
    links: [
      { label: 'Self-organizing map (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Self-organizing_map' },
      { label: 'Teuvo Kohonen', url: 'https://en.wikipedia.org/wiki/Teuvo_Kohonen' },
      { label: 'Competitive learning', url: 'https://en.wikipedia.org/wiki/Competitive_learning' },
    ],
  },
  opticalVortex: {
    title: 'Optical Vortices',
    about:
      "A phase vortex is a thread of pure darkness in a beam of light: a point where the wave's phase winds a whole number of turns, e^{i\u2113\u03b8}, and at the centre \u2014 where every phase meets at once \u2014 the amplitude must vanish. That is a doughnut of light carrying orbital angular momentum \u2113\u0127 per photon. Interfere such a beam with a tilted reference wave and its fine fringes SPLIT into forks at each vortex \u2014 the branch points that betray a phase singularity, and the very pattern a computer-generated hologram uses to MAKE a vortex beam. This one computes the real thing: several drifting vortex beams plus a reference wave, and the screen shows the intensity of their sum.",
    howItWorks:
      "Rendered not as particles but as a true field \u2014 a full-screen shader evaluates the light itself at every pixel. Several Laguerre\u2013Gauss-like vortex beams (amplitude (\u03c1/w)^{|\u2113|}\u00b7e^{\u2212\u03c1\u00b2/2w\u00b2}, helical phase \u2113\u03b8) drift on ellipses; a tilted plane-wave reference is added; and the pixel shows I = |\u03a3E|\u00b2. Because the reference lays down a fine carrier of parallel fringes, each vortex FORKS them \u2014 a fringe splits into two exactly where a phase singularity threads the field, its order equal to the topological charge. Warm inferno tones for the bright fringes over a violet ground. Add or remove 'vortices', spin their phase, drift the apertures, or widen the beams.",
    equations: [
      { label: 'a vortex beam \u2014 dark core, helical phase', latex: 'E_\\ell(\\rho,\\theta) = \\Big(\\tfrac{\\rho}{w}\\Big)^{|\\ell|} e^{-\\rho^2/2w^2}\\,e^{i\\ell\\theta}' },
      { label: 'interfere with a tilted reference and show the intensity', latex: 'I = \\big|\\,\\textstyle\\sum_k E_k + e^{i\\mathbf{k}\\cdot\\mathbf{r}}\\big|^2' },
      { label: 'each photon carries orbital angular momentum', latex: 'L_z = \\ell\\hbar' },
    ],
    params: [
      { key: 'zoom', symbol: 'z', meaning: 'field of view into the beam plane' },
      { key: 'drift', symbol: 'v', meaning: 'speed the vortex apertures drift' },
      { key: 'twist', symbol: '\\dot\\phi', meaning: 'rate the beams\u2019 phase spins' },
      { key: 'width', symbol: 'w', meaning: 'beam width' },
      { key: 'gain', symbol: 'g', meaning: 'intensity / contrast' },
    ],
    code: "// a full-screen field, not points: evaluate |\u03a3E|\u00b2 at every pixel\nfor each beam k:  E += (\u03c1/w)^{|\u2113|}\u00b7e^{\u2212\u03c1\u00b2/2w\u00b2}\u00b7(cos, sin)(\u2113\u00b7atan2 + \u03c6_k);\nE += (cos, sin)(k\u00b7r);        // tilted reference wave \u2014 its fringes get FORKED\nI = |E|\u00b2;                    // forks appear at every vortex core",
    links: [
      { label: 'Optical vortex (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Optical_vortex' },
      { label: 'Orbital angular momentum of light', url: 'https://en.wikipedia.org/wiki/Orbital_angular_momentum_of_light' },
      { label: 'Fork holograms for vortex beams', url: 'https://en.wikipedia.org/wiki/Computer-generated_holography' },
    ],
  },
  spiralWhirl: {
    title: 'Spiral Whirl',
    about:
      "A whole animation in a single tweet. This is a faithful port of a \u201ctsubuyaki Processing\u201d (\u3064\u3076\u3084\u304dProcessing \u2014 \u2018murmur\u2019 code, short enough to fit in a post) sketch by KAZ+OO (@KAZOOOps): four thousand points, each riding a nested spiral. It is nothing but a for-loop and a little trigonometry, yet it turns and pulses into a lace of interleaved arcs \u2014 a reminder that a few lines of closed-form math can hold a surprising amount of motion.",
    howItWorks:
      "Every point is indexed by i. Its radius is a sawtooth r = i mod 200 (twenty nested rings) plus a breathing wobble 99\u00b7sin(i\u00b2 + t); its angle a = i + t winds it around; and a second offset 80\u00b7(sin(i+t), cos(3i+t)) swirls the whole bloom off-centre. That is the entire system \u2014 no state, just the closed form re-evaluated each frame as t advances. We sample densely along the same index range for a finer cloud (bucketing the i\u00b2 wobble per integer so each arc stays crisp), and bake the white-to-pink colour once. 'Wind speed' sets how fast t runs; 'swirl offset' scales the off-centre drift.",
    equations: [
      { label: 'radius: nested sawtooth + a breathing wobble', latex: 'r = (i \\bmod 200) + 99\\sin(i^2 + t)' },
      { label: 'position: wound by a = i + t, swirled off-centre', latex: '(x,y) = r(\\sin a, \\cos a) + 80(\\sin(i{+}t),\\, \\cos(3i{+}t))' },
    ],
    params: [
      { key: 'speed', symbol: '\\dot t', meaning: 'how fast the whirl winds' },
      { key: 'swirl', symbol: 's', meaning: 'scale of the off-centre swirl offset' },
    ],
    code: "// a tweet-sized sketch, ported faithfully — one loop, pure trig\nr = (i mod 200) + 99\u00b7sin(i\u00b2 + t);          // twenty nested rings + a breathing wobble\na = i + t;                                 // wind it around\n(x, y) = r\u00b7(sin a, cos a) + 80\u00b7(sin(i+t), cos(3i+t)); // swirl the bloom off-centre",
    links: [
      { label: 'Original sketch \u2014 KAZ+OO (@KAZOOOps)', url: 'https://twitter.com/KAZOOOps' },
      { label: 'tsubuyaki Processing (\u3064\u3076\u3084\u304dProcessing)', url: 'https://twitter.com/hashtag/%E3%81%A4%E3%81%B6%E3%82%84%E3%81%8DProcessing' },
      { label: 'p5.js', url: 'https://p5js.org/' },
    ],
  },
  onsagerVortex: {
    title: 'Onsager Vortices',
    about:
      "In 1949 Lars Onsager turned statistical mechanics upside down. A gas of point vortices in a thin (2-D) fluid has bounded phase space, so above a critical energy its entropy DECREASES with energy — a negative absolute temperature. There, same-sign vortices, which normally orbit each other at a distance, instead condense into a few giant coherent domains: order emerging from adding energy, the reverse of everyday heat. It's the mechanism behind long-lived structures in 2-D turbulence, from soap films to Jupiter's Great Red Spot to trapped superfluid gases — and it was directly imaged in a Bose–Einstein condensate in 2019.",
    howItWorks:
      "Each point vortex of circulation Γ stirs the whole fluid: at a distance it induces an azimuthal velocity u = Γ/(2π)·(ẑ×Δ)/|Δ|² (Biot–Savart). We place two clusters of same-sign vortices — the condensed state Onsager predicted — and, for every pixel, sum that velocity from all of them. The flowing streamlines are drawn by line-integral convolution: a noise texture is marched a few steps forward and backward along the local velocity and averaged, smearing white noise into streaks that trace the flow exactly. The sign of the summed vorticity tints each region (cyan ↷ vs ember ↶), and the vortex cores burn white. Because it's a continuum field, not particles, the two counter-rotating domains read cleanly. 'Flow rate' sets the precession speed; 'contrast' the streamline sharpness.",
    equations: [
      { label: 'velocity a vortex induces (Biot–Savart, 2-D)', latex: '\\mathbf{u}(\\mathbf{r}) = \\frac{\\Gamma}{2\\pi}\\,\\frac{\\hat{\\mathbf{z}}\\times(\\mathbf{r}-\\mathbf{r}_j)}{|\\mathbf{r}-\\mathbf{r}_j|^2}' },
      { label: 'Onsager’s negative temperature (bounded phase space)', latex: '\\frac{1}{T} = \\frac{\\partial S}{\\partial E} < 0 \\;\\Rightarrow\\; \\text{same-sign vortices clump}' },
    ],
    params: [
      { key: 'zoom', symbol: 'z', meaning: 'field of view over the vortex gas' },
      { key: 'speed', symbol: '\\dot t', meaning: 'how fast the dipole precesses' },
      { key: 'gain', symbol: 'g', meaning: 'streamline contrast' },
    ],
    code: "// per pixel: sum the velocity every vortex induces, then trace the streamline\nu = (0,0);\nfor each vortex k:  d = p - r_k;  u += Γ_k/(2π) · (-d.y, d.x) / (|d|² + a²);\n// line-integral convolution: march noise along u, both ways, and average → streaks\nω = Σ Γ_k·G(p - r_k);  colour = (ω > 0) ? cyan : ember;",
    links: [
      { label: 'Onsager 1949 — Statistical hydrodynamics', url: 'https://en.wikipedia.org/wiki/Two-dimensional_point_vortex_gas' },
      { label: 'Negative temperature', url: 'https://en.wikipedia.org/wiki/Negative_temperature' },
      { label: 'Vortex clustering imaged in a BEC (2019)', url: 'https://en.wikipedia.org/wiki/Quantum_vortex' },
    ],
  },
  screenedVortexGas: {
    title: 'Screened Vortex Gas',
    about:
      "The same point-vortex gas as Onsager, but given a memory of scale. In a rotating, stratified fluid — the atmosphere, the ocean — a vortex cannot stir the whole world: beyond the deformation radius R_d (where rotation balances buoyancy) its influence is screened away. This is the quasi-geostrophic, or equivalent-barotropic, model, and it is the workhorse of geophysical fluid dynamics: it explains why Jupiter organizes into banded jets and long-lived spots, and why the ocean is full of mesoscale eddies. With finite reach, only neighbours interact — so instead of one global condensate you get a living turbulent field of rotating islands and drifting pairs. It begins as a gas and ends up looking like weather.",
    howItWorks:
      "Each vortex deposits a blob of potential vorticity q = Σ Γᵢ Gₐ(r−rᵢ). The streamfunction is recovered not from Poisson's equation but from a SCREENED one, (−∇² + R_d⁻²)ψ = q — the extra R_d⁻² term is the whole story. Its Green's function is a Bessel K₀(r/R_d): like 1/r up close, but decaying exponentially past R_d, so distant vortices are muted (we approximate it as a 1/r kernel times e^{−r/R_d}). The velocity u = (∂ᵧψ, −∂ₓψ) advects both the vortices and a cloud of passive tracers, drawn by line-integral convolution into the fine threads that record the flow's stretching and folding. Same-sign vortices bind into co-rotating islands; opposite signs pair up and translate. Two potential-vorticity signs carry two shades each — jade↔emerald and crimson↔copper. 'Deformation radius' sets how local the turbulence is (small = many tight cells; large → back toward Onsager's global reach).",
    equations: [
      { label: 'potential-vorticity carriers (Gaussian cores)', latex: 'q(\\mathbf{r},t) = \\sum_i \\Gamma_i\\, G_a(\\mathbf{r}-\\mathbf{r}_i(t))' },
      { label: 'screened streamfunction (finite deformation radius)', latex: '\\left(-\\nabla^2 + R_d^{-2}\\right)\\psi = q, \\qquad \\mathbf{u} = (\\partial_y\\psi,\\, -\\partial_x\\psi)' },
    ],
    params: [
      { key: 'zoom', symbol: 'z', meaning: 'field of view over the vortex gas' },
      { key: 'speed', symbol: '\\dot t', meaning: 'how fast the islands drift and spin' },
      { key: 'screen', symbol: 'R_d', meaning: 'deformation radius — the screening length' },
      { key: 'gain', symbol: 'g', meaning: 'tracer-thread contrast' },
    ],
    code: "// screened Biot-Savart: 1/r kernel, cut off past the deformation radius R_d\nu = (0,0);\nfor each vortex k:  d = p - r_k;  w = exp(-|d|/R_d) / |d|²;\n                    u += Γ_k · (-d.y, d.x) · w;\n// same-sign vortices bind into islands; LIC-trace the passive threads\nq = Σ Γ_k·G(p - r_k);  colour = (q > 0) ? jade : copper;",
    links: [
      { label: 'Quasi-geostrophic dynamics', url: 'https://en.wikipedia.org/wiki/Quasi-geostrophic_equations' },
      { label: 'Rossby radius of deformation', url: 'https://en.wikipedia.org/wiki/Rossby_radius_of_deformation' },
      { label: 'Two-dimensional / geostrophic turbulence', url: 'https://en.wikipedia.org/wiki/Two-dimensional_turbulence' },
    ],
  },
  vascularSom: {
    title: 'Vascular SOM',
    about:
      "A self-organizing map is excellent at learning smooth surfaces — hand it a sphere and it drapes over like an orange peel. A branching vascular network is a different challenge entirely. A flat rectangular lattice of neurons cannot wrap around every bifurcation while keeping all neighbouring neurons connected in a consistent way, so near the branch points the map begins to stretch, compress and reorganize. What looks like the algorithm struggling is one of its most interesting properties: it is revealing the limits of topology preservation. The geometry is simply asking more of the neural sheet than its lattice can faithfully represent — and sometimes the most informative machine-learning pictures are the ones that show you exactly where a method's assumptions break down.",
    howItWorks:
      "The rule is identical to the sphere-draping SOM. For each input sample x drawn from the data — here, points along a recursively branching tree — the map finds its best-matching neuron c = argminᵢ‖x − wᵢ‖, then nudges that neuron and its grid neighbours toward the sample, wᵢ ← wᵢ + η(t)·h_ci(t)·(x − wᵢ), with a Gaussian neighbourhood h that shrinks and a learning rate η that decays as training anneals. On a continuous manifold those local updates preserve neighbourhood structure beautifully. On a tree they cannot: a single sheet has to reach into every branch, so it strains and tears at the bifurcations. We keep the neighbourhood radius from collapsing to zero, so the sheet stays taut and its stress stays visible rather than crumpling. The blue mesh is the live sheet of neurons; the gold clusters are the tree's branch-tips (the data being learned).",
    equations: [
      { label: 'best-matching unit for a sample x', latex: 'c = \\arg\\min_i \\lVert x - w_i \\rVert' },
      { label: 'update the winner and its grid neighbours', latex: 'w_i \\leftarrow w_i + \\eta(t)\\, h_{ci}(t)\\, (x - w_i)' },
    ],
    params: [
      { key: 'rate', symbol: '\\eta', meaning: 'learning pace — how fast the sheet strains toward the tree' },
    ],
    code: "// same Kohonen rule as the sphere SOM — but the data is a branching tree\nfor each sample x on the vascular tree:\n  c = argmin_i |x - w_i|;                      // best-matching neuron\n  for each neuron i near c on the grid:\n    h = eta * exp(-|grid_i - grid_c|^2 / 2σ²); // shrinking neighbourhood\n    w_i += h * (x - w_i);                       // a flat sheet can't tile a tree → it tears",
    links: [
      { label: 'Self-organizing map (Kohonen)', url: 'https://en.wikipedia.org/wiki/Self-organizing_map' },
      { label: 'Topology preservation', url: 'https://en.wikipedia.org/wiki/Topological_data_analysis' },
      { label: 'Teuvo Kohonen', url: 'https://en.wikipedia.org/wiki/Teuvo_Kohonen' },
    ],
  },
  hopfion: {
    title: 'Hopfion',
    about:
      "In 1931 Heinz Hopf found the first example of a map from a higher sphere to a lower one that cannot be unwound — a map from the 3-sphere S³ onto the ordinary 2-sphere S². Its defining feature is that the preimage of every single point on S² is a whole circle in S³, and any two of those circles are linked exactly once, like adjacent rings of a chain mail. Stereographically projected into ordinary 3-D space, those fibres become a family of nested, interlocking tori that fill all of space. This isn't just pretty topology: a 'hopfion' — a field configuration carrying this linking as a conserved charge (the Hopf invariant) — is a genuine topological soliton, observed in ferromagnets and chiral magnets, in Bose–Einstein condensates and superfluids, in knotted beams of light, and in linked vortex tubes in fluids. (An 'emergent-spacetime superfluid' framing is speculative; the hopfion itself is textbook.)",
    howItWorks:
      "Write a point of S³ as a pair of complex numbers (z₀, z₁) with |z₀|² + |z₁|² = 1. The Hopf map records only their ratio z₀/z₁ as a point of S² (the Riemann sphere), so multiplying both by the same phase e^{iτ} leaves the S² point fixed — that phase orbit is the circular fibre. We pick a latitude θ on S² (which fixes |z₀|:|z₁| = cos(θ/2):sin(θ/2)) and run the fibre phase and azimuth to trace each circle, then stereographically project (z₀, z₁) ∈ S³ ⊂ R⁴ down to R³. A band of latitudes lifts to a set of nested tori; colour tracks the base-sphere azimuth so the linking reads as a wheel of colour. Advancing every fibre's phase together is a rigid isometry of S³ (the Hopf flow), so the whole knot spins without changing shape. The winding number turns the ordinary (1,1) fibres into (1,n) torus knots — higher-order hopfions.",
    equations: [
      { label: 'Hopf fibre of a base point (θ, φ), phase τ', latex: '(z_0, z_1) = \\left(\\cos\\tfrac{\\theta}{2}\\,e^{i\\tau},\\; \\sin\\tfrac{\\theta}{2}\\,e^{i(n\\tau+\\varphi)}\\right)' },
      { label: 'stereographic projection S³ → R³ from the pole', latex: '\\mathbf{r} = \\frac{(\\,\\mathrm{Re}\\,z_0,\\ \\mathrm{Re}\\,z_1,\\ \\mathrm{Im}\\,z_0)}{1 - \\mathrm{Im}\\,z_1}' },
    ],
    params: [
      { key: 'rate', symbol: '\\dot\\tau', meaning: 'Hopf flow — slides every point along its fibre' },
      { key: 'winding', symbol: 'n', meaning: 'winding number — (1,n) torus-knot hopfions' },
    ],
    code: "// each fibre is a circle in S³ ⊂ R⁴; project it into R³\nz0 = (cos(θ/2)·cos τ, cos(θ/2)·sin τ);      // a complex number\nz1 = (sin(θ/2)·cos(nτ+φ), sin(θ/2)·sin(nτ+φ));\nden = 1 - z1.im;                             // stereographic from (0,0,0,1)\n(x, y, z) = (z0.re, z1.re, z0.im) / den;     // nested linked tori",
    links: [
      { label: 'Hopf fibration', url: 'https://en.wikipedia.org/wiki/Hopf_fibration' },
      { label: 'Hopfion (topological soliton)', url: 'https://en.wikipedia.org/wiki/Hopfion' },
      { label: 'Stereographic projection', url: 'https://en.wikipedia.org/wiki/Stereographic_projection' },
    ],
  },
  bifurcation: {
    title: 'Bifurcation Diagram',
    about:
      "The road from order to chaos, drawn in one picture. The logistic map xₙ₊₁ = r·xₙ·(1−xₙ) was introduced as a toy model of a population that grows in proportion to its size but is capped by limited resources. For each growth rate r it settles onto a long-run attractor — and as r increases that attractor keeps DOUBLING: one steady value, then an alternation between two, then four, eight, sixteen, the doublings crowding closer and closer together until, at r ≈ 3.5699, they accumulate and the orbit turns chaotic. Yet the chaos is not featureless: it is shot through with sudden PERIODIC WINDOWS, most famously a wide period-3 band near r ≈ 3.83. Mitchell Feigenbaum discovered that the doublings shrink by a universal ratio δ ≈ 4.669 — the SAME constant for a huge class of systems, one of the deep surprises of nonlinear science.",
    howItWorks:
      "Each point owns a fixed growth rate r and keeps iterating the map forever, so it hops around its own long-run attractor; the cloud of all points, continuously resampled, IS the diagram — and it shimmers as the orbits jump. Where the orbit is a stable cycle the points pile onto a few sharp curves (the period-1, 2, 4… branches); where it is chaotic they fill a band. Colour is baked by the Lyapunov exponent λ = ⟨ln|r(1−2x)|⟩, the average rate at which nearby orbits separate: cool teal where λ<0 (stable — the branches and the windows), hot where λ>0 (chaotic). Reading r left-to-right walks you up the period-doubling cascade, into the chaotic sea, and past the pale gaps of the periodic windows.",
    equations: [
      { label: 'the logistic map', latex: 'x_{n+1} = r\\,x_n\\,(1 - x_n)' },
      { label: 'Feigenbaum’s universal ratio of the doublings', latex: '\\delta = \\lim_{n\\to\\infty}\\frac{r_{n-1}-r_{n-2}}{r_n-r_{n-1}} = 4.6692\\ldots' },
      { label: 'Lyapunov exponent (colour): stable λ<0, chaotic λ>0', latex: '\\lambda = \\lim_{N\\to\\infty}\\frac1N\\sum_{n} \\ln\\bigl|\\,r(1-2x_n)\\,\\bigr|' },
    ],
    params: [
      { key: 'rate', symbol: '\\dot n', meaning: 'how fast each orbit is re-iterated (the shimmer speed)' },
    ],
    code: "// every point holds a fixed r and keeps iterating — the ensemble is the diagram\nx = r*x*(1 - x);                 // one step of the logistic map\nscreen = ( map(r) , map(x) );    // r → horizontal, x → vertical\nλ += ln|r*(1 - 2x)|;             // running Lyapunov → colour (cool stable / hot chaotic)",
    links: [
      { label: 'Logistic map', url: 'https://en.wikipedia.org/wiki/Logistic_map' },
      { label: 'Feigenbaum constants', url: 'https://en.wikipedia.org/wiki/Feigenbaum_constants' },
      { label: 'Period-doubling bifurcation', url: 'https://en.wikipedia.org/wiki/Period-doubling_bifurcation' },
    ],
  },
  elementaryCA: {
    title: 'Elementary Cellular Automaton',
    about:
      "Stephen Wolfram's demonstration that you do not need a complicated rule to make complicated things. A single row of cells, each on or off, updates in lockstep: a cell's next state depends only on itself and its two immediate neighbours. There are just 2³ = 8 possible neighbourhoods, so a rule is nothing but 8 yes/no answers — and reading those 8 bits as a binary number gives the rule its name, 0 to 255. From a single lit cell, Rule 90 draws the Sierpiński triangle, Rule 30 produces provable chaos (Mathematica used it as a random-number generator), and Rule 110 was proved Turing-complete — capable, in principle, of any computation a computer can do — all from three-cell arithmetic. Stacking each new generation below the last builds the space-time diagram you see accrete.",
    howItWorks:
      "Label the three cells above a target as left, middle, right; their on/off values form a number 0–7. The rule is a byte, and its bit at that position is the target's new value: sᵢᵗ⁺¹ = (rule ≫ (4·L + 2·M + R)) & 1. We seed a single lit cell at the top and evolve the whole grid, then reveal it row by row so the pattern grows downward before looping. Rule 30's left half is a wall of noise while its right half throws off nested triangles; Rule 90 is a pure Sierpiński gasket; Rule 110 weaves drifting 'gliders' that collide and interact. The rule-number slider walks all 256 elementary universes.",
    equations: [
      { label: 'the update: the rule byte, indexed by the 3-cell neighbourhood', latex: 's_i^{\\,t+1} = \\left(\\,\\text{rule} \\gg (4\\,s_{i-1}^{\\,t} + 2\\,s_i^{\\,t} + s_{i+1}^{\\,t})\\,\\right) \\,\\&\\, 1' },
    ],
    params: [
      { key: 'rule', symbol: 'R', meaning: 'which of the 256 rules (30 chaos · 90 Sierpiński · 110 universal)' },
      { key: 'seed', symbol: 's_0', meaning: 'start from a single lit cell (0) or a random row (1)' },
      { key: 'rate', symbol: '\\dot g', meaning: 'how fast new generations accrete downward' },
    ],
    code: "// each new cell looks up the rule byte by its 3-cell neighbourhood\nfor each cell i in the new row:\n  nb = 4*left + 2*middle + right;   // 0..7\n  cell[i] = (RULE >> nb) & 1;        // the nb-th bit of the rule number\n// stack rows downward → the space-time diagram",
    links: [
      { label: 'Elementary cellular automaton', url: 'https://en.wikipedia.org/wiki/Elementary_cellular_automaton' },
      { label: 'Rule 30', url: 'https://en.wikipedia.org/wiki/Rule_30' },
      { label: 'Rule 110 (Turing-complete)', url: 'https://en.wikipedia.org/wiki/Rule_110' },
    ],
  },
  doublePendulumSwarm: {
    title: 'Double Pendulum Swarm',
    about:
      "The clearest way to SEE chaos. A double pendulum — one pendulum hung from the end of another — obeys simple, exact, deterministic equations, yet it is the textbook example of sensitive dependence on initial conditions: change the starting angle by a hair and the future is utterly different. Here tens of thousands of them start from almost exactly the same angle, a spread far thinner than a pixel, so the cloud of lower-bob tips begins as a single bright dot. For a moment they move as one — then the microscopic differences, amplified exponentially, tear the dot into a filament, the filament folds, and within a few swings the swarm has detonated into a fog that fills the whole reachable region. The moment it smears is the Lyapunov horizon — the predictability time — made visible; past it the identical-looking pendulums have completely forgotten one another.",
    howItWorks:
      "Every pendulum integrates the same conservative equations of motion (equal masses and arms) with RK4, so no energy is added or lost — the divergence is pure chaos, not noise. Two nearby orbits separate on average like δ(t) ≈ δ₀·e^{λt} with a positive Lyapunov exponent λ, which is why a hair-thin initial fan explodes so fast. Unlike the phase-space Double Pendulum (which plots the abstract 4-D state), this shows the lower bob swinging in REAL space. Colour is baked across the starting bundle, so as it stretches and folds you watch the ordered rainbow shear and marble into mixing — the signature stretch-and-fold of a chaotic flow. The swarm periodically re-collapses to replay the divergence from the start.",
    equations: [
      { label: 'nearby orbits separate exponentially (chaos)', latex: '\\delta(t) \\approx \\delta_0\\, e^{\\lambda t}, \\qquad \\lambda > 0' },
      { label: 'lower-bob tip in real space', latex: '(x,y) = \\bigl(L_1\\sin\\theta_1 + L_2\\sin\\theta_2,\\; -L_1\\cos\\theta_1 - L_2\\cos\\theta_2\\bigr)' },
    ],
    params: [
      { key: 'spread', symbol: '\\delta_0', meaning: 'width of the initial angle bundle (smaller = longer as one dot)' },
      { key: 'rate', symbol: '\\dot t', meaning: 'time rate of the integration' },
    ],
    code: "// tens of thousands of pendulums, almost identical start angles\nθ₁[i] = θ₁₀ + i·tiny;            // a spread thinner than a pixel\n// each integrates the SAME conservative equations with RK4\n// δ(t) ≈ δ₀·e^{λt}, λ>0  → the dot detonates into a fog\ntip = (L₁sinθ₁+L₂sinθ₂, −L₁cosθ₁−L₂cosθ₂);   // plotted in real space",
    links: [
      { label: 'Double pendulum', url: 'https://en.wikipedia.org/wiki/Double_pendulum' },
      { label: 'Chaos theory / sensitive dependence', url: 'https://en.wikipedia.org/wiki/Chaos_theory' },
      { label: 'Lyapunov exponent', url: 'https://en.wikipedia.org/wiki/Lyapunov_exponent' },
    ],
  },
  ising: {
    title: 'Ising Model',
    about:
      "The simplest model in physics that still has a genuine phase transition — proposed by Wilhelm Lenz to his student Ernst Ising in 1920, and solved exactly in two dimensions by Lars Onsager in 1944, one of the landmark calculations of the century. Picture a grid of tiny magnets (spins), each pointing up or down. Neighbouring spins prefer to agree (that is what a ferromagnet is), but temperature constantly jostles them. Two forces compete: order (spins aligning to lower their energy) and entropy (heat scrambling them). Below a sharp critical temperature — the Curie point Tc = 2/ln(1+√2) ≈ 2.269 — order wins and the whole lattice spontaneously MAGNETIZES into large domains all pointing the same way. Above it, heat wins and the spins are a disordered salt-and-pepper. Exactly at Tc something remarkable happens: domains appear at every size at once, self-similar and fractal (critical opalescence), and quantities like the magnetic susceptibility diverge — the signature of a second-order phase transition.",
    howItWorks:
      "We evolve the lattice by the Metropolis Monte-Carlo rule, the workhorse of statistical physics. Pick a spin; flipping it changes the energy by ΔE = 2·s·(sum of its four neighbours). If that LOWERS the energy, always accept the flip; if it raises it, accept anyway with probability e^{−ΔE/T} — occasionally letting the system climb uphill, which is exactly how thermal fluctuations work. Sweeping the whole lattice this way (on a checkerboard, so the two sub-lattices update independently) samples the Boltzmann distribution at temperature T. Drag the temperature slider down and you watch domains freeze and grow; push it up through Tc and they dissolve into noise. Warm points are up-spins, cool points are down-spins, so the domain walls — the boundaries between agreeing regions — are drawn directly.",
    equations: [
      { label: 'energy: neighbours want to agree (ferromagnetic, J>0)', latex: 'E = -J\\sum_{\\langle i,j\\rangle} s_i s_j, \\qquad s_i = \\pm 1' },
      { label: 'Metropolis acceptance of a proposed flip', latex: 'P(\\text{flip}) = \\min\\!\\left(1,\\; e^{-\\Delta E / T}\\right), \\quad \\Delta E = 2 s_i \\textstyle\\sum_{\\text{nbrs}} s_j' },
      { label: 'the exact critical temperature (Onsager, 1944)', latex: 'T_c = \\frac{2}{\\ln(1+\\sqrt{2})} \\approx 2.269' },
    ],
    params: [
      { key: 'temperature', symbol: 'T', meaning: 'the control knob — cross Tc≈2.27 to drive order ↔ disorder' },
      { key: 'rate', symbol: '\\dot{s}', meaning: 'Monte-Carlo sweeps per frame' },
    ],
    code: "// Metropolis Monte-Carlo: propose a flip, accept by the Boltzmann rule\nΔE = 2 * s[i] * (s[up] + s[down] + s[left] + s[right]);\nif (ΔE <= 0 || random() < exp(-ΔE / T)) s[i] = -s[i];\n// below Tc = 2/ln(1+√2) ≈ 2.269 the lattice magnetizes into domains",
    links: [
      { label: 'Ising model', url: 'https://en.wikipedia.org/wiki/Ising_model' },
      { label: 'Metropolis–Hastings algorithm', url: 'https://en.wikipedia.org/wiki/Metropolis%E2%80%93Hastings_algorithm' },
      { label: 'Phase transitions & critical phenomena', url: 'https://en.wikipedia.org/wiki/Phase_transition' },
    ],
  },
  penrose: {
    title: 'Penrose Tiling',
    about:
      "One of the most surprising objects in modern geometry. Ordinary tilings repeat — slide them and they land back on themselves. In 1974 Roger Penrose found a pair of tiles, a fat and a thin rhombus, that tile the entire plane but ONLY aperiodically: the pattern never repeats no matter how far you go, and yet it is nothing like random. It has perfect five-fold symmetry (forbidden to ordinary crystals), a rigid long-range order, and the property that every finite patch, however large, reappears infinitely often — order without periodicity. For years it was a mathematical curiosity, until in 1982 Dan Shechtman found real metal alloys whose atoms are arranged exactly this way. Nobody believed him at first — five-fold crystals were 'impossible' — but he was right, the materials are called quasicrystals, and he won the 2011 Nobel Prize in Chemistry for them.",
    howItWorks:
      "We build the tiling with N. G. de Bruijn's elegant 1981 insight: the Penrose tiling is the DUAL of a 'pentagrid'. Take five families of equally-spaced parallel lines, each family rotated 72° from the last (five-fold symmetry). Wherever a line from one family crosses a line from another, place a rhombus whose edges point along those two families' directions — fat if the families are two apart, thin if they are adjacent. Slide the whole construction into place and these rhombi lock together, with no gaps or overlaps, into a perfect Penrose tiling. Each intersection of the pentagrid becomes exactly one tile; the five integer 'which-line' counts at a point are the tile's coordinates. We draw the rhombus edges as glowing points — the fat tiles warm, the thin tiles cool — so the characteristic ten-fold rosettes stand out.",
    equations: [
      { label: 'the five grid directions (72° apart)', latex: '\\mathbf{e}_k = (\\cos\\tfrac{2\\pi k}{5},\\ \\sin\\tfrac{2\\pi k}{5}), \\quad k = 0\\ldots 4' },
      { label: 'de Bruijn grid: line index of family k at a point', latex: 'K_k(\\mathbf{r}) = \\lceil\\, \\mathbf{e}_k\\cdot\\mathbf{r} + \\gamma_k \\,\\rceil, \\qquad \\textstyle\\sum_k \\gamma_k \\in \\mathbb{Z}' },
      { label: 'each pentagrid intersection → one rhombus (edges eₖ, e_l)', latex: '\\text{fat if } |k-l|\\in\\{2,3\\},\\quad \\text{thin if } |k-l|\\in\\{1,4\\}' },
    ],
    params: [
      { key: 'speed', symbol: '\\dot\\theta', meaning: 'slow rotation of the whole tiling' },
    ],
    code: "// de Bruijn dual: every pair of pentagrid lines (k,i)×(l,j) makes one rhombus\nsolve  eₖ·r = i − γₖ,  e_l·r = j − γ_l   for the intersection r\nfor m ≠ k,l:  Kₘ = floor(eₘ·r + γₘ);   O = Σ Kₘ·eₘ\ncorners = O + {i−1,i}·eₖ + {j−1,j}·e_l    // a rhombus spanned by eₖ and e_l",
    links: [
      { label: 'Penrose tiling', url: 'https://en.wikipedia.org/wiki/Penrose_tiling' },
      { label: 'de Bruijn — pentagrid / multigrid method', url: 'https://en.wikipedia.org/wiki/Penrose_tiling#Deflation_for_P2_and_P3_tilings' },
      { label: 'Quasicrystals (Shechtman, Nobel 2011)', url: 'https://en.wikipedia.org/wiki/Quasicrystal' },
    ],
  },
  barabasiAlbert: {
      "title": "Barabási–Albert Network",
      "about": "Why do so many real networks — the World Wide Web, scientific citations, protein interactions, airline routes, who-follows-whom — have a few enormously connected hubs and a vast majority of barely-connected nodes, instead of everyone having roughly the same number of links? In 1999 Albert-László Barabási and Réka Albert showed that two ingredients are enough: the network GROWS (nodes are added over time) and new nodes attach PREFERENTIALLY (they are more likely to link to nodes that are already well connected). That is all. No hub is planned; the earliest, best-connected nodes simply keep winning new links — \"the rich get richer\" — and the result is a scale-free network whose degree distribution follows a power law, P(k) ∝ k^-3. It is the same self-reinforcing structure people are gesturing at when they look at a dense all-to-all diagram — even a 1665 alchemical table — and see a neural network: connectivity concentrating into hubs.",
      "howItWorks": "We grow the graph exactly as the model prescribes. Start with a small seed of fully-connected nodes. Then add nodes one at a time; each new node makes m links, and it chooses each partner with probability proportional to that node's current number of links. We implement the proportional choice with the classic 'stub list' trick — a list in which every node appears once for each link it has, so picking a random entry automatically favours high-degree nodes — which makes each attachment O(1). Once the graph is grown we lay it out in three dimensions with a force-directed relaxation: every pair of nodes repels (so the graph spreads out) while linked nodes attract (so neighbours stay close), cooled over many passes until it settles. Finally each edge is drawn as a short chain of points, dim along the low-degree end and bright at the hubs, and each node gets a little glow whose size and warmth grow with its degree — so the emergent hubs blaze gold while the periphery stays a cool blue web. A slow spin reveals the three-dimensional hub-and-spoke skeleton.",
      "equations": [
          {
              "label": "preferential attachment probability",
              "latex": "\\Pi(k_i) = \\dfrac{k_i}{\\sum_j k_j}"
          },
          {
              "label": "resulting scale-free degree distribution",
              "latex": "P(k) \\sim k^{-3}"
          },
          {
              "label": "the network grows one node (m links) at a time",
              "latex": "N \\to N+1, \\qquad E \\to E + m"
          }
      ],
      "params": [
          {
              "key": "nodes",
              "symbol": "N",
              "meaning": "total number of nodes grown"
          },
          {
              "key": "attach",
              "symbol": "m",
              "meaning": "links each new node makes — higher m = denser, more interconnected"
          },
          {
              "key": "speed",
              "symbol": "\\omega",
              "meaning": "how fast the network spins"
          }
      ],
      "code": "// grow the graph: new nodes attach preferentially to well-connected nodes\nseed = fully_connected(m+1)\nstubs = [each node once per link]          // sampling this favours high degree\nfor i in (m+1) .. N-1:\n  targets = m distinct nodes drawn from stubs   // preferential attachment\n  for t in targets: add_edge(i, t); stubs += [i, t]\n// then: 3-D force-directed layout, draw edges as glowing spokes, hubs hot",
      "links": [
          {
              "label": "Barabási & Albert 1999 — Emergence of scaling in random networks",
              "url": "https://en.wikipedia.org/wiki/Barab%C3%A1si%E2%80%93Albert_model"
          },
          {
              "label": "Scale-free network",
              "url": "https://en.wikipedia.org/wiki/Scale-free_network"
          },
          {
              "label": "Preferential attachment",
              "url": "https://en.wikipedia.org/wiki/Preferential_attachment"
          }
      ]
  },
  collatz: {
      "title": "Collatz Coral",
      "about": "Pick any positive whole number. If it is even, halve it; if it is odd, triple it and add one. Repeat. The Collatz conjecture — posed in 1937 and still unproven — says that no matter where you start, you always tumble down to 1. It has been checked by computer for every number up to about 2^68, yet no proof exists; Paul Erdős said \"mathematics may not be ready for such problems.\" Each number's journey down to 1 is its hailstone sequence (the values bounce up and down like hail in a cloud before falling). This piece turns those journeys into a plant. Because every sequence ends the same way — …→8→4→2→1 — all of them share that final stretch, so if you draw each one as a little path they overlap along a common stem and only peel apart where their numbers differ. Hundreds of independent descents, drawn together, weave themselves into a single branching coral: no tree-building, just arithmetic finding its own shape.",
      "howItWorks": "We run each number's sequence BACKWARDS, starting from the root at 1, and draw it with a turtle: step forward one unit, and at every number turn a little — gently to the left when the number is even, more sharply to the right when it is odd. Because roughly two of every three steps are halvings (even), the boughs sweep in long gentle curves, and the occasional odd number puts the kink that throws off a new branch. Every bough is drawn as a continuous line of points, dim where it shares the crowded stem and brightening toward its own tip, so the trunk stays a thin bright thread while the crown blazes with hundreds of overlapping fronds. We sample starting integers spread across a wide range for variety, cap how deep each bough is drawn so the rare very-long sequences don't spiral away, and normalise the whole coral to sit upright in the frame. The turn angles are balanced so the boughs, on average, grow straight up — the fan comes from the natural spread of even/odd patterns, not from a bias.",
      "equations": [
          {
              "label": "the Collatz (3n+1) map",
              "latex": "f(n) = \\begin{cases} n/2 & n \\text{ even} \\\\ 3n+1 & n \\text{ odd} \\end{cases}"
          },
          {
              "label": "the conjecture: every start reaches 1",
              "latex": "\\forall n \\in \\mathbb{Z}^{+}\\; \\exists k:\\; f^{(k)}(n) = 1 \\quad(\\text{unproven})"
          },
          {
              "label": "turtle heading along a reversed bough",
              "latex": "\\theta_{j} = \\theta_{j-1} + \\begin{cases} +\\alpha & \\text{value even} \\\\ -\\beta & \\text{value odd} \\end{cases}"
          }
      ],
      "params": [
          {
              "key": "sway",
              "symbol": "a",
              "meaning": "amplitude of the slow seaweed drift; 0 freezes the coral"
          },
          {
              "key": "speed",
              "symbol": "\\omega",
              "meaning": "how fast the coral sways"
          }
      ],
      "code": "// draw each number's descent, backwards from the root, as a turtle bough\nfor each start:\n  seq = hailstone(start)         // start -> ... -> 1\n  x = 0; y = 0; h = PI/2         // root at the base, pointing up\n  for val in reverse(seq):\n    h += (val even) ? +A_EVEN : -A_ODD   // gentle left / sharper right\n    x += cos(h); y += sin(h)\n    plot a line point here, dim near the root, bright toward the tip",
      "links": [
          {
              "label": "Collatz conjecture (Wikipedia)",
              "url": "https://en.wikipedia.org/wiki/Collatz_conjecture"
          },
          {
              "label": "Veritasium — The Simplest Math Problem No One Can Solve",
              "url": "https://www.youtube.com/watch?v=094y1Z2wpJg"
          },
          {
              "label": "hailstone sequences (OEIS A006577)",
              "url": "https://oeis.org/A006577"
          }
      ]
  },
  primeSpiral: {
    title: 'Prime Spiral',
    about:
      "What happens when you let number theory arrange itself geometrically? Take the sunflower's own packing — the arrangement a real sunflower head, pinecone, or pineapple uses to fit the most seeds into a disk — and drop the whole number line onto it. Integer n goes at radius √n and angle n × 137.507°, the GOLDEN ANGLE: a full turn scaled by 1/φ², the 'most irrational' rotation there is, so no two seeds ever line up and the packing stays maximally even. The interlocking spiral arms you see (botanists call them parastichies, and there are always a Fibonacci number of them) are not drawn in — they emerge purely from that irrational spacing. Now colour each point by whether it is PRIME. The primes are not scattered at random: they flare through the arms in a structured way, thinning some spirals and lighting others — a portrait of how the multiplicative fabric of the integers threads through nature's favourite packing. It is a phyllotactic cousin of Stanisław Ulam's famous square prime spiral.",
    howItWorks:
      "Two ingredients. First, the geometry: Vogel's 1979 formula r = c√n, θ = n·ψ with ψ = 2π/φ² ≈ 137.507° places point n on the sunflower; because √n makes the area per point constant, the disk fills evenly, and because ψ is irrational the arms never close into spokes. Second, the arithmetic: we mark which integers are prime with a single pass of the Sieve of Eratosthenes — cross out every multiple of 2, then 3, then 5, and so on; whatever survives is prime. (No need to re-test primality every frame — it never changes.) Primes are drawn incandescent, ember at the dense core fading to ivory at the rim; composites collapse to a dim violet haze so the spiral families still read. The whole bloom turns slowly.",
    equations: [
      { label: 'Vogel sunflower placement of integer n', latex: 'r = c\\sqrt{n}, \\qquad \\theta = n\\cdot\\psi, \\quad \\psi = \\frac{2\\pi}{\\varphi^2} \\approx 137.507^\\circ' },
      { label: 'the golden angle from the golden ratio', latex: '\\varphi = \\tfrac{1+\\sqrt5}{2}, \\qquad \\psi = 2\\pi\\,(1 - 1/\\varphi) = \\pi(3-\\sqrt5)' },
    ],
    params: [
      { key: 'speed', symbol: '\\dot\\theta', meaning: 'slow rotation of the whole bloom' },
    ],
    code: "// place every integer on the sunflower, then light the primes\nfor n = 1..N:\n  r = c·√n;  θ = n · 137.507°;         // Vogel / golden-angle packing\n  (x,y) = (r·cosθ, r·sinθ);\n// primality once, by the Sieve of Eratosthenes\nfor p = 2..√N:  if prime(p):  mark 2p,3p,4p… composite\ncolour = isPrime(n) ? ember→ivory : dim violet;",
    links: [
      { label: 'Fermat / Vogel spiral (phyllotaxis)', url: 'https://en.wikipedia.org/wiki/Fermat%27s_spiral' },
      { label: 'Golden angle', url: 'https://en.wikipedia.org/wiki/Golden_angle' },
      { label: 'Ulam spiral (the square cousin)', url: 'https://en.wikipedia.org/wiki/Ulam_spiral' },
    ],
  },
  communityIslands: {
      "title": "Community Islands",
      "about": "Most real networks — friendships, papers citing papers, proteins that work together, the web — are made of COMMUNITIES: groups whose members link to each other far more often than to anyone outside. Finding those groups is one of network science's central problems (community detection), and the first obstacle is simply seeing them: drawn naively, a few hundred nodes and links are an unreadable hairball. The trick that makes structure visible is to treat the network as a physical object. Make every link a spring and every node an electric charge that pushes all the others away, and let the whole thing relax. Densely-linked groups pull themselves together into tight balls, while the few links between groups — the sociologist Mark Granovetter's 'weak ties', which turn out to carry most of the new information in a social network — get stretched into long bridges. The hairball unmixes into islands. Every so often this network scrambles itself back into a tangle so you can watch it happen again.",
      "howItWorks": "The network is a stochastic block model, the standard benchmark for community-detection algorithms: nodes are split into communities of uneven size; inside a community each pair is linked with a probability that gives about five links per node (plus a random spanning tree so no community falls apart); a small number of 'bridge' links join random nodes in different communities. The layout is a live force simulation in the spirit of Fruchterman and Reingold: every pair of nodes repels with an inverse-square force, every link is a Hooke spring with a fixed rest length, a weak pull toward the centre stops separate islands drifting away, and velocities are damped so the system settles. We step it every frame (it is cheap enough to do exactly, all pairs, for a few hundred nodes). Links are drawn as chains of points in their community's colour; bridges glow white-gold; each node is a small ball sized by how many links it has. The 'link pull' knob strengthens the springs (tighter, more separated islands); 'bridges' adds more weak ties (with enough of them the islands merge back into one blob — communities only exist while ties inside outnumber ties between).",
      "equations": [
          {
              "label": "repulsion between every pair of nodes",
              "latex": "\\mathbf F_{ij} = k_r\\,\\dfrac{\\mathbf x_i - \\mathbf x_j}{\\lVert \\mathbf x_i - \\mathbf x_j \\rVert^{3}}"
          },
          {
              "label": "each link is a spring with rest length L₀",
              "latex": "\\mathbf F_{ij} = -k_s\\,(d_{ij} - L_0)\\,\\hat{\\mathbf d}_{ij}"
          },
          {
              "label": "damped motion",
              "latex": "\\ddot{\\mathbf x}_i = \\textstyle\\sum_j \\mathbf F_{ij} - g\\,\\mathbf x_i - \\gamma\\,\\dot{\\mathbf x}_i"
          },
          {
              "label": "stochastic block model: link probability",
              "latex": "P(i \\sim j) = \\begin{cases} p_{\\text{in}} & c_i = c_j \\\\ p_{\\text{out}} & c_i \\ne c_j \\end{cases}, \\quad p_{\\text{in}} \\gg p_{\\text{out}}"
          }
      ],
      "params": [
          {
              "key": "communities",
              "symbol": "C",
              "meaning": "number of communities"
          },
          {
              "key": "nodes",
              "symbol": "N",
              "meaning": "number of nodes"
          },
          {
              "key": "bridges",
              "symbol": "p_{\\text{out}}",
              "meaning": "how many weak ties join different communities"
          },
          {
              "key": "pull",
              "symbol": "k_s",
              "meaning": "spring strength of the links"
          },
          {
              "key": "reshuffle",
              "symbol": "T",
              "meaning": "seconds between scrambles back into a hairball (0 = never)"
          }
      ],
      "code": "// a stochastic block model, laid out by a spring–charge simulation\nfor each pair in the same community: link with prob p_in\nadd a few bridge links between communities (p_out)\nevery frame:\n  F_i = Σ_j k_r (x_i−x_j)/|x_i−x_j|³          // all pairs repel\n      + Σ_links −k_s (d−L0) d̂                  // links are springs\n      − g x_i                                  // weak pull to the centre\n  v_i = (v_i + F_i dt)·e^(−γ dt);  x_i += v_i dt",
      "links": [
          {
              "label": "Stochastic block model",
              "url": "https://en.wikipedia.org/wiki/Stochastic_block_model"
          },
          {
              "label": "Community structure",
              "url": "https://en.wikipedia.org/wiki/Community_structure"
          },
          {
              "label": "Force-directed graph drawing",
              "url": "https://en.wikipedia.org/wiki/Force-directed_graph_drawing"
          },
          {
              "label": "Granovetter 1973 — The Strength of Weak Ties",
              "url": "https://en.wikipedia.org/wiki/Interpersonal_ties#Weak_ties"
          }
      ]
  },
  thomson: {
      "title": "Thomson Network",
      "about": "In 1904 J. J. Thomson — who had just discovered the electron — asked a question as a model of the atom: if N electrons are stuck on the surface of a sphere and repel each other by Coulomb's law, how do they arrange themselves? A few answers are elegant (4 charges sit at the corners of a tetrahedron, 6 an octahedron, 12 an icosahedron); for large N the charges form an almost-hexagonal net, like a honeycomb. But a sphere can never be tiled by hexagons alone. Euler's formula for any network drawn on a sphere forces a 'topological charge': if each charge has z neighbours, the total of (6 − z) over all charges is exactly 12. So there are always defects — at least twelve 5-fold sites (red here) — and above a few hundred charges the defects grow 7-fold partners (green) and string out into short lines called scars. The same rule shapes virus shells, fullerenes (C₆₀ has exactly twelve pentagons), and particle 'armour' on droplets. The Thomson problem is still unsolved in general: the number of near-optimal arrangements grows exponentially with N.",
      "howItWorks": "We scatter N charges at random on a sphere and relax them by projected gradient descent: compute the total Coulomb force on each charge, remove the part pointing out of the sphere, take a small step, and push every charge back onto the surface — repeated until the arrangement settles into a (local) minimum of the energy. Then we find each charge's neighbours. For points on a sphere the convex hull — the tightest polyhedron around them — is exactly their Delaunay triangulation, so we build the hull (incrementally, adding one point at a time and replacing the faces it can see) and read off which charges share a triangle. Each charge is coloured by its number of neighbours (5 red-orange, 6 blue, 7 green) and each link is drawn as a short great-circle arc, blending the colours of its two ends. The label in the hierarchy panel reports the defect count, and you can check the topological charge is always 12. A small thermal jiggle (each charge wanders around its site) and a slow spin keep it alive; the colours belong to the relaxed ground state.",
      "equations": [
          {
              "label": "Coulomb energy to minimise (unit sphere)",
              "latex": "E = \\sum_{i<j} \\frac{1}{\\lVert \\mathbf x_i - \\mathbf x_j \\rVert}, \\qquad \\lVert \\mathbf x_i \\rVert = 1"
          },
          {
              "label": "Euler's formula for a triangulated sphere",
              "latex": "V - E + F = 2"
          },
          {
              "label": "…forces a total topological charge of 12",
              "latex": "\\sum_i \\,(6 - z_i) = 12"
          }
      ],
      "params": [
          {
              "key": "charges",
              "symbol": "N",
              "meaning": "number of charges on the sphere"
          },
          {
              "key": "jiggle",
              "symbol": "T",
              "meaning": "thermal motion of each charge around its site"
          },
          {
              "key": "spin",
              "symbol": "\\omega",
              "meaning": "how fast the sphere turns"
          }
      ],
      "code": "// relax N charges on a sphere, then triangulate and count neighbours\nscatter N points on the unit sphere\nrepeat:\n  F_i = Σ_j (x_i − x_j)/|x_i − x_j|³\n  F_i −= (F_i·x_i) x_i                 // stay on the sphere\n  x_i = normalise(x_i + step·F_i)\nneighbours = edges of the convex hull     // = spherical Delaunay\ncolour by z_i: 5 red · 6 blue · 7 green   // Σ(6 − z_i) = 12",
      "links": [
          {
              "label": "Thomson problem",
              "url": "https://en.wikipedia.org/wiki/Thomson_problem"
          },
          {
              "label": "Euler characteristic",
              "url": "https://en.wikipedia.org/wiki/Euler_characteristic"
          },
          {
              "label": "Bausch et al. 2003 — grain boundary scars on colloidal crystals",
              "url": "https://www.science.org/doi/10.1126/science.1081160"
          }
      ]
  },
  edgeBundling: {
      "title": "Edge Bundling",
      "about": "How do you see the structure in thousands of connections? Put every node of a network on a ring and draw each link as a straight chord, and you get a grey disc of spaghetti. In 2006 Danny Holten had the idea of letting the network's own HIERARCHY do the routing. Most real networks come with one — software modules inside packages, neurons inside brain regions, people inside teams inside departments. Instead of a straight line, each link travels the path through that tree: from its node up to its group, up to the common ancestor, and back down to the target, drawn as a smooth curve that uses the tree nodes as guide points. Links that run between the same parts of the hierarchy share guide points, so they merge into cables, and the big picture — which parts talk to which — leaps out of the clutter. One knob, the bundling strength β, slides every curve from the straight chord (β = 0) to the full tree route (β = 1). Here it breathes slowly, so you can watch the spaghetti gather into cables and fray apart again.",
      "howItWorks": "The nodes are leaves of a three-level hierarchy — groups split into subgroups split into leaves — laid out radially: leaves evenly on the ring (a small gap between groups), each subgroup and group placed further in at the average angle of its members, the root at the centre. Each group talks mostly to itself and to two partner groups, with a few random links, so there is real structure to find. For a link from leaf a to leaf b we list the tree path a → subgroup → group → root → group → subgroup → b (stopping at the lowest common ancestor when they share one), straighten those control points toward the chord by β, and draw a uniform cubic B-spline through them (the end points repeated so the curve lands exactly on the leaves). Colour runs along each link from its source group's hue to its target's — the ring is a colour wheel — so a bundle's ends tell you who is talking to whom. A gentle dome lifts the bundles off the ring plane, so orbiting shows them as arches.",
      "equations": [
          {
              "label": "straightening each control point toward the chord",
              "latex": "\\mathbf P_i' = \\beta\\,\\mathbf P_i + (1-\\beta)\\Big(\\mathbf P_0 + \\tfrac{i}{n-1}(\\mathbf P_{n-1} - \\mathbf P_0)\\Big)"
          },
          {
              "label": "uniform cubic B-spline segment",
              "latex": "\\mathbf C(s) = \\tfrac16\\big[(1-s)^3\\mathbf Q_0 + (3s^3-6s^2+4)\\mathbf Q_1 + (-3s^3+3s^2+3s+1)\\mathbf Q_2 + s^3\\mathbf Q_3\\big]"
          }
      ],
      "params": [
          {
              "key": "beta",
              "symbol": "\\beta",
              "meaning": "bundling strength: 0 = straight chords, 1 = full route through the hierarchy"
          },
          {
              "key": "breathe",
              "symbol": "a",
              "meaning": "how far β swings down and back (period about 14 s)"
          },
          {
              "key": "groups",
              "symbol": "G",
              "meaning": "number of top-level groups"
          },
          {
              "key": "links",
              "symbol": "k",
              "meaning": "average links per node"
          },
          {
              "key": "dome",
              "symbol": "h",
              "meaning": "how high the bundles arch off the ring"
          }
      ],
      "code": "// hierarchical edge bundling (Holten 2006)\nfor each link (a, b):\n  P = [a, sub(a), group(a), root, group(b), sub(b), b]   // path through the tree via the common ancestor\n  P'_i = β·P_i + (1−β)·lerp(P_0, P_last, i/(n−1))       // straighten toward the chord\n  draw uniform cubic B-spline through P' (ends tripled)\ncolour along the link: hue(group a) → hue(group b)",
      "links": [
          {
              "label": "Holten 2006 — Hierarchical Edge Bundles",
              "url": "https://doi.org/10.1109/TVCG.2006.147"
          },
          {
              "label": "Edge bundling (overview)",
              "url": "https://en.wikipedia.org/wiki/Edge_bundling"
          },
          {
              "label": "B-spline",
              "url": "https://en.wikipedia.org/wiki/B-spline"
          }
      ]
  },
  recaman: {
      "title": "Recamán Arcs",
      "about": "A sequence with a one-line rule that draws a cathedral. Start at 0. On step n, jump BACKWARD by n if that lands on a positive number you have not visited yet; otherwise jump FORWARD by n. That is all. It begins 0, 1, 3, 6, 2, 7, 13, 20, 12, 21, 11, 22, 10, 23, … — and its rhythm is impossible to predict. The Colombian mathematician Bernardo Recamán Santos sent it to Neil Sloane's encyclopedia of integer sequences (entry A005132) in 1991, and Numberphile made it famous with the right way to look at it: an ARC DIAGRAM. Lay the numbers along a line and draw each jump as a half-circle, alternating above and below. Backward jumps nest inside earlier forward ones, and the picture fills with interlocking arches. Nobody knows whether every positive number is eventually visited — it is conjectured, but unproven, and some small numbers take an astronomically long time to appear, if they ever do.",
      "howItWorks": "We generate the sequence exactly by the rule, keeping a set of visited numbers. Each jump from aₙ₋₁ to aₙ becomes a half-circle of radius |aₙ − aₙ₋₁| / 2 centred halfway between them; even-numbered jumps arc above the number line and odd ones below, and the lower arcs are tilted out of the plane (the tilt knob) so the diagram has depth when you orbit it. Colour runs with the step number, blue through magenta to gold, so you can read the order of the jumps in the finished picture, and a slow ripple travels through the arches in the same order — each one swells as the wave passes — like the sequence being played back.",
      "equations": [
          {
              "label": "Recamán's sequence (OEIS A005132)",
              "latex": "a_0 = 0, \\qquad a_n = \\begin{cases} a_{n-1} - n & \\text{if } a_{n-1} - n > 0 \\text{ and not already in the sequence} \\\\ a_{n-1} + n & \\text{otherwise} \\end{cases}"
          },
          {
              "label": "each jump drawn as a half-circle",
              "latex": "\\text{centre } \\tfrac{a_{n-1}+a_n}{2}, \\qquad \\text{radius } \\tfrac{|a_n - a_{n-1}|}{2}"
          }
      ],
      "params": [
          {
              "key": "steps",
              "symbol": "n",
              "meaning": "how many jumps to draw"
          },
          {
              "key": "wave",
              "symbol": "a",
              "meaning": "height of the ripple that runs through the arches in step order"
          },
          {
              "key": "tilt",
              "symbol": "\\phi",
              "meaning": "how far the lower arcs lean out of the plane"
          }
      ],
      "code": "// Recamán: go back if you can, forward if you must\na = [0]; seen = {0}\nfor n = 1..N:\n  b = a[n−1] − n\n  a[n] = (b > 0 and b not in seen) ? b : a[n−1] + n\n  seen.add(a[n])\n// draw jump n as a half-circle from a[n−1] to a[n], alternating above/below",
      "links": [
          {
              "label": "OEIS A005132 — Recamán's sequence",
              "url": "https://oeis.org/A005132"
          },
          {
              "label": "Recamán's sequence (Wikipedia)",
              "url": "https://en.wikipedia.org/wiki/Recam%C3%A1n%27s_sequence"
          },
          {
              "label": "Numberphile — The Slightly Spooky Recamán Sequence",
              "url": "https://www.youtube.com/watch?v=FGC5TdIiT9U"
          }
      ]
  },
  racketFlip: {
      "title": "Why the Racket Flips",
      "about": "Toss a tennis racket, a phone or a book into the air with a spin, and it behaves very differently depending on which way you spin it. Every rigid body has three special 'principal' axes: one it is easiest to spin about (here RED), one hardest (BLUE), and one in between (YELLOW). Spin it about the red or the blue axis and it spins calmly. Spin it about the yellow, in-between axis and every few turns it flips over by half a turn — while flying freely, with nothing touching it. Cosmonaut Vladimir Dzhanibekov noticed a wing nut doing exactly this aboard the Salyut 7 space station in 1985, which is why it is often called the Dzhanibekov effect; mathematicians call it the intermediate-axis or tennis-racket theorem. Three identical plates spin here, one about each axis; only the middle one flips. The sphere underneath explains why.",
      "howItWorks": "Each plate obeys Euler's equations for a body with no torque acting on it, integrated exactly (RK4) together with its orientation (a quaternion). Two things are conserved: the angular momentum L (a vector fixed in space) and the kinetic energy. Seen from inside the body, the direction of L must therefore stay on a sphere (fixed length) and on an ellipsoid (fixed energy) at the same time — so it can only travel along the curves where the two meet, called polhodes. The sphere draws those curves. Around the red and blue axes they are small closed loops: nudge the spin and it just circles nearby — stable. Around the yellow axis the curves cross in an X (the separatrix, in white): a saddle point. Any tiny wobble starts L sliding along that X, all the way round to the opposite side of the sphere, and back — which, seen from outside, is the plate flipping over and over. The coloured comet on the sphere is each plate's own L; the middle plate's comet sweeps through the X each time it flips. Making the plate thicker or wider changes the three moments of inertia, and with them how fast the flips come.",
      "equations": [
          {
              "label": "Euler's equations (torque-free, principal axes)",
              "latex": "I_1\\dot\\omega_1 = (I_2-I_3)\\,\\omega_2\\omega_3,\\quad I_2\\dot\\omega_2 = (I_3-I_1)\\,\\omega_3\\omega_1,\\quad I_3\\dot\\omega_3 = (I_1-I_2)\\,\\omega_1\\omega_2"
          },
          {
              "label": "conserved: momentum (a sphere) and energy (an ellipsoid)",
              "latex": "L_1^2+L_2^2+L_3^2 = |\\mathbf L|^2, \\qquad \\frac{L_1^2}{I_1}+\\frac{L_2^2}{I_2}+\\frac{L_3^2}{I_3} = 2E"
          },
          {
              "label": "near the middle axis small wobbles grow exponentially",
              "latex": "\\lambda = \\omega\\sqrt{\\frac{(I_3-I_2)(I_2-I_1)}{I_1 I_3}} > 0 \\quad (I_1<I_2<I_3)"
          }
      ],
      "params": [
          {
              "key": "spin",
              "symbol": "\\omega",
              "meaning": "how fast the plates spin"
          },
          {
              "key": "wobble",
              "symbol": "\\varepsilon",
              "meaning": "how far each plate starts from a perfect spin about its axis (smaller = longer between flips)"
          },
          {
              "key": "width",
              "symbol": "b",
              "meaning": "plate width — changes the middle moment of inertia"
          },
          {
              "key": "thickness",
              "symbol": "c",
              "meaning": "plate thickness"
          }
      ],
      "code": "// torque-free rigid body: Euler's equations + quaternion attitude\nω̇1 = (I2−I3)/I1·ω2ω3;  ω̇2 = (I3−I1)/I2·ω3ω1;  ω̇3 = (I1−I2)/I3·ω1ω2\nq̇ = ½ q ⊗ (0, ω)                       // orientation\nRK4 step, renormalise q, rescale ω so |Iω| = |L| exactly\n// the sphere: L/|L| in the body frame; polhodes = sphere ∩ energy ellipsoid",
      "links": [
          {
              "label": "Tennis racket theorem",
              "url": "https://en.wikipedia.org/wiki/Tennis_racket_theorem"
          },
          {
              "label": "Euler's equations (rigid body dynamics)",
              "url": "https://en.wikipedia.org/wiki/Euler%27s_equations_(rigid_body_dynamics)"
          },
          {
              "label": "Polhode",
              "url": "https://en.wikipedia.org/wiki/Polhode"
          }
      ]
  },
  heavyTop: {
      "title": "Heavy Top: Precession & Nutation",
      "about": "Why doesn't a spinning top fall over? Gravity pulls its leaning centre down, but on a spinning body that pull doesn't tip it — it twists the spin axis sideways, so the axis sweeps slowly round the vertical instead: PRECESSION. Look closer and the axis also nods up and down as it goes round: NUTATION. How it nods depends only on how the top was let go, and there are exactly three kinds of path its tip can draw. Three identical tops spin here with the same tilt and the same spin; the only difference is a sideways nudge at release. Pushed forward along the precession, the tip draws gentle WAVES. Let go with no nudge, it draws CUSPS — it comes to a dead stop at the top of every nod, like a ball thrown straight up. Pushed backwards, it draws LOOPS — briefly running backwards on every nod.",
      "howItWorks": "This is Lagrange's top: a symmetric top on a fixed point under gravity, one of the few spinning-body problems that can be solved exactly. Two angular momenta are conserved — about the vertical (p_φ) and about the top's own axis (p_ψ) — along with the energy. They let us write the precession rate φ̇ directly in terms of the tilt θ, leaving a single equation for the nodding motion, which we integrate with RK4. Whether the tip draws waves, cusps or loops is decided by whether φ̇ ever reaches zero: never (waves), exactly at the top of each nod (cusps — the case when the top is released without a sideways push), or passing through zero and changing sign (loops). Each top's axis tip leaves a fading trail on the sphere it moves on, and a coloured stripe on each disc shows its spin. Spin faster and the nutation shrinks into a fast shiver and the precession slows — the 'sleepy' top you see on a table.",
      "equations": [
          {
              "label": "precession rate from the conserved momenta (transverse inertia I)",
              "latex": "\\dot\\phi = \\frac{p_\\phi - p_\\psi\\cos\\theta}{I\\sin^2\\theta}"
          },
          {
              "label": "the nodding (nutation) equation",
              "latex": "I\\ddot\\theta = I\\dot\\phi^{2}\\sin\\theta\\cos\\theta - p_\\psi\\,\\dot\\phi\\sin\\theta + mgl\\sin\\theta"
          },
          {
              "label": "slow precession of a fast top",
              "latex": "\\Omega_p \\approx \\frac{mgl}{I_3\\,\\omega_3}"
          }
      ],
      "params": [
          {
              "key": "spin",
              "symbol": "\\omega_3",
              "meaning": "spin about the top's own axis"
          },
          {
              "key": "tilt",
              "symbol": "\\theta_0",
              "meaning": "tilt from the vertical at release"
          },
          {
              "key": "gravity",
              "symbol": "mgl",
              "meaning": "gravity's torque (weight × distance of the centre of mass from the tip)"
          }
      ],
      "code": "// Lagrange top: φ̇ from the conserved momenta, θ integrated (RK4)\nb = φ̇0·sin²θ0 + a·cosθ0                    // a = p_ψ/I, b = p_φ/I\nφ̇ = (b − a cosθ)/sin²θ\nθ̈ = φ̇² sinθ cosθ − a φ̇ sinθ + (mgl/I) sinθ\nψ̇ = ω3 − φ̇ cosθ\ntip = (sinθ cosφ, cosθ, sinθ sinφ)   // trail on the sphere\n// φ̇0 > 0: waves · φ̇0 = 0: cusps · φ̇0 < 0: loops",
      "links": [
          {
              "label": "Lagrange, Euler and Kovalevskaya tops",
              "url": "https://en.wikipedia.org/wiki/Lagrange,_Euler,_and_Kovalevskaya_tops"
          },
          {
              "label": "Precession",
              "url": "https://en.wikipedia.org/wiki/Precession"
          },
          {
              "label": "Nutation",
              "url": "https://en.wikipedia.org/wiki/Nutation"
          }
      ]
  },
  poinsot: {
      "title": "Poinsot's Rolling Ellipsoid",
      "about": "In 1834 Louis Poinsot found a purely geometric way to see how any body spins when nothing pushes on it. Attach to the body an egg-shaped surface built from its moments of inertia (its inertia ellipsoid). Then the whole motion is just this: the ellipsoid rolls, without slipping, on a fixed flat floor — the 'invariable plane', square to the body's angular momentum — with its centre held still. The point where egg touches floor always lies on the body's instantaneous spin axis. Seen from the body, that contact point runs round a closed curve on the egg (the polhode, gold); seen from outside it draws a curve on the floor (the herpolhode, pink) that generally never closes. Make the body nearly symmetric (asymmetry near 0) and the floor curve becomes a circle: the spin axis simply circles the momentum axis. That is exactly what the Earth does — its rotation axis wanders around in a circle a few metres across at the poles, the Chandler wobble, with a period of about 433 days (Euler predicted 305 days for a rigid Earth; the real Earth's oceans and mantle stretch it).",
      "howItWorks": "We integrate the exact torque-free motion (Euler's equations plus the body's orientation, with RK4), with the angular momentum pointing straight down so that the invariable plane is a floor under the ellipsoid. Each step we compute where the spin vector meets the ellipsoid — scaling ω by 1/√(2T) puts it exactly on the surface xᵀIx = 1, and its height is always the same, √(2T)/|L|, which is why the floor is flat — and record the contact point on the floor. The ellipsoid is drawn as a lattice of lines that turns with the body; the gold polhode is the closed curve on its surface where the momentum sphere meets the energy ellipsoid, mapped onto the inertia ellipsoid; the white rod is the instantaneous spin axis from the centre to the contact point; the fading pink trail is the herpolhode. 'Wobble size' picks how far the spin starts from the body's main axis (which polhode it runs on).",
      "equations": [
          {
              "label": "the inertia (Poinsot) ellipsoid, fixed in the body",
              "latex": "\\mathbf x^{\\mathsf T} I\\,\\mathbf x = 1"
          },
          {
              "label": "the contact point is the scaled spin vector",
              "latex": "\\mathbf x_c = \\frac{\\boldsymbol\\omega}{\\sqrt{2T}}, \\qquad \\mathbf x_c\\cdot\\hat{\\mathbf L} = \\frac{\\sqrt{2T}}{|\\mathbf L|} = \\text{const}"
          },
          {
              "label": "Euler's free-wobble period for an oblate rigid body",
              "latex": "T_{\\text{wobble}} = \\frac{2\\pi}{\\Omega}\\,\\frac{I_1}{I_3 - I_1}"
          }
      ],
      "params": [
          {
              "key": "asymmetry",
              "symbol": "I_2",
              "meaning": "how far the middle moment sits from the smallest (0 = symmetric, like the Earth)"
          },
          {
              "key": "start",
              "symbol": "\\theta_0",
              "meaning": "how far the spin starts from the main axis — the size of the wobble"
          },
          {
              "key": "spin",
              "symbol": "\\omega",
              "meaning": "how fast it turns"
          }
      ],
      "code": "// Poinsot: the inertia ellipsoid rolls on the invariable plane\nintegrate Euler's equations + quaternion (RK4)\nx_c(body) = ω / √(2T)                 // on the ellipsoid xᵀIx = 1\nx_c(space) = R·x_c                     // its height along L̂ is constant: a flat floor\nherpolhode += (x_c.x, x_c.z)             // the trace on the floor\npolhode  = sphere ∩ energy-ellipsoid, mapped by x = I⁻¹L/√(2E)",
      "links": [
          {
              "label": "Poinsot's ellipsoid",
              "url": "https://en.wikipedia.org/wiki/Poinsot%27s_ellipsoid"
          },
          {
              "label": "Polhode (and herpolhode)",
              "url": "https://en.wikipedia.org/wiki/Polhode"
          },
          {
              "label": "Chandler wobble",
              "url": "https://en.wikipedia.org/wiki/Chandler_wobble"
          }
      ]
  },
  foucault: {
      "title": "Foucault's Pendulum",
      "about": "In 1851 Léon Foucault hung a 28 kg brass bob on a 67 m wire from the dome of the Panthéon in Paris and set it swinging. Nothing pushes the pendulum sideways — and yet, over the hours, the line it swings along slowly turns, clockwise, knocking over a ring of pegs one by one. The swing isn't really turning: the floor is. The pendulum keeps swinging in the same direction in space while Paris, the building and the spectators turn underneath it with the Earth — the first direct, indoors demonstration that the Earth rotates. How fast it turns depends on where you are: once a day at the North or South Pole, not at all on the equator, and in between at the Earth's rate times the sine of the latitude — once every 31.8 hours in Paris, anticlockwise in the southern hemisphere. Here the Earth's spin is speeded up enormously (the knob) so a turn takes a minute or two; the hierarchy panel shows the real period for the latitude you choose.",
      "howItWorks": "Watched from the rotating floor, the bob feels an extra sideways push — the Coriolis force — that bends each swing a little to the right in the northern hemisphere. Only the vertical part of the Earth's spin matters for a pendulum swinging near the floor, which is where the sin(latitude) comes from. We integrate the standard small-swing pendulum in the rotating frame with RK4: a spring-like pull back to the centre plus the Coriolis term. Released from rest at the edge, as Foucault did by burning the thread that held it back, the bob's path seen from the floor is a star of petals with sharp points at the rim; give it a sideways push at release and the petals open into loops. The fading gold trace on the floor is the bob's path, and a peg falls whenever the bob passes over it; the pegs stand up again after each half turn of the swing plane.",
      "equations": [
          {
              "label": "the pendulum seen from the rotating floor",
              "latex": "\\ddot x = -\\omega_0^2 x - 2\\Omega\\sin\\lambda\\,\\dot z, \\qquad \\ddot z = -\\omega_0^2 z + 2\\Omega\\sin\\lambda\\,\\dot x"
          },
          {
              "label": "rate at which the swing plane turns",
              "latex": "\\Omega_F = \\Omega_\\oplus \\sin\\lambda"
          },
          {
              "label": "time for a full turn",
              "latex": "T_F = \\frac{23.93\\ \\text{h}}{\\sin\\lambda} \\quad (31.8\\ \\text{h in Paris, } \\lambda = 48.85^\\circ)"
          }
      ],
      "params": [
          {
              "key": "latitude",
              "symbol": "\\lambda",
              "meaning": "latitude in degrees (negative = southern hemisphere)"
          },
          {
              "key": "earth",
              "symbol": "\\Omega/\\omega_0",
              "meaning": "the Earth's spin relative to the swing rate — hugely exaggerated so you can watch"
          },
          {
              "key": "push",
              "symbol": "v_0",
              "meaning": "a sideways push at release (0 = released from rest, as Foucault did)"
          }
      ],
      "code": "// small-swing pendulum in the Earth's rotating frame (RK4)\nWv = Ω·sin(latitude)\nẍ = −ω0²·x − 2·Wv·ż\nz̈ = −ω0²·z + 2·Wv·ẋ\n// the swing plane turns at −Wv: clockwise in the north, anticlockwise in the south\ntrace (x, z) on the floor; knock over a peg when the bob passes it",
      "links": [
          {
              "label": "Foucault pendulum",
              "url": "https://en.wikipedia.org/wiki/Foucault_pendulum"
          },
          {
              "label": "Coriolis force",
              "url": "https://en.wikipedia.org/wiki/Coriolis_force"
          }
      ]
  },
  riverSpace: {
      "title": "River of Space",
      "about": "There is a picture of a black hole in which nothing is mysterious about the horizon at all. Write Schwarzschild's solution in Painlevé–Gullstrand coordinates and space itself becomes a river, flowing straight inward through ordinary flat space at exactly the Newtonian escape speed. Light always moves at the speed of light — but relative to the river it is swimming in. Far from the hole the river is slow, and a flash of light spreads out as an almost perfect circle. Closer in, the circle is dragged inward and turns lopsided. At the horizon the river flows at exactly the speed of light, so light aimed straight out stands still, like a swimmer going flat out against a current just as fast. Inside, the river outruns light, and every flash, whichever way it points, is carried to the centre. This flow is what relativists call a shift vector — and it is the same ingredient that drives an Alcubierre warp bubble, here in an exact solution of Einstein's equations made of ordinary, positive mass.",
      "howItWorks": "In Painlevé–Gullstrand coordinates the black hole's metric is ds² = −dt² + (dx − β dt)² with flat space and a radial flow β = −c√(r_s/r): the time slices are flat, clocks tick at the rate of falling observers, and everything that is curved about the spacetime is carried by the flow. Light then obeys a very simple rule: its velocity is c in some direction n̂, plus the velocity of the river at that spot, ẋ = c·n̂ + β r̂. We set off flashes from sources scattered around the hole, send light out in every direction from each, and integrate that rule (with smaller steps close to the centre, where the river is fast). Gold flashes start outside the horizon, red ones inside; faint blue tracers drift with the river itself; the red ring marks the horizon, where |β| = c. Light that reaches the centre has met the singularity; its points are hidden among the surviving part of the same flash.",
      "equations": [
          {
              "label": "Schwarzschild in Painlevé–Gullstrand form",
              "latex": "ds^2 = -c^2dt^2 + \\big(d\\mathbf x - \\boldsymbol\\beta\\,dt\\big)^2, \\quad \\boldsymbol\\beta = -c\\sqrt{r_s/r}\\;\\hat{\\mathbf r}"
          },
          {
              "label": "light moves at c relative to the river",
              "latex": "\\dot{\\mathbf x} = c\\,\\hat{\\mathbf n} + \\boldsymbol\\beta(r)"
          },
          {
              "label": "the horizon: the river reaches c",
              "latex": "|\\boldsymbol\\beta(r_s)| = c, \\qquad r_s = \\frac{2GM}{c^2}"
          }
      ],
      "params": [
          {
              "key": "emitters",
              "symbol": "N",
              "meaning": "how many flash sources are scattered around the hole"
          },
          {
              "key": "period",
              "symbol": "T",
              "meaning": "time between flashes from each source"
          }
      ],
      "code": "// the river model: space flows in at escape speed; light swims at c through it\nbeta(r) = -sqrt(r_s / r)              // inward, units c = 1\nfor each light point (direction n):\n  x += (n + beta(|x|) * x/|x|) * dt   // c relative to the local river\n// horizon: |beta| = 1 at r = r_s; inside, every direction is carried inward",
      "links": [
          {
              "label": "Hamilton & Lisle 2008 — The river model of black holes",
              "url": "https://arxiv.org/abs/gr-qc/0411060"
          },
          {
              "label": "Gullstrand–Painlevé coordinates",
              "url": "https://en.wikipedia.org/wiki/Gullstrand%E2%80%93Painlev%C3%A9_coordinates"
          }
      ]
  },
  alcubierre: {
      "title": "Alcubierre Warp Bubble",
      "about": "In 1994 Miguel Alcubierre wrote down a spacetime in which a ship could reach a distant star arbitrarily fast without ever moving faster than light locally. Space inside a bubble around the ship is flat and still; the trick is that the whole bubble of space is carried along — space contracts ahead of it and expands behind it, the famous picture drawn here as a sheet (squeezed ahead in orange, stretched behind in blue). Seen from the bubble, the rest of the universe streams past. Light always moves at the speed of light relative to its own patch of space, so its path is bent by that stream. Below light speed, flashes from the ship spread out lopsidedly but escape. Above light speed, a horizon forms where the stream reaches c: light sent forward piles up against the front wall (a white-hole horizon, with extreme blueshift), and light sent backward is swept away (a black-hole horizon) — which also means the crew could never signal the front of their own bubble to steer or stop it. The catch is the magenta ring: to bend space this way, the bubble wall needs negative energy density, concentrated in a torus around the line of motion. The hierarchy panel shows the classical estimate of how much. Nothing known can supply it.",
      "howItWorks": "The Alcubierre metric is ds² = −dt² + (dx − v_s f(r_s) dt)² + dy² + dz²: flat space, normal time, and a shift vector — space at the bubble carried along at v_s, with f a smooth top-hat (1 inside, 0 outside, a tanh wall whose sharpness is σ). We work in the bubble's frame, where space outside streams past at −v_s and light obeys ẋ = c·n̂ − v_s(1 − f) x̂. Flashes from the ship (gold) and from sources outside the bubble (cyan) are integrated with that rule; the red ring is the horizon, the radius where v_s(1 − f) = c (it appears only when v_s > c). The sheet's height is York time θ = v_s (x/r) f′(r), the rate at which volumes expand (normalised for display). The magenta cloud samples the energy density seen by observers at rest, T⁰⁰ = −(v_s²/32π)(ρ²/r²)(f′)², which is negative wherever it isn't zero. The energy readout is Pfenning & Ford's classical estimate E ≈ −(1/12) v_s² (c⁴/G) R² σ for a bubble of radius R (the knob, in metres): it grows with the square of the speed and the radius. With R = 6 m, σ = 1.2 per metre and v_s = 10 c it gives about 255 Jupiter masses — negative ones.",
      "equations": [
          {
              "label": "the Alcubierre metric",
              "latex": "ds^2 = -dt^2 + \\big(dx - v_s f(r_s)\\,dt\\big)^2 + dy^2 + dz^2"
          },
          {
              "label": "the top-hat shape of the bubble",
              "latex": "f(r_s) = \\frac{\\tanh\\sigma(r_s+R) - \\tanh\\sigma(r_s-R)}{2\\tanh\\sigma R}"
          },
          {
              "label": "light, in the bubble's frame",
              "latex": "\\dot{\\mathbf x} = c\\,\\hat{\\mathbf n} - v_s\\,\\big(1 - f(r)\\big)\\,\\hat{\\mathbf x}"
          },
          {
              "label": "York time (expansion of space)",
              "latex": "\\theta = v_s\\,\\frac{x - x_s}{r_s}\\,\\frac{df}{dr_s}"
          },
          {
              "label": "energy density (negative)",
              "latex": "T^{00} = -\\frac{1}{8\\pi}\\,\\frac{v_s^2}{4}\\,\\frac{\\rho^2}{r_s^2}\\Big(\\frac{df}{dr_s}\\Big)^2"
          },
          {
              "label": "Pfenning–Ford classical estimate of the total",
              "latex": "E \\approx -\\frac{1}{12}\\,v_s^2\\,\\frac{c^4}{G}\\,R^2\\,\\sigma"
          }
      ],
      "params": [
          {
              "key": "vs",
              "symbol": "v_s",
              "meaning": "bubble speed in units of c — above 1 the horizons appear"
          },
          {
              "key": "sigmaR",
              "symbol": "\\sigma R",
              "meaning": "how sharp the bubble wall is compared with the bubble's size"
          },
          {
              "key": "radius",
              "symbol": "R",
              "meaning": "bubble radius in metres, used for the energy estimate"
          },
          {
              "key": "period",
              "symbol": "T",
              "meaning": "time between light flashes"
          }
      ],
      "code": "// Alcubierre bubble, in its own frame: space outside streams past at -v_s\nf(r) = (tanh(s(r+R)) - tanh(s(r-R))) / (2 tanh(sR))\nflow(x) = -v_s * (1 - f(|x|))\nfor each light point (direction n):  x += (n + flow(x) x̂) * dt\nhorizon: v_s * (1 - f(r_h)) = 1           // only when v_s > 1\nsheet height = York time  θ = v_s (x/r) f'(r)\nE ≈ -(1/12) v_s² (c⁴/G) R² σ              // Pfenning & Ford",
      "links": [
          {
              "label": "Alcubierre 1994 — The warp drive",
              "url": "https://arxiv.org/abs/gr-qc/0009013"
          },
          {
              "label": "Hiscock 1997 — horizons of a superluminal bubble",
              "url": "https://arxiv.org/abs/gr-qc/9707024"
          },
          {
              "label": "Pfenning & Ford 1997 — The unphysical nature of “Warp Drive”",
              "url": "https://arxiv.org/abs/gr-qc/9702026"
          },
          {
              "label": "Alcubierre drive",
              "url": "https://en.wikipedia.org/wiki/Alcubierre_drive"
          }
      ]
  },
  warpFlume: {
      "title": "Analog Warp Bubble (Flume)",
      "about": "You can't build a warp bubble, but you can build one for water waves. Bill Unruh showed in 1981 that waves on a moving fluid obey the same equation as light in a curved spacetime — the flow plays the part of the shift vector. Shape the flow like Alcubierre's: water streams past a sheltered pocket in which it is still, with the pocket's edge having the same top-hat profile as a warp bubble's wall. A plunger at the centre (the ship) makes waves. When the stream outside runs faster than the waves can travel (Froude number above 1 — the analog of a bubble going faster than light), a horizon forms where the flow reaches the wave speed: crests sent forward stall and bunch up at the front wall, crests sent backward are carried away. Turn the stream down below the wave speed and the horizon disappears. Experiments of exactly this kind have been done: wave-blocking at a white-hole horizon in a water channel (Rousseaux et al. 2008) and stimulated Hawking emission from one (Weinfurtner et al. 2011). This system was first written with the Gravity MCP server as part of the AWB-1 analog-warp-flume design: a 1.5 m acrylic channel, 20 mm deep, comparing Fr = 0.6 with Fr = 1.6.",
      "howItWorks": "Shallow-water waves of small height η and velocity potential φ on a background flow V obey (∂t + V·∇)φ = −gη and (∂t + V·∇)η = −h∇²φ, which combine into the convected wave equation (∂t + V·∇)²φ = c²∇²φ with c² = gh — the acoustic metric. The flow in the ship's frame is V = −U(1 − f(r)) x̂, with Alcubierre's top-hat f. We step it on a grid: semi-Lagrangian advection along the stream (a cubic back-trace), then a symplectic update of the wave terms, with a sponge layer at the edges to absorb outgoing waves. The red ring is the horizon radius, where 1 − f(r) = 1/Fr (at Fr = 1.6 with the default pocket, r ≈ 1.03 R). Colour shows the water itself: blue where the flow is slower than the waves (so they can travel upstream), orange where the stream outruns them.",
      "equations": [
          {
              "label": "acoustic metric (Unruh 1981)",
              "latex": "ds^2 \\propto -(c^2 - V^2)\\,dt^2 - 2\\,\\mathbf V\\cdot d\\mathbf x\\,dt + d\\mathbf x^2"
          },
          {
              "label": "convected wave equation",
              "latex": "(\\partial_t + \\mathbf V\\cdot\\nabla)^2\\phi = c^2\\,\\nabla^2\\phi, \\qquad c^2 = g h"
          },
          {
              "label": "the flow: a warp-bubble-shaped pocket",
              "latex": "\\mathbf V(\\mathbf x) = -U\\,\\big(1 - f(r)\\big)\\,\\hat x"
          },
          {
              "label": "horizon",
              "latex": "|\\mathbf V(r_h)| = c \\iff 1 - f(r_h) = 1/\\mathrm{Fr}, \\quad \\mathrm{Fr} = U/c"
          }
      ],
      "params": [
          {
              "key": "Fr",
              "symbol": "\\mathrm{Fr}",
              "meaning": "Froude number: stream speed over wave speed — the analog of v_s/c; above 1 there are horizons"
          },
          {
              "key": "R",
              "symbol": "R",
              "meaning": "radius of the sheltered pocket (the bubble)"
          },
          {
              "key": "sigma",
              "symbol": "\\sigma",
              "meaning": "sharpness of the pocket's wall"
          },
          {
              "key": "omega",
              "symbol": "\\omega",
              "meaning": "plunger frequency"
          },
          {
              "key": "amp",
              "symbol": "A",
              "meaning": "plunger amplitude"
          }
      ],
      "code": "// waves on a moving medium shaped like a warp bubble (semi-Lagrangian + symplectic)\nV(x) = -Fr * (1 - f(r)) along x        // c = 1\nadvect eta, phi along the stream (cubic back-trace)\nphi -= dt * eta;   eta -= dt * laplacian(phi)\nplunger at the centre; sponge at the edges\nhorizon: 1 - f(r_h) = 1/Fr",
      "links": [
          {
              "label": "Unruh 1981 — Experimental black-hole evaporation?",
              "url": "https://doi.org/10.1103/PhysRevLett.46.1351"
          },
          {
              "label": "Weinfurtner et al. 2011 — stimulated Hawking emission in a water flume",
              "url": "https://arxiv.org/abs/1008.1911"
          },
          {
              "label": "Analogue gravity",
              "url": "https://en.wikipedia.org/wiki/Analogue_gravity"
          }
      ]
  },
  thirringShell: {
      "title": "Rotating Shell (Frame Dragging)",
      "about": "Does spinning matter drag space around with it? General relativity says yes. In 1918 Hans Thirring worked out what happens inside a massive spherical shell that is slowly spinning: the local sense of 'not rotating' — the frame in which a gyroscope or a pendulum keeps its direction — itself rotates, in the same sense as the shell. So a pendulum hung at the centre does not swing in a plane fixed to the distant stars. Its swing plane slowly turns with the shell, drawing a rosette, though nothing touches it: a Foucault pendulum whose 'Earth' is a shell of matter around it. Set the compactness to zero (Newton's gravity) and the plane stays put. A massive shell carrying its interior along is exactly the shape of the 'physical' warp drives proposed recently (Bobrick and Martire 2021; Fell and Heisenberg 2024): ordinary positive-energy matter, but enormously massive, and only ever slower than light. The real effect is tiny for ordinary objects: a shell with the Earth's mass and size would turn its interior about a billionth as fast as itself. Gravity Probe B measured the Earth's own frame dragging, outside it, in 2011.",
      "howItWorks": "To first order in the shell's compactness GM/(Rc²), the space inside a shell of mass M and radius R spinning at Ω is flat but rotating: inertial frames there turn at ω = (4/3)(GM/Rc²)·Ω, the same everywhere inside (Thirring 1918). A pendulum at the centre swings in a fixed plane of that rotating inertial frame, so seen from the distant stars its plane turns at ω. We draw it exactly: the bob is at A cos(ω₀t) along a direction that has turned through ∫ω dt, and its recent history is drawn as a fading trail, which is why the swing traces a rosette. The amber shell turns at Ω (its stripes show the spin); the faint ring with ticks far outside stands for the distant stars. The hierarchy panel compares the dragging rate with the shell's spin, and with what a shell of the Earth's mass and size would do. The formula is the weak-field result; for very compact shells (approaching a black hole) the full answer differs.",
      "equations": [
          {
              "label": "Thirring's interior frame dragging (weak field)",
              "latex": "\\omega = \\frac{4}{3}\\,\\frac{GM}{Rc^2}\\,\\Omega"
          },
          {
              "label": "the pendulum, seen from the distant stars",
              "latex": "\\mathbf x(t) = A\\cos(\\omega_0 t)\\,\\big(\\cos\\omega t,\\ 0,\\ -\\sin\\omega t\\big)"
          },
          {
              "label": "for an Earth-sized shell of the Earth's mass",
              "latex": "\\frac{\\omega}{\\Omega} = \\frac{4}{3}\\frac{GM_\\oplus}{R_\\oplus c^2} \\approx 9\\times10^{-10}"
          }
      ],
      "params": [
          {
              "key": "kappa",
              "symbol": "GM/Rc^2",
              "meaning": "the shell's compactness — 0 is Newtonian gravity (no dragging)"
          },
          {
              "key": "spin",
              "symbol": "\\Omega",
              "meaning": "how fast the shell spins"
          }
      ],
      "code": "// Thirring 1918: inside a spinning massive shell, inertial frames rotate\nomega = (4/3) * kappa * Omega        // kappa = GM/(R c²), weak field\ndrag += omega * dt                    // the inertial frame's turn so far\nbob(t) = A cos(w0 t) * (cos drag, 0, -sin drag)\ndraw the bob's last few seconds as a trail → a rosette",
      "links": [
          {
              "label": "Frame-dragging",
              "url": "https://en.wikipedia.org/wiki/Frame-dragging"
          },
          {
              "label": "Lense–Thirring precession",
              "url": "https://en.wikipedia.org/wiki/Lense%E2%80%93Thirring_precession"
          },
          {
              "label": "Bobrick & Martire 2021 — Introducing physical warp drives",
              "url": "https://arxiv.org/abs/2102.06824"
          },
          {
              "label": "Fell & Heisenberg 2024 — Constant velocity physical warp drive solution",
              "url": "https://arxiv.org/abs/2405.02709"
          },
          {
              "label": "Gravity Probe B",
              "url": "https://en.wikipedia.org/wiki/Gravity_Probe_B"
          }
      ]
  },
  specialRelativity: {
      "title": "Train and Platform (Special Relativity)",
      "about": "Einstein's train, built out of clocks. A platform and a train with the same rest length each carry a row of light clocks — a flash of light bouncing between two mirrors, one tick for each round trip, with a dial counting the ticks. The train runs past at speed v, and everything is drawn exactly as it is in the frame you choose. In the platform's frame the train is shorter than the platform (length contraction), its photons run a longer zigzag so its clocks tick slower (time dilation), and — the part people forget — its clocks, which agree with each other aboard the train, disagree along its length: the front clock reads earlier than the rear one (the relativity of simultaneity). Switch to the train's frame and everything turns around: now the platform is the short one with the slow clocks. Two lightning bolts strike the ends of the train at the same platform time. Their light (violet from the rear, rose from the front) reaches the observer standing mid-platform together, but the observer mid-train is heading into the front flash and sees it first — so for the people on the train, the two strikes did not happen at the same time. Each observer raises a lamp on the side a flash has reached them from.",
      "howItWorks": "Take c = 1. Every object is at rest in one frame — the platform's or the train's — at a rest-frame position ξ, and its clock shows proper time τ. If that frame moves at velocity w relative to you, a Lorentz transformation puts the object, at your time t, at x = ξ/γ + w t, and its clock then reads τ = t/γ − w ξ, where γ = 1/√(1 − w²). The 1/γ in the first formula is length contraction; the 1/γ in the second is time dilation; the −w ξ is the relativity of simultaneity. Velocities seen from the 'train' or 'midway' frame come from relativistic velocity addition, w = (v − u)/(1 − v u). A light clock's photon is at height H·tri(τ/2H) above its lower mirror, so drawing it at its own τ makes moving clocks slow and staggered automatically, and its trail is its real path in your frame — straight up and down for a clock at rest, a zigzag for a moving one. The lightning strikes happen at the train's ends at platform time 0, and their light spreads as a sphere at speed 1 from each strike event, transformed into your frame. A lamp rises when the sphere has reached an observer. The order and the observers' own clock readings at each arrival come out the same in every frame — the hierarchy panel gives the train observer's gap between the two flashes.",
      "equations": [
          {
              "label": "Lorentz factor",
              "latex": "\\gamma = \\frac{1}{\\sqrt{1 - v^2/c^2}}"
          },
          {
              "label": "a point at rest at ξ in a frame moving at w",
              "latex": "x(t) = \\frac{\\xi}{\\gamma} + w\\,t"
          },
          {
              "label": "what its clock reads",
              "latex": "\\tau(t) = \\frac{t}{\\gamma} - \\frac{w\\,\\xi}{c^2}"
          },
          {
              "label": "Lorentz transformation",
              "latex": "t' = \\gamma\\left(t - \\frac{v x}{c^2}\\right),\\quad x' = \\gamma\\,(x - v t)"
          },
          {
              "label": "velocity addition",
              "latex": "w = \\frac{v - u}{1 - v u / c^2}"
          },
          {
              "label": "the train observer's gap between the flashes",
              "latex": "\\Delta\\tau \\approx \\frac{v L}{c^2}"
          }
      ],
      "params": [
          {
              "key": "v",
              "symbol": "v/c",
              "meaning": "the train's speed relative to the platform, as a fraction of light speed"
          },
          {
              "key": "frame",
              "symbol": "u",
              "meaning": "whose frame the scene is drawn in: the platform's (u = 0), the train's (u = v), or the midway frame where both move at equal and opposite speeds"
          }
      ],
      "code": "// every object: rest-frame position xi, in a frame moving at w relative to the viewer (c = 1)\ngamma = 1 / sqrt(1 - w*w)\nx   = xi / gamma + w * t        // length contraction\ntau = t / gamma - w * xi        // time dilation + relativity of simultaneity\nphoton height = H * triangle(tau / (2H))\n// lightning at the train's ends at platform time 0 → Lorentz-transform the events,\n// draw spheres of radius (t - t_strike) around them",
      "links": [
          {
              "label": "Einstein 1905 — Zur Elektrodynamik bewegter Körper (Annalen der Physik 322, 891)",
              "url": "https://doi.org/10.1002/andp.19053221004"
          },
          {
              "label": "Einstein — Relativity: The Special and General Theory (the train and embankment, ch. 9)",
              "url": "https://www.gutenberg.org/ebooks/5001"
          },
          {
              "label": "Relativity of simultaneity",
              "url": "https://en.wikipedia.org/wiki/Relativity_of_simultaneity"
          },
          {
              "label": "Time dilation",
              "url": "https://en.wikipedia.org/wiki/Time_dilation"
          },
          {
              "label": "Length contraction",
              "url": "https://en.wikipedia.org/wiki/Length_contraction"
          },
          {
              "label": "Lorentz transformation",
              "url": "https://en.wikipedia.org/wiki/Lorentz_transformation"
          }
      ]
  },
  lightCones: {
      "title": "Light Cones (Causal Structure)",
      "about": "A spacetime diagram you can walk around: two directions of space laid flat, time pointing up, and light travelling on 45° cones. Pick one event E — the bright point at the centre. Every other event is in one of three places. Inside the upper cone (gold) is E's future: anything E does can reach those events. Inside the lower cone (blue) is E's past: those events could have affected E. Everything outside both cones (violet) is 'elsewhere': no signal, even light, can link it to E either way. The diagram is redrawn from the point of view of an observer whose velocity sweeps back and forth along x. Watch what changes: events slide along hyperbolae, the lab's time axis and its 'now' line scissor towards the light cone, and the ticks of a moving clock spread apart (time dilation). And watch what doesn't: the cones stay put and no event ever changes colour. Different observers disagree about when and where, but never about what could cause what. The one thing that does flip is the order of 'elsewhere' events: the rose marker B, outside E's cones, happens after E for some observers and before it for others — which is harmless, because nothing can travel between them. The gold marker C, inside the future cone, is after E for everyone.",
      "howItWorks": "Units with c = 1. A change of observer moving along x is a Lorentz boost, which in terms of the rapidity φ (v = tanh φ) is a hyperbolic rotation of the (t, x) plane: t′ = t cosh φ − x sinh φ, x′ = x cosh φ − t sinh φ, and y is untouched. It keeps the interval s² = t² − x² − y² fixed, so every event moves along its own hyperbola and keeps its causal class. The event dust is sampled in invariant coordinates — in each wedge of the (t, x) plane an event is ρ(cosh η, sinh η) — so a boost simply shifts every rapidity η by −φ; the sample is uniform in η, which is the boost-invariant way to spread points, and it is wrapped at the window's edges so the cloud looks the same in every frame. Each event's colour is set once from its interval to E and never needs to change. The light cone, the hyperboloids where a clock that left E reads ±1 (gold and blue bowls) and the one-sheet hyperboloid s² = −1 (violet) are all invariant, so they are drawn fixed. Worldlines through E — an observer at rest in the lab (cyan), one moving at 0.5c (green) and the lab's own x axis (its 'now') — are drawn for ±1.4 units of their own proper time, with a tick every 0.2; a boost stretches them. The pink curve is an observer with constant proper acceleration, x² − t² = 1: a boost just slides its ticks along it. Rings of light run out along the future cone and in along the past cone at speed 1.",
      "equations": [
          {
              "label": "the interval (the same for every observer)",
              "latex": "s^2 = c^2t^2 - x^2 - y^2"
          },
          {
              "label": "a boost along x, with rapidity φ",
              "latex": "t' = t\\cosh\\varphi - x\\sinh\\varphi,\\quad x' = x\\cosh\\varphi - t\\sinh\\varphi,\\quad v = c\\tanh\\varphi"
          },
          {
              "label": "causal classes",
              "latex": "s^2>0:\\ \\text{timelike (future or past)},\\quad s^2=0:\\ \\text{on the cone},\\quad s^2<0:\\ \\text{elsewhere}"
          },
          {
              "label": "when a spacelike event B happens in the new frame",
              "latex": "t'_B = \\gamma\\,(t_B - v\\,x_B/c^2)\\ \\text{changes sign at}\\ v = c^2 t_B / x_B"
          },
          {
              "label": "constant proper acceleration a",
              "latex": "t = \\tfrac{c}{a}\\sinh\\tfrac{a\\tau}{c},\\quad x = \\tfrac{c^2}{a}\\cosh\\tfrac{a\\tau}{c}"
          }
      ],
      "params": [
          {
              "key": "sweep",
              "symbol": "\\varphi(t)",
              "meaning": "sweep the observer's velocity back and forth automatically"
          },
          {
              "key": "vmax",
              "symbol": "v_{max}",
              "meaning": "how fast the sweep goes, at most, as a fraction of light speed"
          },
          {
              "key": "v",
              "symbol": "v",
              "meaning": "the observer's velocity when the sweep is off"
          }
      ],
      "code": "// every event in invariant coordinates: wedge q, |s| = rho, rapidity eta\n// a boost by rapidity phi shifts eta → eta − phi; colour = sign of s² (never changes)\n(t, x) = rho * (cosh(eta - phi), sinh(eta - phi))   // future wedge; others by symmetry\n// worldlines: lab events boosted\nt' = t*cosh(phi) - x*sinh(phi);  x' = x*cosh(phi) - t*sinh(phi)\n// accelerating observer: (sinh(tau - phi), cosh(tau - phi))",
      "links": [
          {
              "label": "Minkowski 1908 — Space and Time (translation)",
              "url": "https://en.wikisource.org/wiki/Translation:Space_and_Time"
          },
          {
              "label": "Light cone",
              "url": "https://en.wikipedia.org/wiki/Light_cone"
          },
          {
              "label": "Minkowski diagram",
              "url": "https://en.wikipedia.org/wiki/Minkowski_diagram"
          },
          {
              "label": "Causal structure",
              "url": "https://en.wikipedia.org/wiki/Causal_structure"
          },
          {
              "label": "Rapidity",
              "url": "https://en.wikipedia.org/wiki/Rapidity"
          },
          {
              "label": "Hyperbolic motion (relativity)",
              "url": "https://en.wikipedia.org/wiki/Hyperbolic_motion_(relativity)"
          }
      ]
  },
  kerrDragging: {
      "title": "Kerr Black Hole (Frame Dragging)",
      "about": "Real black holes spin, and a spinning black hole drags space around with it. Here matter is let go from rest far away with no angular momentum at all — nothing pushes it sideways — in eight narrow streams around the equator. With no spin (set a = 0) each stream falls straight in. With spin, the streams hook round in the hole's sense of rotation as they get close, and cross the horizon going round with it. The orange shell is the ergosphere, the region where the dragging is so strong that nothing can stay still. On the equator, light is sent both ways round circular mirror tracks (think of a ring of optical fibre). Far out, the backward beam (pink) goes backwards and the forward beam (cyan) forwards, a little faster. At the edge of the ergosphere — 2M on the equator — the backward beam stands still. Inside, it is carried forwards too: even light cannot go against the spin there. The faint rings mark the innermost stable circular orbits for matter going with the spin and against it (solid), and the circular photon orbits (dotted). As the spin grows the prograde ones shrink towards the horizon and the retrograde ones move out, which is why a spinning hole's accretion disc can reach so much deeper.",
      "howItWorks": "Units with G = c = M = 1, spin a. The falling matter follows exact geodesics of the Kerr metric: the 'rain' with energy E = 1 (from rest at infinity), angular momentum L = 0 and Carter constant Q = 0. These keep a fixed latitude θ, and in Boyer–Lindquist coordinates go round at exactly the frame-dragging rate ω = −g_tφ/g_φφ. Boyer–Lindquist coordinates break down at the horizon (a falling body there would wind round infinitely often and never cross), so we draw everything in ingoing Kerr coordinates (T, r, θ, φ̃), in which the rain's path is finite everywhere: dφ̃/dr = a/[(r²+a²)(1+β)] and dT/dr = [a² sin²θ − (r²+a²)(1+β+β²)/(1+β)]/√(2r(r²+a²)), with β = √(2r/(r²+a²)). Both are integrated once into tables; each tracer's radius at time T comes from a table lookup, and the point is placed at the Kerr–Schild position x + iy = (r + ia)e^{iφ̃} sin θ, z = r cos θ. The streams are drawn as a steady flow from r = 6M; tracers are thinned with depth (each stops at its own radius, with the share that gets deeper than r falling like r²) so the inflow doesn't pile up into a glare at the centre — that thinning is a drawing choice, not physics. The light tracks use the equatorial metric: light confined to a circle of radius r goes round at Ω± = [−g_tφ ± √(g_tφ² − g_tt g_φφ)]/g_φφ, and Ω₋ = 0 exactly where g_tt = 0, the static limit r = 2M. The ISCOs and photon orbits are Bardeen, Press and Teukolsky's 1972 formulas. The hierarchy panel gives the horizon radius, its rotation rate Ω_H = a/(2Mr₊), the ISCOs, and which way the backward beam goes on each track.",
      "equations": [
          {
              "label": "horizon and ergosphere",
              "latex": "r_+ = M + \\sqrt{M^2 - a^2},\\qquad r_E(\\theta) = M + \\sqrt{M^2 - a^2\\cos^2\\theta}"
          },
          {
              "label": "frame-dragging rate (zero angular momentum)",
              "latex": "\\omega = -\\frac{g_{t\\phi}}{g_{\\phi\\phi}} = \\frac{2Mar}{(r^2+a^2)^2 - a^2\\Delta\\sin^2\\theta},\\quad \\Delta = r^2 - 2Mr + a^2"
          },
          {
              "label": "the rain, in ingoing coordinates",
              "latex": "\\frac{d\\tilde\\phi}{dr} = \\frac{a}{(r^2+a^2)(1+\\beta)},\\quad \\beta = \\sqrt{\\frac{2Mr}{r^2+a^2}}"
          },
          {
              "label": "light going round a circle of radius r",
              "latex": "\\Omega_\\pm = \\frac{-g_{t\\phi} \\pm \\sqrt{g_{t\\phi}^2 - g_{tt}\\,g_{\\phi\\phi}}}{g_{\\phi\\phi}}"
          },
          {
              "label": "photon orbits (prograde −, retrograde +)",
              "latex": "r_{ph} = 2M\\left[1 + \\cos\\left(\\tfrac{2}{3}\\arccos(\\mp a/M)\\right)\\right]"
          },
          {
              "label": "horizon angular velocity",
              "latex": "\\Omega_H = \\frac{a}{2Mr_+}"
          }
      ],
      "params": [
          {
              "key": "a",
              "symbol": "a/M",
              "meaning": "the black hole's spin (angular momentum per unit mass); 0 is a non-spinning Schwarzschild hole, 1 is the maximum"
          }
      ],
      "code": "// rain (E = 1, L = 0, Q = 0): fixed latitude, tabulated once per spin\nX = r*r + a*a;  beta = sqrt(2r / X)\ndphi/dr = a / (X (1 + beta))\ndT/dr   = (a*a*sin²θ - X (1+beta+beta²)/(1+beta)) / sqrt(2 r X)\n// each tracer: r(T) by table lookup → Kerr–Schild position\nx + i y = (r + i a) e^{i phi} sin θ;  z = r cos θ\n// light on a circular track: Ω± = (−g_tφ ± sqrt(g_tφ² − g_tt g_φφ)) / g_φφ",
      "links": [
          {
              "label": "Kerr 1963 — Gravitational field of a spinning mass… (Phys. Rev. Lett. 11, 237)",
              "url": "https://doi.org/10.1103/PhysRevLett.11.237"
          },
          {
              "label": "Bardeen, Press & Teukolsky 1972 — Rotating black holes (ApJ 178, 347)",
              "url": "https://doi.org/10.1086/151796"
          },
          {
              "label": "Doran 2000 — A new form of the Kerr solution (the rain frames)",
              "url": "https://arxiv.org/abs/gr-qc/9910099"
          },
          {
              "label": "Visser — The Kerr spacetime: a brief introduction",
              "url": "https://arxiv.org/abs/0706.0622"
          },
          {
              "label": "Kerr metric",
              "url": "https://en.wikipedia.org/wiki/Kerr_metric"
          },
          {
              "label": "Ergosphere",
              "url": "https://en.wikipedia.org/wiki/Ergosphere"
          }
      ]
  },
  maxwellFdtd: {
      "title": "Maxwell's Equations (FDTD)",
      "about": "Light, radio and every other electromagnetic wave is an electric field and a magnetic field that keep regenerating each other: a changing magnetic field makes a curling electric field, and a changing electric field makes a curling magnetic one. This system solves Maxwell's equations directly on a grid, with nothing about waves put in by hand, and lets you watch what comes out. Choose a set-up. 'Antenna': a single wire carrying an oscillating current radiates circular waves. 'Phased array': two antennas half a wavelength apart; change the phase difference between them and the beam swings round, with no moving parts — this is how modern radars and 5G base stations steer. 'Double slit': a plane wave hits a metal wall with two openings, and the waves from the two openings interfere. Switch the view to time-averaged intensity and the bright and dark fringes stand still as a fan of rays — Young's experiment. 'Glass block': a plane wave arrives at an angle on glass and bends towards the normal (refraction), part of it bouncing back. Inside the glass the waves are shorter, because light is slower there. Orange is the electric field pointing out of the screen, blue into it. Walls and glass are drawn faintly underneath.",
      "howItWorks": "This is the finite-difference time-domain (FDTD) method of Kane Yee (1966), in two dimensions with the electric field Eᶻ out of the plane and the magnetic field (Hˣ, Hʸ) in it (the 'TM' polarisation). The components live on a staggered grid, half a cell apart in space and half a step apart in time, so each update is a centred difference: first H is advanced from the curl of E (Faraday's law), then E from the curl of H (the Ampère–Maxwell law). Units: c = 1, cell size 1, time step 0.5 cells (the Courant number S = 0.5, inside the 2-D stability limit 1/√2). Glass has permittivity ε = n², which slows the E update; metal is a perfect conductor where Eᶻ is held at 0. The sources are 'soft' — they add current to the field rather than forcing it — so waves coming back pass through them. The border is a graded absorbing layer with matched electric and magnetic loss (σ* = σ in these units), which lets waves leave with little reflection. The intensity view is a running average of Eᶻ² over about two periods. Checked against theory: the double-slit maxima come out at 23° and 48° for slit spacing 2.6λ (sin θ = mλ/d gives 22.6° and 50.3°; the measuring arc is not fully in the far field); a beam measured at 31.2° incidence refracts to 20.6° in n = 1.5 glass (Snell's law gives 20.3°); and two sources λ/2 apart at 90° phase difference beam about 35° off broadside (30° in the far field). The grid has a little numerical dispersion: short waves travel slightly slower than c, more so along the grid axes than diagonally.",
      "equations": [
          {
              "label": "Faraday's law",
              "latex": "\\frac{\\partial \\mathbf H}{\\partial t} = -\\frac{1}{\\mu_0}\\nabla\\times\\mathbf E"
          },
          {
              "label": "Ampère–Maxwell law",
              "latex": "\\frac{\\partial \\mathbf E}{\\partial t} = \\frac{1}{\\varepsilon}\\left(\\nabla\\times\\mathbf H - \\mathbf J\\right)"
          },
          {
              "label": "in 2-D (TM): the three equations solved",
              "latex": "\\partial_t H_x = -\\partial_y E_z,\\quad \\partial_t H_y = \\partial_x E_z,\\quad \\varepsilon\\,\\partial_t E_z = \\partial_x H_y - \\partial_y H_x - J_z"
          },
          {
              "label": "Yee's leapfrog update (c = 1, Δx = 1)",
              "latex": "E_z^{n+1} = E_z^{n} + \\frac{S}{\\varepsilon}\\left(H_y^{n+\\frac12}\\big|_{i} - H_y^{n+\\frac12}\\big|_{i-1} - H_x^{n+\\frac12}\\big|_{j} + H_x^{n+\\frac12}\\big|_{j-1}\\right)"
          },
          {
              "label": "double slit and phased array",
              "latex": "d\\sin\\theta_m = m\\lambda,\\qquad \\sin\\theta_{beam} = \\frac{\\Delta\\varphi\\,\\lambda}{2\\pi d}"
          },
          {
              "label": "Snell's law",
              "latex": "\\sin\\theta_1 = n\\sin\\theta_2"
          }
      ],
      "params": [
          {
              "key": "scene",
              "symbol": "",
              "meaning": "the set-up: one antenna, a phased pair, a double slit, or a glass block"
          },
          {
              "key": "wavelength",
              "symbol": "\\lambda",
              "meaning": "the wavelength, in grid cells (scaled with the grid size)"
          },
          {
              "key": "phase",
              "symbol": "\\Delta\\varphi",
              "meaning": "phased array: the phase difference between the two antennas, which steers the beam"
          },
          {
              "key": "n",
              "symbol": "n",
              "meaning": "glass block: the refractive index (permittivity ε = n²)"
          },
          {
              "key": "angle",
              "symbol": "\\theta_1",
              "meaning": "glass block: the angle at which the plane wave arrives"
          },
          {
              "key": "view",
              "symbol": "",
              "meaning": "draw the electric field, the energy density, or the time-averaged intensity"
          }
      ],
      "code": "// Yee FDTD, TM polarisation, S = c·dt/dx = 0.5\nfor each cell: Hx -= S * (Ez[j+1] - Ez[j]);  Hy += S * (Ez[i+1] - Ez[i])\nfor each cell: Ez  = ca * Ez + (S/eps) * ((Hy[i] - Hy[i-1]) - (Hx[j] - Hx[j-1]))\n// metal: Ez = 0;  glass: eps = n²;  border: graded matched loss\n// soft source: Ez[src] += sin(omega * t + phase)",
      "links": [
          {
              "label": "Yee 1966 — Numerical solution of initial boundary value problems involving Maxwell's equations (IEEE Trans. Antennas Propag. 14, 302)",
              "url": "https://doi.org/10.1109/TAP.1966.1138693"
          },
          {
              "label": "Maxwell 1865 — A dynamical theory of the electromagnetic field (Phil. Trans. R. Soc. 155, 459)",
              "url": "https://doi.org/10.1098/rstl.1865.0008"
          },
          {
              "label": "Finite-difference time-domain method",
              "url": "https://en.wikipedia.org/wiki/Finite-difference_time-domain_method"
          },
          {
              "label": "Maxwell's equations",
              "url": "https://en.wikipedia.org/wiki/Maxwell%27s_equations"
          },
          {
              "label": "Double-slit experiment",
              "url": "https://en.wikipedia.org/wiki/Double-slit_experiment"
          },
          {
              "label": "Phased array",
              "url": "https://en.wikipedia.org/wiki/Phased_array"
          },
          {
              "label": "Snell's law",
              "url": "https://en.wikipedia.org/wiki/Snell%27s_law"
          }
      ]
  },
  chargedParticles: {
      "title": "Charged Particles in Fields",
      "about": "One force runs every motor, every particle accelerator and the northern lights: the Lorentz force on a charge, F = q(E + v × B). An electric field pushes along itself; a magnetic field pushes sideways to the motion, so it bends a path without speeding it up. Four set-ups show what that does. Cyclotron: in a uniform magnetic field (the faint vertical lines) every charge goes round in a circle, and the time for one turn depends only on its charge and mass, not its speed — the fast ones simply make bigger circles. So all the particles of a kind arrive back at the start together, which is how a cyclotron keeps its kick in step and how a mass spectrometer sorts atoms. Positive (orange) and negative (cyan) charges circle opposite ways; ions four times heavier (magenta) take four times as long. E × B drift: add an electric field across the magnetic one and everything drifts the same way at the same speed E/B — positive or negative, heavy or light — along looping cycloids. Magnetic mirror: between two coils the field is weak in the middle and strong at the ends. A particle spiralling towards a coil is slowed along the field and turned back, unless it is moving too nearly along the field — inside the 'loss cone' — in which case it escapes. Radiation belt: in the Earth's dipole field particles spiral, bounce from one hemisphere to the other, and slowly drift round the planet, positive ions westward and negative charges eastward, which is the ring current around the Earth and the shape of the Van Allen belts.",
      "howItWorks": "Each particle obeys m dv/dt = q(E + v × B), advanced with the Boris scheme (1970): half an electric kick, a pure rotation of the velocity about B, then the other half kick. The rotation is exact in angle form, so in a pure magnetic field the speed never drifts (it stays constant to rounding error), and the scheme is volume-preserving, which keeps long orbits honest. Steps adapt so that each gyration takes at least about 30 steps. The cyclotron and E × B fields are uniform. The mirror field is the exact field of two circular current loops, computed with complete elliptic integrals; its mirror ratio B_max/B_min gives a loss-cone angle sin²α = B_min/B_max. Starting pitch angles are spread evenly from 10° to 80°, so about (26.1 − 10)/70 ≈ 23% start inside the 26° loss cone; tracking 1,008 particles, 25% escaped (and with isotropic starts 12%, against the formula's 10.1%). The small excess is real physics the formula leaves out: these orbits are not tiny compared with the bottle, and the loss-cone rule assumes they are. The Earth's field is a dipole pointing north at the equator; particles that reach the atmosphere are replaced with fresh ones. The units are scaled so that gyration, bouncing and drifting all fit on screen: real belt particles gyrate millions of times per drift orbit, here only hundreds. The numbers were checked: cyclotron return times equal 2πm/(qB) for every speed, and the E × B drift is exactly E/B for both charges.",
      "equations": [
          {
              "label": "the Lorentz force",
              "latex": "m\\frac{d\\mathbf v}{dt} = q\\left(\\mathbf E + \\mathbf v\\times\\mathbf B\\right)"
          },
          {
              "label": "cyclotron frequency and radius",
              "latex": "\\omega_c = \\frac{|q|B}{m},\\qquad r_L = \\frac{m v_\\perp}{|q|B}"
          },
          {
              "label": "E × B drift (the same for every charge and mass)",
              "latex": "\\mathbf v_E = \\frac{\\mathbf E\\times\\mathbf B}{B^2}"
          },
          {
              "label": "magnetic mirror: the loss cone",
              "latex": "\\sin^2\\alpha_{loss} = \\frac{B_{min}}{B_{max}}"
          },
          {
              "label": "Boris rotation",
              "latex": "\\mathbf t = \\frac{q\\mathbf B}{m}\\frac{\\Delta t}{2},\\ \\ \\mathbf v' = \\mathbf v^- + \\mathbf v^-\\times\\mathbf t,\\ \\ \\mathbf v^+ = \\mathbf v^- + \\frac{2\\,\\mathbf v'\\times\\mathbf t}{1+t^2}"
          }
      ],
      "params": [
          {
              "key": "scene",
              "symbol": "",
              "meaning": "the set-up: cyclotron, E × B drift, magnetic mirror, or the Earth's radiation belt"
          },
          {
              "key": "B",
              "symbol": "B",
              "meaning": "the magnetic field strength (scales the whole field)"
          },
          {
              "key": "E",
              "symbol": "E",
              "meaning": "the electric field across B, in the E × B set-up"
          }
      ],
      "code": "// Boris push (non-relativistic)\nv  += (q/m) * E * dt/2\nt   = (q/m) * B * dt/2;  s = 2 t / (1 + |t|²)\nv' = v + v × t\nv  += v' × s\nv  += (q/m) * E * dt/2\nx  += v * dt\n// mirror: B from two current loops (elliptic integrals K, E)\n// belt: dipole B = B0 R³ (3 (m·r̂) r̂ − m) / r³",
      "links": [
          {
              "label": "Qin et al. 2013 — Why is Boris algorithm so good? (Phys. Plasmas 20, 084503)",
              "url": "https://doi.org/10.1063/1.4818428"
          },
          {
              "label": "Lorentz force",
              "url": "https://en.wikipedia.org/wiki/Lorentz_force"
          },
          {
              "label": "Guiding center (drifts)",
              "url": "https://en.wikipedia.org/wiki/Guiding_center"
          },
          {
              "label": "Cyclotron",
              "url": "https://en.wikipedia.org/wiki/Cyclotron"
          },
          {
              "label": "Magnetic mirror",
              "url": "https://en.wikipedia.org/wiki/Magnetic_mirror"
          },
          {
              "label": "Van Allen radiation belt",
              "url": "https://en.wikipedia.org/wiki/Van_Allen_radiation_belt"
          },
          {
              "label": "Ring current",
              "url": "https://en.wikipedia.org/wiki/Ring_current"
          }
      ]
  },
  threeBody: {
      "title": "Three-Body Problem",
      "about": "Two bodies orbiting each other follow ellipses forever, and there is a formula for them. Add a third and in general there is none: the motion can be orderly, or it can be chaos. Three set-ups. Lagrange points: a star and a planet circling each other, seen from a frame that turns with them. In that frame gravity and the centrifugal effect make a landscape — two wells (the star in the middle, the planet on the right), a ridge round the orbit, and five balance points marked in white: L1, L2 and L3 on the line through the two bodies, L4 and L5 at the tips of equilateral triangles, 60° ahead of and behind the planet. L4 and L5 sit on hilltops, yet small bodies stay near them, steered round by the Coriolis effect. That is where Jupiter's Trojan asteroids live, and it is why spacecraft such as JWST are parked near the Sun–Earth L2. The gold trails are small bodies: near L4 and L5 they loop in 'tadpoles', and along the ridge they creep round in 'horseshoes' and turn back before reaching the planet. Raise the mass ratio past 0.0385 (Routh's limit) and the Trojans can no longer stay. Figure-eight: three equal masses chasing each other round a single figure-eight, found by Cris Moore in 1993 and proved to exist by Chenciner and Montgomery in 2000. Pythagorean: masses 3, 4 and 5 let go from rest at the corners of a 3-4-5 right triangle (Burrau, 1913). They swing through a long chaotic dance, and at about t = 60 the lightest body is thrown out for good while 4 and 5 leave as a bound pair — the outcome Szebehely and Peters found in 1967. Then it starts again.",
      "howItWorks": "Lagrange points use the circular restricted three-body problem: the two big bodies (total mass 1, separation 1) move in a circle at angular velocity 1, and test particles feel both but pull on neither. In the rotating frame, with the star at (−μ, 0) and the planet at (1 − μ, 0), the motion is ẍ − 2ẏ = ∂Ω/∂x, ÿ + 2ẋ = ∂Ω/∂y, with Ω = (x² + y²)/2 + (1 − μ)/r₁ + μ/r₂; the 2ẏ and 2ẋ are the Coriolis terms. The landscape is drawn at height −Ω (squashed so the wells stay in view), and the zero-velocity curves through L1, L2 and L3 are picked out. L1–L3 come from solving ∂Ω/∂x = 0 on the axis; L4 and L5 are exact. Particles are integrated with classical RK4 (on ordinary orbits Jacobi's constant 2Ω − v² holds to about 1e-15; close passes by the planet are less accurate, and those particles are soon replaced). Particles that pass too close to the planet or are flung away are replaced. The figure-eight and Pythagorean problems are full three-body problems (G = 1), integrated with an adaptive Dormand–Prince 5(4) method at a tolerance of 1e-11 per step. The figure-eight returns to its starting state after one period (6.326) to within 4e-8. For the Pythagorean problem the energy stays at −769/60 to about 1e-7, and the escape (mass 3 at t ≈ 60, leaving 4 + 5 bound) is the same at a tolerance of 1e-13. At a looser 1e-10 a different body escapes, at a different time: this is chaos, where tiny errors grow until they decide the outcome. A body counts as gone for good when the other two are bound to each other and its energy relative to them is positive.",
      "equations": [
          {
              "label": "rotating frame (restricted problem)",
              "latex": "\\ddot x - 2\\dot y = \\frac{\\partial\\Omega}{\\partial x},\\qquad \\ddot y + 2\\dot x = \\frac{\\partial\\Omega}{\\partial y}"
          },
          {
              "label": "effective potential",
              "latex": "\\Omega = \\frac{x^2+y^2}{2} + \\frac{1-\\mu}{r_1} + \\frac{\\mu}{r_2}"
          },
          {
              "label": "Jacobi constant (conserved)",
              "latex": "C_J = 2\\Omega - \\dot x^2 - \\dot y^2"
          },
          {
              "label": "L4 and L5 are stable when (Routh 1875)",
              "latex": "\\mu < \\tfrac12\\left(1 - \\sqrt{23/27}\\right) \\approx 0.0385"
          },
          {
              "label": "the full problem",
              "latex": "\\ddot{\\mathbf r}_i = \\sum_{j\\ne i} G m_j \\frac{\\mathbf r_j - \\mathbf r_i}{|\\mathbf r_j - \\mathbf r_i|^3}"
          },
          {
              "label": "Pythagorean energy (at rest, sides 3, 4, 5)",
              "latex": "E = -\\left(\\tfrac{3\\cdot4}{5} + \\tfrac{3\\cdot5}{4} + \\tfrac{4\\cdot5}{3}\\right) = -\\tfrac{769}{60}"
          }
      ],
      "params": [
          {
              "key": "scene",
              "symbol": "",
              "meaning": "the set-up: Lagrange points, the figure-eight, or the Pythagorean problem"
          },
          {
              "key": "mu",
              "symbol": "\\mu",
              "meaning": "Lagrange points: the planet's share of the total mass (Jupiter/Sun ≈ 0.00095; Earth–Moon ≈ 0.012)"
          }
      ],
      "code": "// restricted problem, rotating frame (RK4)\nax =  2*vy + x - (1-mu)*(x+mu)/r1³ - mu*(x-1+mu)/r2³\nay = -2*vx + y - (1-mu)*y/r1³ - mu*y/r2³\n// full problem: a_i = Σ m_j (r_j − r_i)/|r_j − r_i|³, adaptive Dormand–Prince, tol 1e-11\n// figure-eight start: x1 = −x2 = (−0.97000436, 0.24308753), x3 = 0,\n//   v3 = (−0.93240737, −0.86473146), v1 = v2 = −v3/2",
      "links": [
          {
              "label": "Burrau 1913 — Numerische Berechnung eines Spezialfalles des Dreikörperproblems (Astron. Nachr. 195, 113)",
              "url": "https://doi.org/10.1002/asna.19131950602"
          },
          {
              "label": "Szebehely & Peters 1967 — Complete solution of a general problem of three bodies (AJ 72, 876)",
              "url": "https://doi.org/10.1086/110355"
          },
          {
              "label": "Moore 1993 — Braids in classical dynamics (Phys. Rev. Lett. 70, 3675)",
              "url": "https://doi.org/10.1103/PhysRevLett.70.3675"
          },
          {
              "label": "Chenciner & Montgomery 2000 — A remarkable periodic solution of the three-body problem…",
              "url": "https://arxiv.org/abs/math/0011268"
          },
          {
              "label": "Lagrange point",
              "url": "https://en.wikipedia.org/wiki/Lagrange_point"
          },
          {
              "label": "Jupiter trojan",
              "url": "https://en.wikipedia.org/wiki/Jupiter_trojan"
          },
          {
              "label": "Three-body problem",
              "url": "https://en.wikipedia.org/wiki/Three-body_problem"
          }
      ]
  },
  idealGas: {
      "title": "Ideal Gas (Maxwell–Boltzmann)",
      "about": "What is temperature? Molecules moving. This is a box of gas molecules modelled as hard discs that bounce off each other and the walls without losing any energy. The cyan ones are light; the orange ones are four times heavier. They all start at exactly the same speed, in random directions. Within a few collisions that single speed spreads out into the Maxwell–Boltzmann distribution: watch the histograms on the wall behind fill in under the white theory curves. Most molecules are near a typical speed, a few are nearly still, and a long tail is much faster. At the same time energy flows from the heavy molecules (which started with four times the kinetic energy) to the light ones, until both kinds have the same average energy. That is equipartition, and it is what 'the same temperature' means. In equilibrium the light molecules move twice as fast on average. The walls feel the molecules' impacts as pressure. The panel compares it with the ideal-gas law, PA = NkT, which ignores the size of the molecules, and with the hard-disc equation of state, which allows for the space the discs take up — the measured value tracks the second. Switch the walls to 'hot' and they give every molecule that touches them a fresh random velocity at the wall's temperature: the gas heats (or cools) until it matches.",
      "howItWorks": "Discs move in straight lines between collisions. Each small time step, overlapping pairs that are moving towards each other (found with a grid of cells) bounce elastically: an impulse along the line of centres that conserves momentum and kinetic energy exactly, for any pair of masses. Steps are short enough that no disc travels more than a fifth of its radius per step. Reflecting walls simply reverse the normal velocity. Thermal walls replace the outgoing velocity with one drawn from the wall's temperature (a Rayleigh-distributed normal part, as for molecules leaving a warm surface, and a Gaussian tangential part). Pressure is the momentum delivered to the walls per unit length per unit time. The histograms are speed densities for each kind, averaged over the last second or so. The curves are the two-dimensional Maxwell–Boltzmann distribution f(v) = (mv/kT) exp(−mv²/2kT), using each kind's measured kT, where kT is its mean kinetic energy in two dimensions. Checked: from the start energy is conserved to rounding error. By t ≈ 2 the light discs' speeds pass a Kolmogorov–Smirnov test against Maxwell–Boltzmann and the two kinds share the same kT, within the fluctuations of 1,800 molecules. PA/NkT comes out between 1.24 and 1.33 against Henderson's 1.295 for 12% packing. With hot walls at kT = 1.5 the gas settles at about 1.5.",
      "equations": [
          {
              "label": "Maxwell–Boltzmann speed distribution (2-D)",
              "latex": "f(v) = \\frac{mv}{kT}\\,e^{-mv^2/2kT}"
          },
          {
              "label": "temperature from motion (2-D, per molecule)",
              "latex": "\\left\\langle \\tfrac12 m v^2 \\right\\rangle = kT"
          },
          {
              "label": "ideal-gas law (2-D)",
              "latex": "PA = NkT"
          },
          {
              "label": "hard discs at packing fraction φ (Henderson 1975)",
              "latex": "\\frac{PA}{NkT} \\approx \\frac{1 + \\varphi^2/8}{(1-\\varphi)^2}"
          },
          {
              "label": "an elastic collision (impulse along the line of centres)",
              "latex": "\\mathbf v_1' = \\mathbf v_1 + \\frac{2m_2}{m_1+m_2}\\,\\frac{(\\mathbf v_2-\\mathbf v_1)\\cdot\\mathbf d}{|\\mathbf d|^2}\\,\\mathbf d"
          }
      ],
      "params": [
          {
              "key": "n",
              "symbol": "N",
              "meaning": "the number of molecules (60% light, 40% heavy)"
          },
          {
              "key": "size",
              "symbol": "a",
              "meaning": "the molecules' size — bigger discs fill more of the box and push the pressure further above the ideal-gas value"
          },
          {
              "key": "walls",
              "symbol": "",
              "meaning": "perfectly reflecting walls (energy conserved) or hot walls at a set temperature"
          },
          {
              "key": "tWall",
              "symbol": "kT_{wall}",
              "meaning": "the hot walls' temperature"
          }
      ],
      "code": "// each step: move, bounce off walls, then for each nearby overlapping, approaching pair\nd = x_j - x_i; dv = v_j - v_i; vn = dv·d\nk = 2 vn / ((m_i + m_j) |d|²)\nv_i += k m_j d;   v_j -= k m_i d        // momentum and energy exactly conserved\n// pressure = Σ m |Δv_wall| / (perimeter × time)",
      "links": [
          {
              "label": "Maxwell 1860 — Illustrations of the dynamical theory of gases (Phil. Mag. 19, 19)",
              "url": "https://doi.org/10.1080/14786446008642818"
          },
          {
              "label": "Alder & Wainwright 1959 — Studies in molecular dynamics I (J. Chem. Phys. 31, 459)",
              "url": "https://doi.org/10.1063/1.1730376"
          },
          {
              "label": "Henderson 1975 — A simple equation of state for hard discs (Mol. Phys. 30, 971)",
              "url": "https://doi.org/10.1080/00268977500102511"
          },
          {
              "label": "Maxwell–Boltzmann distribution",
              "url": "https://en.wikipedia.org/wiki/Maxwell%E2%80%93Boltzmann_distribution"
          },
          {
              "label": "Equipartition theorem",
              "url": "https://en.wikipedia.org/wiki/Equipartition_theorem"
          },
          {
              "label": "Kinetic theory of gases",
              "url": "https://en.wikipedia.org/wiki/Kinetic_theory_of_gases"
          }
      ]
  },
  heatEquation: {
      "title": "Heat Equation",
      "about": "Heat flows from hot to cold, and the steeper the temperature difference the faster it flows (Fourier's law). Put that together with the fact that heat is conserved and you get the heat equation, one of the most important equations in physics: the same mathematics describes diffusing dye, spreading pollutants, and the price models of finance. Three set-ups on a square plate; orange is warmer, blue colder, and the thin dark lines are isotherms, one every tenth of the temperature range. Hot and cold drops: spots of heat and cold land on a plate whose edges let no heat out. Each spreads as a widening, fading bell curve whose width grows like the square root of time, so it spreads quickly at first and then ever more slowly. The total amount of heat never changes. Two metals: the left half is copper, the right half steel (tinted), with the left edge held hot and the right edge cold. Heat races through the copper and creeps into the steel. In the end the temperature settles into two straight ramps meeting at the join, steep in the steel and gentle in the copper, because the same heat flow has to pass through both and steel conducts it about ten times less well. Steady state: one edge is held hot and the other three cold. The plate relaxes to the solution of Laplace's equation, where every point is the average of its surroundings and the isotherms fan out from the hot edge. By symmetry the centre ends up exactly a quarter of the way from cold to hot.",
      "howItWorks": "The plate is a grid of cells and each step moves heat across every face between neighbouring cells: flow = D_face × (T_neighbour − T_cell), added to one cell and taken from the other, so heat is conserved exactly. This is the standard explicit finite-volume scheme for ∂T/∂t = ∇·(D∇T); with time step 1 and grid spacing 1 it is stable for D ≤ 1/4, and D is 0.24 here. At the copper–steel join the face uses the harmonic mean of the two diffusivities, which makes the heat flow continuous across it. Outer edges are insulated (no flow) unless a column or row is held at a fixed temperature. The steel's diffusivity is set to 0.11 of the copper's, close to real copper (111 mm²/s) and 1%-carbon steel (11.7 mm²/s); their heat capacities per volume are similar, so their conductivities are in about the same ratio. Checked: a drop's variance grows by exactly 2D per step along each axis, and the total heat is unchanged to every printed digit. In the two-metal plate the slopes end up in the ratio 9.09 = 1/0.11 (it takes about 300,000 steps — steel is slow). The steady-state centre settles at 0.252 on this 200-cell grid, against exactly 0.25 in the continuum.",
      "equations": [
          {
              "label": "the heat equation",
              "latex": "\\frac{\\partial T}{\\partial t} = \\nabla\\cdot\\left(D\\,\\nabla T\\right)"
          },
          {
              "label": "Fourier's law (heat flux)",
              "latex": "\\mathbf q = -k\\,\\nabla T,\\qquad D = \\frac{k}{\\rho c}"
          },
          {
              "label": "a spreading spot (uniform plate)",
              "latex": "T \\propto \\frac{1}{\\sigma^2(t)}\\,e^{-r^2/2\\sigma^2(t)},\\quad \\sigma^2(t) = \\sigma_0^2 + 2Dt"
          },
          {
              "label": "two metals in steady state: the same heat flow through both",
              "latex": "D_{Cu}\\,\\frac{dT}{dx}\\Big|_{Cu} = D_{steel}\\,\\frac{dT}{dx}\\Big|_{steel}"
          },
          {
              "label": "steady state: Laplace's equation",
              "latex": "\\nabla^2 T = 0"
          },
          {
              "label": "the update on the grid (conservative, explicit)",
              "latex": "T_i^{n+1} = T_i^n + \\sum_{\\text{faces}} D_f\\,(T_j^n - T_i^n)"
          }
      ],
      "params": [
          {
              "key": "scene",
              "symbol": "",
              "meaning": "the set-up: drops on an insulated plate, two metals between a hot and a cold edge, or a plate with fixed edge temperatures"
          },
          {
              "key": "ratio",
              "symbol": "D_{steel}/D_{Cu}",
              "meaning": "how well the right half conducts heat compared with the copper (two metals)"
          }
      ],
      "code": "// one step: move heat across every face (conserves the total exactly)\nfor each face (i, j): f = Dface * (T[j] - T[i]);  T[i] += f;  T[j] -= f\nDface = 2 Di Dj / (Di + Dj)          // continuous heat flow across a join\n// fixed-temperature edges are reset after each step; other edges let no heat through",
      "links": [
          {
              "label": "Fourier 1822 — Théorie analytique de la chaleur",
              "url": "https://archive.org/details/thorieanalytiq00four"
          },
          {
              "label": "Heat equation",
              "url": "https://en.wikipedia.org/wiki/Heat_equation"
          },
          {
              "label": "Thermal conduction (Fourier's law)",
              "url": "https://en.wikipedia.org/wiki/Thermal_conduction"
          },
          {
              "label": "Thermal diffusivity (table of materials)",
              "url": "https://en.wikipedia.org/wiki/Thermal_diffusivity"
          },
          {
              "label": "Laplace's equation",
              "url": "https://en.wikipedia.org/wiki/Laplace%27s_equation"
          }
      ]
  },
  percolation: {
      "title": "Percolation",
      "about": "When does a random network connect? Fill each square of a grid at random, each with probability p, and call touching filled squares a cluster (each cluster has its own colour here). For small p the clusters are small islands. For large p almost everything joins one giant cluster that stretches from edge to edge (drawn in gold). The change between the two is not gradual. On a big grid it happens almost exactly at one value, the percolation threshold p_c ≈ 0.5927 for squares that connect through their edges. Right at the threshold the spanning cluster is a fractal, full of holes and dead ends on every scale. Every so often a fire is lit along the left edge and spreads one square per step through filled squares; its front is drawn raised. Below the threshold it dies out; above it, it crosses, taking a winding path much longer than the straight line. The same mathematics describes forest fires, water seeping through rock or coffee grounds, current through a composite material, and an epidemic spreading through a population when each contact passes it on with probability p. Change p and watch how sudden the transition is.",
      "howItWorks": "Each of the L × L squares is filled independently with probability p. Clusters are found with union–find over edge-neighbours, and a cluster 'spans' if it reaches both the left and the right columns. The fire is a breadth-first search from every filled square in the left column; a square's arrival time is the length of the shortest path to it through filled squares (the chemical distance). The animation replays those arrival times. Each square is drawn as four points scattered inside it, because a perfectly regular grid of single points shimmers with moiré. Checked: on 360 × 360 grids no sample of 40 spanned at p = 0.58, 18 of 40 did at p = 0.5927 (the spanning probability at the threshold on a square with these boundaries is one half), and all 40 did at p = 0.63. At p_c on a 600 × 600 grid, the largest cluster's mass grows with box size with exponent 1.874, against the exact 2-D value 91/48 ≈ 1.896 (finite grids fall a little short). The best estimate of the threshold, p_c = 0.59274621, is from Newman and Ziff (2000).",
      "equations": [
          {
              "label": "the threshold (square lattice, site percolation)",
              "latex": "p_c \\approx 0.592746"
          },
          {
              "label": "the spanning cluster at p_c is a fractal",
              "latex": "M(r) \\sim r^{d_f},\\qquad d_f = \\tfrac{91}{48} \\approx 1.896"
          },
          {
              "label": "above threshold, the share of squares in the giant cluster",
              "latex": "P_\\infty \\sim (p - p_c)^{\\beta},\\qquad \\beta = \\tfrac{5}{36}"
          },
          {
              "label": "the typical cluster size diverges at the threshold",
              "latex": "\\xi \\sim |p - p_c|^{-\\nu},\\qquad \\nu = \\tfrac{4}{3}"
          }
      ],
      "params": [
          {
              "key": "p",
              "symbol": "p",
              "meaning": "the chance that each square is filled (a new random grid on each change)"
          },
          {
              "key": "speed",
              "symbol": "",
              "meaning": "how fast the fire spreads"
          }
      ],
      "code": "for each square: filled = random() < p\nunion–find over touching filled squares → clusters\nspans = some cluster touches both the left and right columns\nfire: breadth-first search from the left column through filled squares\n      → each square's arrival time = shortest path length",
      "links": [
          {
              "label": "Broadbent & Hammersley 1957 — Percolation processes (Math. Proc. Camb. Phil. Soc. 53, 629)",
              "url": "https://doi.org/10.1017/S0305004100032680"
          },
          {
              "label": "Newman & Ziff 2000 — Efficient Monte Carlo algorithm and high-precision results for percolation (PRL 85, 4104)",
              "url": "https://doi.org/10.1103/PhysRevLett.85.4104"
          },
          {
              "label": "Percolation theory",
              "url": "https://en.wikipedia.org/wiki/Percolation_theory"
          },
          {
              "label": "Percolation threshold",
              "url": "https://en.wikipedia.org/wiki/Percolation_threshold"
          },
          {
              "label": "Percolation critical exponents",
              "url": "https://en.wikipedia.org/wiki/Percolation_critical_exponents"
          }
      ]
  },
  shallowWater: {
      "title": "Shallow Water (Dam Break)",
      "about": "When water is shallow compared with the length of its waves — a flood, a tide, a tsunami crossing the ocean, the water in a bath — its motion follows the shallow-water equations (de Saint-Venant, 1871). They say the water is pushed downhill by gravity: where the surface is higher, it flows away. Waves travel at √(gh), so they move faster where the water is deeper. That is why tsunamis slow and pile up near shore and why the back of a flood wave catches up with its front. Then the wave steepens into a sharp step called a bore: the front of a dam-break flood, or a tidal bore running up a river. Three set-ups in a tank with walls. Dam break: a dam holding deep water fails. A smooth dip (a rarefaction) runs back into the reservoir while a bore races downstream; then both bounce off the walls and slosh. Past pillars: the same flood hits two square pillars and wraps round them, throwing off bow waves that cross and interfere. Drop in a pond: a column of water collapses into an expanding ring wave that reflects off the tank walls. The surface is drawn as relief with a faint grid on it, so its shape reads from any angle; every few seconds the scene starts again.",
      "howItWorks": "The tank is divided into cells, each holding the water depth h and the momentum (hu, hv). Every step the cells exchange water and momentum across their faces using the HLL approximate Riemann solver (Harten, Lax and van Leer, 1983), the standard tool for equations that make shocks and bores. Values are reconstructed to each face with minmod-limited slopes, which is second-order accurate in smooth water and sharp without wiggles at bores, and time is advanced with a two-stage Runge–Kutta step at a CFL number of 0.4. The tank walls reflect: only pressure crosses them. Faces against a pillar pair the water cell with its own mirror image, so no water leaks through. Units: g = 1 and reservoir depth 1. Checked: for the straight dam break with downstream depth 0.2, before the waves reach the walls, the computed depth along the tank differs from Stoker's exact solution by 0.002 on average, and the bore is within one cell of where the exact solution puts it. The total volume of water is conserved to about 1e-13 in every set-up.",
      "equations": [
          {
              "label": "mass",
              "latex": "\\frac{\\partial h}{\\partial t} + \\frac{\\partial (hu)}{\\partial x} + \\frac{\\partial (hv)}{\\partial y} = 0"
          },
          {
              "label": "momentum (x; y is the same with u and v swapped)",
              "latex": "\\frac{\\partial (hu)}{\\partial t} + \\frac{\\partial}{\\partial x}\\left(hu^2 + \\tfrac12 g h^2\\right) + \\frac{\\partial (huv)}{\\partial y} = 0"
          },
          {
              "label": "wave speed",
              "latex": "c = \\sqrt{g h}"
          },
          {
              "label": "dam break: the rarefaction fan (Ritter, Stoker)",
              "latex": "h(x,t) = \\frac{\\left(2\\sqrt{g h_L} - x/t\\right)^2}{9g}"
          },
          {
              "label": "the bore: mass and momentum balance across the jump",
              "latex": "u_m = (h_m - h_R)\\sqrt{\\frac{g(h_m + h_R)}{2 h_m h_R}},\\qquad s = \\frac{h_m u_m}{h_m - h_R}"
          }
      ],
      "params": [
          {
              "key": "scene",
              "symbol": "",
              "meaning": "the set-up: a straight dam break, the flood past two pillars, or a collapsing column"
          },
          {
              "key": "ratio",
              "symbol": "h_R/h_L",
              "meaning": "the water depth below the dam, as a fraction of the reservoir's"
          }
      ],
      "code": "// finite volumes: each cell holds (h, hu, hv)\nfor each face: reconstruct h, u, v on both sides (minmod slopes)\n               flux = HLL(left, right)      // handles bores\n               cell_left -= flux; cell_right += flux\n// walls: only pressure ½ g h² crosses; pillar faces: cell vs its mirror image\n// two-stage Runge–Kutta, dt = 0.4 dx / max(|u| + √(gh))",
      "links": [
          {
              "label": "Harten, Lax & van Leer 1983 — Upstream differencing and Godunov-type schemes (SIAM Review 25, 35)",
              "url": "https://doi.org/10.1137/1025002"
          },
          {
              "label": "Stoker 1957 — Water Waves: the mathematical theory with applications",
              "url": "https://archive.org/details/waterwavesmathem0000stok"
          },
          {
              "label": "Shallow water equations",
              "url": "https://en.wikipedia.org/wiki/Shallow_water_equations"
          },
          {
              "label": "Tidal bore",
              "url": "https://en.wikipedia.org/wiki/Tidal_bore"
          }
      ]
  },
  rayleighBenard: {
      "title": "Rayleigh–Bénard Convection",
      "about": "Heat a pan of liquid from below. The warm liquid at the bottom is lighter than the cool liquid above it and wants to rise, but its viscosity and the diffusion of heat resist. The contest is measured by one number, the Rayleigh number Ra. Below a critical value nothing moves and heat simply conducts upward. Above it the layer organises itself into rolls: warm plumes rising (orange) and cold ones sinking (blue), side by side. The rolls carry heat far faster than conduction alone, which is what the Nusselt number Nu in the panel measures. Raise Ra and the plumes sharpen into mushroom shapes, the thin boundary layers at the floor and ceiling shed them more violently, and the flow begins to wobble on its way to turbulence. Convection like this stirs the Earth's mantle (moving the continents), boils the Sun's surface into granules, builds thunderclouds, and makes the hexagonal cells in a heated pan of oil (Bénard, 1900). This is a vertical slice through the layer with the hot floor at the bottom. Try Ra just below and just above the threshold to see the onset.",
      "howItWorks": "The fluid obeys the Navier–Stokes equations in the Boussinesq approximation: density changes only matter where they make fluid buoyant. In two dimensions these reduce to an equation for the vorticity ω, driven by sideways temperature differences, and one for the temperature, carried by the flow and diffusing. Units are diffusive (layer depth 1, temperature difference 1, time in d²/κ). The solver is pseudo-spectral: derivatives are taken exactly in Fourier space and products on the grid with 2/3-rule dealiasing. Diffusion is integrated exactly and the rest with second-order Adams–Bashforth steps limited by the flow speed. The top and bottom are free-slip, fixed-temperature walls, made by solving on the layer plus its mirror image with every field odd about the walls. With such walls the critical Rayleigh number of an endless layer is 27π⁴/4 ≈ 657.5 (Rayleigh, 1916). In this box, four layer-depths wide, the first roll that fits needs Ra ≈ 761. Checked against the linear theory, the computed growth rate of the first roll is −0.506 at Ra = 700 (theory −0.505), −0.001 at Ra = 761 (theory 0), and +0.546 at Ra = 830 (theory +0.547). The Nusselt number is 1 + ⟨wθ⟩, the total heat flux over the conducted flux. Real pans have no-slip walls, which raise the threshold to about 1708; 2-D rolls also leave out the 3-D patterns real layers form.",
      "equations": [
          {
              "label": "vorticity (2-D Boussinesq, diffusive units)",
              "latex": "\\frac{\\partial\\omega}{\\partial t} + \\mathbf u\\cdot\\nabla\\omega = Pr\\,\\nabla^2\\omega + Pr\\,Ra\\,\\frac{\\partial\\theta}{\\partial x}"
          },
          {
              "label": "temperature (θ = departure from the conducting profile 1 − z)",
              "latex": "\\frac{\\partial\\theta}{\\partial t} + \\mathbf u\\cdot\\nabla\\theta = w + \\nabla^2\\theta"
          },
          {
              "label": "the Rayleigh and Prandtl numbers",
              "latex": "Ra = \\frac{g\\alpha\\,\\Delta T\\,d^3}{\\nu\\kappa},\\qquad Pr = \\frac{\\nu}{\\kappa}"
          },
          {
              "label": "onset (free-slip walls), growth rate σ of a roll with wavenumber k_x",
              "latex": "(\\sigma + Pr\\,k^2)(\\sigma + k^2)\\,k^2 = Pr\\,Ra\\,k_x^2,\\quad k^2 = k_x^2 + \\pi^2,\\quad Ra_c = \\tfrac{27}{4}\\pi^4"
          },
          {
              "label": "heat transport",
              "latex": "Nu = 1 + \\langle w\\,\\theta \\rangle"
          }
      ],
      "params": [
          {
              "key": "ra",
              "symbol": "Ra",
              "meaning": "how strongly buoyancy beats viscosity and heat diffusion"
          },
          {
              "key": "pr",
              "symbol": "Pr",
              "meaning": "viscosity over heat diffusivity (air ≈ 0.7, water ≈ 7)"
          }
      ],
      "code": "// pseudo-spectral, vorticity–streamfunction (ψ = −ω/k²)\nu = −∂ψ/∂z,  w = ∂ψ/∂x\nNω = −u·∇ω + Pr·Ra ∂θ/∂x\nNθ = −u·∇θ + w\n// integrating factor for diffusion, Adams–Bashforth 2 for N\nω̂ ← e^{−Pr k² dt} (ω̂ + dt (3/2 N̂ − 1/2 e^{−Pr k² dt} N̂_prev))\n// walls: fields kept odd about z = 0 and z = 1 (free slip, fixed temperature)",
      "links": [
          {
              "label": "Rayleigh 1916 — On convection currents in a horizontal layer of fluid… (Phil. Mag. 32, 529)",
              "url": "https://doi.org/10.1080/14786441608635602"
          },
          {
              "label": "Rayleigh–Bénard convection",
              "url": "https://en.wikipedia.org/wiki/Rayleigh%E2%80%93B%C3%A9nard_convection"
          },
          {
              "label": "Rayleigh number",
              "url": "https://en.wikipedia.org/wiki/Rayleigh_number"
          },
          {
              "label": "Nusselt number",
              "url": "https://en.wikipedia.org/wiki/Nusselt_number"
          },
          {
              "label": "Spectral method",
              "url": "https://en.wikipedia.org/wiki/Spectral_method"
          }
      ]
  },
  shearInstabilities: {
      "title": "Kelvin–Helmholtz & Rayleigh–Taylor",
      "about": "Two ways a smooth boundary between fluids tears itself apart. Kelvin–Helmholtz: two streams sliding past each other — here the middle band (orange dye) flows right and the outer fluid (blue) flows left. Any small ripple on the boundary is lifted, because the flow speeds up over its crest and the pressure there drops. So the ripple grows, leans over, and rolls up into a row of spiral billows that then merge and mix the two streams. It is how wind raises waves on water, why clouds sometimes show rows of breaking-wave 'billows', and what shapes the edges of Jupiter's belts. Rayleigh–Taylor: heavy fluid (blue) resting on light fluid (orange) in gravity. It is balanced, but the way a pencil standing on its point is balanced: the heavy fluid falls in fingers and the light fluid rises in mushroom-capped plumes, and they mix. It is what you see when you turn a glass of water upside down, in the fingers of a supernova remnant like the Crab Nebula, and in the instabilities that fusion capsules must survive. The box wraps round at its edges, so there is a second boundary half a box away with light fluid on top of heavy: that one is stable and only ripples, which shows it is the arrangement, not the boundary itself, that is unstable. Each run starts again once the fluids have mixed.",
      "howItWorks": "Both use the same pseudo-spectral solver for 2-D incompressible flow (vorticity–streamfunction form) as the convection system, on a 128 × 128 grid in a box that is periodic in both directions. Derivatives are exact in Fourier space, products are dealiased by the 2/3 rule, viscosity and diffusion are integrated exactly, and the rest uses second-order Adams–Bashforth with a step limited by the flow speed. Kelvin–Helmholtz: two tanh shear layers of half-thickness δ = 0.025 with a velocity jump of 2U (U = 1), dye that follows the streams, small random ripples, and no gravity. For an inviscid tanh layer the fastest ripples grow as e^{σt} with σ ≈ 0.19 U/δ, at a wavelength of about 14δ (Michalke, 1964). Here a three-wave ripple (kδ = 0.47, where theory gives 7.5) grows at 7.0 at the lowest viscosity and early on, then more slowly, because viscosity steadily thickens the shear layer itself, and thicker layers grow more slowly. Rayleigh–Taylor: buoyancy +1 for light and −1 for heavy fluid, with an interface thickness of about 2δ (δ = 0.01). For a sharp interface with no viscosity a ripple of wavenumber k grows as e^{√(Agk) t} (Rayleigh 1882; Taylor 1950), which is √k in these units. For a two-wave ripple (k = 4π) the measured rate is 3.25 against 3.54, the expected reduction for an interface of finite thickness. Two dimensions only: real billows and plumes break down further into 3-D turbulence.",
      "equations": [
          {
              "label": "vorticity, with buoyancy b (light > 0)",
              "latex": "\\frac{\\partial\\omega}{\\partial t} + \\mathbf u\\cdot\\nabla\\omega = \\nu\\nabla^2\\omega + \\frac{\\partial b}{\\partial x}"
          },
          {
              "label": "dye or buoyancy, carried by the flow",
              "latex": "\\frac{\\partial b}{\\partial t} + \\mathbf u\\cdot\\nabla b = \\kappa\\nabla^2 b"
          },
          {
              "label": "Kelvin–Helmholtz, a sharp sheet (velocity jump ΔU): every ripple grows",
              "latex": "\\sigma = \\tfrac12\\,k\\,\\Delta U"
          },
          {
              "label": "…a tanh layer of half-thickness δ: fastest growth (Michalke 1964)",
              "latex": "\\sigma_{max} \\approx 0.19\\,\\frac{U}{\\delta}\\quad\\text{at}\\quad k\\delta \\approx 0.44"
          },
          {
              "label": "Rayleigh–Taylor, a sharp interface (Atwood number A)",
              "latex": "\\sigma = \\sqrt{A\\,g\\,k},\\qquad A = \\frac{\\rho_{heavy}-\\rho_{light}}{\\rho_{heavy}+\\rho_{light}}"
          }
      ],
      "params": [
          {
              "key": "scene",
              "symbol": "",
              "meaning": "shear between two streams (Kelvin–Helmholtz) or heavy fluid on light (Rayleigh–Taylor)"
          },
          {
              "key": "visc",
              "symbol": "\\nu",
              "meaning": "viscosity (and the dye's diffusion): higher values smooth out the finest billows and fingers and slow their growth"
          }
      ],
      "code": "// same solver as convection, periodic box, 128²\nNω = −u·∇ω + ∂b/∂x      // (no buoyancy term for Kelvin–Helmholtz)\nNb = −u·∇b\n// KH: u(z) = tanh((z−¼)/δ) − tanh((z−¾)/δ) − 1, ω = −du/dz, dye b = same profile\n// RT: b = tanh(cos(2πz) / (2πδ))  → heavy over light at z = ¼, light over heavy at z = ¾",
      "links": [
          {
              "label": "Thomson (Kelvin) 1871 — Hydrokinetic solutions and observations (Phil. Mag. 42, 362)",
              "url": "https://doi.org/10.1080/14786447108640585"
          },
          {
              "label": "Rayleigh 1882 — …equilibrium of an incompressible heavy fluid of variable density (Proc. LMS 14, 170)",
              "url": "https://doi.org/10.1112/plms/s1-14.1.170"
          },
          {
              "label": "Taylor 1950 — The instability of liquid surfaces when accelerated… (Proc. R. Soc. A 201, 192)",
              "url": "https://doi.org/10.1098/rspa.1950.0052"
          },
          {
              "label": "Michalke 1964 — On the inviscid instability of the hyperbolic-tangent velocity profile (JFM 19, 543)",
              "url": "https://doi.org/10.1017/S0022112064000908"
          },
          {
              "label": "Kelvin–Helmholtz instability",
              "url": "https://en.wikipedia.org/wiki/Kelvin%E2%80%93Helmholtz_instability"
          },
          {
              "label": "Rayleigh–Taylor instability",
              "url": "https://en.wikipedia.org/wiki/Rayleigh%E2%80%93Taylor_instability"
          }
      ]
  },
  elasticWaves: {
      "title": "Elastic Waves (Earthquake)",
      "about": "When a fault slips, the shock spreads through the Earth as two different kinds of wave. P waves (primary) push and pull the rock along their direction of travel, like sound; they are the fastest and arrive first. S waves (secondary) shake it from side to side; they travel about 1.7 times slower and cannot pass through liquid, which is how we know the Earth's outer core is molten. Where the waves reach the surface they combine into a Rayleigh wave that rolls the ground up and down like an ocean swell. It arrives last, travels along the surface instead of spreading into the deep rock, and does most of the damage. Seismologists read the delay between P and S to tell how far away a quake was, and early-warning systems use the fast P wave to warn of the shaking seconds before it arrives. This is a vertical slice through the ground with the surface at the top. Choose what to see: the vertical ground motion, or the compression (P) and shear (S) parts separately — in 'deep in the rock' they form two clean rings, P outside S. 'Soft layer over rock' adds a layer of sediment where waves travel at half the speed: they slow down, grow taller and get trapped bouncing inside it, which is why cities built on soft basins (Mexico City, for one) shake hardest.",
      "howItWorks": "This solves the equations of linear elasticity for in-plane motion (P–SV waves) with Virieux's 1986 staggered-grid scheme: velocities and stresses live on interleaved grids and leapfrog each other in time — velocities change with the divergence of the stress, stresses with the gradient of the velocity, through the rock's Lamé constants λ and μ. The rock is a 'Poisson solid' (λ = μ), close to typical crustal rock, with P speed α = 1 and S speed β = α/√3. The ground surface is traction-free: the normal stress is zero there and the shear stress is mirrored across it. The other edges are absorbing sponges. The source is a Ricker pulse injected into the stresses — part explosion, part shear — so it radiates both P and S. Checked from the computed waves: P travels at 1.000α and S at 0.563α (theory 0.577α; the difference is the grid's numerical dispersion), and the surface pulse, timed by cross-correlating the ground motion at two points 80 cells apart, travels at 0.525α against Rayleigh's 0.9194β = 0.531α. 'Compression' is drawn as the divergence of the velocity field and 'shear' as its curl.",
      "equations": [
          {
              "label": "momentum",
              "latex": "\\rho\\,\\frac{\\partial \\mathbf v}{\\partial t} = \\nabla\\cdot\\boldsymbol\\sigma"
          },
          {
              "label": "Hooke's law (rate form)",
              "latex": "\\frac{\\partial \\boldsymbol\\sigma}{\\partial t} = \\lambda\\,(\\nabla\\cdot\\mathbf v)\\,\\mathbf I + \\mu\\left(\\nabla\\mathbf v + \\nabla\\mathbf v^{\\mathsf T}\\right)"
          },
          {
              "label": "wave speeds",
              "latex": "\\alpha = \\sqrt{\\frac{\\lambda + 2\\mu}{\\rho}},\\qquad \\beta = \\sqrt{\\frac{\\mu}{\\rho}},\\qquad \\frac{\\beta}{\\alpha} = \\frac{1}{\\sqrt3}\\ \\text{when}\\ \\lambda = \\mu"
          },
          {
              "label": "Rayleigh wave speed (λ = μ)",
              "latex": "\\frac{c_R^2}{\\beta^2} = 2 - \\frac{2}{\\sqrt3}\\quad\\Rightarrow\\quad c_R \\approx 0.9194\\,\\beta"
          },
          {
              "label": "free surface",
              "latex": "\\sigma_{zz} = \\sigma_{xz} = 0"
          },
          {
              "label": "distance from the P–S delay",
              "latex": "d = \\frac{\\Delta t}{1/\\beta - 1/\\alpha}"
          }
      ],
      "params": [
          {
              "key": "scene",
              "symbol": "",
              "meaning": "a quake below the surface, the same under a soft sediment layer, or a source deep in the rock with no surface"
          },
          {
              "key": "view",
              "symbol": "",
              "meaning": "draw the vertical ground motion, or the compression (P, the divergence) and shear (S, the curl) parts separately"
          }
      ],
      "code": "// Virieux staggered grid, dx = 1, dt = 0.5 (α = 1)\nvx += dt/ρ (∂x σxx + ∂z σxz);   vz += dt/ρ (∂x σxz + ∂z σzz)\nσxx += dt ((λ+2μ) ∂x vx + λ ∂z vz)\nσzz += dt (λ ∂x vx + (λ+2μ) ∂z vz)\nσxz += dt μ (∂z vx + ∂x vz)\n// surface: σzz = 0, σxz mirrored;  source: Ricker pulse into σxx, σzz, σxz",
      "links": [
          {
              "label": "Virieux 1986 — P-SV wave propagation in heterogeneous media: velocity-stress finite-difference method (Geophysics 51, 889)",
              "url": "https://doi.org/10.1190/1.1442147"
          },
          {
              "label": "Rayleigh 1885 — On waves propagated along the plane surface of an elastic solid (Proc. LMS 17, 4)",
              "url": "https://doi.org/10.1112/plms/s1-17.1.4"
          },
          {
              "label": "Seismic wave",
              "url": "https://en.wikipedia.org/wiki/Seismic_wave"
          },
          {
              "label": "P wave",
              "url": "https://en.wikipedia.org/wiki/P_wave"
          },
          {
              "label": "S wave",
              "url": "https://en.wikipedia.org/wiki/S_wave"
          },
          {
              "label": "Rayleigh wave",
              "url": "https://en.wikipedia.org/wiki/Rayleigh_wave"
          }
      ]
  },
  phonons: {
      "title": "Phonons (Lattice Vibrations)",
      "about": "Sound and heat travel through a crystal as waves of atoms nudging their neighbours. Model the atoms as balls joined by springs and something remarkable appears: the row can only vibrate in definite patterns, called normal modes, and each pattern's frequency is fixed by its wavelength. That rule is the dispersion relation, drawn below the chain, with the current mode marked. Long waves behave like ordinary sound: double the frequency and you halve the wavelength. But the curve bends over as the wavelength shrinks towards two atom spacings, because the atoms cannot wiggle any finer than they are spaced. Use two kinds of atom (light cyan, heavy orange) and the curve splits in two. On the acoustic branch, neighbours move together, as in sound. On the optical branch they move against each other; in ionic crystals such as table salt that motion couples to light, which is where the name comes from. Between the branches is a band gap, a range of frequencies that no vibration can have, the same idea that gives semiconductors their electronic band gaps. Choose 'wave packet' to send a short burst along a long chain. Its crests run at the phase velocity, but the burst itself, and the energy it carries, moves at the group velocity, the slope of the curve. At the edge of the zone the slope is zero and the vibration goes nowhere: a standing wave. The atoms' motion is drawn sideways and magnified so it can be seen.",
      "howItWorks": "Each atom feels Hooke's-law forces from its two neighbours: m ü_n = K(u_{n+1} + u_{n−1} − 2u_n), on a ring of atoms. The chain is integrated numerically with velocity Verlet; the dispersion relation is never imposed. A single mode is started from the exact eigenvector for the chosen wavenumber and branch, and a wave packet from that eigenvector times a Gaussian envelope. At the zone edge one kind of atom stands still: the light ones on the acoustic branch, the heavy ones on the optical. The curves are the textbook formulas: ω = 2√(K/m)|sin(ka/2)| for one kind of atom, and for two masses ω² = K(1/m₁ + 1/m₂) ± K√((1/m₁ + 1/m₂)² − 4 sin²(ka/2)/(m₁m₂)). The small mast over the chain marks where the group velocity says the burst should be. Checked by integrating the chain and timing the atoms: the frequencies match the formula to 4 decimals on both branches, including the zone edge (0.8165 = √(2K/m₂)). A burst's energy centre moves at 0.7059 cells per unit time against a group velocity of 0.7071 (one kind of atom), and at 0.2977 against 0.2992 and −0.0753 against −0.0754 for the two branches of the two-mass chain — the optical burst drifts backwards while its crests run forwards.",
      "equations": [
          {
              "label": "Newton's law for each atom",
              "latex": "m_n\\,\\ddot u_n = K\\left(u_{n+1} + u_{n-1} - 2u_n\\right)"
          },
          {
              "label": "one kind of atom",
              "latex": "\\omega(k) = 2\\sqrt{\\frac{K}{m}}\\,\\left|\\sin\\frac{ka}{2}\\right|"
          },
          {
              "label": "two masses (acoustic −, optical +)",
              "latex": "\\omega^2 = K\\left(\\frac{1}{m_1}+\\frac{1}{m_2}\\right) \\pm K\\sqrt{\\left(\\frac{1}{m_1}+\\frac{1}{m_2}\\right)^2 - \\frac{4\\sin^2(ka/2)}{m_1 m_2}}"
          },
          {
              "label": "phase and group velocity",
              "latex": "v_p = \\frac{\\omega}{k},\\qquad v_g = \\frac{d\\omega}{dk}"
          },
          {
              "label": "the band gap at the zone edge (m₁ < m₂)",
              "latex": "\\sqrt{2K/m_2} < \\omega < \\sqrt{2K/m_1}"
          }
      ],
      "params": [
          {
              "key": "scene",
              "symbol": "",
              "meaning": "one normal mode on a short chain, or a wave packet on a long one"
          },
          {
              "key": "ratio",
              "symbol": "m_2/m_1",
              "meaning": "the heavy atoms' mass relative to the light ones (1 = a single kind of atom)"
          },
          {
              "key": "branch",
              "symbol": "",
              "meaning": "acoustic (neighbours together) or optical (neighbours opposed)"
          },
          {
              "key": "mode",
              "symbol": "k",
              "meaning": "the wavenumber — how many waves fit along the chain (single mode), or how far across the zone (wave packet)"
          }
      ],
      "code": "// ring of atoms, springs K, velocity Verlet\na[n] = K (u[n+1] + u[n-1] - 2 u[n]) / m[n]\nv += a dt/2;  u += v dt;  recompute a;  v += a dt/2\n// start: exact eigenvector (× Gaussian envelope for a packet)\n// heavy/light amplitude: (2K − m1 ω²) A = K (1 + e^{−ik}) B",
      "links": [
          {
              "label": "Brillouin 1946 — Wave Propagation in Periodic Structures",
              "url": "https://archive.org/details/wavepropagationi0000bril"
          },
          {
              "label": "Phonon",
              "url": "https://en.wikipedia.org/wiki/Phonon"
          },
          {
              "label": "Group velocity",
              "url": "https://en.wikipedia.org/wiki/Group_velocity"
          },
          {
              "label": "Brillouin zone",
              "url": "https://en.wikipedia.org/wiki/Brillouin_zone"
          }
      ]
  },
  twoStream: {
      "title": "Two-Stream Instability (Plasma PIC)",
      "about": "Two beams of electrons run through each other in opposite directions, over a still background of positive ions — the simplest example of a plasma turning the energy of flowing particles into electric fields. Picture it in phase space: position across, velocity up, so the two beams start as two flat lines, one moving right (cyan) and one left (orange). A tiny bunching in one beam makes an electric field that bunches the other, which pushes back harder; the ripple grows exponentially, then the field grows strong enough to trap electrons, and each wavelength curls up into a whirling vortex. Below the phase space are the electric field (white) and the logarithm of its energy against time (gold): while the ripple grows exponentially the gold line climbs straight, and its slope can be compared with the faint line, the growth rate that the theory of cold beams predicts. Then it bends over as the electrons are trapped. The same instability keeps particle beams in space from staying beams, heats electrons in shocks, and limits the currents a plasma can carry. Turn up the beam temperature (their velocity spread) and the instability weakens; hot enough and it disappears.",
      "howItWorks": "This is particle-in-cell (PIC) simulation, the workhorse method of plasma physics (Dawson 1983; Birdsall and Langdon). Each dot is a 'macro-electron' standing for many real ones; there are 100,000 of them on a periodic line of 256 grid cells. Every step their charge is shared onto the two nearest grid points (cloud-in-cell weighting) and added to the uniform ion background. The electric field comes from Gauss's law (dE/dx = ρ, with zero mean), is interpolated back to each electron the same way, and moves it by leapfrog (a = −E). Units: plasma frequency ωp = 1. The beams start 'quietly', evenly spaced with a tiny ripple of the chosen wavelength, and a small velocity spread. For two cold beams at ±v₀ each carrying half the density, the dispersion relation 1 = ½/(ω − kv₀)² + ½/(ω + kv₀)² gives growth for kv₀ < 1, fastest at kv₀ = √(3/8) with growth rate 1/(2√2) ≈ 0.354 ωp. The box holds whole wavelengths of that fastest ripple. Checked: the code's plasma oscillation frequency is 1.0000 ωp. Fitting the exponential phase of the field's Fourier mode gives γ = 0.345 against 0.354 for the cold theory. Total energy (kinetic plus field) changes by under 0.1% through saturation, when about 5% of the beams' energy has gone into the field.",
      "equations": [
          {
              "label": "each electron (units: ωp = 1, e = m = ε₀ = 1)",
              "latex": "\\frac{dx}{dt} = v,\\qquad \\frac{dv}{dt} = -E(x)"
          },
          {
              "label": "Gauss's law with the ion background",
              "latex": "\\frac{\\partial E}{\\partial x} = 1 - n_e(x)"
          },
          {
              "label": "cold two-stream dispersion relation",
              "latex": "1 = \\frac{\\omega_p^2/2}{(\\omega - k v_0)^2} + \\frac{\\omega_p^2/2}{(\\omega + k v_0)^2}"
          },
          {
              "label": "its solution",
              "latex": "\\omega^2 = \\frac{(2a^2 + 1) - \\sqrt{8a^2 + 1}}{2},\\quad a = \\frac{k v_0}{\\omega_p}"
          },
          {
              "label": "fastest growth",
              "latex": "\\gamma_{max} = \\frac{\\omega_p}{2\\sqrt2}\\ \\text{at}\\ k v_0 = \\sqrt{3/8}\\,\\omega_p"
          }
      ],
      "params": [
          {
              "key": "mode",
              "symbol": "m",
              "meaning": "how many wavelengths of the fastest-growing ripple fit in the box (= how many vortices form)"
          },
          {
              "key": "vth",
              "symbol": "v_{th}",
              "meaning": "the beams' velocity spread (temperature) — more spread, slower growth"
          },
          {
              "key": "v0",
              "symbol": "v_0",
              "meaning": "the beams' speed"
          }
      ],
      "code": "// particle-in-cell, periodic, 256 cells, dt = 0.1/ωp\nfor each electron: share charge onto the 2 nearest cells (cloud-in-cell)\nρ = 1 − n_e;  E = ∫ρ dx  (zero mean)\nfor each electron: v −= E(x) dt;  x += v dt  (leapfrog, wrap around)",
      "links": [
          {
              "label": "Dawson 1983 — Particle simulation of plasmas (Rev. Mod. Phys. 55, 403)",
              "url": "https://doi.org/10.1103/RevModPhys.55.403"
          },
          {
              "label": "Buneman 1959 — Dissipation of currents in ionized media (Phys. Rev. 115, 503)",
              "url": "https://doi.org/10.1103/PhysRev.115.503"
          },
          {
              "label": "Two-stream instability",
              "url": "https://en.wikipedia.org/wiki/Two-stream_instability"
          },
          {
              "label": "Particle-in-cell",
              "url": "https://en.wikipedia.org/wiki/Particle-in-cell"
          },
          {
              "label": "Plasma oscillation",
              "url": "https://en.wikipedia.org/wiki/Plasma_oscillation"
          }
      ]
  },
  stellarCollapse: {
      "title": "Star: Balance and Collapse",
      "about": "A star is a ball of gas held up by its own pressure against its own gravity. Here it is shown as a slice through the middle: the hot core white, cooler layers yellow and red, and the brightness following the density. 'A star in balance' is the classic model of a Sun-like star, a polytrope of index 3 (Eddington's 'standard model'). Pressure and gravity cancel at every depth, so it is about 54 times denser at the centre than on average. Give it a nudge and it rings, breathing in and out with a period set only by its mean density: make the same mass bigger and it breathes more slowly. That is why a Cepheid variable's pulsation period reveals its size and brightness, which is how Henrietta Leavitt's period–luminosity law turned Cepheids into the yardsticks that showed the universe is expanding. 'Core collapse' takes the same ball but makes the gas slightly too soft to hold itself up. This is what happens when an old massive star's iron core can no longer make energy and its electrons are squeezed into the nuclei. It falls in, faster and faster, the centre reaching hundreds of times its starting density in a fraction of a second, until the core hits nuclear density and suddenly turns stiff. The inner core stops and rebounds, the infalling layers slam into it, and a shock wave runs outward: the start of a core-collapse (Type II) supernova. Here the shock carries some of the outer gas away.",
      "howItWorks": "The starting star solves the Lane–Emden equation for index n = 3; the solver reproduces the textbook constants ξ₁ = 6.89685 and −ξ₁²θ′(ξ₁) = 2.01824, and likewise for n = 1 and 1.5. It is then evolved by 1-D spherical Lagrangian hydrodynamics on 160 mass shells: each shell's surface is pushed by the pressure difference across it and pulled in by the mass inside it. The scheme is von Neumann–Richtmyer's, with leapfrog time stepping and artificial viscosity to capture shocks. Internal energy changes by the work done on each shell, using the average of the old and new pressure. Units G = M = R = 1. In balance the gas is ideal with Γ = 5/3, and the model is first relaxed onto the grid's own equilibrium. Left alone, its interior then moves at under 0.5% of the escape speed and its shells hold their radii to 0.4%. Nudged, it breathes, and the period scales with radius as R^{3/2} at fixed mass (measured ratio 1.842 against 1.837 for R = 1.5 vs 1), i.e. as 1/√(Gρ̄). For the collapse the pressure follows a 'hybrid' equation of state of the kind used in supernova modelling: a soft power law (Γ = 1.3 below 4/3, so it cannot stand) up to a stand-in nuclear density (400× the starting central density), very stiff (Γ = 2.5) above it, plus a thermal part (Γ = 1.5) for shock-heated gas. Total energy is conserved to about 5% through bounce and ejection. This is a toy, and an honest one. Real cores lose huge amounts of energy breaking iron into nucleons and in neutrinos, so the real shock stalls within a few hundred kilometres. Reviving it takes neutrino heating and turbulence over hundreds of milliseconds, the subject of decades of work (Bethe 1990). Here nothing is lost, so the shock always gets out.",
      "equations": [
          {
              "label": "hydrostatic balance",
              "latex": "\\frac{dP}{dr} = -\\frac{G\\,m(r)\\,\\rho}{r^2}"
          },
          {
              "label": "polytrope and the Lane–Emden equation",
              "latex": "P = K\\rho^{1+1/n},\\qquad \\frac{1}{\\xi^2}\\frac{d}{d\\xi}\\left(\\xi^2\\frac{d\\theta}{d\\xi}\\right) = -\\theta^n,\\quad \\rho = \\rho_c\\,\\theta^n"
          },
          {
              "label": "Lagrangian hydrodynamics of each shell",
              "latex": "\\frac{du}{dt} = -4\\pi r^2\\frac{\\partial (P+q)}{\\partial m} - \\frac{G m}{r^2},\\qquad \\frac{de}{dt} = -(P+q)\\frac{d(1/\\rho)}{dt}"
          },
          {
              "label": "breathing period (Ritter's relation)",
              "latex": "\\Pi \\propto \\frac{1}{\\sqrt{G\\bar\\rho}}"
          },
          {
              "label": "why Γ < 4/3 collapses",
              "latex": "E = -\\frac{3\\Gamma - 4}{3(\\Gamma - 1)}\\,\\frac{GM^2}{R}\\times\\text{const}\\quad\\Rightarrow\\quad \\text{unbound to collapse for}\\ \\Gamma < \\tfrac43"
          }
      ],
      "params": [
          {
              "key": "scene",
              "symbol": "",
              "meaning": "a star in hydrostatic balance (nudged, it breathes) or a core too soft to hold itself up"
          },
          {
              "key": "gamma",
              "symbol": "\\Gamma",
              "meaning": "collapse: the softness of the gas below nuclear density — further below 4/3, faster collapse"
          },
          {
              "key": "radius",
              "symbol": "R",
              "meaning": "balance: the star's radius at fixed mass — bigger stars breathe more slowly"
          }
      ],
      "code": "// 160 mass shells, von Neumann–Richtmyer\nu_i += dt (−4π r_i² (P_out − P_in)/m̄ − G m_i / r_i²)\nr_i += u_i dt\nρ_j = dm_j / (4π/3 (r_{j+1}³ − r_j³))\nq_j = ρ (2 Δu² + 0.3 |Δu| c)   if compressing\ne_j −= (½(P_old + P_new) + q) Δ(1/ρ)\n// collapse EOS: soft K ρ^1.3 → stiff ρ^2.5 above ρ_nuc, + thermal part",
      "links": [
          {
              "label": "Chandrasekhar 1939 — An Introduction to the Study of Stellar Structure",
              "url": "https://archive.org/details/introductiontost0000chan"
          },
          {
              "label": "von Neumann & Richtmyer 1950 — A method for the numerical calculation of hydrodynamic shocks (J. Appl. Phys. 21, 232)",
              "url": "https://doi.org/10.1063/1.1699639"
          },
          {
              "label": "Bethe 1990 — Supernova mechanisms (Rev. Mod. Phys. 62, 801)",
              "url": "https://doi.org/10.1103/RevModPhys.62.801"
          },
          {
              "label": "Lane–Emden equation",
              "url": "https://en.wikipedia.org/wiki/Lane%E2%80%93Emden_equation"
          },
          {
              "label": "Type II supernova",
              "url": "https://en.wikipedia.org/wiki/Type_II_supernova"
          },
          {
              "label": "Cepheid variable",
              "url": "https://en.wikipedia.org/wiki/Cepheid_variable"
          }
      ]
  },
  fracture: {
      "title": "Fracture (Brittle Crack)",
      "about": "Why does glass shatter, and why does a tiny scratch make it so much easier to break? Here a brittle plate is modelled as a triangular lattice of atoms joined by springs that snap if stretched more than 3.5%. The plate is pulled taut between clamped top and bottom edges, then a notch is cut into its left side. Stress piles up enormously at the notch tip — a sharp crack multiplies the force on the bonds at its tip, which is why a scratch weakens glass. Whether the crack runs is an energy question, first answered by A. A. Griffith in 1921. Breaking bonds costs energy (the new surfaces), while letting the plate relax releases the elastic energy stored in it. Pull too gently and there isn't enough stored energy to pay for the new surface, so the notch just sits there. Pull a little harder and the bonds at the tip snap one after another, and the crack (orange) races across the plate. Pull harder still and the crack becomes unstable: it roughens, sheds side branches and splits, like the forks in a broken windscreen. Classical theory says a crack in a continuous material can't run faster than the Rayleigh speed, the speed of waves along a free surface. In real brittle materials cracks go unstable well before that, in acrylic at about a third of it.",
      "howItWorks": "There are 150 × 86 atoms on a triangular lattice, each joined to its six neighbours by linear springs (k = m = spacing = 1). This lattice is an isotropic elastic solid with Young's modulus 2k/√3, Poisson's ratio 1/3, shear-wave speed √(3/8) ≈ 0.612 and Rayleigh speed 0.9194 of that, ≈ 0.563. Checked: a long extensional wave along the free plate travels at 0.987 against the bar speed √(E/ρ) = 1. The plate starts uniformly stretched by the chosen strain, with the matching sideways contraction so it is already in balance, and the top and bottom two rows are held as grips. The notch is cut by removing the bonds across the middle line over the left 12% of the plate. Atoms move by velocity Verlet with very light damping, and any bond stretched beyond 3.5% breaks for good. Measured behaviour: at 0.8% strain the crack doesn't run; from about 1.2% it crosses cleanly along the middle; from about 2.6% it branches heavily. The tip settles at about 1.05 times the lattice's Rayleigh speed. That is slightly faster than the continuum limit, which idealised lattices with perfectly brittle springs are known to allow, since nothing absorbs energy except the snapping bonds. Real materials lose energy to microcracks, heat and roughness, and run slower.",
      "equations": [
          {
              "label": "Griffith's criterion: the crack grows when the released elastic energy pays for the new surfaces",
              "latex": "G \\ge 2\\gamma,\\qquad \\sigma_c = \\sqrt{\\frac{2E\\gamma}{\\pi a}}"
          },
          {
              "label": "each bond (breaks for good beyond ε_c)",
              "latex": "\\mathbf F = k\\,(|\\mathbf d| - a)\\,\\hat{\\mathbf d},\\qquad |\\mathbf d| > a(1+\\varepsilon_c)\\ \\Rightarrow\\ \\text{snap}"
          },
          {
              "label": "the triangular lattice as an elastic solid",
              "latex": "E = \\frac{2k}{\\sqrt3},\\quad \\nu = \\tfrac13,\\quad c_s = \\sqrt{\\frac{3k a^2}{8m}},\\quad c_R \\approx 0.9194\\,c_s"
          },
          {
              "label": "the stress near a crack tip grows without limit (linear elasticity)",
              "latex": "\\sigma \\sim \\frac{K_I}{\\sqrt{2\\pi r}}"
          }
      ],
      "params": [
          {
              "key": "strain",
              "symbol": "\\varepsilon",
              "meaning": "how far the plate is stretched before the notch is cut — below about 1% nothing happens, around 2% a clean crack runs, near 3% it branches"
          }
      ],
      "code": "// triangular spring lattice, k = m = a = 1, velocity Verlet\nfor each intact bond: s = |d| − 1\n    if s > 0.035: break it (for good)\n    else: f = s · d/|d|  on both atoms\n// start: uniform stretch ε with sideways contraction ε/3, grips held, notch cut\n// crack tip = furthest broken bond along the middle",
      "links": [
          {
              "label": "Griffith 1921 — The phenomena of rupture and flow in solids (Phil. Trans. R. Soc. A 221, 163)",
              "url": "https://doi.org/10.1098/rsta.1921.0006"
          },
          {
              "label": "Marder & Gross 1995 — Origin of crack tip instabilities (J. Mech. Phys. Solids 43, 1)",
              "url": "https://doi.org/10.1016/0022-5096(94)00060-I"
          },
          {
              "label": "Fineberg, Gross, Marder & Swinney 1991 — Instability in dynamic fracture (PRL 67, 457)",
              "url": "https://doi.org/10.1103/PhysRevLett.67.457"
          },
          {
              "label": "Fineberg & Marder 1999 — Instability in dynamic fracture (Physics Reports 313, 1)",
              "url": "https://doi.org/10.1016/S0370-1573(98)00085-4"
          },
          {
              "label": "Fracture mechanics",
              "url": "https://en.wikipedia.org/wiki/Fracture_mechanics"
          }
      ]
  },
  aharonovBohm: {
      "title": "Aharonov–Bohm Effect",
      "about": "Can a magnetic field affect an electron that never touches it? In quantum mechanics, yes. An electron wave (drawn as its amplitude) passes through two slits and interferes, building up the familiar bright and dark fringes on a screen. Just behind the wall, between the slits, sits a thin solenoid (the white dot), perfectly shielded. All of its magnetic field is inside, the electron can't get in, and everywhere the electron can go the magnetic field is exactly zero. Yet turning up the flux inside slides the fringes sideways. Half a flux quantum (h/2e) turns every bright fringe dark; one whole quantum (h/e) puts them back exactly where they started. The reason is that the electron responds to the magnetic vector potential A, which is not zero outside the solenoid even though the field B is. The two paths round the solenoid pick up different phases, and the difference, (e/ħ)∮A·dl = 2πΦ/Φ₀, depends only on the flux they enclose. Aharonov and Bohm predicted this in 1959; Tonomura's team confirmed it in 1986 by holography with electrons passing round a tiny magnetised ring sealed inside a superconductor, so that no field could leak out. On the right, the pattern builds up on the screen (bright strip) next to the pattern with no flux (dim strip), so the shift is easy to see. Try 0, 0.5, 1 and 1.5.",
      "howItWorks": "The electron obeys the time-dependent Schrödinger equation iħ∂ψ/∂t = −(ħ²/2m)∇²ψ on a 288 × 192 lattice (units ħ = m = 1, lattice spacing 1). The wall and the solenoid are cells the wave cannot enter. The flux enters only as a Peierls phase: every hop of the electron across a line running up from the solenoid to the edge of the box picks up a factor e^{±2πiα}, with α = Φ/Φ₀ the flux in flux quanta. That is exactly a vector potential confined to a thin sheet; the magnetic field it describes is zero everywhere the electron can be. The wave is advanced by second-order differencing (Askar and Cakmak 1978): ψ(t+dt) = ψ(t−dt) − 2i dt Hψ(t), which keeps the norm for dt·E_max < 1 (here 0.2 × 4). A thin absorbing layer at the edges soaks up the outgoing wave. A second, identical run with no flux goes on alongside as the reference, and both runs add up |ψ|² at the screen. Checked: with the absorber off, the norm changes by 5 × 10⁻⁶ in 300 steps. The measured fringe shift equals the flux mod 1 to two decimals: 0.250 at α = 0.25, −0.500 at 0.5, −0.251 at 0.75. At α = 1 the screen pattern matches α = 0 exactly, total dose included, as gauge invariance requires.",
      "equations": [
          {
              "label": "Schrödinger equation with a vector potential",
              "latex": "i\\hbar\\frac{\\partial\\psi}{\\partial t} = \\frac{1}{2m}\\left(-i\\hbar\\nabla - e\\mathbf A\\right)^2\\psi"
          },
          {
              "label": "phase difference between the two paths",
              "latex": "\\Delta\\varphi = \\frac{e}{\\hbar}\\oint \\mathbf A\\cdot d\\mathbf l = \\frac{e\\,\\Phi}{\\hbar} = 2\\pi\\,\\frac{\\Phi}{\\Phi_0},\\qquad \\Phi_0 = \\frac{h}{e}"
          },
          {
              "label": "fringe shift (in fringes)",
              "latex": "\\delta = \\frac{\\Phi}{\\Phi_0}\\pmod 1"
          },
          {
              "label": "on the lattice: Peierls phase on each hop",
              "latex": "-\\tfrac12\\,\\psi_{j} \\to -\\tfrac12\\,e^{\\,i\\frac{e}{\\hbar}\\int_j^i \\mathbf A\\cdot d\\mathbf l}\\,\\psi_j"
          },
          {
              "label": "time stepping (second-order differencing)",
              "latex": "\\psi^{n+1} = \\psi^{n-1} - 2i\\,\\Delta t\\,H\\psi^n"
          }
      ],
      "params": [
          {
              "key": "flux",
              "symbol": "\\Phi/\\Phi_0",
              "meaning": "the magnetic flux inside the shielded solenoid, in flux quanta h/e — the fringes shift by this amount (whole numbers change nothing)"
          }
      ],
      "code": "// lattice Schrödinger equation, ħ = m = 1, spacing 1\n(Hψ)_i = 2ψ_i − ½ Σ_neighbours U_ij ψ_j     // U = 1, except\nU = e^{±2πiα} for hops across the cut above the solenoid\nψ_next = ψ_prev − 2i dt Hψ                   // second-order differencing\nwalls and solenoid: ψ = 0;  screen: Σ |ψ|² over time\n// a second run with α = 0 is the reference",
      "links": [
          {
              "label": "Aharonov & Bohm 1959 — Significance of electromagnetic potentials in the quantum theory (Phys. Rev. 115, 485)",
              "url": "https://doi.org/10.1103/PhysRev.115.485"
          },
          {
              "label": "Tonomura et al. 1986 — Evidence for Aharonov–Bohm effect with magnetic field completely shielded from electron wave (PRL 56, 792)",
              "url": "https://doi.org/10.1103/PhysRevLett.56.792"
          },
          {
              "label": "Peierls 1933 — Zur Theorie des Diamagnetismus von Leitungselektronen (Z. Phys. 80, 763)",
              "url": "https://doi.org/10.1007/BF01342591"
          },
          {
              "label": "Askar & Cakmak 1978 — Explicit integration method for the time-dependent Schrödinger equation (J. Chem. Phys. 68, 2794)",
              "url": "https://doi.org/10.1063/1.436072"
          },
          {
              "label": "Aharonov–Bohm effect",
              "url": "https://en.wikipedia.org/wiki/Aharonov%E2%80%93Bohm_effect"
          }
      ]
  },
  casimirPlates: {
      "title": "Casimir Plates",
      "about": "Two uncharged metal plates, side by side in a perfect vacuum, are pushed together by empty space itself. In quantum theory the vacuum is never perfectly still: every mode of the electromagnetic field, every wavelength in every direction, keeps a residual jiggle with energy ½ħω even with no light present. A metal surface forces the electric field to vanish on it. So between two parallel mirrors only the waves that fit can exist, those with a node on each plate (wavelengths 2d, 2d/2, 2d/3, …), while outside every wavelength is allowed. The strings show this zero-point field along lines through the plates: cyan between them, where only the allowed standing waves jiggle, and violet outside, where all wavelengths do. Make the gap smaller and the long waves inside disappear. Below, the mode spectrum shows the allowed frequencies inside (bright ticks, evenly spaced) against the unbroken continuum outside. Fewer modes inside than outside means less zero-point energy inside, and the plates are pushed together (red arrows). The total zero-point energy is infinite on both sides, but the difference is finite and can be calculated, which the panel does live. The force is tiny at a micrometre (about a thousandth of a pascal) but grows as 1/d⁴: about an atmosphere at ten nanometres, where it matters in micro-machines. It has been measured since Lamoreaux's 1997 experiment.",
      "howItWorks": "For two ideal parallel mirrors the energy per area is E/A = −π²ħc/(720 d³), so the pressure is P = π²ħc/(240 d⁴) (Casimir 1948). The panel evaluates these in real units for the chosen gap: 13.0 Pa at 100 nm, 1.30 × 10⁵ Pa (about 1.3 atmospheres) at 10 nm, 1.30 mPa at 1 µm. The finite answer comes out of an infinite sum, and the panel shows how, in the simplest case: a 1-D field between two plates, with modes ω_n = nπc/d. Its zero-point energy Σ ½ħω_n diverges, so each mode is damped by a smooth cutoff e^{−εω} (as a real metal stops reflecting at high frequency). The damped sum is d/(2πε²) − π/(24d) + O(ε²). The first term is just proportional to the length of the gap, the same energy density as empty space everywhere, and cancels against the outside. What remains, −π/(24d), doesn't depend on the cutoff at all. The panel computes the damped sum numerically with ε = 0.004 and subtracts the first term, giving −0.130899/d against the exact −π/24 = −0.130900. (The same number is behind the famous '1 + 2 + 3 + … = −1/12'.) The strings are drawn from the same mode picture: inside, each allowed standing mode with a random phase and zero-point amplitude ∝ 1/√ω; outside, a random sample of the continuum with a node on the plate. They show which modes exist, not the actual size of the fluctuations. Real metals are not perfect mirrors and real experiments use a sphere near a plate (parallel plates are hard to keep parallel); corrections for finite conductivity, temperature and roughness are a few percent at these gaps.",
      "equations": [
          {
              "label": "Casimir pressure between ideal parallel mirrors",
              "latex": "P = \\frac{\\pi^2\\hbar c}{240\\,d^4}"
          },
          {
              "label": "energy per area",
              "latex": "\\frac{E}{A} = -\\frac{\\pi^2\\hbar c}{720\\,d^3}"
          },
          {
              "label": "the allowed standing waves between the plates",
              "latex": "\\lambda_n = \\frac{2d}{n},\\qquad \\omega_n = \\frac{n\\pi c}{d}"
          },
          {
              "label": "1-D regularised zero-point sum (ħ = c = 1)",
              "latex": "\\sum_{n=1}^{\\infty} \\frac{n\\pi}{2d}\\,e^{-\\varepsilon n\\pi/d} = \\frac{d}{2\\pi\\varepsilon^2} - \\frac{\\pi}{24\\,d} + O(\\varepsilon^2)"
          },
          {
              "label": "the same sum by the Riemann zeta function",
              "latex": "\\sum_{n\\ge1} n \\;\\to\\; \\zeta(-1) = -\\tfrac{1}{12}"
          }
      ],
      "params": [
          {
              "key": "gap",
              "symbol": "d",
              "meaning": "the distance between the plates, in nanometres — the pressure grows as 1/d⁴"
          }
      ],
      "code": "// pressure between ideal mirrors\nP = π² ħc / (240 d⁴)\n// 1-D check: regulated zero-point sum, then remove the part that grows with the gap\nS(ε) = Σ_n (nπ/2d) e^{−ε nπ/d}\nfinite = S(ε) − d / (2π ε²)   →  −π/(24 d) as ε → 0\n// strings: inside, standing modes sin(nπx/d) cos(ω_n t + φ_n) / √ω_n;\n//          outside, sampled continuum modes with a node on the plate",
      "links": [
          {
              "label": "Casimir 1948 — On the attraction between two perfectly conducting plates (Proc. KNAW 51, 793)",
              "url": "https://www.dwc.knaw.nl/DL/publications/PU00018547.pdf"
          },
          {
              "label": "Lamoreaux 1997 — Demonstration of the Casimir force in the 0.6 to 6 µm range (PRL 78, 5)",
              "url": "https://doi.org/10.1103/PhysRevLett.78.5"
          },
          {
              "label": "Bressi et al. 2002 — Measurement of the Casimir force between parallel metallic surfaces (PRL 88, 041804)",
              "url": "https://doi.org/10.1103/PhysRevLett.88.041804"
          },
          {
              "label": "Casimir effect",
              "url": "https://en.wikipedia.org/wiki/Casimir_effect"
          },
          {
              "label": "Zero-point energy",
              "url": "https://en.wikipedia.org/wiki/Zero-point_energy"
          }
      ]
  },
};
