/// <reference types="vite/client" />
import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { StoreController } from '@nanostores/lit';
import { $archetypeId } from '../store';
import { getFactory } from '../../core/registry';

// Lazy raw-source loaders for every archetype / GPU / render module (loaded only when the viewer
// opens, so they don't bloat the main bundle). Keys look like '../../archetypes/strangeAttractor.ts'.
const LOADERS: Record<string, () => Promise<string>> = {
  ...import.meta.glob('../../archetypes/*.ts', { query: '?raw', import: 'default' }),
  ...import.meta.glob('../../gpu/*.ts', { query: '?raw', import: 'default' }),
  ...import.meta.glob('../../render/*.ts', { query: '?raw', import: 'default' }),
} as Record<string, () => Promise<string>>;

const REPO = 'https://github.com/macncrash/realethersim/blob/main/';

// Which source modules implement a given system. Builder categories share one CPU file + one GPU
// twin; the emergent systems each live in a file named after their id (+ a gpu<Id> twin).
function pathsFor(id: string, category: string): string[] {
  const A = (n: string): string => `../../archetypes/${n}`;
  const G = (n: string): string => `../../gpu/${n}`;
  const R = (n: string): string => `../../render/${n}`;
  const byCat: Record<string, string[]> = {
    Attractor: [A('strangeAttractor.ts'), G('gpuAttractor.ts')],
    Map: [A('iteratedMap.ts'), G('gpuMap.ts')],
    Parametric: [A('parametric.ts')],
    Surface: [A('raymarchFractal.ts'), R('raymarch.ts')],
    Fractal: [A('raymarchFractal.ts'), R('raymarch.ts'), A('escapeFractal.ts'), G('gpuEscapeFractal.ts'), A('fractalIFS.ts'), G('gpuFractalIFS.ts')],
  };
  const cap = id.charAt(0).toUpperCase() + id.slice(1);
  const cand = byCat[category] ?? [A(`${id}.ts`), G(`gpu${cap}.ts`)];
  return cand.filter((p) => p in LOADERS);
}

const repoPath = (glob: string): string => glob.replace('../../', 'src/');

interface Src {
  path: string;
  code: string;
}

// "</> Source" modal: shows the actual TypeScript that powers the current system — the CPU archetype
// and, where present, the GPU/TSL compute twin — with copy + "view on GitHub".
export class CodeViewer extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  private cur = new StoreController(this, $archetypeId);
  private open = false;
  private srcs: Src[] = [];
  private active = 0;
  private copied = false;

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('ethersim:code', this.onOpen);
  }
  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('ethersim:code', this.onOpen);
  }

  private onOpen = (): void => {
    void this.load();
  };

  private async load(): Promise<void> {
    const id = this.cur.value;
    const cat = getFactory(id).category;
    const paths = pathsFor(id, cat);
    const srcs = await Promise.all(
      paths.map(async (p) => ({ path: p, code: await LOADERS[p]() })),
    );
    this.srcs = srcs;
    this.active = 0;
    this.copied = false;
    this.open = true;
    this.requestUpdate();
  }

  private hide(): void {
    this.open = false;
    this.requestUpdate();
  }

  private copy(): void {
    const code = this.srcs[this.active]?.code ?? '';
    void navigator.clipboard?.writeText(code).then(() => {
      this.copied = true;
      this.requestUpdate();
      setTimeout(() => {
        this.copied = false;
        this.requestUpdate();
      }, 1400);
    });
  }

  override render(): TemplateResult | typeof nothing {
    if (!this.open) return nothing;
    const src = this.srcs[this.active];
    const label = getFactory(this.cur.value).label;
    return html`
      <style>
        .cv-back {
          position: fixed; inset: 0; z-index: 9999; display: grid; place-items: center; padding: 5vh 4vw;
          background: rgba(2, 6, 14, 0.66); backdrop-filter: blur(3px); font-family: inherit;
        }
        .cv-box {
          width: min(960px, 96vw); height: min(82vh, 820px); display: flex; flex-direction: column;
          background: #0b1119; border: 1px solid #244; border-radius: 12px; overflow: hidden;
          box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6);
        }
        .cv-head { display: flex; align-items: center; gap: 10px; padding: 11px 14px; border-bottom: 1px solid #1d3340; }
        .cv-title { font-weight: 600; color: #dff; }
        .cv-title small { font-weight: 400; color: #6a9; margin-left: 8px; }
        .cv-tabs { display: flex; gap: 4px; margin-left: 8px; flex-wrap: wrap; }
        .cv-tab {
          font: inherit; font-size: 12px; color: #9bd; background: #0f2430; border: 1px solid #1d3a48;
          border-radius: 6px; padding: 4px 9px; cursor: pointer;
        }
        .cv-tab.on { background: #16384a; color: #eafffb; border-color: #2a5a6a; }
        .cv-actions { margin-left: auto; display: flex; gap: 6px; }
        .cv-btn { font: inherit; font-size: 12px; color: #cfe; background: #14323f; border: 1px solid #2a4a58; border-radius: 6px; padding: 5px 11px; cursor: pointer; text-decoration: none; }
        .cv-btn:hover { background: #1c4252; }
        .cv-pre {
          margin: 0; flex: 1; overflow: auto; padding: 14px 16px; font-family: ui-monospace, "SF Mono", Menlo, monospace;
          font-size: 12px; line-height: 1.5; color: #b9d2cf; white-space: pre; tab-size: 2;
        }
        .cv-foot { padding: 7px 14px; border-top: 1px solid #1d3340; font-size: 11px; color: #678; }
      </style>
      <div class="cv-back" @pointerdown=${(e: Event) => e.target === e.currentTarget && this.hide()}>
        <div class="cv-box">
          <div class="cv-head">
            <span class="cv-title">${label} <small>source</small></span>
            <div class="cv-tabs">
              ${this.srcs.map(
                (s, i) => html`<button
                  class="cv-tab ${i === this.active ? 'on' : ''}"
                  @click=${() => {
                    this.active = i;
                    this.copied = false;
                    this.requestUpdate();
                  }}
                >
                  ${s.path.split('/').pop()}
                </button>`,
              )}
            </div>
            <div class="cv-actions">
              <button class="cv-btn" @click=${() => this.copy()}>${this.copied ? '✓ copied' : 'Copy'}</button>
              ${src
                ? html`<a class="cv-btn" href=${REPO + repoPath(src.path)} target="_blank" rel="noopener">GitHub ↗</a>`
                : nothing}
              <button class="cv-btn" @click=${() => this.hide()}>✕</button>
            </div>
          </div>
          <pre class="cv-pre">${src?.code ?? ''}</pre>
          <div class="cv-foot">${repoPath(src?.path ?? '')} — MIT · the real module that runs this system (CPU archetype + GPU/TSL twin)</div>
        </div>
      </div>
    `;
  }
}

customElements.define('ether-code-viewer', CodeViewer);
