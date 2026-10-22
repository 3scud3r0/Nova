import type { SystemDoc } from './content';

// Learn-panel content for the Parametric category — formula-driven point geometry: a map from an
// index or a (u,v) grid cell to a 3D point, sampled into a glowing cloud.

const COL = { key: 'colShift', symbol: '', meaning: '' }; // (parametric systems colour by index)
void COL;

export const PARAMETRIC_DOCS: Record<string, SystemDoc> = {
  fibonacci: {
    title: 'Fibonacci Sphere',
    about:
      'How do you spread N points as evenly as possible on a sphere? Use the golden angle — ' +
      '137.5°, derived from the Fibonacci ratio — between successive points. This is exactly the ' +
      'trick sunflowers, pinecones, and pineapples use to pack seeds (phyllotaxis), and it gives a ' +
      'near-perfect, swirl-free distribution with no clumping or seams.',
    howItWorks:
      'Walk point i up the sphere in equal height steps (so each band has equal area), and rotate by ' +
      'the golden angle each step. Because the golden ratio is the "most irrational" number, the ' +
      'points never line up into spokes — they interleave forever. The twist knob multiplies the ' +
      'angle, opening up Fibonacci spirals.',
    equations: [
      { label: 'golden angle', latex: '\\gamma = \\pi(3 - \\sqrt 5) \\approx 137.5^\\circ' },
      { label: 'point i of N', latex: 'y_i = 1 - \\tfrac{2i+1}{N}, \\quad \\theta_i = i\\,\\gamma, \\quad r_i = \\sqrt{1 - y_i^2}' },
      { label: 'position', latex: '(r_i\\cos\\theta_i,\\; y_i,\\; r_i\\sin\\theta_i)' },
    ],
    params: [
      { key: 'twist', symbol: 't', meaning: 'multiplies the golden angle; 1 = even sphere, >1 opens visible spirals' },
      { key: 'squash', symbol: 's', meaning: 'flattens the sphere toward a disk (oblate) or stretches it' },
    ],
    code: `const g = Math.PI * (3 - Math.sqrt(5));       // golden angle
for (let i = 0; i < N; i++) {
  const y = 1 - (2*i + 1)/N;                    // -1 → 1
  const r = Math.sqrt(1 - y*y);
  const th = i * g * twist;
  point(r*Math.cos(th), y*squash, r*Math.sin(th));
}`,
    links: [
      { label: 'Fibonacci sphere / lattice', url: 'https://en.wikipedia.org/wiki/Geodesic_polyhedron' },
      { label: 'Phyllotaxis (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Phyllotaxis' },
    ],
  },
  torus: {
    title: 'Torus',
    about:
      'The doughnut — the simplest non-trivial surface after the sphere. A circle of radius r swept ' +
      'around a larger ring of radius R. Topologically it’s the product of two circles, S¹×S¹, and ' +
      'it’s the natural home for systems with two independent angles (like coupled oscillators).',
    howItWorks: 'Two angles, u around the ring and v around the tube, map to a point on the surface.',
    equations: [
      { label: 'torus', latex: '\\big((R + r\\cos v)\\cos u,\\; r\\sin v,\\; (R + r\\cos v)\\sin u\\big)' },
    ],
    params: [
      { key: 'R', symbol: 'R', meaning: 'ring radius (distance from centre to the tube’s centre)' },
      { key: 'r', symbol: 'r', meaning: 'tube radius; r→R gives a horn torus, r>R a self-intersecting spindle' },
    ],
    code: `const u = a*2*Math.PI, v = b*2*Math.PI;      // a,b ∈ [0,1] grid
const w = R + r*Math.cos(v);
point(w*Math.cos(u), r*Math.sin(v), w*Math.sin(u));`,
    links: [{ label: 'Torus (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Torus' }],
  },
  klein: {
    title: 'Klein Bottle',
    about:
      'A surface with no inside and no outside — a one-sided bottle whose neck passes through its own ' +
      'wall to join the base from within. It can’t exist without self-intersecting in 3D (it truly ' +
      'lives in 4D), so what you see is the "figure-8 immersion," the least self-tangled shadow of it.',
    howItWorks:
      'A circle (parameter v) is swept around a loop (parameter u), but the circle flips orientation ' +
      'over one trip around — gluing the surface back to itself with a twist, like a 3D Möbius band.',
    equations: [
      {
        label: 'figure-8 immersion',
        latex: '\\begin{aligned} x &= (R + \\cos\\tfrac{u}{2}\\sin v - \\sin\\tfrac{u}{2}\\sin 2v)\\cos u \\\\ z &= \\sin\\tfrac{u}{2}\\sin v + \\cos\\tfrac{u}{2}\\sin 2v \\end{aligned}',
      },
    ],
    params: [{ key: 'size', symbol: 'R', meaning: 'overall radius of the bottle’s body loop' }],
    code: `const u = a*2*Math.PI, v = b*2*Math.PI;
const w = size + Math.cos(u/2)*Math.sin(v) - Math.sin(u/2)*Math.sin(2*v);
point(w*Math.cos(u), Math.sin(u/2)*Math.sin(v)+Math.cos(u/2)*Math.sin(2*v), w*Math.sin(u));`,
    links: [{ label: 'Klein bottle (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Klein_bottle' }],
  },
  mobius: {
    title: 'Möbius Strip',
    about:
      'Take a strip of paper, give it a half-twist, and glue the ends: you get a surface with only ' +
      'one side and one edge. Trace a finger along it and you cover both "faces" without lifting — ' +
      'the canonical example of a non-orientable surface.',
    howItWorks:
      'Sweep a short line segment (parameter v) around a loop (parameter u) while rotating the segment ' +
      'by half a turn over the full loop. Crank "half-twists" up for 3, 5, … twist variants.',
    equations: [
      {
        label: 'Möbius band',
        latex: '\\big((1 + \\tfrac{v}{2}\\cos\\tfrac{u}{2})\\cos u,\\; (1 + \\tfrac{v}{2}\\cos\\tfrac{u}{2})\\sin u,\\; \\tfrac{v}{2}\\sin\\tfrac{u}{2}\\big)',
      },
    ],
    params: [
      { key: 'width', symbol: 'w', meaning: 'width of the strip' },
      { key: 'twists', symbol: 'k', meaning: 'number of half-twists (1 = classic Möbius; odd stays one-sided)' },
    ],
    code: `const u = a*2*Math.PI, v = (b*2 - 1)*width;
const h = twists*u/2, rad = 1.6 + v*0.5*Math.cos(h);
point(rad*Math.cos(u), v*0.5*Math.sin(h), rad*Math.sin(u));`,
    links: [{ label: 'Möbius strip (Wikipedia)', url: 'https://en.wikipedia.org/wiki/M%C3%B6bius_strip' }],
  },
  seashell: {
    title: 'Seashell',
    about:
      'Shells grow by laying down material along a logarithmic (equiangular) spiral — the only curve ' +
      'that keeps its shape as it scales, which is why a nautilus looks self-similar at every size. ' +
      'Sweep an opening around that exponential spiral and you get the whole family of horns, conches, ' +
      'and snails from a handful of numbers.',
    howItWorks:
      'Parameter u winds along the spiral (the tube grows exponentially as it turns), while v goes ' +
      'around the opening. "Turns" sets how many whorls; "taper" stretches it along its axis.',
    equations: [
      { label: 'exponential growth', latex: 'e^{\\,u / (T\\pi)} \\;\\text{grows the tube each whorl}' },
      { label: 'spiral sweep', latex: 'x = 2(1 - e^{u/T\\pi})\\cos u\\,\\cos^2\\tfrac{v}{2}' },
    ],
    params: [
      { key: 'turns', symbol: 'T', meaning: 'number of whorls in the spiral' },
      { key: 'taper', symbol: '\\tau', meaning: 'stretch along the shell’s axis (pointier vs squat)' },
    ],
    code: `const u = a*Math.PI*turns, v = b*2*Math.PI;
const e = Math.exp(u/(turns*Math.PI)), cs = Math.cos(v/2)**2;
point(2*(1-e)*Math.cos(u)*cs, (1 - Math.exp(2*u/(turns*Math.PI)) - Math.sin(v) + e*Math.sin(v))*taper, 2*(e-1)*Math.sin(u)*cs);`,
    links: [
      { label: 'Logarithmic spiral (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Logarithmic_spiral' },
      { label: 'Seashell surface', url: 'https://en.wikipedia.org/wiki/Seashell_surface' },
    ],
  },
  superformula: {
    title: 'Superformula',
    about:
      'Johan Gielis’s 2003 "superformula" generates an astonishing range of natural shapes — ' +
      'starfish, flowers, diatoms, crystals, blobs — from a single equation by varying a few numbers. ' +
      'It generalises the superellipse to any rotational symmetry, and its 3D product gives organic ' +
      'solids that morph continuously as you turn the dials.',
    howItWorks:
      'A radius r(φ) is computed from the angle by the superformula; doing it for two angles (longitude ' +
      'φ and latitude θ) and multiplying gives a 3D surface. m sets the symmetry (number of lobes); ' +
      'n₁, n₂, n₃ pinch, bloat, and sharpen them.',
    equations: [
      {
        label: 'superformula radius',
        latex: 'r(\\varphi) = \\Big( \\big|\\cos\\tfrac{m\\varphi}{4}\\big|^{n_2} + \\big|\\sin\\tfrac{m\\varphi}{4}\\big|^{n_3} \\Big)^{-1/n_1}',
      },
      { label: '3D product (spherical product)', latex: '\\mathbf{p} = r_1(\\varphi)\\,r_2(\\theta)\\,(\\cos\\varphi\\cos\\theta,\\; \\tfrac{\\sin\\theta}{r_1},\\; \\sin\\varphi\\cos\\theta)' },
    ],
    params: [
      { key: 'm', symbol: 'm', meaning: 'rotational symmetry — the number of lobes / points' },
      { key: 'n1', symbol: 'n_1', meaning: 'overall pinch; small n₁ makes spiky stars, large n₁ rounds it' },
      { key: 'n2', symbol: 'n_2', meaning: 'shapes the lobes (one side)' },
      { key: 'n3', symbol: 'n_3', meaning: 'shapes the lobes (other side); n₂≠n₃ breaks symmetry' },
    ],
    code: `function R(angle, m, n1, n2, n3) {
  const t = m*angle/4;
  return Math.pow(Math.abs(Math.cos(t))**n2 + Math.abs(Math.sin(t))**n3, -1/n1);
}
const r1 = R(phi, m,n1,n2,n3), r2 = R(theta, m,n1,n2,n3), ct = r2*Math.cos(theta);
point(r1*Math.cos(phi)*ct, r2*Math.sin(theta), r1*Math.sin(phi)*ct);`,
    links: [
      { label: 'Superformula (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Superformula' },
      { label: 'Gielis 2003 (original paper)', url: 'https://www.amjbot.org/doi/10.3732/ajb.90.3.333' },
    ],
  },
  sunflower: {
    title: 'Sunflower',
    about:
      'The flat cousin of the Fibonacci sphere: Vogel’s 1979 model for the seed head of a sunflower. ' +
      'Place seed i at radius √i and rotate by the golden angle each step — the result is the ' +
      'interlocking left/right spiral families (parastichies) you can count on a real sunflower, and ' +
      'they always come out as consecutive Fibonacci numbers.',
    howItWorks:
      'Equal-area spacing (r = √(i/N)) keeps the seeds uniformly dense from centre to rim, while the ' +
      'golden angle guarantees no two seeds share a spoke. A gentle dome lifts it off the plane into 3D.',
    equations: [
      { label: 'Vogel’s model', latex: 'r_i = \\sqrt{i/N}, \\quad \\theta_i = i\\,\\gamma, \\quad \\gamma = \\pi(3-\\sqrt5)' },
      { label: 'position', latex: '(r_i\\cos\\theta_i,\\; d(1-r_i^2),\\; r_i\\sin\\theta_i)' },
    ],
    params: [
      { key: 'dome', symbol: 'd', meaning: 'height of the central dome (0 = flat disk)' },
      { key: 'spread', symbol: 's', meaning: 'overall radius of the seed head' },
    ],
    code: `const r = Math.sqrt((i+0.5)/N), th = i * g;     // g = golden angle
point(r*spread*Math.cos(th), dome*(1 - r*r), r*spread*Math.sin(th));`,
    links: [{ label: 'Phyllotaxis / Vogel model', url: 'https://en.wikipedia.org/wiki/Fermat%27s_spiral' }],
  },
  torusknot: {
    title: 'Torus Knot',
    about:
      'A (p,q) torus knot winds p times around the hole of a torus and q times through it before ' +
      'closing up. When p and q share no common factor the loop is genuinely knotted — (2,3) is the ' +
      'trefoil, the simplest nontrivial knot. We trace the whole loop as one dense glowing curve.',
    howItWorks:
      'A single angle t runs once around the loop. The point rides a circle of radius 2+cos(q·t) ' +
      '(the meridian winding) while that circle is carried around by the p·t longitude.',
    equations: [
      { label: '(p,q) torus knot', latex: 'x=(2+\\cos qt)\\cos pt,\\;\\; y=-\\sin qt,\\;\\; z=(2+\\cos qt)\\sin pt' },
    ],
    params: [
      { key: 'p', symbol: 'p', meaning: 'times the curve winds around the central axis (longitude)' },
      { key: 'q', symbol: 'q', meaning: 'times it winds through the hole (meridian); gcd(p,q)=1 ⇒ a knot' },
    ],
    code: `const t = (i/N)*2*Math.PI, w = 2 + Math.cos(q*t);
point(w*Math.cos(p*t), -Math.sin(q*t), w*Math.sin(p*t));`,
    links: [{ label: 'Torus knot (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Torus_knot' }],
  },
  lissajous: {
    title: 'Lissajous Curve',
    about:
      'The 3D generalisation of the figures Jules Lissajous drew in 1857 by bouncing light off two ' +
      'vibrating mirrors — and what an oscilloscope shows in XY mode. Three perpendicular sinusoids at ' +
      'integer frequencies trace an intricate closed orbit that knots and unknots as you retune them.',
    howItWorks:
      'Each coordinate is its own oscillator: x, y, z are sines of a·t, b·t, c·t. The frequency ratios ' +
      'set how many times the curve folds in each direction; the phase shears the x-oscillation.',
    equations: [
      { label: '3D Lissajous', latex: 'x=\\sin(at+\\delta),\\;\\; y=\\sin(bt),\\;\\; z=\\sin(ct)' },
    ],
    params: [
      { key: 'a', symbol: 'a', meaning: 'x-frequency' },
      { key: 'b', symbol: 'b', meaning: 'y-frequency' },
      { key: 'c', symbol: 'c', meaning: 'z-frequency' },
      { key: 'phase', symbol: '\\delta', meaning: 'phase offset on x — opens and twists the figure' },
    ],
    code: `const t = (i/N)*2*Math.PI;
point(Math.sin(a*t + phase), Math.sin(b*t), Math.sin(c*t));`,
    links: [{ label: 'Lissajous curve (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Lissajous_curve' }],
  },
  dini: {
    title: "Dini's Surface",
    about:
      'Take a pseudosphere — the trumpet-shaped surface of constant negative curvature, the geometry ' +
      'where parallel lines diverge — and twist it as it climbs. The result is Dini’s surface, a ' +
      'spiralling horn that is still, at every point, a saddle of exactly the same curvature.',
    howItWorks:
      'u winds around and up the axis; v runs from the wide mouth toward the infinitely thin cusp. The ' +
      'twist term adds a height proportional to u, shearing the tractrix profile into a helix.',
    equations: [
      {
        label: "Dini's surface",
        latex: '\\begin{aligned} x &= \\cos u\\sin v,\\;\\; z = \\sin u\\sin v \\\\ y &= \\cos v + \\ln\\tan\\tfrac{v}{2} + b\\,u \\end{aligned}',
      },
    ],
    params: [
      { key: 'twist', symbol: 'b', meaning: 'how fast the horn spirals up its axis' },
      { key: 'turns', symbol: 'T', meaning: 'number of revolutions swept' },
    ],
    code: `const u = a*turns*2*Math.PI, v = 0.12 + b*(1.45-0.12);
point(Math.cos(u)*Math.sin(v), Math.cos(v)+Math.log(Math.tan(v/2))+twist*u-1, Math.sin(u)*Math.sin(v));`,
    links: [{ label: "Dini's surface (Wikipedia)", url: 'https://en.wikipedia.org/wiki/Dini%27s_surface' }],
  },
  harmonic: {
    title: 'Harmonic Sphere',
    about:
      'A sphere whose radius breathes in and out according to a product of sinusoids — the visual ' +
      'signature of a spherical-harmonic mode, the natural vibration patterns of a sphere that show up ' +
      'everywhere from atomic orbitals to the cosmic microwave background. Tuning the lobe counts walks ' +
      'you through petals, sea-urchins, and bumpy little planets.',
    howItWorks:
      'For each (φ, θ) on the sphere, displace the radius by amp·sin(mφ)·sin(kθ). m sets how many lobes ' +
      'run around the equator, k how many run pole-to-pole; amplitude controls how far they bulge.',
    equations: [
      { label: 'modulated radius', latex: 'r(\\varphi,\\theta) = 1 + A\\,\\sin(m\\varphi)\\,\\sin(k\\theta)' },
      { label: 'on the sphere', latex: '(r\\sin\\theta\\cos\\varphi,\\; r\\cos\\theta,\\; r\\sin\\theta\\sin\\varphi)' },
    ],
    params: [
      { key: 'lobesU', symbol: 'm', meaning: 'lobes around the equator (longitude)' },
      { key: 'lobesV', symbol: 'k', meaning: 'lobes from pole to pole (latitude)' },
      { key: 'amp', symbol: 'A', meaning: 'how far the surface bulges in and out' },
    ],
    code: `const phi = a*2*Math.PI, theta = b*Math.PI, st = Math.sin(theta);
const r = 1 + amp*Math.sin(m*phi)*Math.sin(k*theta);
point(r*st*Math.cos(phi), r*Math.cos(theta), r*st*Math.sin(phi));`,
    links: [{ label: 'Spherical harmonics (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Spherical_harmonics' }],
  },
  "boy": {
    "title": "Boy's Surface",
    "about": "Boy's surface is what you get when you try to turn the real projective plane RP² — a sphere with antipodal points glued together — into a smooth shape in ordinary 3D space. Werner Boy discovered in 1901 that it can be done without any creases or pinch points, only gentle self-intersection, settling a question his advisor David Hilbert thought was impossible. The result is a strangely beautiful three-lobed form with perfect 3-fold symmetry, like a Klein bottle's more graceful cousin.",
    "howItWorks": "The whole surface is drawn from a single closed formula found by François Apéry in 1986. Two angles u and v, each running over [0, π], are fed through three rational-trigonometric expressions that share one common denominator. Because that denominator never reaches zero, every point lands at a finite place — the surface immerses cleanly, folding through itself three times to form the lobes. The bulge knob scales the denominator's oscillation, swelling or relaxing the lobes while keeping everything finite.",
    "equations": [
      {
        "label": "shared denominator",
        "latex": "D = 2 - \\beta\\sqrt{2}\\,\\sin(3u)\\sin(2v)"
      },
      {
        "label": "Apéry's immersion",
        "latex": "\\begin{aligned} x &= \\tfrac{1}{D}\\big(\\sqrt2\\cos 2u\\,\\cos^2 v + \\cos u\\,\\sin 2v\\big) \\\\ y &= \\tfrac{1}{D}\\big(\\sqrt2\\sin 2u\\,\\cos^2 v - \\sin u\\,\\sin 2v\\big) \\\\ z &= \\tfrac{3\\cos^2 v}{D} \\end{aligned}"
      },
      {
        "label": "domain",
        "latex": "u \\in [0,\\pi],\\quad v \\in [0,\\pi]"
      }
    ],
    "params": [
      {
        "key": "bulge",
        "symbol": "\\beta",
        "meaning": "scales the denominator's oscillation; 1 is the true Boy surface, lower values relax the lobes (kept ≤ 1 so the denominator stays positive)"
      }
    ],
    "code": "const u = a*Math.PI, v = b*Math.PI;            // a,b ∈ [0,1] grid\nconst cv2 = Math.cos(v)**2, s2v = Math.sin(2*v);\nconst D = 2 - bulge*Math.SQRT2*Math.sin(3*u)*s2v;\npoint(\n  (Math.SQRT2*Math.cos(2*u)*cv2 + Math.cos(u)*s2v)/D,\n  3*cv2/D - 1.5,                               // centred up axis\n  (Math.SQRT2*Math.sin(2*u)*cv2 - Math.sin(u)*s2v)/D,\n);",
    "links": [
      {
        "label": "Boy's surface (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Boy%27s_surface"
      },
      {
        "label": "Boy Surface (MathWorld)",
        "url": "https://mathworld.wolfram.com/BoySurface.html"
      },
      {
        "label": "Real projective plane (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Real_projective_plane"
      }
    ]
  },
  "roman": {
    "title": "Roman Surface",
    "about": "Discovered by Jakob Steiner in Rome in 1844, the Roman surface is one of the simplest ways to push the projective plane RP² into ordinary 3D space. It is the image of the unit sphere under the deceptively tiny quadratic map (x,y,z) → (yz, zx, xy), which folds every antipodal pair of sphere points onto the same point. The result is a rounded tetrahedral blob with three lines of self-intersection that cross at the centre and six pinch (Whitney) points at the tips.",
    "howItWorks": "Each grid cell (θ, φ) gives a point (a,b,c) on the unit sphere, and the three pairwise products bc, ca, ab become the output coordinates. Because the map is even in each pair of antipodal points, the sphere wraps twice and the surface intersects itself along the coordinate axes. The fold and pinch knobs scale the product terms, exaggerating the lobes and the central pinch.",
    "equations": [
      {
        "label": "unit sphere",
        "latex": "(a,b,c) = (\\sin\\theta\\cos\\varphi,\\; \\sin\\theta\\sin\\varphi,\\; \\cos\\theta)"
      },
      {
        "label": "Steiner map",
        "latex": "(x,y,z) = (b\\,c,\\; c\\,a,\\; a\\,b)"
      },
      {
        "label": "implicit form",
        "latex": "x^2y^2 + y^2z^2 + z^2x^2 = x\\,y\\,z"
      }
    ],
    "params": [
      {
        "key": "fold",
        "symbol": "f",
        "meaning": "scales the bc and ab lobes — stretches the surface in two of its three axes"
      },
      {
        "key": "pinch",
        "symbol": "p",
        "meaning": "scales the ca term — sharpens or softens the central self-intersection"
      }
    ],
    "code": "const theta = s*Math.PI, phi = t*2*Math.PI;   // s,t ∈ [0,1] grid\nconst a = Math.sin(theta)*Math.cos(phi);\nconst b = Math.sin(theta)*Math.sin(phi);\nconst c = Math.cos(theta);\npoint(b*c*fold, c*a*pinch, a*b*fold);",
    "links": [
      {
        "label": "Roman surface (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Roman_surface"
      },
      {
        "label": "Roman Surface (MathWorld)",
        "url": "https://mathworld.wolfram.com/RomanSurface.html"
      }
    ]
  },
  "hopf": {
    "title": "Hopf Fibration",
    "about": "The Hopf fibration is the most famous map in topology: it threads the 3-sphere S³ with a family of circles (fibers), one over each point of the ordinary 2-sphere, so that no two circles ever cross yet every pair is linked. Stereographically projected into ordinary space, those fibers become a nested family of interlocking Villarceau circles riding on tori — a structure that shows up in quantum spin states, magnetic monopoles, and twistor theory. Each glowing ring here is one fiber; rings from neighbouring base points clasp like links in chain mail.",
    "howItWorks": "A grid coordinate u selects the base latitude η on the 2-sphere (which torus you land on) together with a base azimuth φ₀, while v = ψ runs once around the fiber circle. From (η, ψ, φ₀) we build a point on S³ = {(q₁,q₂,q₃,q₄)} and then stereographically project from the q₄ = 1 pole down into R³. The latitude η is held inside [0.30, (π/2−0.30)·spread] so the projection denominator 1−q₄ never reaches zero and the largest torus stays bounded.",
    "equations": [
      {
        "label": "fiber on S³",
        "latex": "(q_1,q_2,q_3,q_4) = (\\cos\\eta\\,\\cos\\psi,\\; \\cos\\eta\\,\\sin\\psi,\\; \\sin\\eta\\,\\cos(\\psi+\\varphi_0),\\; \\sin\\eta\\,\\sin(\\psi+\\varphi_0))"
      },
      {
        "label": "stereographic projection",
        "latex": "(x,y,z) = \\frac{1}{1 - q_4}\\,(q_1,\\; q_2,\\; q_3)"
      },
      {
        "label": "Hopf map (base point on S²)",
        "latex": "(q_1,q_2,q_3,q_4)\\;\\longmapsto\\;\\big(2(q_1q_3+q_2q_4),\\; 2(q_2q_3-q_1q_4),\\; q_1^2+q_2^2-q_3^2-q_4^2\\big)"
      }
    ],
    "params": [
      {
        "key": "tori",
        "symbol": "N",
        "meaning": "how many nested tori (discrete latitude bands η) are drawn; each is swept over its full base azimuth and fiber"
      },
      {
        "key": "spread",
        "symbol": "s",
        "meaning": "scales the largest latitude ηₘₐₓ = (π/2−0.15)·s; near 1 the outermost torus swells (and the projection grows), smaller s tightens the nest"
      }
    ],
    "code": "const NB = Math.round(tori);\nconst aa = a*NB, bi = Math.min(NB-1, Math.floor(aa)), phi0 = (aa-bi)*2*Math.PI;\nconst eta = 0.18 + ((bi+0.5)/NB) * ((Math.PI/2-0.15)*spread - 0.18);\nconst psi = b * 2*Math.PI;\nconst ce = Math.cos(eta), se = Math.sin(eta);\nconst q1 = ce*Math.cos(psi),  q2 = ce*Math.sin(psi);\nconst q3 = se*Math.cos(psi+phi0), q4 = se*Math.sin(psi+phi0);\nconst d = 1 - q4;                 // q4 < 1 always => d > 0\npoint(q1/d, q2/d, q3/d);         // stereographic projection from the q4=1 pole",
    "links": [
      {
        "label": "Hopf fibration (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Hopf_fibration"
      },
      {
        "label": "Villarceau circles (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Villarceau_circles"
      },
      {
        "label": "Hopf fibration (Wolfram MathWorld)",
        "url": "https://mathworld.wolfram.com/HopfMap.html"
      }
    ]
  },
  "orbital": {
    "title": "Spherical Harmonic",
    "about": "Spherical harmonics Y_lm are the natural vibration patterns of a sphere — the angular shapes behind atomic orbitals, planetary gravity fields, and the cosmic microwave background. Here the radius at each direction is set to the magnitude of the harmonic, |Y_lm|, so the surface swells out into the harmonic's lobes: l=1 a dumbbell, l=3 a stack of rings, l=4 a flower of petals. Two integers tune it — the degree l counts how busy the pattern is, the order m how those nodes wrap around the equator versus the poles.",
    "howItWorks": "For each direction (theta from a pole, phi around the equator) we evaluate the real spherical harmonic Y_lm using a hardcoded associated Legendre polynomial P_l^|m|(cos theta) times a cos(m·phi) or sin(|m|·phi) wave, with the standard normalization. The radius is r = |Y_lm| + base, where the small base radius fills in the nodal zeros so the shell stays closed instead of pinching to a point. m is clamped to the valid range [-l, l]; positive m uses the cosine wave, negative m the sine.",
    "equations": [
      {
        "label": "real spherical harmonic",
        "latex": "Y_{lm}(\\theta,\\varphi) = K_{lm}\\,P_l^{|m|}(\\cos\\theta)\\begin{cases}\\cos(m\\varphi) & m\\ge 0\\\\ \\sin(|m|\\varphi) & m<0\\end{cases}"
      },
      {
        "label": "normalization",
        "latex": "K_{lm} = \\sqrt{\\tfrac{2l+1}{4\\pi}\\,\\tfrac{(l-|m|)!}{(l+|m|)!}}\\;\\big(m=0\\,?\\,1:\\sqrt2\\big)"
      },
      {
        "label": "radius as orbital",
        "latex": "r(\\theta,\\varphi) = \\big|Y_{lm}(\\theta,\\varphi)\\big| + r_0"
      },
      {
        "label": "surface point",
        "latex": "\\big(r\\sin\\theta\\cos\\varphi,\\; r\\cos\\theta,\\; r\\sin\\theta\\sin\\varphi\\big)"
      },
      {
        "label": "example P_lm (l=3)",
        "latex": "P_3^0 = \\tfrac12 x(5x^2-3),\\quad P_3^3 = -15(1-x^2)^{3/2},\\quad x=\\cos\\theta"
      }
    ],
    "params": [
      {
        "key": "l",
        "symbol": "l",
        "meaning": "degree (1..4): how many lobes/rings — higher l is busier (l=3 stacked lobes, l=4 flower)"
      },
      {
        "key": "m",
        "symbol": "m",
        "meaning": "order, clamped to [-l, l]: |m| sets equatorial nodes; sign picks the cos(mφ) vs sin(|m|φ) pattern"
      },
      {
        "key": "base",
        "symbol": "r_0",
        "meaning": "base radius added at the harmonic's zeros so the shell stays closed instead of pinching"
      }
    ],
    "code": "// real Y_lm magnitude as radius; P_lm hardcoded for l=1..4\nconst phi = a*2*Math.PI, theta = b*Math.PI, x = Math.cos(theta), s = Math.sqrt(1 - x*x);\nconst am = Math.abs(m);\nlet P; // associated Legendre P_l^|m|(x)\nif (l === 3) P = am===0 ? 0.5*x*(5*x*x-3) : am===3 ? -15*s*(1-x*x) : /* ... */ 0;\nlet ratio = 1; for (let k = l-am+1; k <= l+am; k++) ratio /= k;\nconst K = Math.sqrt((2*l+1)/(4*Math.PI)*ratio) * (m===0 ? 1 : Math.SQRT2);\nconst ang = m>0 ? Math.cos(m*phi) : m<0 ? Math.sin(am*phi) : 1;\nconst r = Math.abs(K*P*ang) + base;\npoint(r*s*Math.cos(phi), r*x, r*s*Math.sin(phi));",
    "links": [
      {
        "label": "Spherical harmonics (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Spherical_harmonics"
      },
      {
        "label": "Associated Legendre polynomials (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Associated_Legendre_polynomials"
      },
      {
        "label": "Table of spherical harmonics (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Table_of_spherical_harmonics"
      },
      {
        "label": "Spherical Harmonic (MathWorld)",
        "url": "https://mathworld.wolfram.com/SphericalHarmonic.html"
      }
    ]
  },
  "maurerRose": {
    "title": "Maurer Rose",
    "about": "In 1987 Peter Maurer noticed that if you take an ordinary rose curve r = sin(nθ) but only visit it at evenly spaced angular stops — every d degrees — and connect those stops with straight lines, the long chords leap across the flower and weave a startling lace-like web. The same petals appear, now overlaid with a geometric net that changes character completely with each integer choice of n and d. It is one equation, two whole numbers, and a polyline — yet it looks like cut crystal.",
    "howItWorks": "Walk an index k from 0 to 360. At each step the angle is θ = k·d degrees, and the point sits on the rose at radius sin(nθ). Successive points are joined by straight chords rather than following the smooth curve, so when d does not divide 360 evenly the path skips around the flower, layering chord over chord into the web. A small vertical lift turns the flat lace into a gently rippled 3D sheet, which is then swept into a thin glowing tube.",
    "equations": [
      {
        "label": "rose radius",
        "latex": "r(\\theta) = \\sin(n\\,\\theta)"
      },
      {
        "label": "sample angles (degrees)",
        "latex": "\\theta_k = k\\,d\\cdot\\tfrac{\\pi}{180}, \\quad k = 0,1,\\dots,360"
      },
      {
        "label": "vertex k",
        "latex": "\\big(r(\\theta_k)\\cos\\theta_k,\\; \\ell\\sin\\tfrac{n\\theta_k}{2},\\; r(\\theta_k)\\sin\\theta_k\\big)"
      },
      {
        "label": "edges (chords)",
        "latex": "P_k \\to P_{k+1}\\ \\text{straight segments form the web}"
      }
    ],
    "params": [
      {
        "key": "petals",
        "symbol": "n",
        "meaning": "rose frequency — gives n petals when n is odd, 2n petals when n is even"
      },
      {
        "key": "d",
        "symbol": "d",
        "meaning": "angular step in degrees between successive sample points; the engine of the web — coprimality with 360 sets how densely the chords interlace"
      },
      {
        "key": "lift",
        "symbol": "\\ell",
        "meaning": "vertical displacement that lifts the flat lace into a rippled 3D sheet (0 = flat)"
      },
      {
        "key": "tube",
        "symbol": "\\rho",
        "meaning": "radius of the glowing tube swept along the polyline"
      }
    ],
    "code": "const DEG = Math.PI/180;\nfunction vert(k, n, d, lift) {\n  const th = k * d * DEG;\n  const r = Math.sin(n * th);\n  return [r*Math.cos(th), lift*Math.sin(n*th*0.5), r*Math.sin(th)];\n}\n// polyline: connect vert(0..360) with straight chords, then sweep a tube\nfor (let k = 0; k < 360; k++) drawChord(vert(k,n,d,lift), vert(k+1,n,d,lift));",
    "links": [
      {
        "label": "Maurer rose (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Maurer_rose"
      },
      {
        "label": "Rose / rhodonea curve (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Rose_(mathematics)"
      },
      {
        "label": "Rose curve (MathWorld)",
        "url": "https://mathworld.wolfram.com/Rose.html"
      }
    ]
  },
  "enneper": {
    "title": "Enneper Surface",
    "about": "One of the oldest known minimal surfaces, written down by Alfred Enneper in 1864 — a soap-film shape that locally minimises area, yet is defined by nothing more than cubic polynomials. As you widen its domain it curls back and passes through itself, weaving a six-petalled saddle with a striking three-fold symmetry. It is the textbook example of a minimal surface that is complete but not embedded: beautiful, self-intersecting, and entirely free of trigonometry.",
    "howItWorks": "Two grid coordinates u and v range over a square. Each maps to a point by three short polynomials — x and y mix a cubic with a cross term, while z is the difference of squares u²−v² that gives the saddle. Because everything is polynomial there are no divisions or logarithms to blow up: every sample is finite. Push 'extent' past about 1.4 and the surface begins to overlap itself, opening the classic folded look.",
    "equations": [
      {
        "label": "Enneper surface",
        "latex": "\\begin{aligned} x &= u - \\tfrac{u^3}{3} + u v^2 \\\\ y &= v - \\tfrac{v^3}{3} + v u^2 \\\\ z &= u^2 - v^2 \\end{aligned}"
      },
      {
        "label": "minimal (zero mean curvature)",
        "latex": "H = \\tfrac{1}{2}(\\kappa_1 + \\kappa_2) = 0"
      },
      {
        "label": "Weierstrass data",
        "latex": "f = 1,\\quad g = w,\\quad \\mathbf{r}(w) = \\operatorname{Re}\\!\\int \\big(1-g^2,\\; i(1+g^2),\\; 2g\\big)\\,f\\,dw"
      }
    ],
    "params": [
      {
        "key": "extent",
        "symbol": "A",
        "meaning": "half-width of the (u,v) domain; below ~1.4 it stays embedded, above it the surface folds through itself"
      },
      {
        "key": "fold",
        "symbol": "\\lambda",
        "meaning": "weights the u v² and v u² cross terms — 1 is the true minimal surface, lower flattens the folds"
      }
    ],
    "code": "const u = (a*2 - 1)*extent, v = (b*2 - 1)*extent;   // a,b ∈ [0,1] grid\nconst u2 = u*u, v2 = v*v;\npoint(u - u2*u/3 + fold*u*v2,\n      v - v2*v/3 + fold*v*u2,\n      u2 - v2);",
    "links": [
      {
        "label": "Enneper surface (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Enneper_surface"
      },
      {
        "label": "Enneper's Minimal Surface (MathWorld)",
        "url": "https://mathworld.wolfram.com/EnnepersMinimalSurface.html"
      },
      {
        "label": "Minimal surface (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Minimal_surface"
      }
    ]
  },
  "breather": {
    "title": "Breather Surface",
    "about": "A breather is a soliton that stays put and pulses — it oscillates in place rather than travelling. This surface is its geometric incarnation: the pseudospherical (constant negative curvature) surface corresponding to a breather solution of the sine-Gordon equation. A single parameter aa, between 0 and 1, sets the width of the localized bulge, and the surface ripples out into symmetric wave-like lobes that fade smoothly to a flat sheet far from the centre.",
    "howItWorks": "Two coordinates u and v sweep a grid. With w = sqrt(1 - aa^2), every point is a ratio of hyperbolic functions of aa*u (which localize the feature) and trigonometric functions of v and w*v (which set the oscillation). The shared denominator aa*((w cosh(aa u))^2 + (aa sin(w v))^2) is bounded below by aa*w^2 > 0 over the whole domain, so the surface is everywhere smooth and finite — no spikes to clip. The x-coordinate carries a -u term that shears the lobes along the axis.",
    "equations": [
      {
        "label": "width parameter",
        "latex": "w = \\sqrt{1 - a^2}, \\qquad 0 < a < 1"
      },
      {
        "label": "denominator (always positive)",
        "latex": "D = a\\big( (w\\cosh a u)^2 + (a\\sin w v)^2 \\big)"
      },
      {
        "label": "x",
        "latex": "x = -u + \\frac{2(1 - a^2)\\,\\cosh(a u)\\,\\sinh(a u)}{D}"
      },
      {
        "label": "y",
        "latex": "y = \\frac{2w\\cosh(a u)\\,\\big(-w\\cos v\\cos w v - \\sin v\\sin w v\\big)}{D}"
      },
      {
        "label": "z",
        "latex": "z = \\frac{2w\\cosh(a u)\\,\\big(-w\\sin v\\cos w v + \\cos v\\sin w v\\big)}{D}"
      }
    ],
    "params": [
      {
        "key": "aa",
        "symbol": "a",
        "meaning": "soliton width parameter in (0,1); smaller a stretches the breather wider and taller, larger a tightens it"
      },
      {
        "key": "extent",
        "symbol": "L",
        "meaning": "half-width of the sampled (u,v) square; larger values reveal more of the surrounding lobes"
      }
    ],
    "code": "const aa = 0.4, w = Math.sqrt(1 - aa*aa);\nconst u = (a*2 - 1)*L, v = (b*2 - 1)*L;   // a,b in [0,1] grid\nconst ch = Math.cosh(aa*u), sh = Math.sinh(aa*u);\nconst swv = Math.sin(w*v), cwv = Math.cos(w*v), sv = Math.sin(v), cv = Math.cos(v);\nconst D = aa*((w*ch)**2 + (aa*swv)**2);\npoint(\n  -u + 2*(1 - aa*aa)*ch*sh / D,\n  2*w*ch*(-w*cv*cwv - sv*swv) / D,\n  2*w*ch*(-w*sv*cwv + cv*swv) / D);",
    "links": [
      {
        "label": "Breather (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Breather"
      },
      {
        "label": "Breather surface (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Breather_surface"
      },
      {
        "label": "Sine-Gordon equation (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Sine-Gordon_equation"
      },
      {
        "label": "Breather surface (MathWorld)",
        "url": "https://mathworld.wolfram.com/BreatherSurface.html"
      }
    ]
  },
  "kuen": {
    "title": "Kuen Surface",
    "about": "Kuen's surface is one of the most beautiful surfaces of constant negative curvature: at every point it curves like a saddle by exactly the same amount (Gaussian curvature K = -1), yet it folds into elegant overlapping petals rather than an infinite trumpet. It is a Backlund transform of the pseudosphere, sharing its hyperbolic geometry while wrapping it into a compact, flower-like shell. Like all such surfaces it cannot be embedded smoothly without an edge, so the petals meet along sharp cuspidal seams.",
    "howItWorks": "A parameter u sweeps around the surface, generating the curling petals through the terms cos u + u sin u and sin u - u cos u, while v runs from the flared outer lobes down toward a logarithmic cusp. The shared denominator 1 + u² sin² v is what pins the curvature to exactly -1 everywhere; the height adds a ln(tan(v/2)) term, the same tractrix-style profile seen in the pseudosphere. The reach knob extends how far u winds (more petals); the funnel knob sets where v starts, trading lobe flare against cusp depth.",
    "equations": [
      {
        "label": "common denominator",
        "latex": "D = 1 + u^2\\sin^2 v"
      },
      {
        "label": "Kuen surface",
        "latex": "\\begin{aligned} x &= \\frac{2(\\cos u + u\\sin u)\\sin v}{D}, \\quad y = \\frac{2(\\sin u - u\\cos u)\\sin v}{D} \\\\ z &= \\ln\\tan\\tfrac{v}{2} + \\frac{2\\cos v}{D} \\end{aligned}"
      },
      {
        "label": "constant curvature",
        "latex": "K = -1 \\quad \\text{(everywhere)}"
      }
    ],
    "params": [
      {
        "key": "reach",
        "symbol": "A",
        "meaning": "extent of u ∈ [-A, A]; larger A winds in more overlapping petals"
      },
      {
        "key": "funnel",
        "symbol": "v_0",
        "meaning": "lower bound of v; smaller values deepen the central cusp, larger flare the lobes"
      }
    ],
    "code": "const u = (a*2 - 1)*reach, v = funnel + b*(2.1 - funnel); // a,b ∈ [0,1] grid\nconst sv = Math.sin(v), D = 1 + u*u*sv*sv;\nconst lg = Math.log(Math.tan(v/2));\npoint(2*(Math.cos(u)+u*Math.sin(u))*sv/D,\n      2*(Math.sin(u)-u*Math.cos(u))*sv/D,\n      lg + 2*Math.cos(v)/D);",
    "links": [
      {
        "label": "Kuen surface (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Kuen_surface"
      },
      {
        "label": "Kuen's Surface (MathWorld)",
        "url": "https://mathworld.wolfram.com/KuensSurface.html"
      }
    ]
  },
  "catenoidHelicoid": {
    "title": "Catenoid ↔ Helicoid",
    "about": "The catenoid (the soap film between two rings) and the helicoid (the surface of a spiral ramp) look nothing alike, yet they are secretly the same surface bent without any stretching. They are two members of a continuous 'associate family' of minimal surfaces, and you can morph one smoothly into the other while every patch keeps its exact shape and area — a true isometry, like rolling a sheet of paper into a tube. At every frozen stage in between, the surface is still a minimal (zero-mean-curvature) soap film of its own.",
    "howItWorks": "A single morph angle t interpolates between the two surfaces: at t=0 the formula is the helicoid, at t=π/2 it is the catenoid, and in between cos t and sin t blend the helicoid and catenoid parametrizations of the same (u,v) patch. Because the blend is an isometry, no point ever has to stretch — the grid just rolls and unrolls. The grid coordinate u sweeps once around (here over [-π,π] so the surface sits centred on the origin) and v climbs the height of the tube; both sinh and cosh are smooth everywhere, so every sampled point is finite.",
    "equations": [
      {
        "label": "associate-family morph",
        "latex": "\\begin{aligned} x &= \\cos t\\,\\sinh v\\,\\sin u + \\sin t\\,\\cosh v\\,\\cos u \\\\ y &= -\\cos t\\,\\sinh v\\,\\cos u + \\sin t\\,\\cosh v\\,\\sin u \\\\ z &= u\\cos t + v\\sin t \\end{aligned}"
      },
      {
        "label": "endpoints",
        "latex": "t = 0 \\Rightarrow \\text{helicoid}, \\qquad t = \\tfrac{\\pi}{2} \\Rightarrow \\text{catenoid}"
      },
      {
        "label": "minimal at every t",
        "latex": "H = \\tfrac{1}{2}(\\kappa_1 + \\kappa_2) = 0"
      }
    ],
    "params": [
      {
        "key": "morph",
        "symbol": "t",
        "meaning": "bend angle in [0, π/2]; 0 is the helicoid (spiral ramp), π/2 is the catenoid (soap-film neck), values between are the isometric in-betweens"
      },
      {
        "key": "span",
        "symbol": "A",
        "meaning": "vertical half-extent of the v domain [-A, A]; larger values flare the catenoid mouth wider (cosh grows) and extend the helicoid blade"
      }
    ],
    "code": "const u = a*2*Math.PI - Math.PI, v = (b*2 - 1)*span;  // a,b ∈ [0,1] grid\nconst ct = Math.cos(t), st = Math.sin(t);\nconst shv = Math.sinh(v), chv = Math.cosh(v);\npoint(\n  ct*shv*Math.sin(u) + st*chv*Math.cos(u),\n  -ct*shv*Math.cos(u) + st*chv*Math.sin(u),\n  u*ct + v*st);",
    "links": [
      {
        "label": "Catenoid (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Catenoid"
      },
      {
        "label": "Helicoid (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Helicoid"
      },
      {
        "label": "Minimal surface / associate family (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Minimal_surface"
      },
      {
        "label": "Catenoid (MathWorld)",
        "url": "https://mathworld.wolfram.com/Catenoid.html"
      }
    ]
  },
  "catalan": {
    "title": "Catalan's Surface",
    "about": "Catalan's surface is a classical minimal surface — a shape that, like a soap film, locally minimises its area — discovered by Eugene Catalan in 1855. Its claim to fame is geometric poetry: it is the only minimal surface that contains an ordinary cycloid (the arch traced by a point on a rolling wheel) as a geodesic, running right down its spine. Sweep that arched profile outward with hyperbolic functions and the film flares into broad, gently rippled wings on either side of the cycloid.",
    "howItWorks": "Two coordinates sweep a grid. Parameter u runs along the cycloid arches; at the centre slice v=0 the formula collapses exactly to the cycloid (u - sin u, 1 - cos u, 0). Parameter v then flares the surface away from that geodesic through cosh(v) and sinh(v/2), which widen the wings without ever blowing up — both are entire functions, so every sample is finite. The raw surface marches off along the x-axis and floats at height y=1, so a fixed offset slides it back onto the origin. The 'arches' knob sets how many cycloid arches are drawn; 'extent' controls how far the wings flare.",
    "equations": [
      {
        "label": "Catalan's surface",
        "latex": "\\begin{aligned} x &= u - \\sin u\\,\\cosh v \\\\ y &= 1 - \\cos u\\,\\cosh v \\\\ z &= 4\\,\\sin\\tfrac{u}{2}\\,\\sinh\\tfrac{v}{2} \\end{aligned}"
      },
      {
        "label": "cycloid geodesic (v=0)",
        "latex": "(x,y,z)\\big|_{v=0} = (u - \\sin u,\\; 1 - \\cos u,\\; 0)"
      },
      {
        "label": "minimal (zero mean curvature)",
        "latex": "H = \\tfrac{1}{2}(\\kappa_1 + \\kappa_2) = 0"
      }
    ],
    "params": [
      {
        "key": "arches",
        "symbol": "k",
        "meaning": "number of cycloid arches drawn; u ranges over [0, k\\pi] (default 4 = two full arches)"
      },
      {
        "key": "extent",
        "symbol": "A",
        "meaning": "half-range of v ∈ [-A, A]; larger values flare the hyperbolic wings wider and taller"
      }
    ],
    "code": "const u = a*arches*Math.PI, v = (b*2 - 1)*extent;   // a,b ∈ [0,1] grid\nconst ch = Math.cosh(v), sh2 = Math.sinh(v/2);\nconst uMax = arches*Math.PI;\npoint(u - Math.sin(u)*ch - uMax/2,   // centred along the cycloid\n      1 - Math.cos(u)*ch - 1,        // centred up axis\n      4*Math.sin(u/2)*sh2);",
    "links": [
      {
        "label": "Catalan's minimal surface (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Catalan_minimal_surface"
      },
      {
        "label": "Catalan's Surface (MathWorld)",
        "url": "https://mathworld.wolfram.com/CatalansSurface.html"
      },
      {
        "label": "Minimal surface (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Minimal_surface"
      },
      {
        "label": "Cycloid (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Cycloid"
      }
    ]
  },
  "henneberg": {
    "title": "Henneberg's Surface",
    "about": "Henneberg's surface, found by Lebrecht Henneberg in 1875, is the first known non-orientable minimal surface — a soap-film shape that locally minimises area yet, like a Möbius band, has only one side. Hidden inside it is a Neil semicubical parabola, the cuspidal curve y²=x³, which the surface contains as a geodesic. Built entirely from hyperbolic and trigonometric functions, it folds into a richly self-intersecting six-fold form that has no boundary and no consistent notion of 'outward'.",
    "howItWorks": "Two grid coordinates u and v sweep the surface. The x and y coordinates blend sinh(u) with sinh(3u) against cos/sin of v and 3v, while the height z = 2 cosh(2u) cos(2v) gives the saddle. Because sinh(3u) grows explosively, u is held inside a tight window [-reach, reach] with reach ≤ 0.9 — every term is then a finite hyperbolic/trig value, so no point can blow up. The symmetric u-range makes the whole shape sit centred on the origin. The 'flatten' knob weights the fast sinh(3u) cubic term, relaxing the outer folds toward a plain saddle at 0.",
    "equations": [
      {
        "label": "Henneberg's surface",
        "latex": "\\begin{aligned} x &= 2\\sinh u\\cos v - \\tfrac{2}{3}\\sinh 3u\\,\\cos 3v \\\\ y &= 2\\sinh u\\sin v + \\tfrac{2}{3}\\sinh 3u\\,\\sin 3v \\\\ z &= 2\\cosh 2u\\,\\cos 2v \\end{aligned}"
      },
      {
        "label": "minimal (zero mean curvature)",
        "latex": "H = \\tfrac{1}{2}(\\kappa_1 + \\kappa_2) = 0"
      },
      {
        "label": "contains a Neil parabola (v=0)",
        "latex": "y^2 = x^3 \\quad\\text{(semicubical cusp)}"
      },
      {
        "label": "domain",
        "latex": "u \\in [-A,\\,A],\\ A \\le 0.9,\\quad v \\in [0,\\pi]"
      }
    ],
    "params": [
      {
        "key": "reach",
        "symbol": "A",
        "meaning": "half-width of u ∈ [-A, A]; kept ≤ 0.9 so sinh(3u) stays bounded — larger A reveals more of the self-intersecting folds"
      },
      {
        "key": "flatten",
        "symbol": "f",
        "meaning": "weights the fast (2/3)sinh(3u) cubic term; 1 is the true Henneberg surface, 0 collapses it toward a plain cosh saddle"
      }
    ],
    "code": "const u = (a*2 - 1)*reach, v = b*Math.PI;     // a,b ∈ [0,1] grid, reach ≤ 0.9\nconst su = Math.sinh(u), s3u = Math.sinh(3*u), c2u = Math.cosh(2*u);\nconst k = flatten*(2/3);\npoint(\n  2*su*Math.cos(v) - k*s3u*Math.cos(3*v),\n  2*su*Math.sin(v) + k*s3u*Math.sin(3*v),\n  2*c2u*Math.cos(2*v));",
    "links": [
      {
        "label": "Henneberg surface (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Henneberg_surface"
      },
      {
        "label": "Henneberg's Minimal Surface (MathWorld)",
        "url": "https://mathworld.wolfram.com/HennebergsMinimalSurface.html"
      },
      {
        "label": "Minimal surface (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Minimal_surface"
      }
    ]
  },
  "scherk": {
    "title": "Scherk's Surface",
    "about": "In 1834 Heinrich Scherk found the first new minimal surfaces since Euler and Meusnier — soap-film shapes defined by the strikingly simple equation z = ln(cos x) − ln(cos y). His 'first surface' is doubly periodic: it tiles the plane into a checkerboard of square holes, and at each crossing four saddle-shaped sheets rise and fall to weave together into the classic 'saddle tower'. Because cos hits zero at the cell edges the surface shoots off to infinity there, so what you see is a bounded window cut just short of those walls.",
    "howItWorks": "A flat (u,v) grid is stretched across a few fundamental cells of width π each. Inside every cell the x and y coordinates are folded back to the interval (−π/2, π/2) and clamped a small margin short of the ±π/2 asymptotes, where ln(cos) would diverge. The height is then simply ln|cos x| − ln|cos y|: where cos x is small the surface climbs, where cos y is small it dives, and the two competing logarithms knit the saddle towers. The 'cells' knob tiles more towers; the 'tower clamp' margin trades how tall (and how close to the true asymptote) the towers grow.",
    "equations": [
      {
        "label": "Scherk's first surface",
        "latex": "z = \\ln(\\cos x) - \\ln(\\cos y) = \\ln\\!\\frac{\\cos x}{\\cos y}"
      },
      {
        "label": "fundamental domain",
        "latex": "x,\\,y \\in \\left(-\\tfrac{\\pi}{2}+\\varepsilon,\\; \\tfrac{\\pi}{2}-\\varepsilon\\right)\\ (\\text{mod }\\pi)"
      },
      {
        "label": "minimal (zero mean curvature)",
        "latex": "H = \\tfrac{1}{2}(\\kappa_1 + \\kappa_2) = 0"
      }
    ],
    "params": [
      {
        "key": "cells",
        "symbol": "N",
        "meaning": "how many fundamental cells (each of width π) are tiled per axis — more cells weave more saddle towers"
      },
      {
        "key": "margin",
        "symbol": "\\varepsilon",
        "meaning": "gap held back from the ±π/2 asymptotes where ln(cos)→−∞; smaller ε lets the towers grow taller, larger ε flattens them"
      }
    ],
    "code": "const HALF = Math.PI/2, span = cells*Math.PI;\nconst x = (a - 0.5)*span, y = (b - 0.5)*span;   // a,b ∈ [0,1] grid\nconst lim = HALF - margin;\nfunction fold(t){ let l = t % Math.PI;\n  if (l >  HALF) l -= Math.PI;\n  if (l < -HALF) l += Math.PI;\n  return Math.max(-lim, Math.min(lim, l)); }   // clamp off the asymptotes\nconst cx = Math.abs(Math.cos(fold(x))), cy = Math.abs(Math.cos(fold(y)));\npoint(x, Math.log(cx) - Math.log(cy), y);        // z = up",
    "links": [
      {
        "label": "Scherk surface (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Scherk_surface"
      },
      {
        "label": "Scherk's Minimal Surfaces (MathWorld)",
        "url": "https://mathworld.wolfram.com/ScherksMinimalSurfaces.html"
      },
      {
        "label": "Minimal surface (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Minimal_surface"
      }
    ]
  },
  "astroidalEllipsoid": {
    "title": "Astroidal Ellipsoid",
    "about": "The astroidal ellipsoid is a star-shaped solid built from the astroid — the four-cusped curve traced by a point on a small circle rolling inside one four times its size. Forming the spherical product of two such curves sweeps an eight-pointed star body whose faces all curve inward toward sharp cusps, like an inflated octahedron pinched along every axis. It is the cube of the ordinary ellipsoid parametrization: replacing each coordinate with its signed cube pulls the rounded sphere into pointed, concave lobes.",
    "howItWorks": "Two angles drive a grid: u sweeps the equator while v runs pole to pole. The ordinary ellipsoid point (cos u cos v, sin v, sin u cos v) is taken and each coordinate is raised to an odd power (3 by default) while keeping its sign — the signed power |s|^k·sign(s). Cubing a value in [-1,1] shrinks the mid-range hard while leaving the extremes at ±1, so the smooth sphere collapses inward into cusped star points. Everything is a power of a bounded sine or cosine, so no division or logarithm can blow up.",
    "equations": [
      {
        "label": "astroidal ellipsoid",
        "latex": "\\begin{aligned} x &= (\\cos u\\,\\cos v)^3 \\\\ y &= (\\sin v)^3 \\\\ z &= (\\sin u\\,\\cos v)^3 \\end{aligned}"
      },
      {
        "label": "domain",
        "latex": "u \\in [0, 2\\pi],\\quad v \\in [-\\tfrac{\\pi}{2}, \\tfrac{\\pi}{2}]"
      },
      {
        "label": "signed power (cusp sharpness k)",
        "latex": "s^{(k)} = \\operatorname{sgn}(s)\\,|s|^{k}"
      },
      {
        "label": "implicit form",
        "latex": "x^{2/3} + y^{2/3} + z^{2/3} = 1"
      }
    ],
    "params": [
      {
        "key": "sharp",
        "symbol": "k",
        "meaning": "exponent on each signed factor; k=3 is the classic astroidal ellipsoid, higher k sharpens the cusps and deepens the concave faces, k=1 is a plain octahedral sphere"
      },
      {
        "key": "stretch",
        "symbol": "\\sigma",
        "meaning": "scales the z (up) axis, stretching the star body into a prolate spindle or squashing it toward an oblate disk"
      }
    ],
    "code": "const u = a*2*Math.PI, v = (b - 0.5)*Math.PI;   // a,b ∈ [0,1] grid\nconst sp = s => Math.sign(s)*Math.pow(Math.abs(s), sharp); // signed power\npoint(\n  sp(Math.cos(u)*Math.cos(v)),\n  sp(Math.sin(v))*stretch,\n  sp(Math.sin(u)*Math.cos(v)),\n);",
    "links": [
      {
        "label": "Astroidal ellipsoid (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Astroidal_ellipsoid"
      },
      {
        "label": "Astroid (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Astroid"
      },
      {
        "label": "Astroidal Ellipsoid (MathWorld)",
        "url": "https://mathworld.wolfram.com/AstroidalEllipsoid.html"
      }
    ]
  },
  "superToroid": {
    "title": "Super Toroid",
    "about": "The super-toroid is the torus crossed with the superellipse: a superelliptical cross-section swept around a superelliptical ring. Two squareness exponents let it morph continuously from a smooth doughnut, through a rounded square-tube ring, all the way to a sharp box-section frame. It is the toroidal member of the superquadric family that 3D modellers and CAD systems use to round and bevel boxes, and it scans through an entire catalogue of pillowy and angular ring shapes from just four numbers.",
    "howItWorks": "Two angles parametrize the surface: u runs around the ring, v around the tube. Instead of plain cos/sin, each is passed through the signed power sgnpow(t,e)=sign(t)·|t|^e, which is the superellipse trick. The exponent e1 squashes or pinches the tube's cross-section, e2 does the same to the ring's outline; at e1=e2=1 the formula collapses exactly to the ordinary torus. Taking the absolute value before raising to the power and restoring the sign afterwards avoids the NaN you would get from a negative base raised to a fractional exponent.",
    "equations": [
      {
        "label": "signed power",
        "latex": "\\operatorname{sgnpow}(t,e) = \\operatorname{sign}(t)\\,|t|^{e}"
      },
      {
        "label": "super-toroid",
        "latex": "\\begin{aligned} x &= \\big(R + r\\,\\operatorname{sgnpow}(\\cos v, e_1)\\big)\\,\\operatorname{sgnpow}(\\cos u, e_2) \\\\ y &= r\\,\\operatorname{sgnpow}(\\sin v, e_1) \\\\ z &= \\big(R + r\\,\\operatorname{sgnpow}(\\cos v, e_1)\\big)\\,\\operatorname{sgnpow}(\\sin u, e_2) \\end{aligned}"
      },
      {
        "label": "domain",
        "latex": "u \\in [-\\pi,\\pi],\\quad v \\in [-\\pi,\\pi]"
      }
    ],
    "params": [
      {
        "key": "R",
        "symbol": "R",
        "meaning": "ring radius — distance from the centre to the middle of the tube"
      },
      {
        "key": "r",
        "symbol": "r",
        "meaning": "tube radius; r→R gives a horn super-toroid, r>R a self-intersecting spindle"
      },
      {
        "key": "e1",
        "symbol": "e_1",
        "meaning": "squareness of the tube cross-section: 1 = circle, <1 = squarer (boxy tube), >1 = pinched/star"
      },
      {
        "key": "e2",
        "symbol": "e_2",
        "meaning": "squareness of the ring outline: 1 = round ring, <1 = squared frame, >1 = pinched diamond"
      }
    ],
    "code": "function sgnpow(t, e) {                          // signed power, NaN-safe\n  const a = Math.abs(t);\n  return a < 1e-12 ? 0 : (t < 0 ? -1 : 1) * Math.pow(a, e);\n}\nconst u = a*2*Math.PI - Math.PI, v = b*2*Math.PI - Math.PI; // a,b ∈ [0,1] grid\nconst cv = sgnpow(Math.cos(v), e1), sv = sgnpow(Math.sin(v), e1);\nconst cu = sgnpow(Math.cos(u), e2), su = sgnpow(Math.sin(u), e2);\nconst w = R + r*cv;\npoint(w*cu, r*sv, w*su);",
    "links": [
      {
        "label": "Superellipsoid / superquadrics (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Superellipsoid"
      },
      {
        "label": "Superquadrics (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Superquadrics"
      },
      {
        "label": "Torus (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Torus"
      },
      {
        "label": "Superellipse (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Superellipse"
      }
    ]
  },
  "toroidalSpiral": {
    "title": "Toroidal Spiral",
    "about": "Take a tight helix — a slinky — and bend it around into a closed loop so its two ends meet: you get a toroidal spiral, a coil that winds p times around a doughnut-shaped ring. It is the playful cousin of the torus knot, but where a knot threads through the hole, this curve simply spirals around the tube of the torus and closes after a single trip. The result is a glowing wire-wound ring, like the windings of a toroidal inductor or a coiled spring snapped into a circle.",
    "howItWorks": "A single angle t runs once around the big ring. As it goes, the point also spirals around the tube at p times the speed, tracing a small circle of radius r whose centre sits on a ring of radius R. That centreline is then thickened into a solid tube by sweeping a tiny circle along it, oriented by the curve's analytic tangent so the tube never kinks.",
    "equations": [
      {
        "label": "centreline",
        "latex": "\\mathbf{C}(t) = \\big((R + r\\cos pt)\\cos t,\\; r\\sin pt,\\; (R + r\\cos pt)\\sin t\\big)"
      },
      {
        "label": "tangent (analytic)",
        "latex": "\\mathbf{C}'(t) = \\big(\\dot w\\cos t - w\\sin t,\\; rp\\cos pt,\\; \\dot w\\sin t + w\\cos t\\big),\\quad w = R + r\\cos pt,\\ \\dot w = -rp\\sin pt"
      },
      {
        "label": "domain",
        "latex": "t \\in [0, 2\\pi]"
      }
    ],
    "params": [
      {
        "key": "coils",
        "symbol": "p",
        "meaning": "number of times the helix coils around the torus tube before closing — higher p packs in tighter windings"
      },
      {
        "key": "tube",
        "symbol": "\\rho",
        "meaning": "radius of the solid tube swept along the coiled centreline (its visual thickness)"
      }
    ],
    "code": "const R = 2, r = 0.6;\nconst C  = (t) => { const w = R + r*Math.cos(p*t);\n  return [w*Math.cos(t), r*Math.sin(p*t), w*Math.sin(t)]; };\nconst dC = (t) => { const ct=Math.cos(t), st=Math.sin(t),\n      cp=Math.cos(p*t), sp=Math.sin(p*t),\n      w = R + r*cp, dw = -r*p*sp;\n  return [dw*ct - w*st, r*p*cp, dw*st + w*ct]; };\nsweepTube(i, n, tube, out, o, C, dC);   // thicken centreline into a tube",
    "links": [
      {
        "label": "Toroidal spiral (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Toroidal_spiral"
      },
      {
        "label": "Spiral (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Spiral"
      },
      {
        "label": "Torus (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Torus"
      }
    ]
  },
  "sievert": {
    "title": "Sievert's Surface",
    "about": "Sievert's surface is a rare and beautiful thing: a closed-looking shape that curves by exactly the same positive amount at every single point (constant Gaussian curvature K = +1), just like a sphere — yet it is emphatically not a sphere. Found by Heinrich Sievert in 1886 and later studied by Enneper, it bulges into a plump body wrapped by a single twisting ridge that spirals from one cusp to the other. It is the constant-positive-curvature cousin of the pseudosphere, proving that a sphere is far from the only surface with uniform curvature.",
    "howItWorks": "A shape constant C controls the twist. Two angles sweep the surface: u runs across (-π/2, π/2) and v down the body in (0, π). An auxiliary angle phi = -u/√(C+1) + atan(√(C+1)·tan u) does the twisting, and a shared factor A = 2/(C+1 - C·sin²v·cos²u) sets the swelling — its denominator stays at least 1, so it never blows up. The radial distance r and the height (built from ln tan(v/2) plus A·cos v) trace the bulb and its ridge. We evaluate phi with atan2 so the tan never explodes at the poles, clamp v off zero to keep the logarithm finite, and subtract √((C+1)/C) to slide the body onto the origin.",
    "equations": [
      {
        "label": "twisting angle",
        "latex": "\\varphi = -\\dfrac{u}{\\sqrt{C+1}} + \\operatorname{atan}\\!\\big(\\sqrt{C+1}\\,\\tan u\\big)"
      },
      {
        "label": "swelling factor",
        "latex": "A = \\dfrac{2}{\\,C + 1 - C\\,\\sin^2 v\\,\\cos^2 u\\,}, \\qquad r = \\dfrac{A}{\\sqrt{C}}\\,\\sin v\\,\\sqrt{C+1}\\,\\sqrt{1 + C\\sin^2 u}"
      },
      {
        "label": "Sievert surface",
        "latex": "\\begin{aligned} x &= r\\cos\\varphi, \\quad z = r\\sin\\varphi \\\\ y &= \\dfrac{\\ln\\tan\\tfrac{v}{2}}{\\sqrt{C}} + \\dfrac{A\\,(C+1)\\cos v}{\\sqrt{C}} \\end{aligned}"
      },
      {
        "label": "constant curvature",
        "latex": "K = +1 \\quad \\text{(everywhere)}"
      },
      {
        "label": "domain",
        "latex": "u \\in \\left(-\\tfrac{\\pi}{2}, \\tfrac{\\pi}{2}\\right), \\quad v \\in (0, \\pi)"
      }
    ],
    "params": [
      {
        "key": "C",
        "symbol": "C",
        "meaning": "shape constant > 0; sets the twist and girth of the bulb — C=1 is the classic form, larger C tightens it into a rounder body, smaller C stretches it taller and thinner"
      }
    ],
    "code": "const u = -Math.PI/2 + 0.06 + a*(Math.PI - 0.12);   // a,b ∈ [0,1] grid\nconst v = 0.07 + b*(Math.PI - 0.14);\nconst sC1 = Math.sqrt(C+1), sqC = Math.sqrt(C);\nconst su = Math.sin(u), cu = Math.cos(u), sv = Math.sin(v), cv = Math.cos(v);\nconst phi = -u/sC1 + Math.atan2(sC1*su, cu);         // no tan blow-up at ±π/2\nconst A = 2/((C+1) - C*sv*sv*cu*cu);                 // denominator ≥ 1\nconst r = (A/sqC)*sv*sC1*Math.sqrt(1 + C*su*su);\nconst y = Math.log(Math.tan(v/2))/sqC + A*(C+1)*cv/sqC;\nconst offX = Math.sqrt((C+1)/C);                     // centre it\npoint(r*Math.cos(phi) - offX, y, r*Math.sin(phi));",
    "links": [
      {
        "label": "Sievert–Enneper surface (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Sievert%E2%80%93Enneper_surface"
      },
      {
        "label": "Sievert's Surface (MathWorld)",
        "url": "https://mathworld.wolfram.com/SievertsSurface.html"
      },
      {
        "label": "Gaussian curvature (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Gaussian_curvature"
      }
    ]
  },
  "crossCap": {
    "title": "Cross-Cap",
    "about": "The cross-cap is the most economical way to push the real projective plane RP² — a sphere with every pair of antipodal points glued together — into ordinary 3D space. Unlike the smooth Boy's surface, it pays for its simplicity with two sharp pinch (Whitney) points joined by a short segment where the surface passes through itself. Cap a disk over this self-intersecting hood and you literally close a Möbius band into the non-orientable projective plane. It is the third member of the classic Boy–Roman–cross-cap trio, all three immersions of the very same surface.",
    "howItWorks": "Two angles u and v, each running across [0, π], sweep a grid. The planar coordinates x = cos u·sin 2v and y = sin u·sin 2v wrap a doubled loop — sin 2v vanishes at v = 0, π/2, π, pinching the rim shut — while the height z = cos²v·sin²u (equivalently cos²v − cos²u·cos²v) is always ≥ 0 and collapses to a single segment along the axis, the line of double points running between the two pinch points. Everything is built from bounded sines and cosines, so every sample is finite; the raw z runs from 0 to 1 and is centred by subtracting one half. The width knob scales the planar hood, the height knob stretches the pinched spine.",
    "equations": [
      {
        "label": "cross-cap immersion",
        "latex": "\\begin{aligned} x &= \\cos u\\,\\sin 2v \\\\ y &= \\sin u\\,\\sin 2v \\\\ z &= \\cos^2 v - \\cos^2 u\\,\\cos^2 v \\end{aligned}"
      },
      {
        "label": "height simplifies",
        "latex": "z = \\cos^2 v\\,\\sin^2 u \\;\\ge\\; 0"
      },
      {
        "label": "domain",
        "latex": "u \\in [0,\\pi],\\quad v \\in [0,\\pi]"
      },
      {
        "label": "double-point segment (sin 2v = 0)",
        "latex": "x = y = 0,\\quad z = \\cos^2 v\\,\\sin^2 u"
      }
    ],
    "params": [
      {
        "key": "width",
        "symbol": "w",
        "meaning": "scales the planar hood (x and z); widens or tightens the self-intersecting cap"
      },
      {
        "key": "height",
        "symbol": "h",
        "meaning": "stretches the pinched spine along the up axis (the double-point segment), then re-centres it"
      }
    ],
    "code": "const u = a*Math.PI, v = b*Math.PI;            // a,b ∈ [0,1] grid\nconst s2v = Math.sin(2*v), cv = Math.cos(v);\nconst su = Math.sin(u), cu = Math.cos(u);\nconst z = cv*cv * su*su;                        // = cos²v − cos²u·cos²v ≥ 0\npoint(\n  cu*s2v*width,\n  z*height - 0.5*height,                        // up axis, centred\n  su*s2v*width,\n);",
    "links": [
      {
        "label": "Cross-cap (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Cross-cap"
      },
      {
        "label": "Cross-Cap (MathWorld)",
        "url": "https://mathworld.wolfram.com/Cross-Cap.html"
      },
      {
        "label": "Real projective plane (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Real_projective_plane"
      }
    ]
  },
  "monkeySaddle": {
    "title": "Monkey Saddle",
    "about": "An ordinary saddle dips on two sides and rises on the other two — enough room for a rider's two legs. The monkey saddle adds a third dip, so a monkey can tuck in its tail as well: three valleys and three ridges meeting at a single flat point. It is the textbook example of a degenerate critical point where the second-derivative test fails completely, the surface flattening to third order before it commits to going up or down.",
    "howItWorks": "The height is the real part of the complex cube z = x³ − 3xy², which in polar coordinates is simply r³·cos(3θ): the radius cubed, modulated by a three-fold cosine wave around the angle. We lay points on a disk — one grid axis is the radius fraction (scaled by reach R), the other the angle θ over a full turn — and lift each by that height onto the up axis. Because the height is an odd function of position, the surface is automatically centred on the origin. The legs knob swaps cos(3θ) for cos(kθ), turning the three monkey-saddle valleys into k valleys (k=2 is the plain saddle).",
    "equations": [
      {
        "label": "monkey saddle (Cartesian)",
        "latex": "z = x^3 - 3xy^2"
      },
      {
        "label": "polar height field",
        "latex": "z = r^k\\cos(k\\theta), \\qquad k = 3"
      },
      {
        "label": "disk parametrization",
        "latex": "\\big(r\\cos\\theta,\\; r^k\\cos(k\\theta),\\; r\\sin\\theta\\big), \\quad r\\in[0,R],\\ \\theta\\in[0,2\\pi)"
      },
      {
        "label": "degenerate critical point",
        "latex": "\\nabla z(0)=0,\\quad \\det\\,\\mathrm{Hess}\\,z(0)=0"
      }
    ],
    "params": [
      {
        "key": "reach",
        "symbol": "R",
        "meaning": "radius of the sampled disk; the height grows as R^k, so larger R deepens the valleys steeply"
      },
      {
        "key": "legs",
        "symbol": "k",
        "meaning": "number of descending valleys (and ridges); k=3 is the monkey saddle, k=2 the ordinary saddle, higher k adds more legs"
      },
      {
        "key": "lift",
        "symbol": "\\lambda",
        "meaning": "vertical scale of the height field; flattens (low) or exaggerates (high) the saddle relief"
      }
    ],
    "code": "const u = a, v = b*2*Math.PI;        // a,b ∈ [0,1] grid\nconst rad = u * R, k = Math.round(legs);\npoint(\n  rad*Math.cos(v),\n  lift * Math.pow(rad, k) * Math.cos(k*v),  // r^k cos(kθ), up axis\n  rad*Math.sin(v));",
    "links": [
      {
        "label": "Monkey saddle (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Monkey_saddle"
      },
      {
        "label": "Monkey Saddle (MathWorld)",
        "url": "https://mathworld.wolfram.com/MonkeySaddle.html"
      },
      {
        "label": "Saddle point (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Saddle_point"
      }
    ]
  },
  "supershape3D": {
    "title": "Supershape 3D",
    "about": "Johan Gielis's superformula generates starfish, flowers, diatoms, and crystals from one equation; its 3D spherical product turns those flat profiles into organic solids. This variant frees the two angles to carry their OWN rotational symmetry — m₁ lobes running pole-to-pole (latitude) and m₂ lobes running around the equator (longitude) — so the surface can be, say, a five-pointed star wrapped around a seven-fold body. Sweeping the dials morphs continuously through an enormous catalogue of seed-pods, sea-urchins, gems, and blobs.",
    "howItWorks": "A radius is computed from each angle by the 1-D superformula: r₁ = R(θ; m₁, n₁, n₂, n₃) for the latitude θ ∈ [-π/2, π/2], and r₂ = R(φ; m₂, n₁, n₂, n₃) for the longitude φ ∈ [-π, π]. The two radii are combined by the spherical product — the same construction that builds an ordinary sphere from two circles — yielding the 3D point. m₁ and m₂ set how many lobes appear in each direction independently; the shared n₁ pinches the overall radius while n₂ and n₃ sharpen or bloat the lobe flanks. The radius helper clamps its output and guards the negative-base power and the (|cos|+|sin|)→0 division, so every sample stays finite.",
    "equations": [
      {
        "label": "superformula radius",
        "latex": "R(\\varphi; m) = \\Big( \\big|\\cos\\tfrac{m\\varphi}{4}\\big|^{n_2} + \\big|\\sin\\tfrac{m\\varphi}{4}\\big|^{n_3} \\Big)^{-1/n_1}"
      },
      {
        "label": "independent symmetries",
        "latex": "r_1 = R(\\theta; m_1), \\qquad r_2 = R(\\varphi; m_2)"
      },
      {
        "label": "spherical product",
        "latex": "\\begin{aligned} x &= r_2\\cos\\varphi\\;\\,r_1\\cos\\theta \\\\ y &= r_1\\sin\\theta \\\\ z &= r_2\\sin\\varphi\\;\\,r_1\\cos\\theta \\end{aligned}"
      },
      {
        "label": "domain",
        "latex": "\\theta \\in [-\\tfrac{\\pi}{2}, \\tfrac{\\pi}{2}], \\quad \\varphi \\in [-\\pi, \\pi]"
      }
    ],
    "params": [
      {
        "key": "m1",
        "symbol": "m_1",
        "meaning": "latitude symmetry — number of lobes running pole to pole (θ direction)"
      },
      {
        "key": "m2",
        "symbol": "m_2",
        "meaning": "longitude symmetry — number of lobes running around the equator (φ direction); m₁≠m₂ is what distinguishes this from the single-m superformula"
      },
      {
        "key": "n1",
        "symbol": "n_1",
        "meaning": "overall pinch shared by both angles; small n₁ makes spiky stars, large n₁ rounds it toward a sphere"
      },
      {
        "key": "n2",
        "symbol": "n_2",
        "meaning": "shapes one flank of every lobe"
      },
      {
        "key": "n3",
        "symbol": "n_3",
        "meaning": "shapes the other flank; n₂≠n₃ breaks each lobe's mirror symmetry"
      }
    ],
    "code": "function R(angle, m, n1, n2, n3) {              // 1-D superformula radius (clamped, NaN-safe)\n  const t = m*angle/4;\n  const s = Math.abs(Math.cos(t))**n2 + Math.abs(Math.sin(t))**n3;\n  return s < 1e-6 ? 0 : Math.min(s**(-1/Math.max(n1,1e-3)), 4);\n}\nconst phi = a*2*Math.PI - Math.PI, theta = b*Math.PI - Math.PI/2; // a,b ∈ [0,1] grid\nconst r1 = R(theta, m1, n1,n2,n3), r2 = R(phi, m2, n1,n2,n3);\nconst ct = r1*Math.cos(theta);\npoint(r2*Math.cos(phi)*ct, r1*Math.sin(theta), r2*Math.sin(phi)*ct);",
    "links": [
      {
        "label": "Superformula (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Superformula"
      },
      {
        "label": "Gielis 2003 (original paper)",
        "url": "https://www.amjbot.org/doi/10.3732/ajb.90.3.333"
      },
      {
        "label": "Superellipse (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Superellipse"
      },
      {
        "label": "Superellipse (MathWorld)",
        "url": "https://mathworld.wolfram.com/Superellipse.html"
      }
    ]
  },
  "bourSurface": {
    "title": "Bour's Surface",
    "about": "Bour's surface is a classical minimal surface — a soap-film shape that locally minimises area — named after Edmond Bour, who studied it in the 1860s. The order-2 member shown here is built from a single radial coordinate u raised to the power 1.5 against trigonometric functions of the angle v, folding into a graceful three-lobed form with perfect 3-fold symmetry. Like its cousins Enneper and Henneberg, it is complete but not embedded: as the domain widens the three petals sweep through one another, weaving a self-intersecting bloom.",
    "howItWorks": "A grid coordinate u runs outward from the centre over [0, extent] and v winds once around. The planar x and y coordinates are an ordinary quadratic in u (a term linear in u plus a u^2 term at double the angle), while the height z is the fractional power (4/3)u^1.5 times cos(1.5v) — the piece that demands u >= 0, guarded with Math.max(0,u). Because the u^1.5 height and the doubled/halved angles all share a common rotation, the surface closes into three lobes. The raw shape drifts off-centre along +x, so a fixed offset of extent/2 - 1/8 (measured from the sampled bounding box) is added back to seat it on the origin; the flare knob scales the height lobes.",
    "equations": [
      {
        "label": "Bour's surface (order 2)",
        "latex": "\\begin{aligned} x &= u\\cos v - \\tfrac{u^2}{2}\\cos 2v \\\\ y &= -u\\sin v - \\tfrac{u^2}{2}\\sin 2v \\\\ z &= \\tfrac{4}{3}\\,u^{3/2}\\cos\\tfrac{3v}{2} \\end{aligned}"
      },
      {
        "label": "domain",
        "latex": "u \\in [0, A],\\quad v \\in [0, 2\\pi]"
      },
      {
        "label": "minimal (zero mean curvature)",
        "latex": "H = \\tfrac{1}{2}(\\kappa_1 + \\kappa_2) = 0"
      },
      {
        "label": "Weierstrass data",
        "latex": "f = 1,\\quad g = w^{1/2},\\quad \\mathbf{r}(w) = \\operatorname{Re}\\!\\int\\!\\big(1-g^2,\\; i(1+g^2),\\; 2g\\big)\\,f\\,dw"
      }
    ],
    "params": [
      {
        "key": "extent",
        "symbol": "A",
        "meaning": "outer radius of the u domain [0, A]; below ~1.4 the lobes stay clear, above it they sweep through one another into the self-intersecting bloom"
      },
      {
        "key": "flare",
        "symbol": "\\lambda",
        "meaning": "scales the (4/3)u^{3/2} height term — 1 is the true Bour surface, lower flattens the three lobes toward the plane"
      }
    ],
    "code": "const u = a*extent, v = b*2*Math.PI;          // a,b ∈ [0,1] grid, u ≥ 0\nconst u15 = Math.pow(Math.max(0,u), 1.5);     // guard the fractional power\nconst u2h = u*u/2;\npoint(\n  u*Math.cos(v) - u2h*Math.cos(2*v) + (extent/2 - 0.125),  // centred x\n  -u*Math.sin(v) - u2h*Math.sin(2*v),\n  (4/3)*u15*Math.cos(1.5*v)*flare);",
    "links": [
      {
        "label": "Bour's minimal surface (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Bour%27s_minimal_surface"
      },
      {
        "label": "Minimal surface (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Minimal_surface"
      },
      {
        "label": "Weierstrass–Enneper parameterization (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Weierstrass%E2%80%93Enneper_parameterization"
      }
    ]
  },
  "pluckerConoid": {
    "title": "Plücker's Conoid",
    "about": "Plücker's conoid — also called the cylindroid — is a ruled surface built from a family of straight horizontal lines, each passing through a central axis but tilted up or down depending on its compass direction. As you walk around the axis, the height of the rulings rises and falls like a wave, folding a flat disk into a set of saddle-shaped blades. The classic two-fold version is the graph of z = 2xy/(x²+y²), and it appears in screw geometry and the kinematics of rigid-body motion, where Julius Plücker first studied it in the 1860s.",
    "howItWorks": "Two grid coordinates drive the surface. One, r, runs from the centre out to the rim along each straight ruling; the other, v, is the azimuth angle sweeping all the way around. The planar position is just the polar point (r·cos v, r·sin v), so the rulings fill a flat disk — but the height is set independently to amp·sin(n·v), so each ruling is lifted by an amount that depends only on its direction. Because n full oscillations fit into one trip around the circle, the disk folds into n up-and-down blades that all cross at the central axis. Everything is bounded trigonometry, so every sampled point is finite, and the symmetric domain keeps the shape centred on the origin.",
    "equations": [
      {
        "label": "ruled surface",
        "latex": "\\big(r\\cos v,\\; c\\,\\sin(n v),\\; r\\sin v\\big),\\quad r\\in[0,R],\\; v\\in[0,2\\pi]"
      },
      {
        "label": "implicit form (n = 2)",
        "latex": "z\\,(x^2 + y^2) = c\\cdot 2xy \\quad\\Longleftrightarrow\\quad z = c\\,\\sin 2v"
      },
      {
        "label": "height as a function of azimuth",
        "latex": "z(v) = c\\,\\sin(n v)\\ \\text{— independent of the radius } r"
      }
    ],
    "params": [
      {
        "key": "folds",
        "symbol": "n",
        "meaning": "number of full height oscillations per turn — gives n up/down saddle blades (n=2 is the classic cylindroid)"
      },
      {
        "key": "amp",
        "symbol": "c",
        "meaning": "vertical amplitude of the oscillation; how far the blades rise above and dip below the plane"
      }
    ],
    "code": "const r = a*1.3, v = b*2*Math.PI;          // a,b ∈ [0,1] grid\npoint(r*Math.cos(v), amp*Math.sin(folds*v), r*Math.sin(v));",
    "links": [
      {
        "label": "Plücker's conoid (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Pl%C3%BCcker%27s_conoid"
      },
      {
        "label": "Plücker's Conoid (MathWorld)",
        "url": "https://mathworld.wolfram.com/PlueckersConoid.html"
      },
      {
        "label": "Ruled surface (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Ruled_surface"
      }
    ]
  },
  "sphericalSpiral": {
    "title": "Spherical Spiral",
    "about": "A spherical spiral winds smoothly from one pole of a sphere to the other while circling the axis many times — the path you would trace walking due 'northeast' forever across a globe, a curve closely related to the loxodrome (rhumb line) that sailors followed at a constant compass bearing. As the curve nears each pole the loops crowd tighter and tighter, packing into a dense whorl. Here that pole-to-pole thread is thickened into a glowing solid tube wound over the unit sphere.",
    "howItWorks": "A single sweep parameter runs once over the curve and is remapped to a latitude φ from the south pole (−π/2) to the north pole (+π/2). At each latitude the point sits on the unit sphere at height sinφ, on a circle of radius cosφ, and that circle is spun through c full turns of longitude as φ climbs — so the curve spirals up the sphere c times. The centreline is then thickened into a tube by sweeping a small circle along it, oriented by the curve's analytic tangent (which never vanishes), so the tube stays smooth from pole to pole.",
    "equations": [
      {
        "label": "latitude remap",
        "latex": "\\varphi = \\tfrac{t}{2} - \\tfrac{\\pi}{2} \\in [-\\tfrac{\\pi}{2}, \\tfrac{\\pi}{2}], \\quad t \\in [0, 2\\pi]"
      },
      {
        "label": "centreline",
        "latex": "\\mathbf{C}(\\varphi) = \\big(\\cos\\varphi\\,\\cos c\\varphi,\\; \\sin\\varphi,\\; \\cos\\varphi\\,\\sin c\\varphi\\big)"
      },
      {
        "label": "tangent (analytic)",
        "latex": "\\mathbf{C}'(\\varphi) = \\big(-\\sin\\varphi\\cos c\\varphi - c\\cos\\varphi\\sin c\\varphi,\\; \\cos\\varphi,\\; -\\sin\\varphi\\sin c\\varphi + c\\cos\\varphi\\cos c\\varphi\\big)"
      },
      {
        "label": "lies on the unit sphere",
        "latex": "\\lVert\\mathbf{C}(\\varphi)\\rVert = 1"
      }
    ],
    "params": [
      {
        "key": "turns",
        "symbol": "c",
        "meaning": "number of longitudinal turns the curve makes from pole to pole — higher c packs in tighter, denser loops"
      },
      {
        "key": "tube",
        "symbol": "\\rho",
        "meaning": "radius of the solid tube swept along the spiral centreline (its visual thickness)"
      }
    ],
    "code": "const C = (t) => { const phi = t/2 - Math.PI/2;        // [-π/2, π/2]\n  const cl = Math.cos(phi);\n  return [cl*Math.cos(c*phi), Math.sin(phi), cl*Math.sin(c*phi)]; };\nconst dC = (t) => { const phi = t/2 - Math.PI/2;\n  const cl = Math.cos(phi), sl = Math.sin(phi),\n        ca = Math.cos(c*phi), sa = Math.sin(c*phi);\n  return [-sl*ca - cl*c*sa, cl, -sl*sa + cl*c*ca]; };\nsweepTube(i, n, tube, out, o, C, dC);   // thicken centreline into a tube",
    "links": [
      {
        "label": "Spherical spiral (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Spherical_spiral"
      },
      {
        "label": "Rhumb line / loxodrome (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Rhumb_line"
      },
      {
        "label": "Spherical Spiral (MathWorld)",
        "url": "https://mathworld.wolfram.com/SphericalSpiral.html"
      }
    ]
  },
  "bohemianDome": {
    "title": "Bohemian Dome",
    "about": "The Bohemian dome is the surface swept out when a fixed circle glides so that its centre rides around an ellipse lying in a plane perpendicular to the circle. The result is a billowing, tent-like quartic that drapes over itself and folds through its own walls, producing two lobed cavities joined along a self-intersection. Despite the elaborate shape it is built from nothing but cosines and sines, so it is everywhere smooth and finite.",
    "howItWorks": "Two angles drive the surface: u runs once around the rigid generating circle (radius a), and v runs once around the guiding ellipse (semi-axes b and c). For each (u, v) the circle is placed with its centre at the ellipse point, then a point is read off the circle. Because cos and sin stay bounded in [-1, 1], the coordinates never blow up; and because all three are odd-or-even oscillations about zero, the whole dome sits centred on the origin with no offset needed.",
    "equations": [
      {
        "label": "Bohemian dome",
        "latex": "\\begin{aligned} x &= a\\cos u \\\\ y &= b\\cos v + a\\sin u \\\\ z &= c\\sin v \\end{aligned}"
      },
      {
        "label": "domain",
        "latex": "u \\in [0, 2\\pi], \\quad v \\in [0, 2\\pi]"
      },
      {
        "label": "construction",
        "latex": "\\text{circle of radius } a \\text{ swept with its centre on the ellipse } (b\\cos v,\\, c\\sin v)"
      }
    ],
    "params": [
      {
        "key": "a",
        "symbol": "a",
        "meaning": "radius of the rigid generating circle that is swept around"
      },
      {
        "key": "b",
        "symbol": "b",
        "meaning": "semi-axis of the guiding ellipse along the dome's up axis; sets the dome height"
      },
      {
        "key": "c",
        "symbol": "c",
        "meaning": "semi-axis of the guiding ellipse across the dome; sets its depth"
      }
    ],
    "code": "const u = a*2*Math.PI, v = b*2*Math.PI;   // a,b ∈ [0,1] grid\npoint(\n  A*Math.cos(u),                          // A = circle radius\n  B*Math.cos(v) + A*Math.sin(u),          // B = ellipse up semi-axis (centred)\n  C*Math.sin(v));                         // C = ellipse depth semi-axis",
    "links": [
      {
        "label": "Bohemian dome (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Bohemian_dome"
      },
      {
        "label": "Bohemian Dome (MathWorld)",
        "url": "https://mathworld.wolfram.com/BohemianDome.html"
      }
    ]
  },
  "conicalSpiral": {
    "title": "Conical Spiral",
    "about": "A conical spiral winds around the surface of an invisible cone, climbing toward its apex while its turning radius shrinks to a point — the geometry of a unicorn's horn, a snail's spike, or a tightly coiled spring squeezed onto a cone. Unlike a flat spiral it gains height as it turns, and unlike a cylindrical helix its loops grow ever smaller. Here the centreline is swept into a solid glowing tube so the whole tapering horn reads as a single ribboned form.",
    "howItWorks": "A single parameter s runs from 0 (the wide base) to 1 (the sharp tip). The winding angle grows linearly, ang = a·2πs, so the curve makes `a` full turns; the radius tapers as rad = (1−s)·R₀, collapsing to zero at the tip; and the height climbs as (s−0.5)·H, which automatically centres the horn on the vertical axis. That centreline is then thickened into a round tube of the chosen radius, using an analytic tangent so the cross-section always faces squarely along the curve.",
    "equations": [
      {
        "label": "winding angle & taper",
        "latex": "\\varphi = 2\\pi a\\,s, \\qquad \\rho = (1-s)\\,R_0, \\qquad s\\in[0,1]"
      },
      {
        "label": "centreline",
        "latex": "C(s) = \\big(\\rho\\cos\\varphi,\\; (s-\\tfrac12)H,\\; \\rho\\sin\\varphi\\big)"
      },
      {
        "label": "analytic tangent",
        "latex": "C'(s) = \\big(-R_0\\cos\\varphi - 2\\pi a\\,\\rho\\sin\\varphi,\\; H,\\; -R_0\\sin\\varphi + 2\\pi a\\,\\rho\\cos\\varphi\\big)"
      }
    ],
    "params": [
      {
        "key": "turns",
        "symbol": "a",
        "meaning": "number of full revolutions the spiral makes from base to tip — more turns coil it tighter"
      },
      {
        "key": "tube",
        "symbol": "\\rho_0",
        "meaning": "radius of the swept tube (thickness of the horn)"
      }
    ],
    "code": "const R0 = 1, H = 2.2;                       // base radius, height\nfor (let s = 0; s <= 1; s += 1/N) {          // s: base -> tip\n  const ang = turns * 2*Math.PI * s;\n  const rad = (1 - s) * R0;                   // taper to a point\n  point(rad*Math.cos(ang), (s - 0.5)*H, rad*Math.sin(ang));  // centred up axis\n}\n// each centreline point is swept into a round tube of radius `tube`",
    "links": [
      {
        "label": "Conical spiral (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Conical_spiral"
      },
      {
        "label": "Conical Spiral (MathWorld)",
        "url": "https://mathworld.wolfram.com/ConicalSpiral.html"
      },
      {
        "label": "Helix (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Helix"
      }
    ]
  },
  harmonograph: {
    "title": "Harmonograph",
    "about": "A harmonograph is a Victorian drawing machine: a pen and the paper beneath it each hang from swinging pendulums, and as the pendulums trace out slowly-decaying sine waves their combined motion inks an intricate, self-overlapping figure. With the pendulums tuned to near-whole-number frequency ratios the result is a perfectly symmetric mandala — a ring of petals around the rim and a dense radial starburst blazing through the centre, the classic look an almost-undamped harmonograph leaves behind. This is that figure rebuilt as one continuous glowing curve.",
    "howItWorks": "Each axis is a sum of sinusoids. To force clean N-fold symmetry we give all three component frequencies the same remainder when divided by N (they are all ≡ 1 mod N): then advancing time by one N-th of the period rotates the whole figure by exactly 2π/N onto itself. One term is fast and retrograde, which throws long chords back across the centre to build the starburst. A gentle 'breathing' damping envelope, repeating once per symmetry sector, pulls each lobe inward without breaking the symmetry or the closure — so the curve fills the disc yet still returns exactly to where it began. The closed path is then swept into a solid glowing tube, laid in the X-Y plane to face the camera with a slight vertical ripple for depth.",
    "equations": [
      {
        "label": "x component",
        "latex": "x(t) = e(t)\\,\\big[A_0\\cos t + A_1\\cos(\\omega_1 t + \\varphi) + A_2\\cos(\\omega_2 t)\\big]"
      },
      {
        "label": "y component",
        "latex": "y(t) = e(t)\\,\\big[A_0\\sin t + A_1\\sin(\\omega_1 t + \\varphi) + A_2\\sin(\\omega_2 t)\\big]"
      },
      {
        "label": "frequencies (all ≡ 1 mod N)",
        "latex": "\\omega_1 = 1 + Nb,\\qquad \\omega_2 = 1 - N(b+1)"
      },
      {
        "label": "breathing envelope",
        "latex": "e(t) = \\exp\\!\\big[-d\\,(1-\\cos Nt)\\big]"
      },
      {
        "label": "vertical lift",
        "latex": "z(t) = \\ell\\,\\sin(Nt)"
      },
      {
        "label": "exact N-fold symmetry",
        "latex": "z\\!\\left(t + \\tfrac{2\\pi}{N}\\right) = e^{\\,i\\,2\\pi/N}\\,z(t)"
      }
    ],
    "params": [
      {
        "key": "symmetry",
        "symbol": "N",
        "meaning": "fold count of the mandala — the figure carries exact N-fold dihedral symmetry (the number of petals around the rim)"
      },
      {
        "key": "ratio",
        "symbol": "b",
        "meaning": "integer frequency ratio setting the inner fast term ω₁ = 1+Nb; larger b packs more spokes into the central starburst"
      },
      {
        "key": "damp",
        "symbol": "d",
        "meaning": "depth of the breathing envelope — pulls each lobe toward the centre (0 = an open epicyclic rose, higher = a denser inward starburst)"
      },
      {
        "key": "phase",
        "symbol": "\\varphi",
        "meaning": "phase offset of the inner term, rotating its petals relative to the outer rose to reshape the pattern"
      },
      {
        "key": "lift",
        "symbol": "\\ell",
        "meaning": "vertical (z) displacement that lifts the flat mandala into a gently rippled 3D sheet for depth"
      },
      {
        "key": "tube",
        "symbol": "\\rho",
        "meaning": "radius of the glowing tube swept along the closed curve"
      }
    ],
    "code": "const N = Math.round(p.symmetry), b = Math.round(p.ratio);\nconst w1 = 1 + N*b, w2 = 1 - N*(b+1); // both ≡ 1 (mod N) ⇒ exact N-fold symmetry\nconst A0 = 1, A1 = 0.55, A2 = 0.32;\nconst C = (t) => {\n  const env = Math.exp(-p.damp * (1 - Math.cos(N*t))); // breathing damp, period 2π/N\n  const x = env*(A0*Math.cos(t) + A1*Math.cos(w1*t + p.phase) + A2*Math.cos(w2*t));\n  const y = env*(A0*Math.sin(t) + A1*Math.sin(w1*t + p.phase) + A2*Math.sin(w2*t));\n  return [x, y, p.lift*Math.sin(N*t)]; // X-Y plane + small z-lift\n};\n// C(t) is closed over t∈[0,2π]; sweep it into a glowing tube",
    "links": [
      {
        "label": "Harmonograph (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Harmonograph"
      },
      {
        "label": "Lissajous curve (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Lissajous_curve"
      },
      {
        "label": "Rose / rhodonea curve (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Rose_(mathematics)"
      }
    ]
  },
  sphericalLissajous: {
    "title": "Spherical Lissajous",
    "about": "A Lissajous figure escapes the plane onto the surface of a sphere. Where the classic oscilloscope figure draws sin(at) against sin(bt) in two dimensions, here two integer winding frequencies drive a single point around a sphere: one frequency makes its latitude oscillate up and down, the other loops it around in longitude. The point never leaves the unit sphere, and because both frequencies are whole numbers it eventually returns exactly to where it began — weaving one continuous closed thread into a dense wireframe orb of overlapping loops. Unlike a loxodrome (a simple pole-to-pole spiral), the latitude here reverses direction many times, so the loops cross and interlace into a woven lattice with clean rotational symmetry about the vertical axis.",
    "howItWorks": "A single parameter t runs once around [0, 2π]. The latitude angle advances as a·t and the longitude as b·t, and the point is placed on the unit sphere by C(t) = (sin(a t)·cos(b t), cos(a t), sin(a t)·sin(b t)) with y as the up axis. Because cos(a t) gives the height, the trace sweeps up and down through 'a' full latitude oscillations while looping 'b' times around — covering the sphere in a woven mesh rather than a single spiral. The vector identity sin²+cos² = 1 guarantees |C| = 1 exactly, so it rides the unit sphere with no drift (verified to 3e-16). For integer a and b the curve closes seamlessly at t = 2π. This centreline is swept into a solid tube along its analytic tangent dC/dt, whose magnitude never falls below a (the −a·sin(a t) term keeps it from vanishing), so the tube frame stays well-conditioned everywhere. Coprime a, b (gcd = 1) give a single non-repeating thread; sharing a common factor would retrace a sparser sub-pattern.",
    "equations": [
      {
        "label": "centreline on the unit sphere (y up)",
        "latex": "C(t) = \\big(\\sin(a t)\\cos(b t),\\; \\cos(a t),\\; \\sin(a t)\\sin(b t)\\big)"
      },
      {
        "label": "lies exactly on the unit sphere",
        "latex": "\\lVert C(t)\\rVert^2 = \\sin^2(a t) + \\cos^2(a t) = 1"
      },
      {
        "label": "tangent (swept into the tube); magnitude bounded below by a",
        "latex": "C'(t) = \\big(a\\cos a t\\cos b t - b\\sin a t\\sin b t,\\; -a\\sin a t,\\; a\\cos a t\\sin b t + b\\sin a t\\cos b t\\big)"
      },
      {
        "label": "closes for integer winding numbers",
        "latex": "C(2\\pi) = C(0) \\quad\\text{when } a,b \\in \\mathbb{Z}"
      }
    ],
    "params": [
      {
        "key": "wind",
        "symbol": "a",
        "meaning": "latitude (theta) winding frequency — how many times the trace oscillates between the poles in one cycle; larger a = more latitude bands"
      },
      {
        "key": "loop",
        "symbol": "b",
        "meaning": "longitude (phi) looping frequency — how many times it wraps around the vertical axis; coprime with a gives a single non-repeating woven thread"
      },
      {
        "key": "tube",
        "symbol": "r",
        "meaning": "radius of the swept tube (visual thickness of the woven strand)"
      }
    ],
    "code": "// single continuous thread woven over the unit sphere (y up)\nconst a = Math.round(wind);   // latitude winding\nconst b = Math.round(loop);   // longitude looping\nC  = (t) => {\n  const sa = Math.sin(a*t);\n  return [sa*Math.cos(b*t), Math.cos(a*t), sa*Math.sin(b*t)]; // |C| = 1\n};\ndC = (t) => {\n  const sa = Math.sin(a*t), ca = Math.cos(a*t);\n  const cb = Math.cos(b*t), sb = Math.sin(b*t);\n  return [a*ca*cb - b*sa*sb, -a*sa, a*ca*sb + b*sa*cb]; // |dC| >= a\n};\n// coprime a,b (gcd=1) ⇒ one closed loop covering the sphere; sweepTube fills the strand",
    "links": [
      {
        "label": "Lissajous curve (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Lissajous_curve"
      },
      {
        "label": "Spherical coordinate system (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Spherical_coordinate_system"
      },
      {
        "label": "Loxodrome / rhumb line (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Rhumb_line"
      }
    ]
  },
  decaySpiral: {
    title: 'Decaying Spiral',
    about:
      'A genuine 3D funnel-coil: a point winds a fixed number of turns around a vertical axis while its orbit radius decays exponentially and it climbs in height. The result is a logarithmic spiral pulled into the third dimension — wide, lazy loops at the base that tighten into a fine thread at the apex, like a spring wound into a horn. Orbit it to see the depth.',
    howItWorks:
      'As the curve parameter u runs 0 → 1, three things happen at once: the winding angle φ sweeps a fixed number of turns (φ = turns·2π·u), the radius decays exponentially (ρ = R₀·e^(−decay·u), so it loses a constant fraction of its width per turn — the signature of a logarithmic spiral), and the height climbs linearly (y = climb·(u − ½)). The point therefore spirals around the vertical axis, tightening as it rises into a funnel/horn. The closed-form curve is swept into a glowing tube; it is unconditionally bounded (every term is bounded) and needs no special framing — the default 3/4 camera shows the coil standing in space.',
    equations: [
      { label: 'winding angle (uniform turns)', latex: '\\varphi(u) = \\text{turns}\\cdot 2\\pi\\,u,\\quad u\\in[0,1]' },
      { label: 'exponentially-decaying radius', latex: '\\rho(u) = R_0\\,e^{-\\text{decay}\\cdot u}' },
      { label: 'height (climb)', latex: 'y(u) = \\text{climb}\\,(u - \\tfrac12)' },
      { label: 'curve', latex: 'C(u) = \\big(\\rho\\cos\\varphi,\\ y,\\ \\rho\\sin\\varphi\\big)' }
    ],
    params: [
      { key: 'turns', symbol: 'N', meaning: 'how many full turns the coil winds from base to apex' },
      { key: 'decay', symbol: '\\kappa', meaning: 'exponential radius-decay rate — higher tightens the funnel faster' },
      { key: 'climb', symbol: 'h', meaning: 'total height of the coil (how tall the funnel stands)' },
      { key: 'tube', symbol: '\\rho', meaning: 'radius of the glowing tube swept along the curve' }
    ],
    code: "const R0 = 1.15, turns = p.turns, decay = p.decay, climb = p.climb;\nconst W = turns * 2*Math.PI;\nconst C = (t) => {\n  const u = t / (2*Math.PI);              // u in [0,1] along the coil\n  const rho = R0 * Math.exp(-decay * u);  // radius decays exponentially\n  const phi = W * u;                       // uniform winding\n  return [rho*Math.cos(phi), climb*(u-0.5), rho*Math.sin(phi)];\n};\n// swept into a glowing tube — a 3D logarithmic funnel-coil",
    links: [
      {
        label: 'Logarithmic spiral (Wikipedia)',
        url: 'https://en.wikipedia.org/wiki/Logarithmic_spiral'
      },
      {
        label: 'Parametric equation (Wikipedia)',
        url: 'https://en.wikipedia.org/wiki/Parametric_equation'
      }
    ]
  },
  theodorus: {
    title: 'Spiral of Theodorus',
    about:
      "Around 400 BC, Theodorus of Cyrene (a teacher of Plato) built a spiral from nothing but right triangles. Start with a unit right triangle — legs 1 and 1, hypotenuse √2. On that hypotenuse erect another triangle with a new unit leg; its hypotenuse is √3. Keep going and the outer corners land at radii √1, √2, √3, … — the square-root spiral, every irrational √n laid out by ruler and compass. Here it is DRIFT-DEFORMED: a small constant twist is added to each step and the single staircase is mirrored into several rotated copies, so the humble triangle spiral blooms into a rotationally-symmetric flower of nested zigzag petals.",
    howItWorks:
      "The n-th vertex sits at radius rₙ = √n and angle θₙ = Σ atan(1/√k) — each unit leg, seen from the centre at radius √k, subtends an angle atan(1/√k), and those angles accumulate as you climb the staircase. Joining consecutive vertices gives the zigzag arm (the unit legs are the teeth; the hypotenuses are the radial spokes). The 'drift' adds a constant δ to every step's angle, θₙ = Σ(atan(1/√k) + δ): a negative δ unwinds the natural ~2√N winding so each arm reads as a distinct curved petal rather than a dense coil, and once atan(1/√k) drops below δ the outer arm curls back, hooking the petal tips. The arm is replicated into M copies, each rotated by 2π/M, to make the flower's M-fold symmetry; every copy is swept into its own glowing tube (no chord links a tip back to the centre). Radius is normalised by √N so the framing stays put as you add triangles, and the figure is laid flat in the camera-facing X–Y plane. Colour runs along the arms, so each petal carries its own slice of the spectrum.",
    equations: [
      { label: 'vertex radius (√n spiral)', latex: 'r_n = \\sqrt{n}' },
      { label: 'cumulative turning angle', latex: '\\theta_n = \\sum_{k=1}^{n} \\arctan\\!\\frac{1}{\\sqrt{k}}' },
      { label: 'drift-deformed angle', latex: '\\theta_n = \\sum_{k=1}^{n} \\Big(\\arctan\\tfrac{1}{\\sqrt{k}} + \\delta\\Big)' },
      { label: 'vertex, M-fold copy j', latex: 'V_n^{(j)} = \\sqrt{n}\\,\\big(\\cos(\\theta_n + \\tfrac{2\\pi j}{M}),\\ \\sin(\\theta_n + \\tfrac{2\\pi j}{M})\\big)' },
      { label: 'asymptotic angle (Hlawka)', latex: '\\theta_n \\approx 2\\sqrt{n} - 2.157782\\ldots' },
    ],
    params: [
      { key: 'triangles', symbol: 'N', meaning: 'how many right triangles each arm is built from — more = a longer, finer staircase (lower N shows the teeth)' },
      { key: 'symmetry', symbol: 'M', meaning: 'number of rotated copies = the flower’s petal/fold count' },
      { key: 'drift', symbol: '\\delta', meaning: 'constant angular twist added per step; negative unwinds the spiral into open petals, positive coils it tighter' },
      { key: 'tube', symbol: '\\rho', meaning: 'radius of the glowing tube swept along each arm' },
      { key: 'lift', symbol: '\\ell', meaning: 'amplitude of a small z-ripple lifting the flat flower into a gently undulating 3D ribbon' },
    ],
    code: "// √n spiral of right triangles, drift-twisted + mirrored into an M-fold flower\nlet acc = 0; const th = [0];\nfor (let v = 1; v < N; v++) { acc += Math.atan(1/Math.sqrt(v)) + drift; th[v] = acc; }\nconst vert = (v, arm) => {                 // arm = 0…M-1 (rotated copy)\n  const r = Math.sqrt(v+1) / Math.sqrt(N); // radius √v, normalised\n  const a = th[v] + arm * (2*Math.PI/M);   // cumulative angle + copy rotation\n  return [r*Math.cos(a), r*Math.sin(a), lift*Math.sin(v*0.6)];\n};\n// join consecutive vertices of each arm into a swept glowing tube (X-Y plane)",
    links: [
      { label: 'Spiral of Theodorus (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Spiral_of_Theodorus' },
      { label: 'Theodorus of Cyrene (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Theodorus_of_Cyrene' },
      { label: 'Hlawka — the Theodorus constant', url: 'https://en.wikipedia.org/wiki/Spiral_of_Theodorus#Growth_rate' },
    ]
  },
  stringWorldsheet: {
    title: 'String Worldsheet',
    about:
      "A classical point particle drags a 1-D worldLINE through spacetime; a relativistic string sweeps a 2-D worldSHEET. This is that sheet, made visible. The string is a vibrating curve — a superposition of standing-wave harmonics, exactly the normal modes of a violin string — and as time advances the curve is swept along a second axis so the surface it traces flows through a static spacetime grid: the leading edge is the string 'now', and every row behind it is the string at an earlier, retarded time. Switch between an OPEN string (pinned ends, like a guitar string) and a CLOSED loop (periodic, the kind whose lowest mode is the graviton in string theory) and the whole sheet changes character.",
    howItWorks:
      "Two coordinates parametrise the sheet: σ runs along the string (0→1) and τ is time. The transverse shape is a sum of N harmonics, y(σ,τ) = Σ aₙ·basisₙ(σ)·cos(ωₙτ+φₙ), with amplitudes aₙ = 1/n (high modes taper) and frequencies ωₙ = nπc set by the tension (wave speed c = √T). For an OPEN string the spatial basis is sin(nπσ) — nodes pinned at both ends; for a CLOSED string it is cos(2πnσ) — periodic around the loop. A second, independently-phased copy of the same sum drives a transverse z displacement, so the string is a genuinely 3-D wiggling curve rather than a flat graph. To make the sheet FLOW, each grid row is evaluated at a retarded time τ = t − (1−τ_local)·window: the present edge (τ_local=1) shows the string now, rows behind it show its past, and as t advances the whole history scrolls through the fixed grid. Colour is baked once — hue along σ (teal→violet), brightness ramping from the dim past edge to the bright present, multiplied by the standing-wave antinode envelope so nodes stay dark and antinodes glow. Bounded for all time (a sum of cosines).",
    equations: [
      { label: 'transverse displacement (mode sum)', latex: 'y(\\sigma,\\tau) = \\sum_{n=1}^{N} a_n\\,\\beta_n(\\sigma)\\,\\cos(\\omega_n \\tau + \\varphi_n), \\quad a_n = \\tfrac{1}{n}' },
      { label: 'spatial basis: open vs closed', latex: '\\beta_n(\\sigma) = \\begin{cases} \\sin(n\\pi\\sigma) & \\text{open (pinned ends)} \\\\ \\cos(2\\pi n\\sigma) & \\text{closed (loop)} \\end{cases}' },
      { label: 'mode frequency from tension', latex: '\\omega_n = n\\pi c, \\qquad c = \\sqrt{T}' },
      { label: 'retarded-time sweep (the sheet flows)', latex: '\\tau(\\sigma_{\\text{row}}) = t - (1 - \\tau_{\\text{local}})\\,W' },
    ],
    params: [
      { key: 'harmonics', symbol: 'N', meaning: 'number of standing-wave modes summed — more = a richer, busier string' },
      { key: 'openVsClosed', symbol: '\\beta', meaning: 'open string (pinned ends, sin basis) vs closed loop (periodic, cos basis)' },
      { key: 'tension', symbol: 'T', meaning: 'string tension → wave speed c=√T → how fast the harmonics oscillate' },
      { key: 'amp', symbol: 'a', meaning: 'overall vibration amplitude (how far the sheet bulges)' },
      { key: 'sweep', symbol: 's', meaning: 'how fast time advances and the sheet scrolls through the grid' },
      { key: 'window', symbol: 'W', meaning: 'how much past history the swept τ-window holds behind the present edge' },
    ],
    code: "// worldsheet point at (σ, retarded τ): sum of standing-wave harmonics\nconst displace = (sg, rt) => {            // sg=σ∈[0,1], rt=retarded time\n  const c = Math.sqrt(tension);\n  let y = 0, z = 0;\n  for (let n = 1; n <= N; n++) {\n    const basis = closed ? Math.cos(2*Math.PI*n*sg) : Math.sin(Math.PI*n*sg);\n    const w = n*Math.PI*c;                 // mode frequency ωₙ\n    y += (1/n)*basis*Math.cos(w*rt + phY[n]);\n    z += (1/n)*basis*Math.cos(w*rt + phZ[n]);   // 2nd polarisation\n  }\n  return [y*amp, z*amp];\n};\nconst rt = t - (1 - tauLocal)*window;       // present edge leads, past trails\n// x = σ along string, y = displacement, z = τ-axis + z-bulge",
    links: [
      { label: 'Worldsheet (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Worldsheet' },
      { label: 'Vibrating string / normal modes', url: 'https://en.wikipedia.org/wiki/String_vibration' },
      { label: 'String theory (Wikipedia)', url: 'https://en.wikipedia.org/wiki/String_theory' },
    ]
  },
  dandelion: {
    title: 'Dandelion',
    about:
      "A dandelion blowball is a lesson in spherical packing. Hundreds of seeds sit on a tiny domed receptacle, each on a slender stalk tipped with a pappus — a radial umbrella of fine bristles that catches the wind. To crowd that many seeds onto a sphere without gaps or seams, the plant uses the same golden-angle spacing that sets the spirals of a sunflower head. The result is the familiar near-perfect translucent sphere of fluff. This is a generative reconstruction of that geometry — nature as a mathematician.",
    howItWorks:
      "Each seed's stalk points outward in a direction taken from a Fibonacci sphere: walk down the sphere in equal steps of height while turning by the golden angle (≈137.5°) each step, and the directions spread out evenly with no two crowding — the 3-D analogue of sunflower phyllotaxis. Along each direction we draw a thin radial filament from a small central receptacle out to a faintly ellipsoidal shell, and at the tip we scatter a soft Gaussian 'puff' of bristles (the pappus). Stalks are drawn dim, the pappus tips bright cream, and the innermost points carry the tan of the seed cup. A slow tumble shows it's a sphere, not a disk. Static geometry — nothing to integrate, bounded by the shell radius.",
    equations: [
      { label: 'Fibonacci-sphere seed directions', latex: 'y_k = 1 - \\tfrac{2k+1}{N}, \\quad \\phi_k = k\\,\\gamma, \\quad \\gamma = \\pi(3-\\sqrt{5})' },
      { label: 'golden angle (even spherical packing)', latex: '\\gamma = 2\\pi\\big(1 - \\tfrac{1}{\\varphi}\\big) \\approx 137.5^{\\circ}' },
      { label: 'stalk + pappus along each direction', latex: '\\mathbf{x} = \\hat{\\mathbf{d}}_k\\,r + \\text{puff},\\quad r \\in [r_0,\\,R]' },
    ],
    params: [
      { key: 'seeds', symbol: 'N', meaning: 'number of seed stalks packed on the sphere' },
      { key: 'puff', symbol: '\\rho', meaning: 'size of the pappus bristle-burst at each tip' },
      { key: 'oblate', symbol: 'e', meaning: 'vertical stretch — a faintly ellipsoidal (not perfectly round) blowball' },
      { key: 'spin', symbol: '\\nu', meaning: 'tumble rate' },
    ],
    code: "// each seed: a Fibonacci-sphere direction, a stalk, and a pappus puff at the tip\nfor (let k = 0; k < N; k++) {\n  const y = 1 - 2*(k + 0.5)/N;             // even heights\n  const rad = Math.sqrt(1 - y*y);\n  const phi = k * Math.PI*(3 - Math.sqrt(5));   // golden angle\n  const dir = [rad*Math.cos(phi), y, rad*Math.sin(phi)];\n  // stalk: dir * r  for r in [r0, R];   pappus: dir*R + small gaussian burst\n}",
    links: [
      { label: 'Pappus (botany) (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Pappus_(botany)' },
      { label: 'Fibonacci sphere / lattice', url: 'https://en.wikipedia.org/wiki/Fibonacci_sequence#Nature' },
      { label: 'Phyllotaxis (golden angle)', url: 'https://en.wikipedia.org/wiki/Phyllotaxis' },
    ]
  },
};
