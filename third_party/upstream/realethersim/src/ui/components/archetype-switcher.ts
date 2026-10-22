import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { StoreController } from '@nanostores/lit';
import { $archetypeId, listFactories, selectArchetype } from '../store';
import { getFactory } from '../../core/registry';

// Category tabs (FR-3.1) + a per-category system selector, so the catalog can grow to dozens of
// systems without overflowing the tab bar. Each registered factory declares its `category`.
const CATEGORY_ORDER = ['Attractor', 'Map', 'Fractal', 'Surface', 'Spacetime', 'Volume', 'Conformal', 'Kaleidoscope', 'Linework', 'Bloom', 'Parametric', 'Life', 'Fluid', 'Field', 'Oscillator', 'Billiard', 'Matter', 'Sampler', 'Orbital', 'Spectral', 'N-Body', 'Cosmology', 'Plasma', 'Atmosphere', 'Tiling', 'Number', 'Neural', 'Network', 'Rotation', 'Quantum', 'Custom'];

export class ArchetypeSwitcher extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  private current = new StoreController(this, $archetypeId);

  private categories(): string[] {
    const present = new Set(listFactories().map((f) => f.category));
    const ordered = CATEGORY_ORDER.filter((c) => present.has(c));
    for (const c of present) if (!ordered.includes(c)) ordered.push(c);
    return ordered;
  }

  private selectCategory(cat: string): void {
    const first = listFactories().find((f) => f.category === cat);
    if (first) selectArchetype(first.id);
  }

  override render(): TemplateResult {
    const activeId = this.current.value;
    const activeCat = getFactory(activeId).category;
    const systems = listFactories().filter((f) => f.category === activeCat);
    return html`
      <div class="section">
        <h4>Archetype</h4>
        <div class="tabs">
          ${this.categories().map(
            (c) => html`<button class="tab ${c === activeCat ? 'active' : ''}" @click=${() => this.selectCategory(c)}>${c}</button>`,
          )}
        </div>
        ${systems.length > 1
          ? html`<select class="sysselect" @change=${(e: Event) => selectArchetype((e.target as HTMLSelectElement).value)}>
              ${systems.map((f) => html`<option value=${f.id} ?selected=${f.id === activeId}>${f.label}</option>`)}
            </select>`
          : nothing}
      </div>
    `;
  }
}

customElements.define('ether-archetype-switcher', ArchetypeSwitcher);
