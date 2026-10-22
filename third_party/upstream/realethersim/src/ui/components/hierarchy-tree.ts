import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { StoreController } from '@nanostores/lit';
import type { NodeSpec } from '../../core/archetype';
import { $engine, $hierarchy, $selectedNode } from '../store';

// Structural Hierarchy Tree panel (FR-3.2): shows the active archetype's parent→child nodes.
// Selecting a node that maps to a particle group (e.g. an N-body cluster) highlights those
// particles in the scene; otherwise it just surfaces the node's parameters.
export class HierarchyTree extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  private nodes = new StoreController(this, $hierarchy);
  private selected = new StoreController(this, $selectedNode);

  private select(node: NodeSpec): void {
    const id = this.selected.value === node.id ? null : node.id;
    $selectedNode.set(id);
    const engine = $engine.get();
    if (!engine) return;
    if (id !== null && node.particleStart !== undefined && node.particleCount !== undefined) {
      engine.highlightParticles(node.particleStart, node.particleCount);
      engine.focusNode(node.particleStart, node.particleCount); // fly camera to frame it (NFR-2.2)
    } else {
      engine.highlightParticles(null, 0);
    }
  }

  private depth(node: NodeSpec, byId: Map<string, NodeSpec>): number {
    let d = 0;
    let cur: NodeSpec | undefined = node;
    while (cur && cur.parentId) {
      cur = byId.get(cur.parentId);
      d++;
    }
    return d;
  }

  override render(): TemplateResult {
    const nodes = this.nodes.value;
    if (nodes.length <= 1) return html`${nothing}`; // nothing structural to show (single root)

    const byId = new Map(nodes.map((n) => [n.id, n]));
    const active = this.selected.value;
    return html`
      <div class="section">
        <h4>Hierarchy</h4>
        <div class="tree">
          ${nodes.map((n) => {
            const omega = n.params?.omega;
            return html`<button
              class="treenode ${n.id === active ? 'active' : ''}"
              style="padding-left:${8 + this.depth(n, byId) * 14}px"
              @click=${() => this.select(n)}
            >
              <span>${n.label}</span>
              ${omega !== undefined ? html`<span class="v">ω ${omega.toFixed(2)}</span>` : nothing}
            </button>`;
          })}
        </div>
      </div>
    `;
  }
}

customElements.define('ether-hierarchy-tree', HierarchyTree);
