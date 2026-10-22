import type { SystemDoc } from './content';

// Curated learn-panel content for the IFS (chaos-game) fractals. Authored by hand (these share one
// archetype, so the equations are the generic affine-map form with each system's maps in the code).
const AFFINE = '\\begin{pmatrix} x\' \\\\ y\' \\end{pmatrix} = \\begin{pmatrix} a_i & b_i \\\\ c_i & d_i \\end{pmatrix}\\begin{pmatrix} x \\\\ y \\end{pmatrix} + \\begin{pmatrix} e_i \\\\ f_i \\end{pmatrix}';
const WARP: SystemDoc['params'] = [
  { key: 'warp', symbol: '\\varepsilon', meaning: 'extra shear added to every map, morphing the attractor (0 = the canonical fractal)' },
];
const IFS_LINK = { label: 'Iterated function system (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Iterated_function_system' };
const CHAOS_LINK = { label: 'Chaos game (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Chaos_game' };

export const FRACTAL_DOCS: Record<string, SystemDoc> = {
  'barnsley-fern': {
    title: 'Barnsley Fern',
    about:
      'An iterated function system (IFS): a fractal grown by repeatedly applying one of four affine contraction maps, each chosen at random with a fixed probability. Over many iterations the points condense onto a strikingly lifelike fern, self-similar fronds all the way down — life-like structure from four matrices.',
    howItWorks:
      'Each step every point jumps under a randomly-chosen affine map (85% of the time the "main frond" map); the maps overlap so the whole fern reappears inside each frond.',
    equations: [{ label: 'pick map i with probability pᵢ, then', latex: AFFINE }],
    params: WARP,
    code: `// (a, b, c, d, e, f, probability) — pick one per step, then x'=a·x+b·y+e, y'=c·x+d·y+f
maps = [
  { a: 0,     b: 0,     c: 0,     d: 0.16, e: 0, f: 0,    p: 0.01 }, // stem
  { a: 0.85,  b: 0.04,  c: -0.04, d: 0.85, e: 0, f: 1.6,  p: 0.85 }, // main frond
  { a: 0.2,   b: -0.26, c: 0.23,  d: 0.22, e: 0, f: 1.6,  p: 0.07 }, // left leaflet
  { a: -0.15, b: 0.28,  c: 0.26,  d: 0.24, e: 0, f: 0.44, p: 0.07 }, // right leaflet
];`,
    links: [{ label: 'Barnsley fern (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Barnsley_fern' }, IFS_LINK],
  },
  sierpinski: {
    title: 'Sierpiński Triangle',
    about:
      'The Sierpiński triangle as an iterated function system: three affine maps that each shrink the plane by half toward one corner of a triangle. The "chaos game" — repeatedly jumping halfway toward a randomly chosen vertex — fills in the classic self-similar gasket of nested triangles.',
    howItWorks: 'Each step the point moves halfway toward a randomly chosen one of the three triangle vertices.',
    equations: [{ label: 'three maps, each a ½-scaling toward a vertex', latex: AFFINE }],
    params: WARP,
    code: `// halve toward each of three vertices (equilateral), equal probability
maps = [
  { a: 0.5, b: 0, c: 0, d: 0.5, e: 0,    f: 0     }, // toward (0, 0)
  { a: 0.5, b: 0, c: 0, d: 0.5, e: 0.5,  f: 0     }, // toward (1, 0)
  { a: 0.5, b: 0, c: 0, d: 0.5, e: 0.25, f: 0.433 }, // toward (½, √3/2)
];`,
    links: [{ label: 'Sierpiński triangle (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Sierpi%C5%84ski_triangle' }, CHAOS_LINK],
  },
  dragon: {
    title: 'Heighway Dragon',
    about:
      'The Heighway dragon curve, generated as an iterated function system from two affine maps — each a scaling by 1/√2 plus a 45° rotation. Iterating them traces a space-filling, self-similar dragon: the same shape you get by repeatedly folding a strip of paper in half.',
    howItWorks: 'Two rotate-and-shrink maps are applied at random; their interleaving builds the dragon’s endlessly folding boundary.',
    equations: [{ label: 'two maps (½√2 scale, ±45° rotation)', latex: AFFINE }],
    params: WARP,
    code: `maps = [
  { a: 0.5, b: -0.5, c: 0.5, d:  0.5, e: 0, f: 0 },
  { a: -0.5, b: -0.5, c: 0.5, d: -0.5, e: 1, f: 0 },
];`,
    links: [{ label: 'Dragon curve (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Dragon_curve' }, IFS_LINK],
  },
  'sierpinski-carpet': {
    title: 'Sierpiński Carpet',
    about:
      'The Sierpiński carpet: eight affine maps that each shrink the plane to one-third and place a copy in one of the eight non-central cells of a 3×3 grid. The chaos game tiles the square with ever-smaller square holes — the 2D cousin of the Cantor set.',
    howItWorks: 'Each step the point is mapped into a randomly chosen one of the eight outer cells of a 3×3 subdivision (the centre is always left empty).',
    equations: [{ label: 'eight maps, each a ⅓-scaling into an outer cell', latex: AFFINE }],
    params: WARP,
    code: `// 1/3-scale into the 8 non-central cells of a 3×3 grid (i,j ∈ {0,1,2}, skip centre)
for (j of [0,1,2]) for (i of [0,1,2]) if (!(i===1 && j===1))
  maps.push({ a: 1/3, b: 0, c: 0, d: 1/3, e: i/3, f: j/3 });`,
    links: [{ label: 'Sierpiński carpet (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Sierpi%C5%84ski_carpet' }, IFS_LINK],
  },
  mandelbrot: {
    title: 'Mandelbrot Set',
    about:
      'The most famous fractal. For each point c in the complex plane, iterate z → z² + c starting from z = 0; c belongs to the set (coloured black) if the orbit never escapes to infinity. The boundary is infinitely intricate and self-similar — you can zoom forever and keep finding new structure. Colour encodes how fast each outside point escapes.',
    howItWorks:
      'Every pixel is a complex number c; the shader iterates z² + c and colours by the smooth escape iteration count. On the GPU the whole grid is recomputed each frame, so pan/zoom reveals fresh detail.',
    equations: [{ label: 'c = pixel, z starts at 0; escapes when |z| > 2', latex: 'z_{n+1} = z_n^{2} + c,\\qquad z_0 = 0' }],
    params: [
      { key: 'centerRe', symbol: 'x_0', meaning: 'view center (real axis)' },
      { key: 'centerIm', symbol: 'y_0', meaning: 'view center (imaginary axis)' },
      { key: 'scale', symbol: 's', meaning: 'half-width of the view — shrink to zoom in' },
      { key: 'maxIter', symbol: 'N', meaning: 'iteration budget; higher = finer boundary detail' },
    ],
    code: `// per pixel c = (cre, cim); count iterations of z = z² + c until |z|² > 4
zr = 0; zi = 0; n = 0;
while (n < maxIter && zr*zr + zi*zi <= 4) {
  [zr, zi] = [zr*zr - zi*zi + cre, 2*zr*zi + cim];
  n++;
}
// smooth colour = n + 1 - log2(log|z|)`,
    links: [{ label: 'Mandelbrot set (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Mandelbrot_set' }],
  },
  julia: {
    title: 'Julia Set',
    about:
      'The Mandelbrot set’s twin: iterate the same z → z² + c, but now c is a FIXED constant and the starting z is the pixel. Each value of c gives a completely different Julia set — connected blobs, dust, dragons, spirals — and the Mandelbrot set is exactly the map of which c values give connected Julia sets. Sweep c to morph between them.',
    howItWorks: 'Every pixel is the initial z; the constant c is the same for the whole image. Change c (cr, ci) to morph the fractal continuously.',
    equations: [{ label: 'z starts at the pixel; c is fixed', latex: 'z_{n+1} = z_n^{2} + c,\\qquad c = c_r + i\\,c_i' }],
    params: [
      { key: 'cRe', symbol: 'c_r', meaning: 'the fixed constant c (real part) — defines which Julia set' },
      { key: 'cIm', symbol: 'c_i', meaning: 'the fixed constant c (imaginary part)' },
      { key: 'centerRe', symbol: 'x_0', meaning: 'view center (real axis)' },
      { key: 'centerIm', symbol: 'y_0', meaning: 'view center (imaginary axis)' },
      { key: 'scale', symbol: 's', meaning: 'half-width of the view — shrink to zoom in' },
      { key: 'maxIter', symbol: 'N', meaning: 'iteration budget; higher = finer detail' },
    ],
    code: `// per pixel z0 = (zre, zim); c = (cr, ci) is constant for the whole image
n = 0;
while (n < maxIter && zr*zr + zi*zi <= 4) {
  [zr, zi] = [zr*zr - zi*zi + cr, 2*zr*zi + ci];
  n++;
}`,
    links: [{ label: 'Julia set (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Julia_set' }],
  },
  'burning-ship': {
    title: 'Burning Ship',
    about:
      'A Mandelbrot variant with one twist: take the absolute value of z’s real and imaginary parts before squaring. That tiny change breaks the smooth symmetry and produces sharp, flame-like "ship" structures along the real axis — zoom into the antenna near (−1.75, 0) to find the iconic burning ship.',
    howItWorks: 'Same escape-time loop as Mandelbrot, but each step folds z into the positive quadrant first (|Re|, |Im|), which creates the angular, ship-like detail.',
    equations: [{ label: 'absolute value before squaring', latex: 'z_{n+1} = \\bigl(|\\mathrm{Re}\\,z_n| + i\\,|\\mathrm{Im}\\,z_n|\\bigr)^{2} + c' }],
    params: [
      { key: 'centerRe', symbol: 'x_0', meaning: 'view center (real axis)' },
      { key: 'centerIm', symbol: 'y_0', meaning: 'view center (imaginary axis)' },
      { key: 'scale', symbol: 's', meaning: 'half-width of the view — shrink to zoom in' },
      { key: 'maxIter', symbol: 'N', meaning: 'iteration budget; higher = finer detail' },
    ],
    code: `// like Mandelbrot, but abs() the parts each step
while (n < maxIter && zr*zr + zi*zi <= 4) {
  ar = Math.abs(zr); ai = Math.abs(zi);
  [zr, zi] = [ar*ar - ai*ai + cre, 2*ar*ai + cim];
  n++;
}`,
    links: [{ label: 'Burning Ship fractal (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Burning_Ship_fractal' }],
  },
};
