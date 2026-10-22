import { LitElement, html, type TemplateResult } from 'lit';
import { StoreController } from '@nanostores/lit';
import { Pane } from 'tweakpane';
import { $archetypeId, $global, $params, setGlobal, setParam } from '../store';
import { getFactory } from '../../core/registry';
import { hasGpu } from '../../gpu';

// Particle-count options, always including the active archetype's current count so the select
// never renders blank (archetypes can default to non-standard counts, e.g. 80k). Archetypes may
// supply their own base list (e.g. N-body caps lower since it's O(n²) on the CPU worker).
function countOptions(current: number, base?: number[]): Record<string, number> {
  const counts = [...new Set([...(base ?? [10_000, 50_000, 100_000, 250_000]), current])].sort((a, b) => a - b);
  const out: Record<string, number> = {};
  for (const c of counts) out[c >= 1000 ? `${Math.round(c / 1000)}k` : String(c)] = c;
  return out;
}

// Tweakpane hosted inside a Lit (light-DOM) element. The control set is rebuilt from the active
// archetype's ParamSpec whenever the archetype changes — Lit owns structure, Tweakpane owns the
// dense sliders, and edits write to the stores the engine subscribes to.
export class ParamsPanel extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  private archId = new StoreController(this, $archetypeId);
  private pane?: Pane;
  private builtFor = '';

  override firstUpdated(): void {
    this.buildPane();
  }

  override updated(): void {
    if (this.archId.value !== this.builtFor) this.buildPane();
  }

  private buildPane(): void {
    this.pane?.dispose();
    const container = this.querySelector('.tp') as HTMLElement;
    container.innerHTML = '';

    const id = $archetypeId.get();
    this.builtFor = id;
    const factory = getFactory(id);

    const values = $params.get();
    const local: Record<string, number> = {};
    for (const s of factory.params) local[s.key] = values[s.key] ?? s.default;

    const g = $global.get();
    const globals = { dt: g.dt, particleCount: g.particleCount, trailLength: g.trailLength, gpuCompute: g.gpuCompute };

    const pane = new Pane({ container, title: `${factory.label} parameters` });
    for (const s of factory.params) {
      const opts = s.options
        ? { label: s.label ?? s.key, options: s.options }
        : { label: s.label ?? s.key, min: s.min, max: s.max, step: s.step ?? 0.01 };
      pane.addBinding(local, s.key, opts).on('change', (e) => setParam(s.key, e.value as number));
    }

    const gf = pane.addFolder({ title: 'Global' });
    gf.addBinding(globals, 'dt', { min: 0.0005, max: 0.05, step: 0.0005 }).on('change', (e) => setGlobal('dt', e.value as number));
    gf.addBinding(globals, 'particleCount', { label: 'particles', options: countOptions(g.particleCount, factory.particleCountOptions) }).on('change', (e) => setGlobal('particleCount', e.value as number));
    gf.addBinding(globals, 'trailLength', { label: 'trail', min: 0, max: 1000, step: 10 }).on('change', (e) => setGlobal('trailLength', e.value as number));
    // Only enable the GPU toggle for systems that actually have a GPU compute kernel; otherwise
    // it would silently no-op (CPU fallback) and look broken.
    gf.addBinding(globals, 'gpuCompute', { label: hasGpu(id) ? 'GPU compute' : 'GPU compute (n/a)', disabled: !hasGpu(id) }).on('change', (e) => setGlobal('gpuCompute', e.value as boolean));

    this.pane = pane;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.pane?.dispose();
  }

  override render(): TemplateResult {
    return html`<div class="section"><div class="tp"></div></div>`;
  }
}

customElements.define('ether-params-panel', ParamsPanel);
