import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { StoreController } from '@nanostores/lit';
import { $archetypeId, $demoMode, $params, $telemetry, primaryParam } from '../store';

function fmt(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const a = Math.abs(n);
  if (a !== 0 && (a < 0.01 || a >= 10000)) return n.toExponential(2);
  return (Math.round(n * 1000) / 1000).toString();
}

// Top-left demo HUD: the live stats people love (FPS · particle count) plus the current system's
// primary knob — its value, position in range, and a hint that +/− and 1-9 drive it. Subscribes to
// telemetry + params so it tracks both the running sim and live keyboard tweaks.
export class DemoHud extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  private demo = new StoreController(this, $demoMode);
  private tel = new StoreController(this, $telemetry);
  private params = new StoreController(this, $params);
  private archId = new StoreController(this, $archetypeId);

  override render(): TemplateResult | typeof nothing {
    if (!this.demo.value) return nothing;
    void this.archId.value; // re-render on system switch (primaryParam() reads the current id)
    const t = this.tel.value;
    const spec = primaryParam();
    const val = spec ? (this.params.value[spec.key] ?? spec.default) : null;
    const span = spec ? spec.max - spec.min || 1 : 1;
    const frac = spec && val != null ? Math.min(1, Math.max(0, (val - spec.min) / span)) : 0;

    return html`
      <style>
        .dh-wrap {
          position: fixed; top: 14px; left: 16px; z-index: 9990; pointer-events: none;
          display: flex; flex-direction: column; gap: 7px; font: inherit; font-size: 12px; color: #bfeee0;
          background: #0c1f1acc; border: 1px solid #1f4d40; border-radius: 10px; padding: 8px 12px;
          backdrop-filter: blur(4px); min-width: 168px;
        }
        .dh-stats { font-variant-numeric: tabular-nums; color: #cdeee5; }
        .dh-fps { color: #5af0c8; font-weight: 600; }
        .dh-sep { opacity: 0.4; margin: 0 5px; }
        .dh-param { display: flex; align-items: center; gap: 8px; }
        .dh-pname { color: #9fe0cf; }
        .dh-pval { color: #fff; font-weight: 600; font-variant-numeric: tabular-nums; min-width: 42px; }
        .dh-bar { flex: 1; height: 4px; min-width: 44px; background: #173b32; border-radius: 2px; overflow: hidden; }
        .dh-fill { display: block; height: 100%; background: linear-gradient(90deg, #16e0c8, #ff7a30); }
        .dh-hint { opacity: 0.5; font-size: 10px; white-space: nowrap; }
      </style>
      <div class="dh-wrap">
        <div class="dh-stats">
          <span class="dh-fps">${Math.round(t.fps)}</span> FPS${t.particles > 1
            ? html`<span class="dh-sep">·</span>${t.particles.toLocaleString()} particles`
            : nothing}
        </div>
        ${spec && val != null
          ? html`<div class="dh-param">
              <span class="dh-pname">${spec.label || spec.key}</span>
              <span class="dh-pval">${fmt(val)}</span>
              <span class="dh-bar"><span class="dh-fill" style="width:${(frac * 100).toFixed(1)}%"></span></span>
              <span class="dh-hint">+ / − · 1–9</span>
            </div>`
          : nothing}
      </div>
    `;
  }
}

customElements.define('ether-demo-hud', DemoHud);
