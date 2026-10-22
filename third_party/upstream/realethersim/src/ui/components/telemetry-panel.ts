import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { StoreController } from '@nanostores/lit';
import { $telemetry } from '../store';

// Real-time telemetry (FR-3 telemetry panel). Re-renders only when $telemetry changes
// (~4 Hz), so it never competes with the 60fps render loop.
export class TelemetryPanel extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  private telemetry = new StoreController(this, $telemetry);

  override render(): TemplateResult {
    const t = this.telemetry.value;
    const lle = Number.isNaN(t.lle) ? '—' : t.lle.toFixed(4);
    const v3 = (a: [number, number, number]): string => a.map((n) => n.toFixed(2)).join(', ');
    return html`
      <div class="section">
        <h4>Telemetry</h4>
        ${t.simTime ? html`<div class="row"><span>sim time</span><span class="v">${t.simTime}</span></div>` : nothing}
        <div class="row"><span>fps</span><span class="v">${t.fps.toFixed(0)}</span></div>
        <div class="row"><span>particles</span><span class="v">${t.particles.toLocaleString()}</span></div>
        <div class="row"><span>substeps / frame</span><span class="v">${t.substeps}</span></div>
        <div class="row"><span>backend</span><span class="v">${t.backend}</span></div>
        <div class="row"><span>largest Lyapunov</span><span class="v">${lle}</span></div>
        <div class="row"><span>camera xyz</span><span class="v">${v3(t.camPos)}</span></div>
        <div class="row"><span>target xyz</span><span class="v">${v3(t.camTarget)}</span></div>
      </div>
    `;
  }
}

customElements.define('ether-telemetry-panel', TelemetryPanel);
