import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { StoreController } from '@nanostores/lit';
import katex from 'katex';
import { $archetypeId, $demoDetails, $demoMode, $params } from '../store';
import { getFactory } from '../../core/registry';
import { getDoc } from '../learn/content';

// KaTeX HTML cache (equations are static; the live "current values" line varies but caches per string).
const texCache = new Map<string, string>();
function tex(latex: string, displayMode = true): string {
  const key = (displayMode ? 'D' : 'I') + latex;
  let v = texCache.get(key);
  if (v === undefined) {
    try {
      v = katex.renderToString(latex, { throwOnError: false, displayMode });
    } catch {
      v = latex;
    }
    texCache.set(key, v);
  }
  return v;
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const a = Math.abs(n);
  if (a !== 0 && (a < 0.01 || a >= 10000)) return n.toExponential(2);
  return (Math.round(n * 1000) / 1000).toString();
}

// Demo-mode "teaching" overlay: when demo mode is showing AND the user has toggled details on (the
// ℹ button in the top badge), the current system's name, about text, and key formulae fade in at the
// bottom over the black — without leaving demo mode. As demo cycles, this updates with each system,
// so it reads like a self-running, narrated screensaver.
export class DemoDetails extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  private demo = new StoreController(this, $demoMode);
  private details = new StoreController(this, $demoDetails);
  private archId = new StoreController(this, $archetypeId);
  private params = new StoreController(this, $params);

  override render(): TemplateResult | typeof nothing {
    if (!this.demo.value || !this.details.value) return nothing;
    const id = this.archId.value;
    const doc = getDoc(id);
    const title = doc?.title ?? getFactory(id).label;
    const eqs = doc?.equations.slice(0, 3) ?? [];
    // Live "current values" line — substitutes the running param values into the symbols, so the
    // primary knob (+/− · 1-9) is visibly reflected in the formula.
    const cur = this.params.value;
    const factory = getFactory(id);
    const valuesLatex = doc?.params.length
      ? doc.params
          .map((p) => `${p.symbol} = ${fmt(cur[p.key] ?? factory.params.find((s) => s.key === p.key)?.default ?? NaN)}`)
          .join(',\\; ')
      : '';

    return html`
      <style>
        .dd-wrap {
          position: fixed; left: 0; right: 0; bottom: 0; z-index: 9990; pointer-events: none;
          padding: 64px 6vw 30px; display: flex; flex-direction: column; align-items: center; gap: 12px;
          text-align: center; font-family: inherit;
          background: linear-gradient(to top, rgba(2, 6, 12, 0.94) 18%, rgba(2, 6, 12, 0.66) 58%, transparent);
          animation: ddFade 0.5s ease both;
        }
        @keyframes ddFade { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        .dd-title { font-size: 22px; font-weight: 600; letter-spacing: 0.06em; color: #eafff7; }
        .dd-about { max-width: 780px; font-size: 14.5px; line-height: 1.55; color: #bcd6d1; }
        .dd-eqs { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 26px; margin-top: 2px; color: #dffaf3; }
        .dd-eqs .katex { font-size: 1.02em; }
        .dd-eqs .katex-display { margin: 4px 0; }
        .dd-vals { font-size: 13px; color: #8fd9c8; }
        .dd-vals .katex { font-size: 1em; }
      </style>
      <div class="dd-wrap">
        <div class="dd-title">${title}</div>
        ${doc?.about ? html`<div class="dd-about">${doc.about}</div>` : nothing}
        ${eqs.length
          ? html`<div class="dd-eqs">${eqs.map((eq) => html`<span>${unsafeHTML(tex(eq.latex))}</span>`)}</div>`
          : nothing}
        ${valuesLatex ? html`<div class="dd-vals">${unsafeHTML(tex(valuesLatex, false))}</div>` : nothing}
      </div>
    `;
  }
}

customElements.define('ether-demo-details', DemoDetails);
