import * as THREE from 'three';
import { registerArchetypes } from '../archetypes';
import { getFactory, listFactories } from '../core/registry';
import { defaultParams, type Archetype, type ResolvedParams } from '../core/archetype';
import { resolveParams } from '../core/params';
import { RELEASES } from '../meta/changelog';

// Standalone scrollytelling tour. Reuses the real archetype simulations (CPU path) rendered with a
// lightweight Three.js WebGL points renderer (max compatibility for sharing). A sticky full-screen
// canvas sits behind scrolling caption sections; the section crossing the viewport centre selects
// the system. Built as a second Vite entry (demo.html) — independent of the main app.
registerArchetypes();

// Live system count — derived from the registry that already powers the tour, so the landing copy
// can never drift again (the hard-coded HTML fallback is just for crawlers / no-JS).
{
  const count = String(listFactories().length);
  for (const id of ['sysCount', 'sysCountOutro', 'sysCountNews']) {
    const el = document.getElementById(id);
    if (el) el.textContent = count;
  }
}

// "What's new" band — the SAME data as the in-app popup (src/meta/changelog.ts), so visitors who only
// hit the website still see what's been added. Each new-system card deep-links into the app via
// ?sim=<id> (the app's share-link handler loads it on launch). Built with createElement (no innerHTML)
// so the strict script-src/style CSP holds.
{
  const body = document.getElementById('newsBody');
  if (body) {
    const recent = RELEASES.filter((r) => r.newSystems.length > 0).slice(0, 6);
    for (const rel of recent) {
      const wrap = document.createElement('div');
      wrap.className = 'news-rel';

      const head = document.createElement('div');
      head.className = 'news-relhead';
      const ver = document.createElement('span');
      ver.className = 'news-ver';
      ver.textContent = `v${rel.version}`;
      const title = document.createElement('span');
      title.className = 'news-title';
      title.textContent = rel.title;
      const date = document.createElement('span');
      date.className = 'news-date';
      date.textContent = rel.date;
      head.append(ver, title, date);

      const summary = document.createElement('p');
      summary.className = 'news-summary';
      summary.textContent = rel.summary;

      const cards = document.createElement('div');
      cards.className = 'news-cards';
      for (const id of rel.newSystems) {
        let label = id;
        let category = '';
        try {
          const f = getFactory(id);
          label = f.label;
          category = f.category;
        } catch {
          continue; // id no longer registered — skip
        }
        const a = document.createElement('a');
        a.className = 'news-card';
        a.href = `./index.html?sim=${encodeURIComponent(id)}`;
        a.title = `Open ${label} in ETHERSIM`;
        const img = document.createElement('img');
        img.className = 'nc-thumb';
        img.src = `thumbs/${id}.webp`;
        img.loading = 'lazy';
        img.alt = '';
        img.addEventListener('error', () => (img.style.visibility = 'hidden'));
        const name = document.createElement('span');
        name.className = 'nc-name';
        name.textContent = label;
        const cat = document.createElement('span');
        cat.className = 'nc-cat';
        cat.textContent = category;
        a.append(img, name, cat);
        cards.append(a);
      }

      wrap.append(head, summary, cards);
      body.append(wrap);
    }
  }
}

// Copy-the-install-command button (logic lives here, not inline, so the strict script-src CSP holds).
{
  const btn = document.getElementById('copyBtn');
  const cmd = document.getElementById('installCmd');
  if (btn && cmd) {
    btn.addEventListener('click', () => {
      const text = cmd.textContent ?? '';
      const done = (msg: string): void => {
        btn.textContent = msg;
        window.setTimeout(() => (btn.textContent = 'copy'), 1800);
      };
      navigator.clipboard?.writeText(text).then(
        () => done('copied ✓'),
        () => done('⌘C to copy'),
      );
    });
  }
}

interface View {
  count: number;
  dt: number;
  sub: number; // sim steps per frame
  mode: '3d' | 'flat';
  camZ: number;
  size: number; // point size (world)
  spin: number; // rad/s
  warm: number; // warm-up steps on load
}

const CONFIG: Record<string, View> = {
  lorenz: { count: 30000, dt: 0.005, sub: 2, mode: '3d', camZ: 4.6, size: 0.012, spin: 0.18, warm: 60 },
  thomas: { count: 30000, dt: 0.03, sub: 2, mode: '3d', camZ: 5.4, size: 0.014, spin: 0.16, warm: 60 },
  clifford: { count: 45000, dt: 0.004, sub: 3, mode: 'flat', camZ: 3.7, size: 0.01, spin: 0.05, warm: 120 },
  'barnsley-fern': { count: 60000, dt: 0.004, sub: 3, mode: 'flat', camZ: 3.7, size: 0.008, spin: 0.0, warm: 120 },
  mandelbrot: { count: 90000, dt: 0.016, sub: 1, mode: 'flat', camZ: 3.5, size: 0.016, spin: 0.0, warm: 0 },
  particleLife: { count: 4000, dt: 0.015, sub: 2, mode: '3d', camZ: 4.4, size: 0.02, spin: 0.22, warm: 30 },
  nbody: { count: 2200, dt: 0.008, sub: 2, mode: '3d', camZ: 4.4, size: 0.026, spin: 0.14, warm: 20 },
};

const canvas = document.getElementById('bg') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setClearColor(0x05070d, 1);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
const group = new THREE.Group();
scene.add(group);

interface Active {
  arch: Archetype;
  points: THREE.Points;
  view: View;
  resolved: ResolvedParams;
}
let active: Active | null = null;
let currentId = '';

function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function setSystem(id: string): void {
  const view = CONFIG[id];
  if (!view || id === currentId) return;
  currentId = id;

  if (active) {
    group.remove(active.points);
    active.points.geometry.dispose();
    (active.points.material as THREE.Material).dispose();
    active.arch.dispose();
  }

  const factory = getFactory(id);
  const resolved = resolveParams(defaultParams(factory.params), view.dt);
  const arch = factory.create({ particleCount: view.count, seed: 7, params: resolved });
  for (let i = 0; i < view.warm; i++) arch.step(view.dt, resolved); // pre-evolve so it's formed on arrival

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(arch.readPositions(), 3));
  const cols = arch.readColors();
  if (cols) geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);

  const material = new THREE.PointsMaterial({
    size: view.size,
    sizeAttenuation: true,
    vertexColors: !!cols,
    color: cols ? 0xffffff : 0x4ad6c8,
    transparent: true,
    opacity: 0.92,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  group.add(points);

  group.rotation.set(0, 0, 0);
  camera.position.set(0, 0, view.camZ);
  camera.lookAt(0, 0, 0);

  active = { arch, points, view, resolved };
}

// The section crossing the viewport centre selects the active system.
const sections = [...document.querySelectorAll('section[data-sim]')] as HTMLElement[];
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) if (e.isIntersecting) setSystem(e.target.getAttribute('data-sim') as string);
  },
  { rootMargin: '-45% 0px -45% 0px' },
);
sections.forEach((s) => io.observe(s));
setSystem('lorenz');

let last = performance.now();
function frame(now: number): void {
  const wall = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (active) {
    for (let s = 0; s < active.view.sub; s++) active.arch.step(active.view.dt, active.resolved);
    (active.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    if (active.view.mode === '3d') group.rotation.y += active.view.spin * wall;
    else group.rotation.z += active.view.spin * wall;
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
