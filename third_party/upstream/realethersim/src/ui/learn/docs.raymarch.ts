import type { SystemDoc } from './content';

// Learn-panel content for the 3D sphere-traced fractals. These are rendered by a distance-estimator
// (DE) fragment shader (src/render/raymarch.ts): for each pixel a ray is marched until the DE — a
// guaranteed lower bound on the distance to the fractal surface — says we've hit it. Math is
// authored against that shader so the equations match what's on screen.

const COL_PARAM = { key: 'colShift', symbol: '\\phi', meaning: 'hue offset of the orbit-trap colour palette' };
const ANIM_PARAM = { key: 'animate', symbol: '\\alpha', meaning: 'amount the shape morphs over time (0 = frozen)' };

export const RAYMARCH_DOCS: Record<string, SystemDoc> = {
  mandelbulb: {
    title: 'Mandelbulb',
    about:
      'The Mandelbulb is the best-known attempt at a “true” 3D Mandelbrot set. Daniel White and ' +
      'Paul Nylander built it in 2009 by inventing a way to square-and-add points in 3D using ' +
      'spherical coordinates. Raising the exponent to the 8th power gives the iconic bulbous, ' +
      'coral-like surface riddled with self-similar detail.',
    howItWorks:
      'Each point in space is iterated zₙ₊₁ = zₙ^p + c (with c the point itself). The cube of space ' +
      'is converted to spherical coordinates, the radius is raised to the power p and the two angles ' +
      'are multiplied by p, then it is converted back — the 3D analogue of squaring a complex number. ' +
      'Points whose orbit stays bounded are inside the set. A running derivative dr turns the escape ' +
      'radius into a distance estimate, so a ray can sphere-trace straight to the surface.',
    equations: [
      { label: 'Iteration', latex: 'z \\mapsto z^{p} + c, \\quad c = \\text{point}' },
      {
        label: 'Power (spherical)',
        latex:
          'z^{p} = r^{p}\\big(\\sin(p\\theta)\\cos(p\\varphi),\\; \\sin(p\\theta)\\sin(p\\varphi),\\; \\cos(p\\theta)\\big)',
      },
      { label: 'Running derivative', latex: "dr \\mapsto p\\, r^{p-1}\\, dr + 1" },
      { label: 'Distance estimate', latex: 'DE = \\tfrac{1}{2}\\, \\frac{r \\ln r}{dr}' },
    ],
    params: [
      { key: 'power', symbol: 'p', meaning: 'exponent; p = 8 is the classic Mandelbulb, other values give exotic shapes' },
      COL_PARAM,
      ANIM_PARAM,
    ],
    code: `// per sample point p, iterate in spherical coords
let z = p, dr = 1, r = 0;
for (let i = 0; i < ITER; i++) {
  r = length(z);
  if (r > 2) break;
  dr = pow(r, power - 1) * power * dr + 1;
  const theta = acos(z.z / r) * power;
  const phi   = atan2(z.y, z.x) * power;
  const zr    = pow(r, power);
  z = zr * vec3(sin(theta)*cos(phi), sin(theta)*sin(phi), cos(theta)) + p;
}
return 0.5 * log(r) * r / dr;   // distance estimate`,
    links: [
      { label: 'Mandelbulb (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Mandelbulb' },
      { label: 'Daniel White — the original write-up', url: 'https://www.skytopia.com/project/fractal/mandelbulb.html' },
      { label: 'Inigo Quilez — distance estimation', url: 'https://iquilezles.org/articles/distancefractals/' },
    ],
  },

  qjulia: {
    title: 'Quaternion Julia',
    about:
      'Julia sets generalise beautifully into four dimensions using quaternions — numbers with one ' +
      'real and three imaginary parts. The full set is 4D, so we take a 3D slice (fixing the 4th ' +
      'coordinate) and render it as a glassy, organic solid. Sweeping the constant c morphs it ' +
      'continuously through a family of shapes.',
    howItWorks:
      'The same z ↦ z² + c iteration as the 2D Julia set, but z and c are quaternions and ' +
      'multiplication is the (non-commutative) Hamilton product. A point is in the set if its orbit ' +
      'stays bounded. Tracking the derivative quaternion gives the Koebe/Hart distance estimate ' +
      'DE = ½·(|z|/|z′|)·ln|z|, which the ray-marcher uses to find the surface.',
    equations: [
      { label: 'Iteration', latex: 'q \\mapsto q^{2} + c, \\quad q,c \\in \\mathbb{H}' },
      {
        label: 'Quaternion square',
        latex: 'q^{2} = \\big(q_0^{2}-\\lVert \\mathbf{q}\\rVert^{2},\\; 2q_0\\mathbf{q}\\big)',
      },
      { label: 'Derivative', latex: "q' \\mapsto 2\\,q\\,q'" },
      { label: 'Distance estimate', latex: 'DE = \\tfrac{1}{4}\\,\\frac{|q|}{|q\'|}\\,\\ln|q|^{2}' },
    ],
    params: [
      { key: 'cx', symbol: 'c_0', meaning: 'real part of the quaternion constant c' },
      { key: 'cy', symbol: 'c_1', meaning: 'first imaginary part of c' },
      { key: 'cz', symbol: 'c_2', meaning: 'second imaginary part of c' },
      { key: 'cw', symbol: 'c_3', meaning: 'third imaginary part (the 4D-slice offset)' },
      COL_PARAM,
      ANIM_PARAM,
    ],
    code: `let q = vec4(p, 0), dq = vec4(1, 0, 0, 0);
let mz2 = dot(q, q), md2 = 1;
for (let i = 0; i < ITER; i++) {
  if (mz2 > 16) break;
  dq = 2 * qmul(q, dq);   // derivative: q' = 2 q q'
  q  = qsqr(q) + c;       // q = q^2 + c   (Hamilton product)
  md2 = dot(dq, dq);
  mz2 = dot(q, q);
}
return 0.25 * log(mz2) * sqrt(mz2 / md2);`,
    links: [
      { label: 'Julia set (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Julia_set' },
      { label: 'Quaternion Julia sets — Hart et al. (1989)', url: 'https://graphics.stanford.edu/courses/cs348b-20-spring-content/uploads/hart.pdf' },
      { label: 'Inigo Quilez — quaternion Julia', url: 'https://iquilezles.org/articles/juliasets/' },
    ],
  },

  mandelbox: {
    title: 'Mandelbox',
    about:
      'Discovered by Tom Lowe in 2010, the Mandelbox is a fractal built not from squaring but from ' +
      'folding space. Repeatedly reflecting and inflating points produces vast, scale-invariant ' +
      'architecture — endless boxes, corridors and balconies — that looks engineered rather than grown.',
    howItWorks:
      'Each iteration applies three conformal operations: a box fold (reflect any coordinate that ' +
      'leaves the [-1, 1] cube), a sphere fold (inflate points near the centre, invert those in a ' +
      'shell), then a linear scale-and-translate. The running derivative dr tracks how these maps ' +
      'stretch space, giving the distance estimate DE = |z| / |dr|. Negative scale values produce the ' +
      'classic hollow look.',
    equations: [
      { label: 'Box fold', latex: 'z \\mapsto \\operatorname{clamp}(z,-1,1)\\cdot 2 - z' },
      {
        label: 'Sphere fold',
        latex:
          'z \\mapsto \\begin{cases} z\\,/\\,r_{\\min}^{2} & |z|^2 < r_{\\min}^2 \\\\ z\\,/\\,|z|^2 & r_{\\min}^2 \\le |z|^2 < 1 \\\\ z & \\text{else} \\end{cases}',
      },
      { label: 'Scale + translate', latex: 'z \\mapsto s\\,z + c, \\quad dr \\mapsto |s|\\,dr + 1' },
      { label: 'Distance estimate', latex: 'DE = |z| / |dr|' },
    ],
    params: [
      { key: 'scale', symbol: 's', meaning: 'scale factor; negative values (≈ -1.6) give the iconic hollow box' },
      { key: 'minRadius', symbol: 'r_{\\min}', meaning: 'inner radius of the sphere fold — controls density of detail' },
      COL_PARAM,
      ANIM_PARAM,
    ],
    code: `let z = p, dr = 1;
for (let i = 0; i < ITER; i++) {
  z = clamp(z, -1, 1) * 2 - z;          // box fold
  const r2 = dot(z, z);
  if (r2 < minR2)      { z /= minR2; dr /= minR2; }   // sphere fold (inflate)
  else if (r2 < 1)     { z /= r2;    dr /= r2;    }   // sphere fold (invert)
  z = z * scale + p;                    // scale + translate
  dr = dr * abs(scale) + 1;
}
return length(z) / abs(dr);`,
    links: [
      { label: 'Mandelbox (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Mandelbox' },
      { label: 'Tom Lowe — original FractalForums thread', url: 'https://www.fractalforums.com/3d-fractal-generation/a-mandelbox-distance-estimate-formula/' },
    ],
  },

  menger: {
    title: 'Menger Sponge',
    about:
      'The Menger sponge, described by Karl Menger in 1926, is the 3D cousin of the Cantor set and ' +
      'Sierpiński carpet. Start with a cube, drill a square hole through the centre of each face and ' +
      'the middle, then repeat on every remaining sub-cube forever. The limit has zero volume but ' +
      'infinite surface area.',
    howItWorks:
      'Rather than recurse, the shader folds space: at each level it tiles the point into a unit cell, ' +
      'scales up by 3, and subtracts a “cross” of three square channels using exact box distances. ' +
      'Because every operation is a true signed-distance function, the result is an exact DE — the ' +
      'crispest and most robust of the four to ray-march.',
    equations: [
      {
        label: 'Box SDF',
        latex: 'd_{\\text{box}}(p,b) = \\lVert \\max(|p|-b, 0)\\rVert + \\min(\\max(|p|-b),0)',
      },
      { label: 'Fold + scale', latex: 'a = |\\,\\operatorname{mod}(3^{m}p, 2) - 1\\,|, \\quad m = 0,1,2,\\dots' },
      { label: 'Cross subtraction', latex: 'd \\mapsto \\max\\!\\big(d,\\; (\\min(d_a,d_b,d_c)-1)/3^{m}\\big)' },
    ],
    params: [
      { key: 'spin', symbol: '\\psi', meaning: 'static tilt of the sponge so the channels catch the light' },
      COL_PARAM,
      ANIM_PARAM,
    ],
    code: `let d = sdBox(p, vec3(1)), s = 1;     // start from the solid cube
for (let m = 0; m < ITER; m++) {
  const a = abs(mod(p * s, 2) - 1);
  s *= 3;
  const r = abs(1 - 3 * a);
  const cross = (min(max(r.x,r.y), min(max(r.y,r.z), max(r.z,r.x))) - 1) / s;
  d = max(d, cross);                   // CSG: carve the channels
}
return d;                              // exact signed distance`,
    links: [
      { label: 'Menger sponge (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Menger_sponge' },
      { label: 'Inigo Quilez — distance functions', url: 'https://iquilezles.org/articles/distfunctions/' },
    ],
  },

  // ── implicit isosurfaces (Surface category) ──
  gyroid: {
    title: 'Gyroid',
    about:
      'The gyroid is a triply-periodic minimal surface discovered by Alan Schoen at NASA in 1970 — ' +
      'infinitely connected, smoothly curved, with no straight lines and no self-intersections. It ' +
      'splits space into two interpenetrating, congruent labyrinths. Nature uses it in butterfly-wing ' +
      'scales and block copolymers; engineers 3D-print it as an ultra-light, strong lattice.',
    howItWorks:
      'Rather than a marching-cubes mesh, we render the level set F = isovalue directly: a ray-marcher ' +
      'finds where the short trigonometric field F crosses the isovalue for each pixel and shades by ' +
      'its gradient ∇F. The "isovalue" knob thickens or thins the two channels; at 0 they’re balanced.',
    equations: [
      { label: 'gyroid level set', latex: '\\sin x\\cos y + \\sin y\\cos z + \\sin z\\cos x = c' },
      { label: 'minimal surface (zero mean curvature)', latex: 'H = \\tfrac{1}{2}(\\kappa_1 + \\kappa_2) = 0' },
    ],
    params: [
      { key: 'iso', symbol: 'c', meaning: 'isovalue (level set); 0 is the balanced gyroid, ±values thicken one labyrinth' },
      { key: 'colShift', symbol: '\\phi', meaning: 'hue offset of the core→edge colour gradient' },
      { key: 'animate', symbol: '\\alpha', meaning: 'gently breathes the isovalue over time (0 = still)' },
    ],
    code: `// implicit field; the surface is F = isovalue
const F = (p) => sin(p.x)*cos(p.y) + sin(p.y)*cos(p.z) + sin(p.z)*cos(p.x);
// raymarch it as a distance estimate, normal = ∇F:
const de = abs(F(p) - iso) / length(grad(F, p));   // |F−iso| / |∇F|`,
    links: [
      { label: 'Gyroid (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Gyroid' },
      { label: 'Triply periodic minimal surface', url: 'https://en.wikipedia.org/wiki/Triply_periodic_minimal_surface' },
    ],
  },
  schwarzP: {
    title: 'Schwarz P (Primitive)',
    about:
      'One of the first triply-periodic minimal surfaces, found by Hermann Schwarz in the 1880s. With ' +
      'simple-cubic symmetry it partitions space into two identical "plumber’s nightmare" networks of ' +
      'pipes meeting at right angles.',
    howItWorks:
      'The simplest possible TPMS field — a sum of three cosines. We render its level set as a lit ' +
      'isosurface; the isovalue pinches or opens the necks where the pipes join.',
    equations: [{ label: 'Schwarz P level set', latex: '\\cos x + \\cos y + \\cos z = c' }],
    params: [
      { key: 'iso', symbol: 'c', meaning: 'isovalue; near ±1 the necks pinch off into separate cells' },
      { key: 'colShift', symbol: '\\phi', meaning: 'colour gradient offset' },
      { key: 'animate', symbol: '\\alpha', meaning: 'breathes the isovalue (0 = still)' },
    ],
    code: `const F = (p) => cos(p.x) + cos(p.y) + cos(p.z);   // surface: F = isovalue`,
    links: [{ label: 'Schwarz minimal surface (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Schwarz_minimal_surface' }],
  },
  schwarzD: {
    title: 'Schwarz D (Diamond)',
    about:
      'Schwarz’s diamond surface: its two interwoven labyrinths trace the diamond (tetrahedral) lattice ' +
      '— the same geometry as carbon in diamond. Remarkably, the gyroid is the unique intermediate ' +
      '"associate" surface that bends Schwarz D continuously into Schwarz P without stretching.',
    howItWorks:
      'A four-term trigonometric field with diamond symmetry, rendered as a level-set isosurface lit by ' +
      'its gradient. The isovalue controls the channel thickness.',
    equations: [
      {
        label: 'Schwarz D level set',
        latex: '\\sin x\\sin y\\sin z + \\sin x\\cos y\\cos z + \\cos x\\sin y\\cos z + \\cos x\\cos y\\sin z = c',
      },
    ],
    params: [
      { key: 'iso', symbol: 'c', meaning: 'isovalue (channel thickness)' },
      { key: 'colShift', symbol: '\\phi', meaning: 'colour gradient offset' },
      { key: 'animate', symbol: '\\alpha', meaning: 'breathes the isovalue (0 = still)' },
    ],
    code: `const F = (p) => sin(x)*sin(y)*sin(z) + sin(x)*cos(y)*cos(z)
              + cos(x)*sin(y)*cos(z) + cos(x)*cos(y)*sin(z);  // F = isovalue`,
    links: [{ label: 'Schwarz minimal surface (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Schwarz_minimal_surface' }],
  },
  schoenIWP: {
    title: 'Schoen I-WP',
    about:
      'Another of Alan Schoen’s 1970 minimal surfaces, with body-centred-cubic symmetry. The "I-WP" ' +
      '("I-Wrapped Package") splits space into two NON-congruent labyrinths — one wraps around bcc ' +
      'lattice points, the other threads between them — giving its distinctive cage-of-cages look.',
    howItWorks:
      'A trigonometric level set with both first- and second-harmonic cosine terms, rendered as a lit ' +
      'isosurface. The isovalue trades volume between the two unequal labyrinths.',
    equations: [
      {
        label: 'Schoen I-WP level set',
        latex: '2(\\cos x\\cos y + \\cos y\\cos z + \\cos z\\cos x) - (\\cos 2x + \\cos 2y + \\cos 2z) = c',
      },
    ],
    params: [
      { key: 'iso', symbol: 'c', meaning: 'isovalue; shifts volume between the two unequal labyrinths' },
      { key: 'colShift', symbol: '\\phi', meaning: 'colour gradient offset' },
      { key: 'animate', symbol: '\\alpha', meaning: 'breathes the isovalue (0 = still)' },
    ],
    code: `const F = (p) => 2*(cos(x)*cos(y) + cos(y)*cos(z) + cos(z)*cos(x))
              - (cos(2*x) + cos(2*y) + cos(2*z));   // F = isovalue`,
    links: [{ label: 'Triply periodic minimal surface', url: 'https://en.wikipedia.org/wiki/Triply_periodic_minimal_surface' }],
  },
  neovius: {
    title: 'Neovius Surface',
    about:
      'Discovered in 1883 by Edvard Neovius, a student of Schwarz. It shares Schwarz P’s simple-cubic ' +
      'symmetry but adds a fourth term, fattening the nodes where the channels meet into chunky cubic ' +
      'hubs connected by narrow necks.',
    howItWorks:
      'Schwarz P’s three cosines plus a triple-product term, rendered as a level-set isosurface. The ' +
      'isovalue tunes the balance between the bulbous hubs and the connecting necks.',
    equations: [{ label: 'Neovius level set', latex: '3(\\cos x + \\cos y + \\cos z) + 4\\cos x\\cos y\\cos z = c' }],
    params: [
      { key: 'iso', symbol: 'c', meaning: 'isovalue (hub vs neck balance)' },
      { key: 'colShift', symbol: '\\phi', meaning: 'colour gradient offset' },
      { key: 'animate', symbol: '\\alpha', meaning: 'breathes the isovalue (0 = still)' },
    ],
    code: `const F = (p) => 3*(cos(x)+cos(y)+cos(z)) + 4*cos(x)*cos(y)*cos(z);  // F = isovalue`,
    links: [{ label: 'Neovius surface (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Neovius_surface' }],
  },
  chmutov: {
    title: 'Chmutov Octic',
    about:
      'Unlike the minimal surfaces, this is an algebraic surface — a degree-8 polynomial zero set built ' +
      'by Sergei Chmutov from Chebyshev polynomials. Chmutov’s construction packs a near-record number ' +
      'of nodal singularities for its degree, producing a dense, highly symmetric lattice of tunnels ' +
      'and pinch points inside the unit cube.',
    howItWorks:
      'Sum the 8th Chebyshev polynomial T₈ evaluated on each axis; its zero set is the surface. Because ' +
      'the gradient varies a lot, we under-relax the ray-march step, then light it by the gradient.',
    equations: [
      { label: 'Chmutov octic', latex: 'T_8(x) + T_8(y) + T_8(z) = c' },
      { label: '8th Chebyshev polynomial', latex: 'T_8(t) = 128t^8 - 256t^6 + 160t^4 - 32t^2 + 1' },
    ],
    params: [
      { key: 'iso', symbol: 'c', meaning: 'isovalue; sweeps through the family of related level sets' },
      { key: 'colShift', symbol: '\\phi', meaning: 'colour gradient offset' },
      { key: 'animate', symbol: '\\alpha', meaning: 'sweeps the isovalue over time (0 = still)' },
    ],
    code: `const T8 = (t)=>{const a=t*t,b=a*a,c=b*a,d=b*b; return 128*d - 256*c + 160*b - 32*a + 1;};
const F = (p) => T8(p.x) + T8(p.y) + T8(p.z);   // surface: F = isovalue`,
    links: [
      { label: 'Chmutov surfaces', url: 'https://en.wikipedia.org/wiki/Algebraic_surface' },
      { label: 'Chebyshev polynomials', url: 'https://en.wikipedia.org/wiki/Chebyshev_polynomials' },
    ],
  },
  heart: {
    title: 'Heart',
    about:
      'The Taubin heart surface — a sextic (degree-6) algebraic surface whose zero set is a plump, ' +
      'three-dimensional valentine. It’s the canonical example of an implicit surface that would be ' +
      'painful to describe with a parametric formula but falls out of a single polynomial equation.',
    howItWorks:
      'A core ellipsoid term is cubed, then two negative z³ terms pull the top into the two lobes and ' +
      'the bottom into the cusp. We render it the same way as the minimal surfaces: distance ≈ |F|/|∇F|.',
    equations: [
      { label: 'Taubin heart', latex: '\\left(x^2 + \\tfrac94 y^2 + z^2 - 1\\right)^3 - x^2 z^3 - \\tfrac{9}{80}\\,y^2 z^3 = 0' },
    ],
    params: [
      { key: 'iso', symbol: 'c', meaning: 'isovalue; inflates or deflates the heart' },
      { key: 'colShift', symbol: '\\phi', meaning: 'colour gradient offset' },
      { key: 'animate', symbol: '\\alpha', meaning: 'sweeps the isovalue over time (0 = still)' },
    ],
    code: `// cusp axis remapped to world-up so it stands upright
const F = (x,y,z) => { const b = x*x + 2.25*z*z + y*y - 1;
  return b*b*b - x*x*y*y*y - 0.1125*z*z*y*y*y; };`,
    links: [{ label: 'Heart surface (MathWorld)', url: 'https://mathworld.wolfram.com/HeartSurface.html' }],
  },
  tanglecube: {
    title: 'Tanglecube',
    about:
      'A smooth quartic (degree-4) surface that looks like four rounded lobes tangled through a central ' +
      'cage — a favourite test object for implicit-surface renderers because it’s symmetric, bounded, ' +
      'and has no singular points to trip up the ray-march.',
    howItWorks:
      'Each axis contributes a double-well polynomial t⁴ − 5t²; summed with a constant, the zero set is ' +
      'the tangle. The wells along each axis are what carve out the four lobes.',
    equations: [
      { label: 'tanglecube', latex: 'x^4 - 5x^2 + y^4 - 5y^2 + z^4 - 5z^2 + 11.8 = 0' },
    ],
    params: [
      { key: 'iso', symbol: 'c', meaning: 'isovalue; opens and closes the central tangle' },
      { key: 'colShift', symbol: '\\phi', meaning: 'colour gradient offset' },
      { key: 'animate', symbol: '\\alpha', meaning: 'sweeps the isovalue over time (0 = still)' },
    ],
    code: `const F = (x,y,z) => x**4 - 5*x*x + y**4 - 5*y*y + z**4 - 5*z*z + 11.8;`,
    links: [{ label: 'Tanglecube (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Tanglecube' }],
  },
  goursat: {
    title: 'Goursat',
    about:
      'The Goursat surfaces are the family of quartics built only from the symmetric quantities x⁴+y⁴+z⁴ ' +
      'and (x²+y²+z²). This one — x⁴+y⁴+z⁴ = 1 — is the "squircle" in 3D: a cube with the edges and ' +
      'corners rounded off. Push the isovalue and it inflates from a near-sphere toward a sharper cube.',
    howItWorks:
      'The quartic norm x⁴+y⁴+z⁴ measures distance in a way that bulges toward the cube’s corners; its ' +
      'level set is a rounded cube. Raised powers ⇒ sharper edges.',
    equations: [
      { label: 'Goursat (rounded cube)', latex: 'x^4 + y^4 + z^4 = 1 + c' },
    ],
    params: [
      { key: 'iso', symbol: 'c', meaning: 'isovalue; 0 = rounded cube, higher ⇒ larger / squarer' },
      { key: 'colShift', symbol: '\\phi', meaning: 'colour gradient offset' },
      { key: 'animate', symbol: '\\alpha', meaning: 'sweeps the isovalue over time (0 = still)' },
    ],
    code: `const F = (x,y,z) => x**4 + y**4 + z**4 - 1;   // surface: F = isovalue`,
    links: [{ label: 'Goursat surface (MathWorld)', url: 'https://mathworld.wolfram.com/GoursatsSurface.html' }],
  },
  barth: {
    title: 'Barth Sextic',
    about:
      'Wolf Barth’s 1996 sextic is famous for a reason: it has 65 ordinary double points (nodes), the ' +
      'maximum possible for a degree-6 surface. Its equation is laced with the golden ratio φ, and the ' +
      'nodes sit at the vertices of nested icosahedra — a crystalline knot of pinch points.',
    howItWorks:
      'Three factors of the form φ²·a²−b² (cyclically permuted) multiply to give the icosahedral ' +
      'symmetry, minus a squared sphere term that closes it up. The nodes are where the surface pinches ' +
      'to a point, so the ray-march is run with extra steps to resolve them.',
    equations: [
      {
        label: 'Barth sextic',
        latex: '4(\\varphi^2 x^2 - y^2)(\\varphi^2 y^2 - z^2)(\\varphi^2 z^2 - x^2) - (1+2\\varphi)(x^2+y^2+z^2-1)^2 = 0',
      },
      { label: 'golden ratio', latex: '\\varphi = \\tfrac{1+\\sqrt5}{2} \\approx 1.618' },
    ],
    params: [
      { key: 'iso', symbol: 'c', meaning: 'isovalue; perturbs the surface off its singular zero set' },
      { key: 'colShift', symbol: '\\phi', meaning: 'colour gradient offset' },
      { key: 'animate', symbol: '\\alpha', meaning: 'sweeps the isovalue over time (0 = still)' },
    ],
    code: `const P = 2.6180339887;   // φ²
const F = (x,y,z) => { const a=x*x,b=y*y,c=z*z, s=a+b+c-1;
  return 4*(P*a-b)*(P*b-c)*(P*c-a) - 4.2360679*s*s; };`,
    links: [{ label: 'Barth surface (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Barth_surface' }],
  },
  "kummer": {
    "title": "Kummer Surface",
    "about": "Ernst Kummer's 1864 quartic is the most singular surface its degree allows: a degree-4 surface can have at most 16 ordinary double points, and the Kummer surface achieves exactly that maximum. The 16 conical pinch points (nodes) sit in a strikingly symmetric arrangement, paired with 16 special tangent planes (tropes) in the famous 16₆ configuration. It is the quotient of a complex torus by sign-flip, which is why it haunts the theory of abelian varieties and theta functions.",
    "howItWorks": "We render the level set F = isovalue of the affine (tetrahedroid) Kummer quartic directly: a core sphere term (x²+y²+z²−μ²)² is balanced against the product of four planes scaled by λ. With μ=1.3 the parameter λ=(3μ²−1)/(3−μ²)≈3.11 tunes the surface to its 16-real-node form. A ray-marcher finds where F crosses the isovalue and shades by the gradient ∇F. Because ∇F nearly vanishes at the 16 nodes, the step is heavily under-relaxed and hard-capped so the march doesn't overshoot the pinch points.",
    "equations": [
      {
        "label": "Kummer quartic (affine)",
        "latex": "\\left(x^2+y^2+z^2-\\mu^2\\right)^2 - \\lambda\\,\\textstyle\\prod_{i=1}^{4} \\Pi_i = c"
      },
      {
        "label": "the four tropes",
        "latex": "\\Pi = (1-z-\\sqrt2\\,x)(1-z+\\sqrt2\\,x)(1+z+\\sqrt2\\,y)(1+z-\\sqrt2\\,y)"
      },
      {
        "label": "node-tuning parameter",
        "latex": "\\lambda = \\dfrac{3\\mu^2 - 1}{3 - \\mu^2}, \\quad \\mu = 1.3 \\Rightarrow \\lambda \\approx 3.11"
      },
      {
        "label": "16 nodes (maximal for a quartic)",
        "latex": "\\#\\{\\,\\nabla F = 0,\\; F = 0\\,\\} = 16"
      }
    ],
    "params": [
      {
        "key": "iso",
        "symbol": "c",
        "meaning": "isovalue; 0 is the singular 16-node Kummer, ±values smooth the pinch points open"
      },
      {
        "key": "colShift",
        "symbol": "\\phi",
        "meaning": "hue offset of the core→edge colour gradient"
      },
      {
        "key": "animate",
        "symbol": "\\alpha",
        "meaning": "gently sweeps the isovalue over time (0 = still)"
      }
    ],
    "code": "const mu2 = 1.69, lambda = 3.1069, s2 = Math.SQRT2;\nconst F = (x, y, z) => {\n  const r = x*x + y*y + z*z - mu2;\n  const prod = (1 - z - s2*x) * (1 - z + s2*x)\n             * (1 + z + s2*y) * (1 + z - s2*y);\n  return r*r - lambda*prod;   // surface: F = isovalue\n};",
    "links": [
      {
        "label": "Kummer surface (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Kummer_surface"
      },
      {
        "label": "Kummer surface (MathWorld)",
        "url": "https://mathworld.wolfram.com/KummerSurface.html"
      }
    ]
  },
  "clebsch": {
    "title": "Clebsch Cubic",
    "about": "The Clebsch diagonal cubic, found by Alfred Clebsch in 1871, is the most symmetric of all smooth cubic surfaces. Every smooth cubic contains exactly 27 straight lines, and the Clebsch is the unique one whose entire set of 27 lines is real and visible — they lace across its three rounded lobes in a perfectly symmetric weave. Ten special points (the Eckardt points) each lie where three of those lines cross, giving it a beauty prized since the 19th century, when plaster models of it sat in every serious mathematics department.",
    "howItWorks": "We render the zero set of a single cubic polynomial F(x,y,z) as a lit isosurface. Because a cubic is unbounded, the ray-march is clipped to a bounding sphere and only the recognisable central body is shown. The gradient of this degree-3 field swings over two orders of magnitude across the surface, so the |F−iso|/|∇F| step estimate is under-relaxed and hard-capped to stop the ray overshooting the flatter sheets. The isovalue knob slides through nearby cubics, fattening the lobes or pinching the necks where the lines bunch up.",
    "equations": [
      {
        "label": "Clebsch diagonal cubic (affine form)",
        "latex": "81(x^3+y^3+z^3) - 189\\!\\!\\sum_{i\\neq j}\\!x_i^2 x_j + 54\\,xyz - 126(xy+yz+zx) + 9(x^2+y^2+z^2) + 9(x+y+z) - 1 = c"
      },
      {
        "label": "symmetric (projective) form",
        "latex": "\\sum_{i=0}^{4} x_i^{3} = 0, \\qquad \\sum_{i=0}^{4} x_i = 0"
      },
      {
        "label": "the 27 lines",
        "latex": "\\#\\{\\text{lines on a smooth cubic}\\} = 27,\\ \\text{all real here}"
      }
    ],
    "params": [
      {
        "key": "iso",
        "symbol": "c",
        "meaning": "isovalue; 0 is the true Clebsch cubic, nearby values fatten the lobes or pinch the necks"
      },
      {
        "key": "colShift",
        "symbol": "\\phi",
        "meaning": "hue offset of the core→edge colour gradient"
      },
      {
        "key": "animate",
        "symbol": "\\alpha",
        "meaning": "gently sweeps the isovalue over time (0 = still)"
      }
    ],
    "code": "// affine real Clebsch cubic; surface is F = isovalue\nconst F = (x,y,z) => {\n  const x2=x*x, y2=y*y, z2=z*z;\n  return 81*(x*x2 + y*y2 + z*z2)\n    - 189*(x2*y + x2*z + y2*x + y2*z + z2*x + z2*y)\n    + 54*x*y*z - 126*(x*y + y*z + z*x)\n    + 9*(x2 + y2 + z2) + 9*(x + y + z) - 1;\n};",
    "links": [
      {
        "label": "Clebsch surface (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Clebsch_surface"
      },
      {
        "label": "Clebsch Diagonal Cubic (MathWorld)",
        "url": "https://mathworld.wolfram.com/ClebschDiagonalCubic.html"
      },
      {
        "label": "27 lines on a cubic surface (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Cubic_surface"
      }
    ]
  },
  "cayley": {
    "title": "Cayley Cubic",
    "about": "Cayley's nodal cubic is the cubic surface carrying the maximum number of singular points a cubic can have: four ordinary double points (nodes), arranged with the symmetry of a tetrahedron. Discovered by Arthur Cayley in the 1860s, it is the degree-3 champion of nodal surfaces, the cubic analogue of the Kummer quartic and Barth sextic. Three of its lines are the coordinate axes themselves, which meet the curving sheets exactly at the four pinch points.",
    "howItWorks": "We render the zero set of the cubic polynomial F directly as a lit isosurface: a ray is marched until F crosses the isovalue, and the surface is shaded by its gradient ∇F. Because the gradient vanishes at the four nodes, the distance estimate |F−iso|/|∇F| can blow up there, so the march step is under-relaxed and hard-capped (exactly like the heart surface) to stop it overshooting straight through a pinch point.",
    "equations": [
      {
        "label": "Cayley nodal cubic",
        "latex": "-5\\,\\big(x^2(y+z)+y^2(x+z)+z^2(x+y)\\big) + 2\\,(xy+yz+zx) = c"
      },
      {
        "label": "expanded form",
        "latex": "-5\\sum_{\\text{sym}} x^2 y \\; + \\; 2(xy+yz+zx) = c"
      },
      {
        "label": "diagonal section x=y=z=t",
        "latex": "F(t,t,t) = -30\\,t^3 + 6\\,t^2 = 6t^2(1-5t)"
      },
      {
        "label": "node condition",
        "latex": "F = 0 \\ \\text{and}\\ \\nabla F = 0 \\ \\Rightarrow\\ 4\\ \\text{nodes}"
      }
    ],
    "params": [
      {
        "key": "iso",
        "symbol": "c",
        "meaning": "isovalue; c = 0 is the singular cubic, nonzero values smooth the nodes into little necks or holes"
      },
      {
        "key": "colShift",
        "symbol": "\\phi",
        "meaning": "hue offset of the core→edge colour gradient"
      },
      {
        "key": "animate",
        "symbol": "\\alpha",
        "meaning": "gently sweeps the isovalue over time (0 = still)"
      }
    ],
    "code": "// surface: F = isovalue. Four nodes (incl. the origin) in a tetrahedron.\nconst F = (x, y, z) =>\n  -5 * (x*x*(y+z) + y*y*(x+z) + z*z*(x+y))\n  + 2 * (x*y + y*z + z*x);",
    "links": [
      {
        "label": "Cayley's nodal cubic (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Cayley%27s_nodal_cubic_surface"
      },
      {
        "label": "Cubic surface (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Cubic_surface"
      },
      {
        "label": "Nodal surfaces — Wolf Barth / IMAGINARY",
        "url": "https://imaginary.org/gallery/herwig-hauser-classic"
      }
    ]
  },
  "fischerKoch": {
    "title": "Fischer-Koch S",
    "about": "The Fischer-Koch S is a triply-periodic minimal surface with orthorhombic symmetry, named for crystallographers Werner Fischer and Elke Koch who catalogued it among the balanced minimal surfaces tiling space by crystallographic groups. Its single labyrinth threads through space in a sinuous, S-shaped weave - unlike the gyroid's two interlocking channels, here one channel snakes back through itself. It belongs to the same family of self-supporting, zero-mean-curvature lattices prized for 3D-printed metamaterials and bone-scaffold geometries.",
    "howItWorks": "We render the level set F = isovalue of a short trigonometric nodal approximation rather than meshing it. For each pixel a ray is marched until the field F crosses the isovalue, and the surface is lit by its gradient. The field mixes a second-harmonic cosine on one axis with first-harmonic sin and cos on the other two, cyclically, producing the characteristic S-weave. The isovalue knob fattens or thins the channel; at 0 the surface is balanced.",
    "equations": [
      {
        "label": "Fischer-Koch S level set",
        "latex": "\\cos 2x\\,\\sin y\\,\\cos z + \\cos 2y\\,\\sin z\\,\\cos x + \\cos 2z\\,\\sin x\\,\\cos y = c"
      },
      {
        "label": "minimal surface (zero mean curvature)",
        "latex": "H = \\tfrac{1}{2}(\\kappa_1 + \\kappa_2) = 0"
      }
    ],
    "params": [
      {
        "key": "iso",
        "symbol": "c",
        "meaning": "isovalue (level set); 0 is the balanced surface, ±values thicken or thin the single labyrinth"
      },
      {
        "key": "colShift",
        "symbol": "\\phi",
        "meaning": "hue offset of the core→edge colour gradient"
      },
      {
        "key": "animate",
        "symbol": "\\alpha",
        "meaning": "gently breathes the isovalue over time (0 = still)"
      }
    ],
    "code": "// implicit field; the surface is F = isovalue\nconst F = (p) => Math.cos(2*p.x)*Math.sin(p.y)*Math.cos(p.z)\n              + Math.cos(2*p.y)*Math.sin(p.z)*Math.cos(p.x)\n              + Math.cos(2*p.z)*Math.sin(p.x)*Math.cos(p.y);\n// raymarch it as a distance estimate, normal = ∇F:\nconst de = Math.abs(F(p) - iso) / length(grad(F, p));   // |F−iso| / |∇F|",
    "links": [
      {
        "label": "Triply periodic minimal surface (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Triply_periodic_minimal_surface"
      },
      {
        "label": "Fischer-Koch surfaces - minimal surface catalogue",
        "url": "https://en.wikipedia.org/wiki/Minimal_surface"
      }
    ]
  },
  "schwarzCLP": {
    "title": "Schwarz CLP",
    "about": "The Schwarz CLP — \"Crossed Layers of Parallels\" — is a triply-periodic minimal surface from Hermann Schwarz's family. As its name promises, it is built from stacked layers of parallel ribbons, with successive layers crossed at right angles so the whole structure interlocks into a continuous, infinitely connected sheet. Unlike the chunky cubic networks of Schwarz P or the diamond labyrinths of Schwarz D, CLP has a distinctly woven, fabric-like character.",
    "howItWorks": "We render the level set F = isovalue of a short trigonometric field directly, instead of meshing it. For each pixel a ray is marched until F crosses the isovalue, and the surface is shaded by its gradient grad F. The nodal approximation cos(2x)cos(z) + cos(2y)sin(z) is the standard tetragonal Schwarz CLP form: it is pi-periodic in x and y and 2pi-periodic in z (the layering axis), reflecting CLP's tetragonal cell. The cos(2x)/cos(2y) factors lay down the crossed parallel ribbons while the z phase (cos z vs sin z) rotates successive layers by a quarter period so they interlock. At isovalue 0 the two sides are volume-balanced (verified: equal pos/neg counts), and the surface is a good minimal-surface approximation (measured mean |H| ~= 0.06, comparable to other nodal TPMS).",
    "equations": [
      {
        "label": "Schwarz CLP level set (tetragonal nodal approx)",
        "latex": "\\cos 2x \\, \\cos z + \\cos 2y \\, \\sin z = c"
      },
      {
        "label": "minimal surface (zero mean curvature)",
        "latex": "H = \\tfrac{1}{2}(\\kappa_1 + \\kappa_2) = 0"
      }
    ],
    "params": [
      {
        "key": "iso",
        "symbol": "c",
        "meaning": "isovalue (level set); 0 is the balanced CLP, ±values thicken one side of the woven sheet"
      },
      {
        "key": "colShift",
        "symbol": "\\phi",
        "meaning": "hue offset of the core→edge colour gradient"
      },
      {
        "key": "animate",
        "symbol": "\\alpha",
        "meaning": "gently breathes the isovalue over time (0 = still)"
      }
    ],
    "code": "// implicit field; the surface is F = isovalue\nconst F = (p) => Math.cos(2*p.x)*Math.cos(p.z) + Math.cos(2*p.y)*Math.sin(p.z);\n// raymarch it as a distance estimate, normal = grad(F):\nconst de = Math.abs(F(p) - iso) / length(grad(F, p));   // |F-iso| / |grad F|",
    "links": [
      {
        "label": "Schwarz minimal surface (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Schwarz_minimal_surface"
      },
      {
        "label": "Triply periodic minimal surface (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Triply_periodic_minimal_surface"
      }
    ]
  },
  "togliatti": {
    "title": "Togliatti Quintic",
    "about": "Eugenio Togliatti's quintic is the degree-5 surface carrying the maximum number of ordinary double points a quintic can have: 31 nodes, a bound conjectured by Arnaud Beauville and realised by Togliatti in 1940 (with the explicit equation given later by Wolf Barth). Its constants are laced with sqrt(5), giving the node cluster a striking fivefold, almost icosahedral symmetry. A quintic is unbounded, so what you see is the recognisable central body where the pinch points bunch up; the rest of the surface streams off to infinity and is clipped by the bounding sphere.",
    "howItWorks": "We render the zero set F = isovalue of a single quintic polynomial directly as a lit isosurface: a ray is marched until F crosses the isovalue, and the surface is shaded by its gradient grad F. The polynomial factors into a degree-5 piece in x and y times a linear z-factor, minus a term built from the squared quadric 4(x^2+y^2-z^2)+1+3 sqrt5 — that squared quadric is what forces the nodes. Because grad F vanishes at the nodes (and swings across roughly 500x in magnitude over the surface), the distance estimate |F-iso|/|grad F| is heavily under-relaxed and hard-capped, exactly like the Barth sextic and Kummer quartic, so the march can't overshoot straight through a pinch point.",
    "equations": [
      {
        "label": "Togliatti quintic (affine real form)",
        "latex": "64(x-1)\\big(x^4 - 4x^3 - 10x^2y^2 - 4x^2 + 16x - 20xy^2 + 5y^4 + 16 - 20y^2\\big) - 5\\sqrt5\\,(2z-\\sqrt5-1)\\big(4(x^2+y^2-z^2) + 1 + 3\\sqrt5\\big)^2 = c"
      },
      {
        "label": "31 nodes (maximal for a quintic)",
        "latex": "\\#\\{\\,F=0,\\ \\nabla F = 0\\,\\} = 31"
      },
      {
        "label": "node-forcing quadric",
        "latex": "Q = 4(x^2+y^2-z^2) + 1 + 3\\sqrt5"
      }
    ],
    "params": [
      {
        "key": "iso",
        "symbol": "c",
        "meaning": "isovalue; c = 0 is the singular 31-node Togliatti quintic, nonzero values smooth the pinch points open"
      },
      {
        "key": "colShift",
        "symbol": "\\phi",
        "meaning": "hue offset of the core->edge colour gradient"
      },
      {
        "key": "animate",
        "symbol": "\\alpha",
        "meaning": "gently sweeps the isovalue over time (0 = still)"
      }
    ],
    "code": "// affine real Togliatti quintic; surface is F = isovalue\nconst s5 = Math.sqrt(5);\nconst F = (x, y, z) => {\n  const poly = x**4 - 4*x**3 - 10*x*x*y*y - 4*x*x + 16*x\n             - 20*x*y*y + 5*y**4 + 16 - 20*y*y;\n  const Q = 4*(x*x + y*y - z*z) + (1 + 3*s5);\n  return 64*(x - 1)*poly - 5*s5*(2*z - s5 - 1)*Q*Q;\n};",
    "links": [
      {
        "label": "Togliatti surface (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Togliatti_surface"
      },
      {
        "label": "Quintic surface (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Quintic_surface"
      },
      {
        "label": "Nodal surfaces — Herwig Hauser / IMAGINARY gallery",
        "url": "https://imaginary.org/gallery/herwig-hauser-classic"
      }
    ]
  },
  "whitneyUmbrella": {
    "title": "Whitney Umbrella",
    "about": "The Whitney umbrella is the archetypal singular surface — the standard local model for a 'cross-cap', where a smooth sheet folds back and pierces itself along a line. Introduced by Hassler Whitney in his 1944 study of how surfaces map into space, its single cubic equation x² = y²z produces a curved canopy that self-intersects above the origin, tapering into a sharp spike of handle below it. Every coordinate point on that handle line is singular: the surface pinches to nothing along the entire negative z-axis.",
    "howItWorks": "We render the level set F = isovalue of the cubic F(x,y,z) = x² − y²z directly, rather than meshing it. For each pixel a ray is marched until F crosses the isovalue, and the surface is shaded by its gradient ∇F. The gradient ∇F = (2x, −2yz, −y²) vanishes along the whole z-axis (x = y = 0), so the distance estimate |F−iso|/|∇F| blows up along the handle and the spike; to stop the ray overshooting straight through these singular points the march step is strongly under-relaxed and hard-capped, exactly like the Kummer and heart surfaces. The isovalue knob lifts the surface off its singular zero set, opening the self-intersection into a smooth fold.",
    "equations": [
      {
        "label": "Whitney umbrella",
        "latex": "x^2 - y^2 z = c"
      },
      {
        "label": "implicit zero set (c = 0)",
        "latex": "x^2 = y^2 z"
      },
      {
        "label": "gradient",
        "latex": "\\nabla F = \\big(2x,\\; -2yz,\\; -y^2\\big)"
      },
      {
        "label": "singular handle (whole z-axis)",
        "latex": "\\nabla F = 0 \\iff x = y = 0 \\ \\Rightarrow\\ \\text{line of singular points}"
      }
    ],
    "params": [
      {
        "key": "iso",
        "symbol": "c",
        "meaning": "isovalue; c = 0 is the singular Whitney umbrella, nonzero values smooth the self-intersection into a fold"
      },
      {
        "key": "colShift",
        "symbol": "\\phi",
        "meaning": "hue offset of the core→edge colour gradient"
      },
      {
        "key": "animate",
        "symbol": "\\alpha",
        "meaning": "gently sweeps the isovalue over time (0 = still)"
      }
    ],
    "code": "// surface: F = isovalue. Sheet for z>0, singular handle along x=y=0, z<0.\nconst F = (x, y, z) => x*x - y*y*z;   // x² − y²z",
    "links": [
      {
        "label": "Whitney umbrella (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Whitney_umbrella"
      },
      {
        "label": "Whitney Umbrella (MathWorld)",
        "url": "https://mathworld.wolfram.com/WhitneyUmbrella.html"
      },
      {
        "label": "Cross-cap (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Cross-cap"
      }
    ]
  },
  "tooth": {
    "title": "Tooth Surface",
    "about": "The tooth surface (also called the cushion surface) is a compact quartic whose zero set is a rounded, pillow-like solid. Its equation is one of the simplest that mixes a quartic norm x^4+y^4+z^4 against the ordinary squared radius x^2+y^2+z^2, and the competition between those two terms gives the surface its puckered silhouette. The body reaches +-1 along each coordinate axis but bulges outward toward the eight cube-corner directions, passing through (+-1,+-1,+-1) at radius sqrt3. The origin sits on the surface as an isolated solitary point (an acnode): the gradient vanishes there and, locally, the zero set consists of just that single point.",
    "howItWorks": "We render the level set F = isovalue of the quartic directly: for each pixel a ray is marched until the field F crosses the isovalue, and the surface is shaded by its gradient grad F. The quartic term x^4+y^4+z^4 grows faster than the quadratic term far from the centre, closing the surface off into a bounded body whose axis intercepts are at +-1 and whose farthest reach is the diagonal corner (1,1,1) at radius sqrt3~1.73. The field has interior critical points (where grad F = 0) at coordinate combinations of +-1/sqrt2, and the origin is an isolated singular point; at these points the |F-iso|/|grad F| step estimate can blow up, so the march step is under-relaxed and hard-capped (like the heart and Kummer surfaces) to keep the ray from overshooting. A small positive isovalue removes the isolated origin point and smooths the field.",
    "equations": [
      {
        "label": "Tooth (cushion) quartic",
        "latex": "x^4 + y^4 + z^4 - (x^2 + y^2 + z^2) = c"
      },
      {
        "label": "axis intercepts",
        "latex": "F(t,0,0) = t^2(t^2 - 1) = 0 \\;\\Rightarrow\\; t = 0,\\, \\pm 1"
      },
      {
        "label": "diagonal section x=y=z=t",
        "latex": "F(t,t,t) = 3t^2(t^2 - 1), \\quad \\min = -\\tfrac34 \\text{ at } t = \\tfrac{1}{\\sqrt2}, \\;\\; \\text{surface reaches } (1,1,1),\\, |r|=\\sqrt3"
      },
      {
        "label": "isolated singular point (acnode) at the origin",
        "latex": "F(0,0,0) = 0, \\quad \\nabla F(0,0,0) = 0"
      }
    ],
    "params": [
      {
        "key": "iso",
        "symbol": "c",
        "meaning": "isovalue; 0 is the singular tooth, small +values open the central pinch into a smooth neck"
      },
      {
        "key": "colShift",
        "symbol": "\\phi",
        "meaning": "hue offset of the core→edge colour gradient"
      },
      {
        "key": "animate",
        "symbol": "\\alpha",
        "meaning": "gently sweeps the isovalue over time (0 = still)"
      }
    ],
    "code": "// implicit field; the surface is F = isovalue\nconst F = (x, y, z) => {\n  const x2 = x*x, y2 = y*y, z2 = z*z;\n  return x2*x2 + y2*y2 + z2*z2 - (x2 + y2 + z2);\n};\n// raymarch it as a distance estimate, normal = grad(F):\nconst de = Math.abs(F(p.x,p.y,p.z) - iso) / length(grad(F, p));   // |F-iso| / |grad F|",
    "links": [
      {
        "label": "Tooth surface (MathWorld)",
        "url": "https://mathworld.wolfram.com/ToothSurface.html"
      },
      {
        "label": "Algebraic surface (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Algebraic_surface"
      }
    ]
  },
  "lidinoid": {
    "title": "Lidinoid",
    "about": "The Lidinoid is a triply-periodic minimal surface discovered by Sven Lidin and Stefan Larsson in 1990 - the gyroid's hexagonal cousin. Like the gyroid it is balanced and contains no straight lines, but it carries rhombohedral (rather than cubic) symmetry, twisting space into two interpenetrating labyrinths with a distinctly hexagonal weave. It sits, with the gyroid, on the associate (Bonnet) family of the Schwarz P and D surfaces, bending one into the other without stretching.",
    "howItWorks": "Instead of meshing it we render the level set F = isovalue directly. For each pixel a ray is marched until the short trigonometric field F crosses the isovalue, and the surface is lit by its gradient grad F. The field mixes a first term of sin(2x)cos(y)sin(z) (cyclically permuted) with a second-harmonic term cos(2x)cos(2y), plus the +0.15 constant that picks out the balanced Lidinoid from its family. The isovalue knob thickens or thins the two channels.",
    "equations": [
      {
        "label": "Lidinoid level set",
        "latex": "\\tfrac12\\!\\sum_{\\text{cyc}}\\! \\sin 2x\\,\\cos y\\,\\sin z \\;-\\; \\tfrac12\\!\\sum_{\\text{cyc}}\\! \\cos 2x\\,\\cos 2y \\;+\\; 0.15 = c"
      },
      {
        "label": "expanded (cyclic sums over x,y,z)",
        "latex": "\\tfrac12\\big(\\sin 2x\\cos y\\sin z + \\sin 2y\\cos z\\sin x + \\sin 2z\\cos x\\sin y\\big) - \\tfrac12\\big(\\cos 2x\\cos 2y + \\cos 2y\\cos 2z + \\cos 2z\\cos 2x\\big) + 0.15 = c"
      },
      {
        "label": "minimal surface (zero mean curvature)",
        "latex": "H = \\tfrac{1}{2}(\\kappa_1 + \\kappa_2) = 0"
      }
    ],
    "params": [
      {
        "key": "iso",
        "symbol": "c",
        "meaning": "isovalue (level set); 0 is the balanced Lidinoid, ±values thicken one labyrinth"
      },
      {
        "key": "colShift",
        "symbol": "\\phi",
        "meaning": "hue offset of the core->edge colour gradient"
      },
      {
        "key": "animate",
        "symbol": "\\alpha",
        "meaning": "gently breathes the isovalue over time (0 = still)"
      }
    ],
    "code": "// implicit field; the surface is F = isovalue\nconst F = (p) => {\n  const {x, y, z} = p;\n  const a = Math.sin(2*x)*Math.cos(y)*Math.sin(z)\n          + Math.sin(2*y)*Math.cos(z)*Math.sin(x)\n          + Math.sin(2*z)*Math.cos(x)*Math.sin(y);\n  const b = Math.cos(2*x)*Math.cos(2*y)\n          + Math.cos(2*y)*Math.cos(2*z)\n          + Math.cos(2*z)*Math.cos(2*x);\n  return 0.5*a - 0.5*b + 0.15;\n};\n// raymarch it as a distance estimate, normal = grad(F):\nconst de = Math.abs(F(p) - iso) / length(grad(F, p));   // |F-iso| / |grad F|",
    "links": [
      {
        "label": "Lidinoid - Triply periodic minimal surface (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Triply_periodic_minimal_surface"
      },
      {
        "label": "Gyroid (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Gyroid"
      },
      {
        "label": "Minimal surface (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Minimal_surface"
      }
    ]
  },
  "dingDong": {
    "title": "Ding-Dong Surface",
    "about": "The ding-dong surface is the zero set of a single cubic, x²+y²−z²+z³, and it looks exactly like its name: a closed teardrop bell joined at a cusp to a horn that flares open below. The bell is the lobe for z between 0 and 1, where the radial term x²+y² is balanced by z²(1−z); below z=0 that term flips sign and the surface trumpets outward without bound. The origin is a singular cusp where the bell pinches down to a point and the horn begins, and the apex at z=1 is the rounded top of the bell.",
    "howItWorks": "We render the level set F = isovalue of the cubic directly, instead of meshing it: for each pixel a ray is marched until F crosses the isovalue, and the surface is shaded by its gradient ∇F. On the axis F reduces to z²(z−1), so the bell closes cleanly at z=0 and z=1. Because the gradient ∇F=(2x, 2y, 3z²−2z) vanishes at the origin cusp (and shrinks across much of the rounded lobe), the |F−iso|/|∇F| step estimate can blow the ray straight through the pinch point, so the march is under-relaxed and hard-capped like the heart and Cayley surfaces. The cusp axis is rotated to world-up and the lobe is recentred on the origin so the bell stands framed with its horn hanging below.",
    "equations": [
      {
        "label": "ding-dong surface",
        "latex": "x^2 + y^2 - z^2(1 - z) = 0 \\;\\Longleftrightarrow\\; x^2 + y^2 - z^2 + z^3 = 0"
      },
      {
        "label": "on-axis section (x=y=0)",
        "latex": "z^2(z-1) = 0 \\;\\Rightarrow\\; \\text{bell closes at } z=0,\\,1"
      },
      {
        "label": "lobe radius",
        "latex": "x^2+y^2 = z^2(1-z), \\quad r_{\\max} = \\sqrt{\\tfrac{4}{27}} \\approx 0.385 \\text{ at } z=\\tfrac23"
      },
      {
        "label": "gradient (cusp at origin)",
        "latex": "\\nabla F = (2x,\\; 2y,\\; 3z^2 - 2z) = \\mathbf{0} \\text{ at } (0,0,0)"
      }
    ],
    "params": [
      {
        "key": "iso",
        "symbol": "c",
        "meaning": "isovalue; 0 is the true ding-dong with its pinched cusp, ±values round the cusp open or seal the bell"
      },
      {
        "key": "colShift",
        "symbol": "\\phi",
        "meaning": "hue offset of the core→edge colour gradient"
      },
      {
        "key": "animate",
        "symbol": "\\alpha",
        "meaning": "gently sweeps the isovalue over time (0 = still)"
      }
    ],
    "code": "// cusp axis remapped to world-up so the bell stands upright; surface is F = isovalue\nconst F = (x, y, z) => x*x + y*y - z*z + z*z*z;   // x²+y²−z²+z³",
    "links": [
      {
        "label": "Ding-Dong surface (MathWorld)",
        "url": "https://mathworld.wolfram.com/Ding-DongSurface.html"
      },
      {
        "label": "Algebraic surface (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Algebraic_surface"
      }
    ]
  },
  "dupinCyclide": {
    "title": "Dupin Ring Cyclide",
    "about": "Charles Dupin's cyclide (1822) is the inversion of a torus in a sphere — and its single most beautiful property is that every one of its lines of curvature is a perfect circle. The ring cyclide looks like a torus whose tube swells on one side and tapers on the other, an asymmetric doughnut with a sharply varying cross-section. Because it is the image of a torus under a Möbius (sphere) inversion, it inherits the torus's smoothness everywhere: there is not a single pinch point or node on the whole surface.",
    "howItWorks": "We render the level set F = isovalue of the cyclide's defining quartic directly instead of meshing it. For each pixel a ray is marched until F crosses the isovalue, and the surface is shaded by its gradient ∇F. The seed constants a=1.9, c=1 (so b²=a²−c²=2.61) and d=1.4 satisfy a>d>c, the condition that picks out a ring cyclide; the on-axis section F(X,0,0)=0 then has four real roots, two nested intervals that are the two sides of the swept tube. The raw body is off-centre (it spans x∈[−4.3,2.3]), so we substitute X=x−1 to recentre it on the origin for the bounding sphere and the radial colour trap. The field is smooth — its gradient never vanishes on the surface (measured min|∇F|≈4.6) — so unlike the nodal quartics no step under-relaxation is needed; the isovalue knob simply inflates or deflates the tube.",
    "equations": [
      {
        "label": "Dupin ring cyclide (recentred X = x−1)",
        "latex": "\\left(X^2+y^2+z^2 + b^2 - d^2\\right)^2 - 4\\,(aX - c\\,d)^2 - 4\\,b^2 y^2 = c_{\\text{iso}}"
      },
      {
        "label": "parameters (ring cyclide ⇔ a > d > c)",
        "latex": "a = 1.9,\\quad c = 1,\\quad b = \\sqrt{a^2 - c^2} = \\sqrt{2.61},\\quad d = 1.4"
      },
      {
        "label": "inversion of a torus",
        "latex": "\\text{cyclide} = \\iota_S(\\text{torus}),\\qquad \\iota_S(\\mathbf{p}) = \\mathbf{p}_0 + R^2\\dfrac{\\mathbf{p}-\\mathbf{p}_0}{\\lVert \\mathbf{p}-\\mathbf{p}_0\\rVert^2}"
      },
      {
        "label": "on-axis section (four real ring radii)",
        "latex": "F(X,0,0)=\\left(X^2 + b^2 - d^2\\right)^2 - 4(aX - cd)^2 = 0"
      }
    ],
    "params": [
      {
        "key": "iso",
        "symbol": "c",
        "meaning": "isovalue; 0 is the true ring cyclide, ±values inflate or deflate the swept tube"
      },
      {
        "key": "colShift",
        "symbol": "\\phi",
        "meaning": "hue offset of the core→edge colour gradient"
      },
      {
        "key": "animate",
        "symbol": "\\alpha",
        "meaning": "gently breathes the isovalue over time (0 = still)"
      }
    ],
    "code": "// recentred Dupin ring cyclide; surface is F = isovalue\nconst a = 1.9, c = 1.0, d = 1.4, b2 = a*a - c*c;   // b² = 2.61\nconst F = (x, y, z) => {\n  const X = x - 1.0;                 // recentre the off-axis ring on the origin\n  const s = X*X + y*y + z*z + (b2 - d*d);\n  const t = a*X - c*d;\n  return s*s - 4*t*t - 4*b2*y*y;     // (…)² − 4(aX−cd)² − 4b²y²\n};",
    "links": [
      {
        "label": "Dupin cyclide (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Dupin_cyclide"
      },
      {
        "label": "Cyclide (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Cyclide"
      },
      {
        "label": "Cyclide (MathWorld)",
        "url": "https://mathworld.wolfram.com/Cyclide.html"
      }
    ]
  },
  "orthocircle": {
    "title": "Orthocircle",
    "about": "The orthocircle is a smooth degree-12 algebraic surface built from three unit circles lying in the three coordinate planes, each one fattened into a torus-like tube. Where an ordinary union of three rings would cross and pinch, a single product equation fuses them into one continuous, gently swollen lattice of interlocking loops — a favourite showpiece for implicit-surface renderers because it is bounded, highly symmetric, and entirely free of singular points. The constant a sets the tube thickness and b adds a mild radial swell that smooths the joins where the rings meet.",
    "howItWorks": "Each factor ((u²+v²−1)²+w²) is the squared distance, in a tweaked metric, from a unit circle living in one coordinate plane — its zero set is a thin tube around that ring. Multiplying the three orthogonal ring-fields together and subtracting the small positive term a²(1+b·r²) thickens every ring into a solid tube and seals the six places where pairs of rings approach, yielding one smooth connected surface. We render the level set F = isovalue directly: for each pixel a ray is marched until F crosses the isovalue, shaded by its gradient ∇F. Because ∇F never vanishes on the surface (it stays in roughly [0.14, 0.79]), the |F−iso|/|∇F| step needs no under-relaxation — it ray-marches as cleanly as the Goursat or tanglecube.",
    "equations": [
      {
        "label": "Orthocircle surface",
        "latex": "\\big((x^2+y^2-1)^2+z^2\\big)\\big((y^2+z^2-1)^2+x^2\\big)\\big((z^2+x^2-1)^2+y^2\\big) - a^2\\big(1 + b\\,(x^2+y^2+z^2)\\big) = c"
      },
      {
        "label": "one ring-tube factor",
        "latex": "R_z(x,y,z) = (x^2+y^2-1)^2 + z^2 \\;\\;(\\text{tube around the unit circle in the }xy\\text{-plane})"
      },
      {
        "label": "standard constants",
        "latex": "a = 0.075,\\quad b = 3 \\;\\Rightarrow\\; a^2 = 0.005625,\\;\\; a^2 b = 0.016875"
      },
      {
        "label": "bounded body",
        "latex": "\\max_{F=0}\\lVert(x,y,z)\\rVert \\approx 1.15"
      }
    ],
    "params": [
      {
        "key": "iso",
        "symbol": "c",
        "meaning": "isovalue; 0 is the standard orthocircle, ±values fatten the tubes or pinch the ring joins"
      },
      {
        "key": "colShift",
        "symbol": "\\phi",
        "meaning": "hue offset of the core→edge colour gradient"
      },
      {
        "key": "animate",
        "symbol": "\\alpha",
        "meaning": "gently breathes the isovalue over time (0 = still)"
      }
    ],
    "code": "// surface: F = isovalue. Three orthogonal unit rings fused into one tube lattice.\nconst a = 0.075, b = 3;\nconst F = (x, y, z) => {\n  const x2 = x*x, y2 = y*y, z2 = z*z;\n  const t1 = (x2 + y2 - 1)**2 + z2;   // ring in xy-plane\n  const t2 = (y2 + z2 - 1)**2 + x2;   // ring in yz-plane\n  const t3 = (z2 + x2 - 1)**2 + y2;   // ring in zx-plane\n  return t1*t2*t3 - a*a*(1 + b*(x2 + y2 + z2));\n};",
    "links": [
      {
        "label": "Orthocircle (MathWorld)",
        "url": "https://mathworld.wolfram.com/Orthocircles.html"
      },
      {
        "label": "Algebraic surface (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Algebraic_surface"
      },
      {
        "label": "Implicit surface (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Implicit_surface"
      }
    ]
  },
  "decocube": {
    "title": "Decocube",
    "about": "The decocube is a rounded cube rendered not as a solid but as its skeleton: twelve tube-edges meeting at eight corners, like a wireframe cube fattened into smooth rods. It is built algebraically as the product of three intersecting-torus factors — one torus wrapped around each coordinate axis and capped at ±1 — so the zero set is exactly where those tubes live. The result is a clean, hollow cube frame with no flat faces, beloved as a showcase object for implicit-surface and ray-marching renderers.",
    "howItWorks": "Each factor ((u²+v²−r²)² + (w²−1)²) is a thin torus of tube-radius √a around one axis, pinched to its ±1 caps by the (w²−1)² term; multiplying the three cyclic factors and subtracting a² carves out the 12 edges where any one tube is thin. We render the level set F = isovalue directly: for each pixel a ray is marched until F crosses the isovalue, and the surface is shaded by its gradient ∇F. The field is smooth and its gradient stays in a narrow band (probe: |∇F| ≈ 0.024–0.085, range only 3.6×, zero overshoot flags), so no special step-capping is needed — the standard |F−iso|/|∇F| under-relaxation suffices. The isovalue knob fattens the tubes as it rises and thins them to wires as it falls.",
    "equations": [
      {
        "label": "Decocube (product of three tori)",
        "latex": "\\big((x^2+y^2-r^2)^2+(z^2-1)^2\\big)\\big((y^2+z^2-r^2)^2+(x^2-1)^2\\big)\\big((z^2+x^2-r^2)^2+(y^2-1)^2\\big) - a^2 = c"
      },
      {
        "label": "tube offset and thickness",
        "latex": "r = 0.82, \\qquad a = 0.02 \\;\\Rightarrow\\; a^2 = 4\\times10^{-4}"
      },
      {
        "label": "one torus factor (capped at ±1)",
        "latex": "(x^2+y^2-r^2)^2 + (z^2-1)^2 = 0 \\;\\Rightarrow\\; x^2+y^2=r^2,\\ z=\\pm 1"
      }
    ],
    "params": [
      {
        "key": "iso",
        "symbol": "c",
        "meaning": "isovalue; 0 is the slim cube frame, positive values fatten the edges into chunky rods, negative thins them toward wires"
      },
      {
        "key": "colShift",
        "symbol": "\\phi",
        "meaning": "hue offset of the core→edge colour gradient"
      },
      {
        "key": "animate",
        "symbol": "\\alpha",
        "meaning": "gently breathes the isovalue over time (0 = still)"
      }
    ],
    "code": "// implicit field; the surface is F = isovalue\nconst r2 = 0.82 * 0.82, a2 = 0.02 * 0.02;\nconst F = (x, y, z) => {\n  const x2 = x*x, y2 = y*y, z2 = z*z;\n  const t1 = (x2 + y2 - r2)**2 + (z2 - 1)**2;\n  const t2 = (y2 + z2 - r2)**2 + (x2 - 1)**2;\n  const t3 = (z2 + x2 - r2)**2 + (y2 - 1)**2;\n  return t1 * t2 * t3 - a2;   // surface: F = isovalue\n};\n// raymarch it as a distance estimate, normal = grad(F):\nconst de = Math.abs(F(p.x, p.y, p.z) - iso) / length(grad(F, p));   // |F-iso| / |grad F|",
    "links": [
      {
        "label": "Decocube (Bruno Levy / Graphite gallery)",
        "url": "https://members.loria.fr/Bruno.Levy/GEX/decocube.html"
      },
      {
        "label": "Implicit surface (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Implicit_surface"
      },
      {
        "label": "Algebraic surface (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Algebraic_surface"
      }
    ]
  },
  "endrassOctic": {
    "title": "Endraß Octic",
    "about": "Stephan Endraß's 1995 octic is the degree-8 surface carrying the record number of ordinary double points: 168 real nodes, the most known for any octic and close to the theoretical maximum. Its equation is laced with √2, and the nodes pack into a dense, eight-fold-symmetric cluster — a glittering knot of pinch points where the surface folds through itself again and again. Like all high-degree algebraic surfaces it is unbounded, so what you see is the recognisable central body where the nodes bunch up; sheets stream outward along the z-axis and are clipped by the bounding sphere.",
    "howItWorks": "We render the zero set F = isovalue of a single octic polynomial directly as a lit isosurface: a ray is marched until F crosses the isovalue, and the surface is shaded by its gradient ∇F. The polynomial is a product of four planes, 64(x²−1)(y²−1)((x+y)²−2)((x−y)²−2), minus the square of a degree-4 polynomial in (x²+y²) and z — that squared factor is what forces the 168 nodes. Because ∇F vanishes at every node (a numerical probe finds ~37% of on-surface samples have near-zero gradient, with the field magnitude swinging ~10⁴× across the surface), the distance estimate |F−iso|/|∇F| is heavily under-relaxed and hard-capped, exactly like the Togliatti quintic and Barth sextic, so the march can't overshoot straight through a pinch point.",
    "equations": [
      {
        "label": "Endraß octic (w = 1)",
        "latex": "64\\,(x^2-1)(y^2-1)\\big((x+y)^2-2\\big)\\big((x-y)^2-2\\big) - \\Big(\\!-4(1{+}\\sqrt2)(x^2{+}y^2)^2 + \\big(8(2{+}\\sqrt2)z^2 + 2(2{+}7\\sqrt2)\\big)(x^2{+}y^2) - 16z^4 + 8(1{+}2\\sqrt2)z^2 - (1{+}12\\sqrt2)\\Big)^2 = c"
      },
      {
        "label": "plane product (the four tropes)",
        "latex": "\\Pi = (x^2-1)(y^2-1)\\big((x+y)^2-2\\big)\\big((x-y)^2-2\\big)"
      },
      {
        "label": "168 nodes (record for an octic)",
        "latex": "\\#\\{\\,F=0,\\ \\nabla F = 0\\,\\} = 168"
      }
    ],
    "params": [
      {
        "key": "iso",
        "symbol": "c",
        "meaning": "isovalue; c = 0 is the singular 168-node Endraß octic, nonzero values smooth the pinch points open"
      },
      {
        "key": "colShift",
        "symbol": "\\phi",
        "meaning": "hue offset of the core→edge colour gradient"
      },
      {
        "key": "animate",
        "symbol": "\\alpha",
        "meaning": "gently sweeps the isovalue over time (0 = still)"
      }
    ],
    "code": "// affine Endraß octic (w = 1); surface is F = isovalue\nconst s2 = Math.SQRT2;\nconst F = (x, y, z) => {\n  const x2=x*x, y2=y*y, z2=z*z, z4=z2*z2, r2=x2+y2;\n  const planes = 64*(x2-1)*(y2-1)*((x+y)**2-2)*((x-y)**2-2);\n  const inner = -4*(1+s2)*r2*r2\n              + (8*(2+s2)*z2 + 2*(2+7*s2))*r2\n              - 16*z4 + 8*(1+2*s2)*z2 - (1+12*s2);\n  return planes - inner*inner;\n};",
    "links": [
      {
        "label": "Endraß surface — Endraß octic gallery",
        "url": "https://www.mathematik.uni-mainz.de/AlgebraischeGeometrie/docs/Eflaeche.shtml"
      },
      {
        "label": "Octic surface (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Octic_surface"
      },
      {
        "label": "Nodal surfaces — Herwig Hauser / IMAGINARY gallery",
        "url": "https://imaginary.org/gallery/herwig-hauser-classic"
      }
    ]
  },
  "cassini": {
    "title": "Cassini Surface",
    "about": "The Cassini surface is a Cassini oval spun into three dimensions — the locus of points whose product of distances to two fixed foci is held constant. Giovanni Domenico Cassini proposed the planar curve in 1680 as a model for the Earth-Sun orbit, and its 3D surface of revolution inherits the same dramatic morphology: as the constant b is tuned past the focal separation a, the shape transforms from a single oval, through a pinched peanut, into two separate egg-shaped blobs. At a=1, b=1.1 it sits just on the connected side, a smooth vertical dumbbell with a slim waist.",
    "howItWorks": "We render the level set F = isovalue of the quartic Cassini field directly rather than meshing it. For each pixel a ray is marched until F crosses the isovalue, and the surface is shaded by its gradient ∇F. The core (x²+y²+z²)² term closes the surface into a bounded body, while the −2a²(x²−y²−z²) term stretches it along one axis (remapped to world-up so the dumbbell stands upright) and squeezes the perpendicular waist. The whole surface is smooth — its gradient never collapses to zero near the zero set (measured |∇F| stays between 2.2 and 7.2), so no step under-relaxation is needed. The isovalue knob inflates the peanut or, pushed negative, pinches its waist shut into two separate lobes.",
    "equations": [
      {
        "label": "Cassini surface of revolution",
        "latex": "\\left(x^2+y^2+z^2\\right)^2 - 2a^2\\left(x^2 - y^2 - z^2\\right) + a^4 - b^4 = c"
      },
      {
        "label": "defining locus (product of focal distances)",
        "latex": "\\lVert\\mathbf{p}-\\mathbf{f}_1\\rVert\\,\\lVert\\mathbf{p}-\\mathbf{f}_2\\rVert = b^2,\\quad \\mathbf{f}_{1,2}=(\\pm a,0,0)"
      },
      {
        "label": "axial tip and waist (a=1, b=1.1)",
        "latex": "x_{\\text{tip}} = \\sqrt{a^2+b^2} \\approx 1.487,\\qquad r_{\\text{waist}} = \\sqrt{b^2-a^2} \\approx 0.458"
      },
      {
        "label": "connectivity transition",
        "latex": "b > a \\Rightarrow \\text{connected peanut};\\quad b < a \\Rightarrow \\text{two separate blobs}"
      }
    ],
    "params": [
      {
        "key": "iso",
        "symbol": "c",
        "meaning": "isovalue; 0 is the connected peanut (a=1, b=1.1), negative values pinch the waist into two blobs, positive values inflate it toward an oval"
      },
      {
        "key": "colShift",
        "symbol": "\\phi",
        "meaning": "hue offset of the core→edge colour gradient"
      },
      {
        "key": "animate",
        "symbol": "\\alpha",
        "meaning": "gently sweeps the isovalue over time (0 = still)"
      }
    ],
    "code": "// Cassini oval of revolution; surface is F = isovalue. a=1, b=1.1 ⇒ a⁴−b⁴ = −0.4641.\nconst a2 = 1, a4 = 1, b4 = Math.pow(1.1, 4);\nconst F = (x, y, z) => {\n  const r2 = x*x + y*y + z*z;\n  return r2*r2 - 2*a2*(x*x - y*y - z*z) + (a4 - b4);\n};\n// raymarch it as a distance estimate, normal = grad(F):\nconst de = Math.abs(F(x,y,z) - iso) / length(grad(F, p));   // |F−iso| / |∇F|",
    "links": [
      {
        "label": "Cassini oval (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Cassini_oval"
      },
      {
        "label": "Cassini Surface (MathWorld)",
        "url": "https://mathworld.wolfram.com/CassiniSurface.html"
      },
      {
        "label": "Cassini Ovals (MathWorld)",
        "url": "https://mathworld.wolfram.com/CassiniOvals.html"
      }
    ]
  },
  blackhole: {
    "title": "Black Hole (Gargantua)",
    "about": "A Schwarzschild black hole with a glowing accretion disk, rendered the way Interstellar's \"Gargantua\" and the Event Horizon Telescope image look: the disk behind the hole is bent up and over the event horizon by gravitational lensing, a razor-thin photon ring traces the edge of the central shadow, and one side of the disk blazes far brighter than the other from relativistic beaming. Unlike every other system here it is not a distance-estimated surface — each pixel fires a photon and the shader integrates its curved path through warped spacetime until it falls into the hole, strikes the disk, or escapes to the stars.",
    "howItWorks": "For each pixel a photon is launched from the camera and stepped along a null geodesic. Working in geometric units (horizon radius r_s = 1, so the mass M = ½), the photon carries a conserved squared angular momentum L² = |r×v|², and gravity pulls its direction inward with acceleration a = −1.5·r_s·L²·p/|p|⁵ — the Cartesian form of the textbook light-bending equation d²u/dφ² = −u + (3/2)r_s u². A velocity-Verlet (leapfrog) integrator advances position and direction with an adaptive step dt = clamp(0.1·|p|, 0.02, 0.6) that automatically refines near the hole. Three outcomes end a ray: it crosses inside r_s (painted black — the shadow), it crosses the equatorial disk annulus r∈[3r_s, 10r_s] (emission is added and the ray keeps going, so a single photon can pick up the disk twice — once in front, once lensed over the top), or it escapes and samples the starfield in its final, bent direction (which is why the stars themselves warp into an Einstein ring). The disk's lopsided brightness is real physics: gas orbits at relativistic speed, so the approaching side is Doppler-beamed (brightness × D³) and the whole disk is gravitationally redshifted (× √(1−r_s/r)), making the inner approaching edge up to ~50× brighter than the receding side. The unstable photon sphere at r = 1.5 r_s is never tested for — it emerges from the dynamics, winding near-critical rays multiple times around the hole to produce the thin photon ring just outside the shadow.",
    "equations": [
      {
        "label": "Null-geodesic light bending (orbit form)",
        "latex": "\\frac{d^2u}{d\\varphi^2} = -u + \\tfrac{3}{2}\\,r_s\\,u^2, \\qquad u = 1/r"
      },
      {
        "label": "Cartesian acceleration (what the shader integrates)",
        "latex": "\\mathbf{a} = -\\frac{3}{2}\\,r_s\\,L^2\\,\\frac{\\mathbf{p}}{\\lVert\\mathbf{p}\\rVert^{5}}, \\qquad L^2 = \\lVert\\mathbf{p}\\times\\mathbf{v}\\rVert^2"
      },
      {
        "label": "Event horizon & photon sphere",
        "latex": "r_s = 2M, \\qquad r_{\\text{ph}} = \\tfrac{3}{2}r_s = 3M"
      },
      {
        "label": "Shadow (critical impact parameter)",
        "latex": "b_{\\text{crit}} = 3\\sqrt{3}\\,M = \\tfrac{3\\sqrt3}{2}\\,r_s \\approx 2.598\\,r_s"
      },
      {
        "label": "Inner disk edge (ISCO)",
        "latex": "r_{\\text{in}} = r_{\\text{ISCO}} = 6M = 3\\,r_s"
      },
      {
        "label": "Doppler beaming + gravitational redshift",
        "latex": "I_{\\text{obs}} = I_{\\text{em}}\\;D^{3}\\,\\sqrt{1-\\tfrac{r_s}{r}}, \\quad D = \\frac{1}{\\gamma\\,(1-\\boldsymbol{\\beta}\\!\\cdot\\!\\mathbf{n})}, \\quad \\beta = \\sqrt{\\tfrac{M}{r-3M}}"
      }
    ],
    "params": [
      {
        "key": "exposure",
        "symbol": "E",
        "meaning": "overall brightness of the accretion disk (linear exposure multiplier)"
      },
      {
        "key": "beaming",
        "symbol": "\\mathcal{D}",
        "meaning": "strength of relativistic Doppler beaming + redshift; 0 = symmetric disk, 1 = full physical asymmetry"
      },
      {
        "key": "tilt",
        "symbol": "\\theta",
        "meaning": "camera tilt above/below the disk plane — edge-on shows the lensed-over-the-top arc most dramatically"
      },
      {
        "key": "spin",
        "symbol": "\\psi",
        "meaning": "orbits the camera around the hole (azimuth)"
      },
      {
        "key": "colShift",
        "symbol": "\\phi",
        "meaning": "hue offset of the disk's hot→cool temperature palette"
      }
    ],
    "code": "// per pixel: integrate a photon along a bent null geodesic (geometric units r_s = 1, M = 0.5)\nlet pos = ro, dir = rd;                 // dir treated as velocity\nconst h2 = dot(cross(pos, dir), cross(pos, dir));   // conserved L², computed once\nlet prevY = pos.y, emis = vec3(0), done = 0;\nfor (let i = 0; i < maxSteps; i++) {\n  const r = length(pos);\n  if (r < rs)  { done = 1; break; }     // (a) horizon → black shadow\n  if (r > Resc) break;                  // (c) escape → background in the LENSED dir\n  const dt = clamp(0.10 * r, 0.02, 0.6);// adaptive: fine near the hole, coarse far away\n  // velocity-Verlet (leapfrog), a = -1.5 rs h2 p / r^5 (points inward)\n  const acc = pos * (-1.5 * rs * h2 / pow(r, 5));\n  const vh  = dir + acc * (0.5 * dt);\n  const pn  = pos + vh * dt;\n  const acc2 = pn * (-1.5 * rs * h2 / pow(length(pn), 5));\n  dir = vh + acc2 * (0.5 * dt);\n  // (b) equatorial disk crossing: sign-flip of y, then check radius ∈ [r_in, r_out]\n  if (prevY * pn.y < 0) {\n    const t = prevY / (prevY - pn.y);   // linear interp to the y=0 plane\n    const rad = length(vec2(mix(pos.x, pn.x, t), mix(pos.z, pn.z, t)));\n    if (rad > r_in && rad < r_out) {\n      const s = clamp((rad - r_in)/(r_out - r_in), 0, 1);\n      const base = mix(vec3(1,0.95,0.85), vec3(1,0.35,0.1), pow(s, 0.7)); // hot→cool ramp\n      const beta = sqrt(0.5*rs / (rad - 1.5*rs));      // Keplerian speed, M = rs/2\n      const gamma = 1 / sqrt(1 - beta*beta);\n      const D = 1 / (gamma * (1 - beta * dot(normalize(dir), normalize(cross(up, posHit)))));\n      const boost = D*D*D * sqrt(1 - rs/rad);          // beaming³ × grav redshift\n      emis += base * pow(r_in/rad, 0.75) * boost * exposure;  // ADD (multiple crossings)\n    }\n  }\n  prevY = pn.y; pos = pn;\n}\n// resolve: black inside horizon, else starfield sampled in the bent dir + accumulated disk glow\nconst sky = starfield(normalize(dir));\nlet col = mix(sky + emis, vec3(0), done);",
    "links": [
      {
        "label": "Gravitational lens (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Gravitational_lens"
      },
      {
        "label": "Schwarzschild geodesics",
        "url": "https://en.wikipedia.org/wiki/Schwarzschild_geodesics"
      },
      {
        "label": "Photon sphere",
        "url": "https://en.wikipedia.org/wiki/Photon_sphere"
      },
      {
        "label": "Gravitational lensing of a black hole accretion disk — J. James et al. (Interstellar / DNGR)",
        "url": "https://arxiv.org/abs/1502.03808"
      },
      {
        "label": "Riccardo Antonelli — How to draw a black hole (raymarching)",
        "url": "https://rantonels.github.io/starless/"
      }
    ]
  },
  plasmaOrb: {
    "title": "Plasma Orb",
    "about": "A glowing spherical shell of plasma — a luminous, hollow orb whose surface seethes with high-frequency filaments that drift and churn in time. Unlike the distance-estimated fractals and surfaces here, nothing is a hard surface: the camera ray marches straight through a 3D density field and accumulates emission at every step, so the orb reads as translucent glowing gas, brightest in a thin band at radius 1 and transparent in its hollow centre. It is the simplest member of the Volume family — a mostly-analytic spherical-shell mask textured by a single domain-warp octave — and the cheapest to render.",
    "howItWorks": "For each pixel a ray is launched from the camera and stepped a fixed distance Δs through space (no ray bending). At each sample point p the shader evaluates a DENSITY e(p) and adds emission o += exp(−e·k)·pal(e)·e·Δs·E, the volumetric-emission integral used by twigl/つぶやきGLSL tweet-shaders. The density is a spherical SHELL: base = clamp(1 − |‖p‖ − R| / T, 0, 1) gates a band of thickness T=0.6 around radius R=1 (validated: peaks 0.72 at r=1, exactly 0 for r<0.4 and r>1.6 — a genuinely hollow shell), multiplied by a high-frequency animated trig texture cos(8x+t)·cos(8y−0.7t)·cos(8z) and one octave of IQ domain warp warp1(1.5p) for organic filaments. The warp is built from the project's new noise stack: a sin-free integer-lattice hash → trilinear value noise with a quintic (C1) fade → a 3-octave FBM → a single domain-warp feedback q=fbm(p), d=fbm(p+4q) that bends the field into marbled veins (validated: doubles vein density vs plain FBM). The exp(−e·k) factor self-attenuates — e·exp(−e·k) peaks at e=1/k — so mid-density wisps glow brightest and the dense shell never blows out to a solid blob. A per-channel tanh tone-map compresses the accumulated emission into [0,1) so it asymptotes to white instead of clipping. The whole domain slowly rotates about Y (driven by the time uniform) so the surface plasma appears to boil.",
    "equations": [
      {
        "label": "Volumetric-emission integral (what the loop accumulates)",
        "latex": "o \\mathrel{+}= e^{-k\\,e}\\,\\mathrm{pal}(e)\\,e\\,\\Delta s\\,E"
      },
      {
        "label": "Self-attenuation peak (why mid-density glows brightest)",
        "latex": "\\frac{d}{de}\\big(e\\,e^{-k e}\\big)=0 \\;\\Rightarrow\\; e^\\star = 1/k"
      },
      {
        "label": "Spherical shell density mask",
        "latex": "\\rho(\\mathbf p)=\\operatorname{clamp}\\!\\Big(1-\\tfrac{\\big|\\,\\lVert\\mathbf p\\rVert-R\\,\\big|}{T},\\,0,\\,1\\Big)"
      },
      {
        "label": "Value noise with quintic (C1) fade",
        "latex": "n(\\mathbf p)=\\operatorname{trilerp}\\big(h(\\mathbf i+\\mathbf c)\\big),\\quad u=f^{3}\\!\\big(f(6f-15)+10\\big)"
      },
      {
        "label": "Single-octave domain warp",
        "latex": "\\mathbf q=\\mathrm{fbm}(\\mathbf p+\\boldsymbol\\omega),\\qquad d=\\mathrm{fbm}(\\mathbf p+4\\mathbf q)"
      },
      {
        "label": "Cosine emission palette",
        "latex": "\\mathrm{pal}(e)=0.5+0.5\\cos\\!\\big(2\\pi(e+\\phi)+\\boldsymbol\\Phi\\big),\\;\\boldsymbol\\Phi=(0,2.1,4.2)"
      }
    ],
    "params": [
      {
        "key": "scale",
        "symbol": "s",
        "meaning": "spatial frequency of the warp texture — higher = finer surface filaments (capped at 2.5 to keep noise cells in fp32-safe range)"
      },
      {
        "key": "absorb",
        "symbol": "k",
        "meaning": "self-attenuation strength; the brightest density is e=1/k, so larger k makes thin wisps dominate and dense regions darker"
      },
      {
        "key": "exposure",
        "symbol": "E",
        "meaning": "overall glow brightness (linear emission multiplier, applied before the tanh tone-map)"
      },
      {
        "key": "colShift",
        "symbol": "\\phi",
        "meaning": "hue offset rotating the whole density→colour palette"
      }
    ],
    "code": "// per pixel: march a fixed-step ray through the density field, accumulate emission\nlet pos = ro, emis = vec3(0), entered = 0;\nfor (let i = 0; i < maxSteps; i++) {\n  const r = length(pos);\n  if (r < bound) entered = 1;\n  if (entered && r > bound) break;            // only exit AFTER entering (camDist > bound)\n  if (r < bound) {\n    const q = rotateY(pos, time*0.15) * scale; // domain churns over time\n    // hollow plasma shell at R=1, thickness T=0.6, textured by trig × one warp octave\n    const base = clamp(1 - abs(length(q) - 1.0) / 0.6, 0, 1);\n    const tex  = 0.5 + 0.5*cos(q.x*8+t)*cos(q.y*8-0.7*t)*cos(q.z*8);\n    const e    = clamp(base * tex * (0.6 + 0.8*warp1(q*1.5)), 0, 1);\n    const a    = e*2 + colShift*6.2832 + 0.3;\n    const pal  = 0.5 + 0.5*cos(vec3(a, a+2.1, a+4.2));\n    emis += pal * e * exp(-e*absorb) * step * exposure; // o += exp(-e k) pal e ds\n  }\n  pos += rd * step;\n}\ncol += vec3(tanh(emis.x), tanh(emis.y), tanh(emis.z)); // tone-map over the bg gradient",
    "links": [
      {
        "label": "Inigo Quilez — Domain warping",
        "url": "https://iquilezles.org/articles/warp/"
      },
      {
        "label": "Inigo Quilez — Value noise derivatives",
        "url": "https://iquilezles.org/articles/morenoise/"
      },
      {
        "label": "Volume ray casting (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Volume_ray_casting"
      },
      {
        "label": "twigl — GLSL tweet-shader editor (the look this emulates)",
        "url": "https://twigl.app/"
      }
    ]
  },
  nebula: {
    "title": "Nebula",
    "about": "A soft, wispy cloud of emissive gas filling the frame — the classic interstellar-nebula look of GLSL tweet-shaders. Brighter filaments thread through a diffuse glow, the structure flows slowly over time, and a radial falloff fades the cloud toward the edges of the volume. This is the richest and heaviest preset in the Volume family: its density is a full recursive IQ domain warp (seven noise evaluations per step), which produces the swirling, marbled, fluid-like filaments that distinguish a real nebula from flat fog.",
    "howItWorks": "Each pixel marches a fixed-step ray through a 3D density field and accumulates emission o += exp(−e·k)·pal(e)·e·Δs·E. The density is a domain-warped FBM cloud: cloud = warp(0.9·p + drift), where warp is the full IQ feedback q=fbm(p), r=fbm(p+4q), d=fbm(p+4r) — the recursive structure that bends smooth noise into swirling veins (validated: 244 vein-crossings vs 34 for plain FBM, autocorrelation 0.94→0 confirming a coherent, non-white field). A threshold max(cloud−0.45, 0)·2 carves the diffuse haze into distinct wisps, and a radial falloff clamp(1 − ‖p‖/2.6, 0, 1) fades the cloud to nothing at the volume edge. The noise stack underneath is the project's new procedural-noise infrastructure: a sin-free Hoskins hash (validated white, neighbour covariance 0.0009) → trilinear value noise with a quintic C1 fade (validated continuous derivative across cell boundaries, no kinks) → normalised 3-octave FBM bounded in [0,1]. Because the raw density approaches ~0.74 over a dense column, a tone-map is mandatory: per-channel tanh compresses the accumulation into [0,1) (validated max channel 0.63 — never clips to white). The cloud drifts via a time offset fed into the warp lookup, and the whole domain rotates slowly about Y. This preset deliberately runs at a modest step count (88) because each step is the full 7-call warp (~2.7k ops); pushing steps higher before lowering octaves is the wrong trade.",
    "equations": [
      {
        "label": "Volumetric-emission integral",
        "latex": "o \\mathrel{+}= e^{-k\\,e}\\,\\mathrm{pal}(e)\\,e\\,\\Delta s\\,E"
      },
      {
        "label": "Full recursive IQ domain warp",
        "latex": "\\mathbf q=\\mathrm{fbm}(\\mathbf p),\\;\\mathbf r=\\mathrm{fbm}(\\mathbf p+4\\mathbf q),\\;d=\\mathrm{fbm}(\\mathbf p+4\\mathbf r)"
      },
      {
        "label": "Normalised fractional Brownian motion",
        "latex": "\\mathrm{fbm}(\\mathbf p)=\\frac{\\sum_{o} 2^{-o}\\,n(2^{o}\\mathbf p)}{\\sum_{o} 2^{-o}}\\in[0,1]"
      },
      {
        "label": "Wisp threshold × radial falloff",
        "latex": "e=\\max(\\mathrm{cloud}-0.45,\\,0)\\cdot 2\\cdot\\operatorname{clamp}\\!\\big(1-\\tfrac{\\lVert\\mathbf p\\rVert}{2.6},0,1\\big)"
      },
      {
        "label": "Tone-map (asymptotes to white, never clips)",
        "latex": "\\mathbf c_{\\text{out}}=\\tanh(\\mathbf o),\\qquad \\lim_{\\mathbf o\\to\\infty}\\tanh(\\mathbf o)=1"
      }
    ],
    "params": [
      {
        "key": "scale",
        "symbol": "s",
        "meaning": "spatial frequency of the cloud — higher = smaller, finer filaments (capped at 2.0 for fp32 hash stability)"
      },
      {
        "key": "absorb",
        "symbol": "k",
        "meaning": "self-attenuation; sets which density e=1/k glows brightest, controlling whether thin haze or dense cores dominate"
      },
      {
        "key": "exposure",
        "symbol": "E",
        "meaning": "overall brightness of the emissive gas before tone-mapping"
      },
      {
        "key": "colShift",
        "symbol": "\\phi",
        "meaning": "hue offset rotating the density→colour palette (violet/gold by default)"
      }
    ],
    "code": "// per pixel: fixed-step emission march; density = full IQ domain-warp cloud\nlet pos = ro, emis = vec3(0), entered = 0;\nfor (let i = 0; i < maxSteps; i++) {\n  const r = length(pos);\n  if (r < bound) entered = 1;\n  if (entered && r > bound) break;\n  if (r < bound) {\n    const q = rotateY(pos, time*0.15) * scale;\n    // warp = fbm(p + 4*fbm(p + 4*fbm(p))) — swirling marbled filaments\n    const cloud = warp(q*0.9 + vec3(time*0.05, 0, 0));\n    const fall  = clamp(1 - length(q)/2.6, 0, 1);    // fade to volume edge\n    const e     = clamp(max(cloud - 0.45, 0) * 2.0 * fall, 0, 1);\n    const a     = e*2 + colShift*6.2832 + 0.3;\n    const pal   = 0.5 + 0.5*cos(vec3(a, a+2.1, a+4.2));\n    emis += pal * e * exp(-e*absorb) * step * exposure;\n  }\n  pos += rd * step;\n}\ncol += vec3(tanh(emis.x), tanh(emis.y), tanh(emis.z)); // tone-map MANDATORY here",
    "links": [
      {
        "label": "Inigo Quilez — Domain warping",
        "url": "https://iquilezles.org/articles/warp/"
      },
      {
        "label": "Inigo Quilez — FBM",
        "url": "https://iquilezles.org/articles/fbm/"
      },
      {
        "label": "Dave Hoskins — Hash without sine (Shadertoy)",
        "url": "https://www.shadertoy.com/view/4djSRW"
      },
      {
        "label": "twigl — GLSL tweet-shader editor",
        "url": "https://twigl.app/"
      }
    ]
  },
  voxelCloud: {
    "title": "Voxel Cloud",
    "about": "A volume of glowing cubic chunks — fire-and-ice voxels suspended in space, each block flat-lit in one of two opposed hues with a bright rim along its faces. It is the blocky cousin of the Plasma Orb and Nebula: the camera ray still marches straight through a 3D emission field with no hard surface, but the field is QUANTIZED to a cubic lattice before it is evaluated, so the smooth wisps collapse into discrete Minecraft-scale cubes. Some cells glow warm (ember/fire), others cold (ice/cyan), set by a per-cell hash, and a fract()-distance edge term lights up the cell faces so the chunks read as solid blocks rather than fog.",
    "howItWorks": "For each pixel a ray is stepped a fixed distance Δs through the volume (no bending), accumulating emission o += pal(e)·e·exp(−e·K)·Δs·E exactly like the other Volume presets — the only thing that changes is how the density e(p) is built. At each sample the world point is first rotated slowly about Y (time-driven churn) and scaled by the 'detail' uniform into a coord q. q is then floor-quantized into a cubic lattice: cell = floor(q·N) is the integer voxel id, and the density is sampled at the CELL CENTRE cc = (cell+0.5)/N. Because density depends only on the quantized centre, every sample inside one voxel returns the identical value — a flat-shaded cube. The density itself is the project's 3-octave value-noise FBM thresholded, max(fbm(2·cc) − 0.5, 0)·(1/(1−0.5)), which leaves ~50% of voxels genuinely empty (validated) so the cloud reads as scattered chunks instead of a solid block. Colour is split two ways by hashing the integer cell id (hash31(cell) → a flat per-cube value): the hash shifts the shared cosine palette's phase by ≈±1.3 rad, partitioning the voxels into a near-even warm/cold mix (validated 52/48). Finally a glowing-edge term lights the faces: lf = fract(q·N) is the position inside the cell, edgeDist is its distance to the nearest of the six faces (0 at a face, 0.5 at the centre), and clamp(1 − edgeDist/0.1, 0, 1)·edges adds a rim that is masked to filled voxels only (validated: e at a face ≈ 0.49 vs 0.08 at the centre). The accumulated emission is tanh tone-mapped per channel so it asymptotes into [0,1) instead of clipping. The exp(−e·K) self-attenuation (peaks at e=1/K) keeps the densest cubes from blowing out, and the whole lattice slowly rotates so the chunks tumble.",
    "equations": [
      {
        "label": "Volumetric-emission integral (the marched accumulation, shared with all Volume presets)",
        "latex": "o \\mathrel{+}= \\mathrm{pal}(e)\\, e\\, e^{-eK}\\, \\Delta s\\, E"
      },
      {
        "label": "Cubic quantization — sample density at the voxel centre (blocky, flat per cell)",
        "latex": "\\mathbf{cell}=\\lfloor N\\,\\mathbf{q}\\rfloor,\\qquad \\mathbf{c}_c=\\frac{\\mathbf{cell}+\\tfrac12}{N}"
      },
      {
        "label": "Thresholded FBM density (carves empty voxels)",
        "latex": "d=\\frac{\\max\\big(\\mathrm{fbm}(2\\mathbf{c}_c)-\\tau,\\,0\\big)}{1-\\tau},\\qquad \\tau=0.5"
      },
      {
        "label": "Per-cell two-tone palette phase split (warm vs cold)",
        "latex": "\\Delta\\phi = 2.6\\,\\big(\\mathrm{hash}(\\mathbf{cell})-\\tfrac12\\big)\\in[-1.3,\\,1.3]"
      },
      {
        "label": "Cell-face rim glow (distance of the in-cell coord to the nearest face)",
        "latex": "g=\\mathrm{clamp}\\!\\Big(1-\\tfrac{\\min_i\\min(f_i,\\,1-f_i)}{0.1},\\,0,\\,1\\Big),\\quad \\mathbf{f}=\\mathrm{fract}(N\\mathbf{q})"
      },
      {
        "label": "Final clamped voxel density (rim added only to filled cells)",
        "latex": "e=\\mathrm{clamp}\\big(d + g\\cdot\\mathrm{edges}\\cdot[d>0],\\,0,\\,1\\big)"
      }
    ],
    "params": [
      {
        "key": "scale",
        "symbol": "N_q (detail)",
        "meaning": "Spatial frequency applied to the sample coord before quantization. Higher = finer FBM structure across the cloud (more variety between voxels); lower = broader, smoother chunks."
      },
      {
        "key": "cells",
        "symbol": "N",
        "meaning": "Cubic-lattice resolution (cells per q-unit), a compile-time constant in the registry (default 3). Larger N = smaller, more numerous voxels; smaller N = big chunky blocks."
      },
      {
        "key": "absorb",
        "symbol": "K",
        "meaning": "Self-attenuation in e·exp(−eK); emission peaks at density e=1/K, so larger K makes the dense cube cores darker and favours mid-density faces, smaller K lets cubes glow more solidly."
      },
      {
        "key": "exposure",
        "symbol": "E",
        "meaning": "Overall emission gain before the tanh tone-map. Higher = brighter, more saturated glowing cubes."
      },
      {
        "key": "edge",
        "symbol": "edges",
        "meaning": "Rim-glow gain on the cell faces. 0 = matte blocks (density only); higher = bright glowing edges that make the voxels read as wireframe-lit cubes."
      },
      {
        "key": "colShift",
        "symbol": "colour",
        "meaning": "Base phase of the cosine palette (the warm/cold two-tone split is layered on top of this). Sweeps the overall hue of the whole cloud."
      }
    ],
    "code": "// volumetric branch, sdf2 dispatch — the new arm (full code in branchCode):\nconst N = float(sys.cells ?? 4.0);\nconst cell = floor(q.mul(N)).toVar();              // integer voxel id\nconst cc = cell.add(0.5).div(N).toVar();           // cell centre → blocky\nconst thr = float(0.5);\nconst dens = max(fbm3(cc.mul(2.0)).sub(thr), 0).mul(float(1).div(float(1).sub(thr))).toVar();\nconst tone = hash31(cell).toVar();                 // per-cell hash\nconst toneShift = tone.sub(0.5).mul(2.6).toVar();  // ±1.3 rad palette swing\nconst lf = fract(q.mul(N)).toVar();\nconst edgeDist = min(min(lf.x, float(1).sub(lf.x)),\n  min(min(lf.y, float(1).sub(lf.y)), min(lf.z, float(1).sub(lf.z)))).toVar();\nconst edge = clamp(float(1).sub(edgeDist.div(0.1)), 0, 1).mul(u.edge).toVar();\nconst filled = clamp(dens.mul(1e4), 0, 1).toVar();\ne.assign(clamp(dens.add(edge.mul(filled)), 0, 1));\ntoneOff.assign(toneShift);                         // feeds the shared cosine-palette phase\n// shared tail (palette + emis) is reused verbatim, with `.add(toneOff)` on the palette phase `a`.",
    "links": [
      {
        "label": "Volume ray casting (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Volume_ray_casting"
      },
      {
        "label": "Inigo Quilez — value noise & FBM",
        "url": "https://iquilezles.org/articles/fbm/"
      },
      {
        "label": "Inigo Quilez — domain warping",
        "url": "https://iquilezles.org/articles/warp/"
      },
      {
        "label": "Inigo Quilez — palettes (cosine palette)",
        "url": "https://iquilezles.org/articles/palettes/"
      }
    ]
  },
  mobiusFlow: {
    "title": "Möbius Flow",
    "about": "A Möbius transformation w=(az+b)/(cz+d) — the most general angle-preserving (conformal) map of the complex plane — applied to a checkerboard. Every such map is determined by two fixed points and a complex multiplier λ: points spiral away from one fixed point and into the other, the loxodromic flow that makes the checkerboard swirl. It is the geometry of the Riemann sphere seen flat.",
    "howItWorks": "For each pixel a complex coordinate z is read from the screen, transformed by w=f(z), and coloured by which square of an infinite checkerboard w lands in (sign of sin(s·Re w)·sin(s·Im w), softened by anti-aliasing). The map is written in fixed-point form: (w−p)/(w−q) = λ·(z−p)/(z−q), so p and q are the two fixed points and λ=|λ|e^{iφ} the multiplier — |λ|≠1 makes one fixed point an attractor and the other a repeller (loxodromic), pure rotation of λ makes it elliptic. Every complex division floors the denominator magnitude so the pole c·z+d=0 stays finite. λ's phase drifts with time so the whole field rotates.",
    "equations": [
      {
        "label": "Möbius (linear-fractional) transformation",
        "latex": "w = \\dfrac{a z + b}{c z + d}, \\qquad ad - bc \\neq 0"
      },
      {
        "label": "fixed-point form (p, q fixed; λ the multiplier)",
        "latex": "\\dfrac{w-p}{w-q} = \\lambda\\,\\dfrac{z-p}{z-q}"
      },
      {
        "label": "conformal: it preserves angles everywhere",
        "latex": "f'(z) = \\dfrac{ad-bc}{(cz+d)^2} \\neq 0"
      }
    ],
    "params": [
      {
        "key": "px",
        "symbol": "p_x",
        "meaning": "real part of the first fixed point"
      },
      {
        "key": "py",
        "symbol": "p_y",
        "meaning": "imaginary part of the first fixed point"
      },
      {
        "key": "qx",
        "symbol": "q_x",
        "meaning": "real part of the second fixed point"
      },
      {
        "key": "qy",
        "symbol": "q_y",
        "meaning": "imaginary part of the second fixed point"
      },
      {
        "key": "lam",
        "symbol": "|\\lambda|",
        "meaning": "multiplier magnitude; ≠1 = loxodromic spiral (attract/repel), =1 = elliptic rotation"
      },
      {
        "key": "lphase",
        "symbol": "\\arg\\lambda",
        "meaning": "multiplier phase (×2π) — the rotational twist of the flow"
      },
      {
        "key": "scale",
        "symbol": "s",
        "meaning": "checkerboard frequency"
      },
      {
        "key": "zoom",
        "symbol": "Z",
        "meaning": "view scale on the complex plane"
      },
      {
        "key": "animate",
        "symbol": "\\omega",
        "meaning": "animation speed (rotates z and drifts λ)"
      },
      {
        "key": "colShift",
        "symbol": "\\phi",
        "meaning": "hue of the two checkerboard colours"
      }
    ],
    "code": "// per pixel: z from screen, w = Möbius(z), colour by a checkerboard of w\nconst rhs = cmul(lambda, cdiv(sub(z,p), sub(z,q)));   // λ(z−p)/(z−q)\nconst w   = cdiv(sub(p, cmul(q,rhs)), sub([1,0], rhs)); // (p−q·rhs)/(1−rhs)\nconst chk = sign(sin(s*w.re) * sin(s*w.im));          // checkerboard cell",
    "links": [
      {
        "label": "Möbius transformation (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/M%C3%B6bius_transformation"
      },
      {
        "label": "Conformal map (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Conformal_map"
      },
      {
        "label": "Riemann sphere (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Riemann_sphere"
      }
    ]
  },
  inversion: {
    "title": "Inversion 1/z",
    "about": "The complex reciprocal w=1/z — inversion through the unit circle composed with a reflection. It turns the inside of the unit circle out and the outside in (the origin maps to infinity), yet it is conformal: every line and circle maps to a line or circle, and all angles are preserved. The checkerboard shows the warp.",
    "howItWorks": "Each pixel's complex coordinate z is mapped to w=1/z = z̄/|z|² and coloured by a checkerboard of w. Points near the origin fly out to large |w| (huge cells that the distance fade dissolves into the background), while distant points pull in toward 0. The single pole at z=0 is guarded by flooring |z|² so the centre stays finite.",
    "equations": [
      {
        "label": "complex inversion",
        "latex": "w = \\dfrac{1}{z} = \\dfrac{\\bar z}{|z|^2}"
      },
      {
        "label": "magnitude inverts, angle negates",
        "latex": "|w| = 1/|z|, \\qquad \\arg w = -\\arg z"
      }
    ],
    "params": [
      {
        "key": "scale",
        "symbol": "s",
        "meaning": "checkerboard frequency"
      },
      {
        "key": "zoom",
        "symbol": "Z",
        "meaning": "view scale on the complex plane"
      },
      {
        "key": "animate",
        "symbol": "\\omega",
        "meaning": "animation speed (rotates z over time)"
      },
      {
        "key": "colShift",
        "symbol": "\\phi",
        "meaning": "hue of the two checkerboard colours"
      }
    ],
    "code": "const w = cdiv([1,0], z);            // 1/z, denominator magnitude floored for the z=0 pole\nconst chk = sign(sin(s*w.re)*sin(s*w.im));",
    "links": [
      {
        "label": "Inversive geometry (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Inversive_geometry"
      },
      {
        "label": "Conformal map (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Conformal_map"
      },
      {
        "label": "Riemann sphere (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Riemann_sphere"
      }
    ]
  },
  zSquared: {
    "title": "Square z²",
    "about": "The map w=z² — the simplest non-trivial analytic function. It doubles every angle about the origin and squares every distance, wrapping the plane around itself twice. It is conformal everywhere except at the origin (where the angle-doubling pinches), which the checkerboard reveals as a four-fold rosette at the centre.",
    "howItWorks": "Each pixel's z is squared (z² = (x²−y², 2xy)) and coloured by a checkerboard of w. Because arg(w)=2·arg(z), the checkerboard squares spiral and double around the origin; because |w|=|z|², cells stretch rapidly outward. A rotation of z with time spins the whole figure.",
    "equations": [
      {
        "label": "complex square",
        "latex": "w = z^2 = (x^2 - y^2) + 2xy\\,i"
      },
      {
        "label": "doubles the angle, squares the modulus",
        "latex": "|w| = |z|^2, \\qquad \\arg w = 2\\arg z"
      }
    ],
    "params": [
      {
        "key": "scale",
        "symbol": "s",
        "meaning": "checkerboard frequency"
      },
      {
        "key": "zoom",
        "symbol": "Z",
        "meaning": "view scale on the complex plane"
      },
      {
        "key": "animate",
        "symbol": "\\omega",
        "meaning": "animation speed (rotates z over time)"
      },
      {
        "key": "colShift",
        "symbol": "\\phi",
        "meaning": "hue of the two checkerboard colours"
      }
    ],
    "code": "const w = cmul(z, z);               // z²\nconst chk = sign(sin(s*w.re)*sin(s*w.im));",
    "links": [
      {
        "label": "Analytic function (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Analytic_function"
      },
      {
        "label": "Conformal map (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Conformal_map"
      },
      {
        "label": "Riemann sphere (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Riemann_sphere"
      }
    ]
  },
  complexExp: {
    "title": "Exponential eᶻ",
    "about": "The complex exponential w=e^z. It maps horizontal lines to rays from the origin and vertical lines to concentric circles, turning the checkerboard's grid into a polar fan. Because e^z is periodic in the imaginary direction (period 2πi), the pattern repeats vertically — a conformal map that wraps the strip into the whole plane.",
    "howItWorks": "Each pixel's z=(x,y) becomes w=e^x·(cos y, sin y): the real part sets the radius, the imaginary part the angle. The checkerboard of w therefore reads as rings (constant x) crossed by spokes (constant y). The real part is clamped before exponentiation so e^x can't overflow.",
    "equations": [
      {
        "label": "complex exponential",
        "latex": "w = e^{z} = e^{x}\\,(\\cos y + i\\sin y)"
      },
      {
        "label": "periodic in the imaginary direction",
        "latex": "e^{z + 2\\pi i} = e^{z}"
      }
    ],
    "params": [
      {
        "key": "scale",
        "symbol": "s",
        "meaning": "checkerboard frequency"
      },
      {
        "key": "zoom",
        "symbol": "Z",
        "meaning": "view scale on the complex plane"
      },
      {
        "key": "animate",
        "symbol": "\\omega",
        "meaning": "animation speed (rotates z over time)"
      },
      {
        "key": "colShift",
        "symbol": "\\phi",
        "meaning": "hue of the two checkerboard colours"
      }
    ],
    "code": "const ex = exp(clamp(z.re, -8, 8));  // clamp Re so eˣ can't overflow\nconst w  = [ex*cos(z.im), ex*sin(z.im)];\nconst chk = sign(sin(s*w.re)*sin(s*w.im));",
    "links": [
      {
        "label": "Exponential function (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Exponential_function#Complex_plane"
      },
      {
        "label": "Conformal map (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Conformal_map"
      },
      {
        "label": "Riemann sphere (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Riemann_sphere"
      }
    ]
  },
  joukowskiMap: {
    "title": "Joukowski ½(z+1/z)",
    "about": "The Joukowski transform w=½(z+1/z) — the classical map that turns circles into aerofoil shapes, the foundation of early aerodynamics. It folds the plane around the segment [−1,1] (the images of the unit circle), and away from its two critical points ±1 it is conformal. On a checkerboard it produces the characteristic lens-and-wing folds.",
    "howItWorks": "Each pixel's z is mapped to ½(z+1/z) and coloured by a checkerboard of w. The unit circle collapses onto the real segment [−1,1]; circles offset from the origin become aerofoil (wing) profiles, which is why the warped checkerboard sweeps into wing-like bands. The 1/z term's pole at z=0 is guarded.",
    "equations": [
      {
        "label": "Joukowski transform",
        "latex": "w = \\tfrac12\\left(z + \\dfrac{1}{z}\\right)"
      },
      {
        "label": "critical points (angle-doubling) at",
        "latex": "z = \\pm 1, \\qquad w = \\pm 1"
      }
    ],
    "params": [
      {
        "key": "scale",
        "symbol": "s",
        "meaning": "checkerboard frequency"
      },
      {
        "key": "zoom",
        "symbol": "Z",
        "meaning": "view scale on the complex plane"
      },
      {
        "key": "animate",
        "symbol": "\\omega",
        "meaning": "animation speed (rotates z over time)"
      },
      {
        "key": "colShift",
        "symbol": "\\phi",
        "meaning": "hue of the two checkerboard colours"
      }
    ],
    "code": "const w = mul(add(z, cdiv([1,0], z)), 0.5);  // ½(z + 1/z)\nconst chk = sign(sin(s*w.re)*sin(s*w.im));",
    "links": [
      {
        "label": "Joukowsky transform (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Joukowsky_transform"
      },
      {
        "label": "Conformal map (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Conformal_map"
      },
      {
        "label": "Riemann sphere (Wikipedia)",
        "url": "https://en.wikipedia.org/wiki/Riemann_sphere"
      }
    ]
  },
  kaleidoTunnel: {
    title: 'Kaleidoscope Tunnel',
    about:
      'A flight down an endless mirrored corridor. Just like a toy kaleidoscope folds a few coloured beads into a perfectly symmetric rosette, this sphere-traced shader folds 3D space into a wedge of mirrors so every chamber repeats around a central axis — and tiles that chamber infinitely down its length, so the camera appears to fall forever through twisting rings of flat-shaded facets. The view is pointed straight down the throat, where the rings shrink to a vanishing point.',
    howItWorks:
      'It is a distance-field raymarcher, but the distance field is built from symmetry. Before measuring distance to the geometry, each sample point is folded: its angle around the axis is wrapped into one wedge of size 2π/N and mirrored, which is exactly the kaleidoscope operation (N copies of one wedge, reflected). The depth coordinate z is shifted by time (the fly-through) and then taken modulo a cell size, so one short stretch of tunnel repeats endlessly. A depth-proportional rotation adds a helical twist so the rings spiral. Inside each folded cell the surface is a hollow hexagonal tube (an exact hexagon distance function, shelled to a thin wall) sliced into ring bars. Rather than the usual smooth orbit-trap colouring, each ring hashes to a flat facet colour and the two mirror halves of every wedge take alternating tones — giving the crisp, low-poly stained-glass look instead of a gradient.',
    equations: [
      {
        label: 'kaleidoscopic angle fold (N mirrors)',
        latex: '\\theta \\mapsto \\Big|\\,(\\theta \\bmod \\tfrac{2\\pi}{N}) - \\tfrac{\\pi}{N}\\,\\Big|'
      },
      {
        label: 'tunnel tiling along depth',
        latex: "z' = \\big((z + v\\,t)\\bmod c\\big) - \\tfrac{c}{2}"
      },
      {
        label: 'helical twist (depth-proportional)',
        latex: '(x,y)\\mapsto R(\\tau z)\\,(x,y),\\quad \\tau = \\text{twist}'
      },
      {
        label: 'hollow hexagonal tube',
        latex: 'd = \\big|\\,\\mathrm{hex}(x,y)\\,\\big| - w'
      },
      {
        label: 'sphere-trace march',
        latex: 't_{i+1} = t_i + d(\\mathbf{p}(t_i))'
      }
    ],
    params: [
      {
        key: 'symmetry',
        symbol: 'N',
        meaning: 'number of mirror wedges folded around the axis — the fold count of the kaleidoscopic rosette'
      },
      {
        key: 'twist',
        symbol: '\\tau',
        meaning: 'depth-proportional rotation that twists the tunnel rings into a helix (0 = straight bars)'
      },
      {
        key: 'speed',
        symbol: 'v',
        meaning: 'fly-through speed — how fast the tunnel scrolls toward the camera'
      },
      {
        key: 'cellScale',
        symbol: 'c',
        meaning: 'length of one repeating cell along the tunnel; larger = longer chambers, sparser rings'
      },
      {
        key: 'colShift',
        symbol: '\\Delta h',
        meaning: 'hue offset of the flat-facet palette'
      }
    ],
    code: "const wedge = (2*Math.PI) / N;\nconst zAdv = p.z + uTime*speed;             // scroll the tunnel\nconst zt = mod(zAdv, cell) - cell*0.5;       // tile depth into cells\nconst tw = twist * p.z;                       // helical twist\nlet [rx,ry] = rot(p.x, p.y, tw);\nconst a = Math.abs(mod(atan2(ry,rx), wedge) - wedge*0.5); // mirror fold\nconst hex = Math.abs(hexSDF(r*cos(a), r*sin(a))) - 0.18;  // hollow hex tube\nconst zc  = Math.abs(zt) - cell*0.30;        // slice into ring bars\nconst d = length(max(hex,0), max(zc,0)) + min(max(hex,zc),0);\n// facet colour: per-ring hash + alternating mirror-half tone (flat, not gradient)",
    links: [
      {
        label: 'Kaleidoscope (Wikipedia)',
        url: 'https://en.wikipedia.org/wiki/Kaleidoscope'
      },
      {
        label: 'Raymarching distance fields (Íñigo Quílez)',
        url: 'https://iquilezles.org/articles/distfunctions/'
      },
      {
        label: 'Folding space / kaleidoscopic IFS',
        url: 'https://en.wikipedia.org/wiki/Iterated_function_system'
      }
    ]
  },
  octicLattice: {
    title: 'Octic Node Lattice',
    about:
      "A procedural algebraic surface: the zero set of a high-degree polynomial in x, y and z. A quartic 'double well' on each axis carves out a grid of cells; a nodal-coupling term breaks the cubic symmetry so the cells link into an organic crystalline lattice. The polynomial actually has infinite sheets, so it's cropped to a sphere — the framed chunk you see is the lattice.",
    howItWorks:
      "It's sphere-traced like our other implicit surfaces: for each pixel a ray steps forward by a fraction of the distance to the surface F(x,y,z)=0. The field is F = Qx·Qy·Qz − 0.028·(x²−y²)(y²−z²)(z²−x²) − 0.012·xyz, where each axis well is the quartic Qₐ = a⁴ − a² = a²(a²−1) (zeros at a = 0, ±1). The product of the three wells is near zero on a 3D grid of planes (the cell walls); the coupling term and the xyz term twist and fuse those walls into rounded nodes. Because the gradient ∇F swings over many orders of magnitude near the nodes, the marcher's step is strongly under-relaxed and hard-capped so it doesn't overshoot the thin pinch points. The 'isovalue' slider shifts the level set (F = iso), fattening or thinning the lattice.",
    equations: [
      { label: 'implicit surface', latex: 'F(x,y,z) = Q_xQ_yQ_z - 0.028\\,(x^2-y^2)(y^2-z^2)(z^2-x^2) - 0.012\\,xyz = 0' },
      { label: 'quartic axis well', latex: 'Q_a = a^4 - a^2 = a^2\\,(a^2-1)\\quad(\\text{zeros at } a=0,\\pm1)' },
      { label: 'sphere-trace step', latex: 't_{i+1} = t_i + \\sigma\\,\\frac{|F|}{\\lVert\\nabla F\\rVert}' },
    ],
    params: [
      { key: 'iso', symbol: 'c', meaning: 'isovalue — shifts the level set F = c, fattening or thinning the lattice cells' },
      { key: 'colShift', symbol: '\\Delta h', meaning: 'hue offset of the surface palette (≈ warm gold by default)' },
      { key: 'animate', symbol: '\\omega', meaning: 'gentle rotation + morph rate of the lattice' },
    ],
    code: "// implicit field F(x,y,z); the ray-marcher finds F = iso\nconst qx = x*x*x*x - x*x;   // quartic double well Q_a = a⁴ − a²\nconst qy = y*y*y*y - y*y;\nconst qz = z*z*z*z - z*z;\nconst coupling = (x*x - y*y)*(y*y - z*z)*(z*z - x*x);\nF = qx*qy*qz - 0.028*coupling - 0.012*x*y*z;   // = iso ; cropped to the bounding sphere",
    links: [
      { label: 'Algebraic surface (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Algebraic_surface' },
      { label: 'Isosurface (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Isosurface' },
      { label: 'Ray marching / distance fields (Íñigo Quílez)', url: 'https://iquilezles.org/articles/distfunctions/' },
    ],
  },
  newtonFractal: {
    "title": "Newton Fractal",
    "about": "Run Newton's root-finding method on the simplest interesting polynomial, p(z)=zⁿ−1, starting from every point of the complex plane. Most starting points spiral into one of the n roots-of-unity — colour each pixel by WHICH root it reaches and you get n smooth basins of attraction. But the boundaries between basins are not curves: they are an infinitely intricate fractal where all n basins meet at every point, and that filigree is the flowing, n-fold-symmetric structure of polynomiography (Bahman Kalantari's term for root-finding-as-art, and the family of images behind Simone Conradi's polynomial-root pieces).",
    "howItWorks": "For each pixel a complex coordinate z is read from the screen and iterated by Newton's map. For p(z)=zⁿ−1 the step simplifies to z ← z − a·(z − z^{1−n})/n, where a is an over-relaxation factor (a=1 is ordinary Newton; a>1 over-shoots, thickening the fractal seams into the dramatic flowing ribbons). The complex power z^{1−n} is evaluated in polar form r^{1−n}·(cos(1−n)θ, sin(1−n)θ) with a pole-floor on r so z=0 stays finite. After a fixed iteration budget the final z is snapped to the nearest n-th root of unity (its argument → root index) to pick a hue; the number of iterations taken modulates brightness, so the slow-to-converge fractal boundary glows while basin interiors stay dark. 'morph' slowly drifts a so the seams breathe.",
    "equations": [
      { "label": "polynomial and its roots", "latex": "p(z) = z^{n} - 1, \\qquad \\text{roots } \\omega_k = e^{2\\pi i k / n}" },
      { "label": "Newton iteration (over-relaxed)", "latex": "z \\;\\leftarrow\\; z - a\\,\\frac{p(z)}{p'(z)} = z - a\\,\\frac{z - z^{1-n}}{n}" },
      { "label": "complex power in polar form", "latex": "z^{m} = r^{m}\\,\\big(\\cos m\\theta,\\ \\sin m\\theta\\big), \\quad r=|z|,\\ \\theta=\\operatorname{atan}(y,x)" },
    ],
    "params": [
      { "key": "fold", "symbol": "n", "meaning": "degree of zⁿ−1 → the number of roots and the n-fold symmetry of the basins" },
      { "key": "relax", "symbol": "a", "meaning": "over-relaxation: a=1 ordinary Newton (thin seams), a>1 thickens the flowing fractal ribbons" },
      { "key": "zoom", "symbol": "Z", "meaning": "view scale on the complex plane" },
      { "key": "animate", "symbol": "\\omega", "meaning": "morph rate — slowly drifts a so the basin boundaries shimmer" },
      { "key": "colShift", "symbol": "\\phi", "meaning": "hue rotation of the per-root palette" },
    ],
    code: "// per pixel: Newton's method on p(z)=zⁿ−1\nz = vec2(ndc.x, ndc.y) * zoom;\nfor (i in 0..iters) {\n  r = max(|z|, 1e-6);  th = atan(z.y, z.x);\n  zPow = r^(1-n) * (cos((1-n)th), sin((1-n)th));  // z^{1−n}\n  dz = a * (z - zPow) / n;   z -= dz;\n  if (|dz| < 1e-4) break;     // converged → which root?\n}\nrootId = round( atan(z.y,z.x)/2π * n );   // hue\nglow   = pow(iter/iters, 0.5);            // boundary brightness",
    links: [
      { label: 'Newton fractal (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Newton_fractal' },
      { label: 'Polynomiography (Bahman Kalantari)', url: 'https://en.wikipedia.org/wiki/Polynomiography' },
      { label: "Newton's method (Wikipedia)", url: 'https://en.wikipedia.org/wiki/Newton%27s_method' },
    ],
  },
  contourField: {
    "title": "Contour Field",
    "about": "A drawing made of contour lines — the level sets (isolines) of a smooth scalar field, like the curves on a topographic map that join points of equal height. The field here is an interference of a few waves, folded into mirror symmetry and slowly morphing, so the nested loops drift, merge, and split through saddle points — the hypnotic line-art of artists like Zach Lieberman. Pure white lines on black; no 3D, just the poetry of level sets.",
    "howItWorks": "For each pixel a point z is read from the screen, given a mild barrel-bulge, folded into one quadrant (|x|,|y|) so the picture is mirror-symmetric across both axes, and warped by a couple of slow sine displacements (the organic, quasi-3D drift). A scalar field f is built as a sum of plane waves at several angles plus a radial term and an L∞ (max) term — that mixture is what gives the varied contour shapes: concentric ovals around peaks, rectangles from the L∞ term, triangles where diagonal waves fold. Lines are drawn where f·density is near an integer (a level set): a triangle wave of fract(f) is thresholded, anti-aliased with the screen-space derivative fwidth so the lines stay crisp and don't alias where contours crowd together. Everything's phases drift with time, so the field continuously morphs.",
    "equations": [
      { "label": "contour lines = level sets of a scalar field", "latex": "\\{(x,y) : f(x,y) = c\\}, \\quad c \\in \\tfrac{1}{\\rho}\\,\\mathbb{Z}" },
      { "label": "the field: folded interference of waves", "latex": "f(\\mathbf{q}) = \\sum_i \\sin(\\mathbf{k}_i\\!\\cdot\\!\\mathbf{q} + \\varphi_i t) + \\sin(\\lvert\\mathbf{q}\\rvert) + \\sin(\\max(q_x,q_y)), \\;\\; \\mathbf{q}=(|x|,|y|)" },
      { "label": "anti-aliased line (screen-space width)", "latex": "\\text{line} = \\operatorname{smoothstep}\\!\\big(1-w-a,\\ 1-w,\\ |\\,2\\operatorname{fract}(\\rho f)-1|\\big), \\;\\; a=\\operatorname{fwidth}(\\rho f)" },
    ],
    "params": [
      { "key": "density", "symbol": "\\rho", "meaning": "contour density — how many nested level-set lines (closer spacing)" },
      { "key": "warp", "symbol": "w", "meaning": "domain-warp amount — the organic bulge/drift that gives the quasi-3D feel" },
      { "key": "thickness", "symbol": "\\tau", "meaning": "line weight" },
      { "key": "zoom", "symbol": "Z", "meaning": "view scale on the field" },
      { "key": "animate", "symbol": "\\omega", "meaning": "morph rate — how fast the field's phases drift" },
      { "key": "colShift", "symbol": "\\phi", "meaning": "faint line tint (≈ white by default)" },
    ],
    code: "// per pixel: contour lines of a folded sum-of-waves field\nlet p = vec2(ndc.x, ndc.y) * zoom;\np *= 1 + 0.18*dot(p,p);                 // barrel bulge\nconst q = abs(p) + warp*sin(...);        // fold (mirror symmetry) + warp\nconst f = sin(k1·q+t) + ... + sin(|q|) + sin(max(q.x,q.y));\nconst tri = abs(fract(f*density) - 0.5) * 2;      // 1 at level sets\nconst aa  = fwidth(f*density);                      // screen-space AA\nconst line = smoothstep(1-thickness-aa, 1-thickness, tri);\ncol = white * line;",
    links: [
      { label: 'Contour line / level set (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Contour_line' },
      { label: 'Zach Lieberman (artist)', url: 'https://zach.li/' },
      { label: 'Marching squares / isolines', url: 'https://en.wikipedia.org/wiki/Marching_squares' },
    ],
  },
  inkBloom: {
    "title": "Ink Bloom",
    "about": "A drop of ink in water, or a wash of watercolour on wet paper: pigment blooms outward in soft translucent lobes, and wherever two washes overlap the colour deepens. This is that, built as pure compositing rather than a fluid simulation — a ring of overlapping translucent petals laid over a cream ground, warm peach at the soft edges pooling to a dark, inky heart at the centre. Not a 3D surface or a fractal; just layered light and pigment.",
    "howItWorks": "Each pixel reads a plane coordinate that is first domain-warped by a few slow sines so the petal edges undulate organically. Then N petals are placed around a ring; each is a Gaussian blob whose width is the 'softness'. The colour is built by TRANSLUCENT INK LAYERING (subtractive, like watercolour) rather than by summing a field: starting from the cream paper, each petal multiplies the colour beneath it toward its own pigment with an alpha set by the Gaussian. Because the layering is multiplicative, a lone petal stays a pale wash but wherever petals OVERLAP the colour compounds and deepens — and at the centre, where every petal meets a final pooled blob, it darkens to a deep indigo heart. Petal pigment alternates between warm peach and cool indigo (biased by 'warmth'); the whole ring slowly rotates and the warp drifts with 'morph'.",
    "equations": [
      { "label": "petal alpha (Gaussian on a ring)", "latex": "a_i = \\operatorname{clamp}\\big(\\beta\\,e^{-\\lVert \\mathbf{q}-\\mathbf{c}_i\\rVert^{2}/\\sigma^{2}}\\big), \\quad \\mathbf{c}_i = \\rho\\,(\\cos\\theta_i,\\ \\sin\\theta_i)" },
      { "label": "translucent ink layering (overlaps deepen)", "latex": "\\mathbf{C} \\;\\leftarrow\\; \\operatorname{mix}\\big(\\mathbf{C},\\ \\mathbf{C}\\odot\\mathbf{ink}_i,\\ a_i\\big)" },
      { "label": "pigment: warm peach ↔ cool indigo", "latex": "\\mathbf{ink}_i = \\operatorname{mix}(\\mathbf{indigo},\\ \\mathbf{peach},\\ w_i), \\quad w_i \\sim \\tfrac12 + \\tfrac12\\cos(\\cdots) + (\\text{warmth}-\\tfrac12)" },
    ],
    "params": [
      { "key": "softness", "symbol": "\\sigma", "meaning": "petal width — small = crisp distinct petals, large = a single soft cloud" },
      { "key": "warmth", "symbol": "w", "meaning": "pigment bias: low = cool indigo bloom, high = warm peach bloom" },
      { "key": "bloom", "symbol": "\\beta", "meaning": "petal opacity / overall density of the wash" },
      { "key": "zoom", "symbol": "Z", "meaning": "view scale of the bloom" },
      { "key": "animate", "symbol": "\\omega", "meaning": "morph rate — how fast the ring rotates and the petal edges drift" },
      { "key": "colShift", "symbol": "\\phi", "meaning": "rotates which petals are warm vs cool around the ring" },
    ],
    code: "// per pixel: layer N translucent petals over cream paper\nlet C = cream;\nconst q = warp(vec2(ndc.x, ndc.y) * zoom);   // slow-sine domain warp\nfor (i in 0..N) {                              // petals on a ring\n  const c  = 0.62 * vec2(cos(ang_i), sin(ang_i));\n  const a  = clamp(bloom * exp(-dot(q-c, q-c) / softness^2), 0, 0.7);\n  const ink = mix(indigo, peach, warmLobe_i);  // alternating pigment\n  C = mix(C, C * ink * 1.25, a);               // multiplicative → overlaps deepen\n}\nconst ac = clamp(bloom * exp(-dot(q,q) / (1.8*softness^2)), 0, 0.82);\nC = mix(C, C * deepIndigo, ac);                // pooled inky heart",
    links: [
      { label: 'Watercolour (wet-on-wet)', url: 'https://en.wikipedia.org/wiki/Watercolor_painting' },
      { label: 'Alpha compositing (Porter–Duff)', url: 'https://en.wikipedia.org/wiki/Alpha_compositing' },
      { label: 'Subtractive colour (pigment mixing)', url: 'https://en.wikipedia.org/wiki/Subtractive_color' },
    ],
  },
  gravLens: {
    "title": "Gravitational Lens",
    "about": "Mass bends spacetime, and light follows the bend — so a massive foreground object acts as a lens for whatever sits behind it. When the source, lens, and observer line up, a background galaxy is smeared into a luminous EINSTEIN RING; off-axis it splits into arcs and multiple images. Hubble's view of the cluster MACS J0416 is the famous example, its background galaxies stretched into arcs by the cluster's mass. This is the pure-optics version: a point mass lensing a procedural sky into a ring of light — no accretion disk or event horizon (that's the black-hole marcher); just the geometry of bent light.",
    "howItWorks": "For each pixel we read its observed direction θ on the image plane and ask: where on the SOURCE plane did that light actually come from? A point mass deflects a ray passing at impact parameter b by α = 4GM/(c²b), which for the thin-lens geometry gives the lens equation β = θ − θ_E²/θ, where θ_E is the Einstein radius (the ring's angular size). We invert that as a forward map β = θ·(1 − r_E²/|θ|²) and sample the background sky at β — so a source at the optic axis (β=0) lights up the entire ring |θ|=r_E at once, and everything else is pulled into arcs. The sky is two drifting source galaxies plus a hashed star field; the ring is brightened by the lensing magnification (which formally diverges at θ_E), and a faint deflector glows at the centre. Sweep the Einstein radius to grow or shrink the ring.",
    "equations": [
      { "label": "point-mass deflection angle", "latex": "\\alpha = \\frac{4GM}{c^{2}\\,b}" },
      { "label": "thin-lens equation", "latex": "\\beta = \\theta - \\frac{\\theta_E^{2}}{\\theta}, \\qquad \\theta_E = \\sqrt{\\frac{4GM}{c^{2}}\\frac{D_{LS}}{D_L D_S}}" },
      { "label": "observed → source map (what the shader samples)", "latex": "\\beta = \\theta\\,\\Big(1 - \\frac{r_E^{2}}{\\lvert\\theta\\rvert^{2}}\\Big)" },
      { "label": "Einstein ring (source on axis)", "latex": "\\beta = 0 \\;\\Rightarrow\\; \\lvert\\theta\\rvert = r_E \\ \\text{(a full ring)}" },
    ],
    "params": [
      { "key": "mass", "symbol": "r_E", "meaning": "Einstein radius — the lens mass / ring size (bigger = stronger lensing, larger ring)" },
      { "key": "zoom", "symbol": "Z", "meaning": "field of view on the image plane" },
      { "key": "animate", "symbol": "\\alpha", "meaning": "drift rate of the background source galaxies (ring breathes as they move)" },
      { "key": "colShift", "symbol": "\\phi", "meaning": "hue of the lensed source light" },
    ],
    code: "// per pixel: invert the thin-lens map, sample the background sky at the source position\nconst theta = vec2(ndc.x, ndc.y) * zoom;\nconst b = max(length(theta), 1e-3);\nconst beta = theta * (1 - rE*rE / (b*b));     // observed → source\nlet col = sampleGalaxies(beta) + starfield(beta);  // lensed background\ncol += ringGlow(b, rE);                         // magnification brightens |θ|=rE\ncol += deflectorGlow(b);                         // faint lensing mass at centre",
    links: [
      { label: 'Gravitational lens (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Gravitational_lens' },
      { label: 'Einstein ring (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Einstein_ring' },
      { label: 'MACS J0416 (Hubble Frontier Fields)', url: 'https://en.wikipedia.org/wiki/MACS_J0416.1-2403' },
    ],
  },
  jellyfishBloom: {
    "title": "Jellyfish Bloom",
    "about": "In the dark of the deep ocean, life makes its own light. A swarm of jellyfish — fittingly, the collective noun is a 'bloom' — drifts through the water as a constellation of glowing bells, each pulsing to swim and trailing luminous tentacles. This is a generative version of that bioluminescent scene: translucent medusae lit from within in cool living-light blues and violets, pulsing and wandering against an abyssal gradient flecked with drifting marine snow.",
    "howItWorks": "It is drawn per-pixel, with no 3D geometry — pure additive glow composited over a dark blue-to-black gradient. Each jellyfish is an ellipse: an elliptical 'radius' e measures distance from the bell's centre, and the membrane glows where e≈1 (a bright rim) with a soft inner fill, masked to the upper half so it reads as a dome. The bell pulses by oscillating its width and height in ANTI-PHASE — wide-and-flat then tall-and-narrow — the jet propulsion real jellyfish use. Below each bell, a few wavy strands hang and sway as tentacles. The whole swarm drifts on slow sines, each medusa tinted a little differently across the cyan-violet range, and faint hashed motes of marine snow rise through the scene. Everything is bounded glow in [0,1].",
    "equations": [
      { "label": "elliptical bell membrane", "latex": "e = \\Big\\lVert \\big(\\tfrac{q_x}{r_w},\\ \\tfrac{q_y}{r_h}\\big) \\Big\\rVert, \\qquad \\text{rim} = e^{-45\\,(e-1)^2}\\;\\text{(upper half)}" },
      { "label": "pulsation (anti-phase = jet propulsion)", "latex": "r_w = r_w^0 + a\\sin(\\omega t + \\phi), \\quad r_h = r_h^0 - 0.6\\,a\\sin(\\omega t + \\phi)" },
      { "label": "swarm drift", "latex": "\\mathbf{c}_j(t) = \\mathbf{c}_j^0 + \\big(0.16\\sin(0.6t + \\cdots),\\ 0.1\\sin(0.4t + \\cdots)\\big)" },
    ],
    "params": [
      { "key": "glow", "symbol": "G", "meaning": "brightness of the bioluminescence (bells + tentacles)" },
      { "key": "pulse", "symbol": "a", "meaning": "how strongly the bells pulse as they swim" },
      { "key": "zoom", "symbol": "Z", "meaning": "field of view — lower shows fewer, larger medusae; higher shows more of the swarm" },
      { "key": "animate", "symbol": "\\omega", "meaning": "drift + pulse rate of the bloom" },
      { "key": "colShift", "symbol": "\\phi", "meaning": "hue of the living light, across cyan → violet" },
    ],
    code: "// per pixel: additive glow of a drifting swarm of pulsing bells over the abyss\nfor (let j = 0; j < N; j++) {\n  const c = drift(basePos[j], t);                 // slow wander\n  const q = p - c;\n  const a = pulse * Math.sin(2.2*t + j*1.7);\n  const rw = 0.24 + a, rh = 0.18 - 0.6*a;          // anti-phase → propulsion\n  const e = length(vec2(q.x/rw, q.y/rh));\n  const rim  = exp(-45*(e-1)**2) * upperHalf(q.y); // glowing membrane\n  const fill = exp(-2*e*e) * 0.35 * upperHalf(q.y);\n  col += jellyColor(j) * (rim + fill) * glow;\n  col += tentacles(q, t, j) * glow;                // wavy strands below\n}",
    links: [
      { label: 'Bioluminescence (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Bioluminescence' },
      { label: 'Jellyfish (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Jellyfish' },
      { label: 'Jellyfish bloom (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Jellyfish#Blooms' },
    ],
  },
  moire: {
    "title": "Moiré Grid",
    "about": "Overlap two regular patterns and a third, coarser pattern appears out of nowhere — the moiré. It's the beat frequency of the visual world: where the two grids almost-but-not-quite align, they reinforce; where they fall out of step, they cancel. The barrier-grid illusion weaponises this for apparent motion — a fixed image seen through a sliding stripe mask appears to move, though nothing rotates. Here a fixed radial hash grating sits under a sliding vertical barrier, and the moiré rosette between them sweeps around as the barrier translates: static geometry your brain insists is spinning.",
    "howItWorks": "Two binary gratings are built per pixel. The fixed one is a RADIAL hash grating — a square wave of the polar angle θ, so it reads as a set of ticks fanning out around the centre (crisp-thresholded from sin(N·θ)). The moving one is a linear BARRIER — a vertical square wave of x that slides with time. The displayed value is their XOR (|A − B|): white where exactly one grating is 'on', black where they agree. Because one grating is radial and the other linear, their interference fringes are curved (hyperbolic), and translating the linear barrier makes those fringes rotate around the disk — the illusion. The pattern is confined to a soft-edged disk, and the very centre (where the angular frequency is infinite) is calmed to avoid aliasing.",
    "equations": [
      { "label": "radial hash grating (fixed)", "latex": "A = \\big[\\sin(N\\theta) > 0\\big], \\quad \\theta = \\operatorname{atan}(y, x)" },
      { "label": "barrier grating (sliding)", "latex": "B = \\big[\\sin(k\\,x + v t) > 0\\big]" },
      { "label": "moiré = exclusive-or of the two", "latex": "M = \\lvert A - B\\rvert" },
    ],
    "params": [
      { "key": "spokes", "symbol": "N", "meaning": "number of radial hash ticks around the circle" },
      { "key": "bars", "symbol": "k", "meaning": "density of the sliding vertical barrier stripes" },
      { "key": "zoom", "symbol": "Z", "meaning": "view scale of the figure" },
      { "key": "animate", "symbol": "v", "meaning": "barrier speed — how fast the illusory rotation sweeps" },
    ],
    code: "// per pixel: XOR a fixed radial grating with a sliding vertical barrier\nconst th = atan(ndc.y, ndc.x);\nconst A = step(0, sin(th * spokes));            // radial hashes (fixed)\nconst B = step(0, sin(ndc.x * bars + t));       // barrier (sliding)\nconst moire = abs(A - B);                        // interference fringes\ncol = vec3(moire) * diskMask * calmCentre;       // white on black, circular",
    links: [
      { label: 'Moiré pattern (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Moir%C3%A9_pattern' },
      { label: 'Barrier-grid animation / scanimation', url: 'https://en.wikipedia.org/wiki/Barrier-grid_animation_and_stereography' },
      { label: 'Op art (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Op_art' },
    ],
  },
  everlasting: {
    "title": "Everlasting Flower",
    "about": "A volumetric flower — feathery petals of glowing density rather than surfaces, in the spirit of the astonishing one-tweet GLSL blooms of Yohei Nishitsuji's つぶやきGLSL (tweet-shader) work. The trick behind that whole genre is turbulence in a LOG-SPHERICAL domain: replace the radius with its logarithm and the turbulence becomes self-similar layer upon layer, like petals nested inside petals. We grow our own everlasting (strawflower) with that idea — a combed field of thin petal vanes, cupped over green sepals around a cream heart — marched as an emissive volume and composited front-to-back so the petals have real silhouettes.",
    "howItWorks": "Each ray steps through a density field built from three ingredients. (1) TURBULENCE: five octaves of the sin-dot-sin folding trick, Σ dot(sin(p.yzy·s), sin(p.xxz·s))/s, evaluated in log-spherical coordinates (log₂ r, polar, azimuth) so the detail is self-similar in radius — the feathering. (2) VANES: an azimuthal comb sin(petals·φ + …), pow-sharpened into thin radial sheets that lean with the polar angle and twist with log-radius; thin sheets survive the line integral where a soft angular blend would wash out into fog. The bloom's outer envelope extends where a vane runs, so petal tips break the silhouette. (3) COMPOSITING: front-to-back Beer–Lambert absorption (near petals occlude far ones — crisp edges), with the palette keyed by POSITION rather than density: cream at the heart, blush pink through the petals (hue-shiftable), green wrapping the outer sepals. The whole flower slowly turns with the marcher's domain churn.",
    "equations": [
      { "label": "sin-octave turbulence (the twigl fold)", "latex": "T(\\mathbf{p}) = \\sum_{s=2,4,\\dots,32} \\frac{\\sin(\\mathbf{p}_{yzy} s)\\cdot\\sin(\\mathbf{p}_{xxz} s)}{s}" },
      { "label": "log-spherical domain (self-similar petals)", "latex": "\\mathbf{p} = \\big(\\log_2 r,\\ \\theta_{\\text{polar}},\\ \\varphi\\big)" },
      { "label": "petal vanes (sharpened azimuthal comb)", "latex": "V = \\Big(\\tfrac{1}{2} + \\tfrac{1}{2}\\sin(n\\varphi + 3\\theta + cT)\\Big)^{6}" },
      { "label": "front-to-back emission–absorption", "latex": "C \\mathrel{+}= \\text{pal}\\cdot\\alpha\\cdot T_r, \\quad T_r \\mathrel{*}= (1-\\alpha), \\quad \\alpha = 1 - e^{-\\rho k \\Delta s}" },
    ],
    "params": [
      { "key": "petals", "symbol": "n", "meaning": "number of petal vanes around the bloom" },
      { "key": "scale", "symbol": "k", "meaning": "field frequency — finer or coarser feathering" },
      { "key": "absorb", "symbol": "\\rho k", "meaning": "petal opacity (front-to-back absorption)" },
      { "key": "exposure", "symbol": "E", "meaning": "emission brightness" },
      { "key": "colShift", "symbol": "\\phi", "meaning": "petal hue — blush pink toward peach/gold" },
    ],
    code: "// density at a march point p (log-spherical turbulence + sharpened vanes)\nconst lp = vec3(log2(r + .25)*3, polar*2.2, azimuth);\nlet T = 0; for (s of [2,4,8,16,32]) T += dot(sin(lp.yzy*s + t), sin(lp.xxz*s)) / s;\nconst vane = pow(.5 + .5*sin(petals*phi + 3*polar + 2.2*T + .7*lp.x), 6);\nconst rEdge = .68 + .38*vane;                 // tips break the silhouette\ne = pow(env(rEdge) * (vane*(0.8 + .4*T) + wisp), 1.3);\n// front-to-back: near petals occlude far — silhouettes, not fog",
    links: [
      { label: 'Yohei Nishitsuji — つぶやきGLSL (inspiration)', url: 'https://x.com/YoheiNishitsuji' },
      { label: 'twigl (tweet-shader playground)', url: 'https://twigl.app/' },
      { label: 'Volume ray casting (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Volume_ray_casting' },
    ],
  },
};
