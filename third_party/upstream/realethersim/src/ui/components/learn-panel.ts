import { LitElement, html, type TemplateResult } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { StoreController } from '@nanostores/lit';
import katex from 'katex';
import { $archetypeId, $params } from '../store';
import { getFactory } from '../../core/registry';
import { getDoc, type SystemDoc } from '../learn/content';
import { APP_VERSION } from '../../version';

const REPO = 'https://github.com/macncrash/realethersim';

type Tab = 'about' | 'math' | 'code';

// Cache KaTeX HTML by (mode+latex) — equations are static per system; only the live "current
// values" line varies, and it caches per distinct rendered string.
const texCache = new Map<string, string>();
function tex(latex: string, displayMode: boolean): string {
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

// Bottom "Learn" panel: per-system About / Math / Code, with equations rendered live (KaTeX) and
// the current slider values substituted into the parameter list so the math tracks the controls.
export class LearnPanel extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  private archId = new StoreController(this, $archetypeId);
  private params = new StoreController(this, $params);
  private tab: Tab = 'about';
  // Collapsed by default on phones (where it would overlap the full-width control panel); open on desktop.
  private open = typeof window !== 'undefined' ? window.innerWidth > 640 : true;

  private setTab(t: Tab): void {
    this.tab = t;
    this.requestUpdate();
  }
  private toggle(): void {
    this.open = !this.open;
    this.requestUpdate();
  }

  // Lightweight, anonymous, user-initiated favourites — a heart, no downvotes. The first heart sends
  // a fire-and-forget beacon to /_vote/up/<id>; the server-log → observatory pipeline counts it (no
  // new endpoint, no PII, deduped per system). localStorage remembers it so the UI reflects it.
  private isHearted(id: string): boolean {
    try {
      return localStorage.getItem('ethersim:heart:' + id) === '1';
    } catch {
      return false;
    }
  }
  private toggleHeart(id: string): void {
    const was = this.isHearted(id);
    try {
      if (was) localStorage.removeItem('ethersim:heart:' + id);
      else localStorage.setItem('ethersim:heart:' + id, '1');
    } catch {
      /* private mode — heart still sends, just won't persist the UI state */
    }
    if (!was) {
      // only beacon on the first heart (the server dedups by salted ip-hash anyway)
      try {
        navigator.sendBeacon?.('/_vote/up/' + encodeURIComponent(id));
      } catch {
        /* best-effort */
      }
    }
    this.requestUpdate();
  }
  private report(id: string): void {
    const label = getFactory(id).label;
    const title = encodeURIComponent(`Problem with ${label} (${id})`);
    const body = encodeURIComponent(
      `**System:** ${label} (\`${id}\`)\n**Version:** ${APP_VERSION}\n\n` +
        `**What looks wrong?** (the math, the rendering, the behaviour, a typo, a reference…)\n\n\n` +
        `**Expected vs. actual:**\n\n\n---\n_opened from the in-app “report a problem” button_`,
    );
    window.open(`${REPO}/issues/new?title=${title}&body=${body}`, '_blank', 'noopener');
  }

  private renderAbout(doc: SystemDoc): TemplateResult {
    return html`
      <p class="ltext">${doc.about}</p>
      <p class="ltext dim">${doc.howItWorks}</p>
      ${doc.links.length
        ? html`<div class="llinks">
            ${doc.links.map((l) => html`<a href=${l.url} target="_blank" rel="noopener noreferrer">${l.label} ↗</a>`)}
          </div>`
        : null}
    `;
  }

  private renderMath(doc: SystemDoc, id: string): TemplateResult {
    const current = this.params.value;
    const factory = getFactory(id);
    const valueOf = (key: string): number => {
      const v = current[key];
      if (typeof v === 'number') return v;
      const spec = factory.params.find((s) => s.key === key);
      return spec?.default ?? NaN;
    };
    const valuesLatex = doc.params.map((p) => `${p.symbol} = ${fmt(valueOf(p.key))}`).join(',\\quad ');
    return html`
      <div class="leqs">
        ${doc.equations.map((eq) => html`
          ${eq.label ? html`<div class="leq-label">${eq.label}</div>` : null}
          <div class="leq">${unsafeHTML(tex(eq.latex, true))}</div>
        `)}
      </div>
      ${doc.params.length
        ? html`<div class="lvals">
            <span class="dim">current:</span> <span>${unsafeHTML(tex(valuesLatex, false))}</span>
          </div>
          <ul class="lparams">
            ${doc.params.map((p) => html`<li><span class="psym">${unsafeHTML(tex(p.symbol, false))}</span> — ${p.meaning}</li>`)}
          </ul>`
        : null}
    `;
  }

  override render(): TemplateResult {
    const id = this.archId.value;
    const doc = getDoc(id);
    const title = doc?.title ?? getFactory(id).label;

    if (!this.open) {
      return html`<div class="learn closed">
        <button class="learn-handle" @click=${() => this.toggle()}>📖 Learn — ${title} ▴</button>
      </div>`;
    }

    return html`
      <div class="learn open">
        <div class="learn-head">
          <div class="ltabs">
            <strong class="ltitle">${title}</strong>
            <button class="tab ${this.tab === 'about' ? 'active' : ''}" @click=${() => this.setTab('about')}>About</button>
            <button class="tab ${this.tab === 'math' ? 'active' : ''}" @click=${() => this.setTab('math')}>Math</button>
            <button class="tab ${this.tab === 'code' ? 'active' : ''}" @click=${() => this.setTab('code')}>Code</button>
          </div>
          <div class="lactions" style="display:flex;align-items:center;gap:8px;margin-left:auto">
            <button
              title=${this.isHearted(id) ? 'Loved — click to remove' : 'Love this one'}
              @click=${() => this.toggleHeart(id)}
              style="font:inherit;font-size:15px;line-height:1;background:transparent;border:none;cursor:pointer;padding:2px 4px;filter:${this.isHearted(id) ? 'none' : 'grayscale(1)'};opacity:${this.isHearted(id) ? '1' : '.5'};transition:filter .15s,opacity .15s"
            >❤️</button>
            <button
              title="Report a problem (opens a GitHub issue)"
              @click=${() => this.report(id)}
              style="font:inherit;font-size:11px;letter-spacing:.03em;color:#d9a;background:#2a1620;border:1px solid #5a2f3a;border-radius:6px;padding:4px 9px;cursor:pointer"
            >⚠ report</button>
          </div>
          <button class="learn-handle" @click=${() => this.toggle()}>▾</button>
        </div>
        <div class="learn-body">
          ${!doc
            ? html`<p class="ltext dim">Notes for this system are coming soon.</p>`
            : this.tab === 'about'
              ? this.renderAbout(doc)
              : this.tab === 'math'
                ? this.renderMath(doc, id)
                : html`<pre class="lcode"><code>${doc.code}</code></pre>`}
        </div>
      </div>
    `;
  }
}

customElements.define('ether-learn-panel', LearnPanel);
