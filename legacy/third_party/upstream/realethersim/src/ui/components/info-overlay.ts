import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { StoreController } from '@nanostores/lit';
import { $archetypeId, listFactories, selectArchetype } from '../store';
import { getFactory } from '../../core/registry';
import { APP_VERSION } from '../../version';
import { RELEASES, LATEST_RELEASE } from '../../meta/changelog';
import { ATTRIBUTIONS, COPYRIGHT, LICENSE_SPDX, LICENSE_TEXT } from '../../meta/attributions';

const REPO_URL = 'https://github.com/macncrash/realethersim';
const SEEN_KEY = 'ethersim:lastSeenVersion';

// Category display order (mirrors the archetype-switcher tabs) for the Browse grid's filter chips.
const CATEGORY_ORDER = [
  'Attractor', 'Map', 'Fractal', 'Surface', 'Spacetime', 'Volume', 'Conformal', 'Kaleidoscope', 'Linework', 'Bloom',
  'Parametric', 'Life', 'Fluid', 'Field', 'Oscillator', 'Billiard', 'Matter', 'Sampler', 'Orbital', 'Spectral', 'N-Body', 'Cosmology', 'Plasma', 'Atmosphere', 'Tiling', 'Number', 'Neural', 'Network', 'Rotation', 'Quantum', 'Custom',
];

type Tab = 'whatsnew' | 'browse' | 'about';

interface Sys {
  id: string;
  label: string;
  category: string;
}

// Discoverability overlay: a single full-screen panel with three tabs —
//  • What's New  — per-release highlights of newly-added systems (thumbnail + deep link), auto-shown
//    once per app version (compared against a locally-stored last-seen; no telemetry).
//  • Browse all  — a filterable grid of EVERY system, so the size of the catalog is visible at a glance.
//  • About       — license, copyright, third-party attributions (three.js et al.), and version history.
// Opens via window CustomEvents (ethersim:whatsnew / :browse / :about) or auto on a version bump.
// Renders into light DOM with a scoped <style> block so it overlays the whole app (cf. command-palette).
export class InfoOverlay extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  private cur = new StoreController(this, $archetypeId);

  private open = false;
  private tab: Tab = 'whatsnew';
  private query = '';
  private filterCat: string | null = null;
  private licenseExpanded = false;
  private autoShown = false; // this open was the once-per-version auto-show → mark seen on dismiss

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('ethersim:whatsnew', this.onWhatsNew);
    window.addEventListener('ethersim:browse', this.onBrowse);
    window.addEventListener('ethersim:about', this.onAbout);
    // Auto-show "What's New" once per version. Skip in the thumbnail-capture pass, and skip when the
    // visitor arrived via a shared deep-link (?s=/?sim=) so we don't hijack the system they came to see
    // (and don't burn the version — it'll show on a later normal visit).
    const params = new URLSearchParams(location.search);
    const sharedLink = params.has('s') || params.has('sim');
    if (!params.has('capture') && !sharedLink) {
      let seen: string | null = null;
      try {
        seen = localStorage.getItem(SEEN_KEY);
      } catch {
        /* storage blocked (private mode) — just don't auto-show */
      }
      if (seen !== APP_VERSION) {
        this.autoShown = true; // markSeen() deferred to dismiss, so a quick reload doesn't burn it unseen
        this.showTab('whatsnew');
      }
    }
  }
  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('ethersim:whatsnew', this.onWhatsNew);
    window.removeEventListener('ethersim:browse', this.onBrowse);
    window.removeEventListener('ethersim:about', this.onAbout);
  }

  private onWhatsNew = (): void => this.showTab('whatsnew');
  private onBrowse = (): void => this.showTab('browse');
  private onAbout = (): void => this.showTab('about');

  private markSeen(): void {
    try {
      localStorage.setItem(SEEN_KEY, APP_VERSION);
    } catch {
      /* ignore */
    }
  }

  private onKey = (e: KeyboardEvent): void => {
    if (this.open && e.key === 'Escape') {
      e.preventDefault();
      this.hide();
    }
  };

  private showTab(tab: Tab): void {
    this.tab = tab;
    this.open = true;
    if (tab === 'browse') {
      this.query = '';
      this.filterCat = null;
    }
    this.requestUpdate();
    // Move focus into the dialog (a11y: keyboard users land inside the modal, Esc closes).
    requestAnimationFrame(() => (this.querySelector('.io-box') as HTMLElement | null)?.focus());
  }
  private hide(): void {
    this.open = false;
    if (this.autoShown) {
      this.markSeen(); // record the version only once the auto-shown popup has actually been dismissed
      this.autoShown = false;
    }
    this.requestUpdate();
  }

  private go(id: string): void {
    selectArchetype(id);
    this.hide();
  }

  // ---- data helpers ----
  private allSystems(): Sys[] {
    return listFactories().map((f) => ({ id: f.id, label: f.label, category: f.category }));
  }
  private labelOf(id: string): string {
    try {
      return getFactory(id).label;
    } catch {
      return id;
    }
  }
  private categoryOf(id: string): string {
    try {
      return getFactory(id).category;
    } catch {
      return '';
    }
  }
  private knownId(id: string): boolean {
    try {
      getFactory(id);
      return true;
    } catch {
      return false;
    }
  }

  // ---- card ----
  private card(id: string): TemplateResult {
    const isCur = id === this.cur.value;
    return html`<button class="io-card ${isCur ? 'cur' : ''}" @click=${() => this.go(id)} title="Open ${this.labelOf(id)}">
      <span class="io-thumb">
        <img
          src="thumbs/${id}.webp"
          alt=""
          loading="lazy"
          decoding="async"
          @error=${(e: Event) => ((e.target as HTMLImageElement).style.visibility = 'hidden')}
          @load=${(e: Event) => ((e.target as HTMLImageElement).style.visibility = '')}
        />
      </span>
      <span class="io-meta">
        <span class="io-name">${this.labelOf(id)}</span>
        <span class="io-cat">${this.categoryOf(id)}</span>
      </span>
    </button>`;
  }

  // ---- What's New ----
  private whatsNewView(): TemplateResult {
    // The latest release up top, then earlier releases that introduced systems (most recent first).
    const withSystems = RELEASES.filter((r) => r.newSystems.length > 0);
    const latest = LATEST_RELEASE;
    const earlier = withSystems.filter((r) => r.version !== latest.version).slice(0, 6);
    return html`
      <div class="io-scroll">
        <div class="io-rel-head">
          <div>
            <div class="io-rel-title">${latest.title}</div>
            <div class="io-rel-sub">v${latest.version} · ${latest.date}</div>
          </div>
          <button class="io-browse-cta" @click=${() => this.showTab('browse')}>Browse all ${this.allSystems().length} systems →</button>
        </div>
        <p class="io-rel-summary">${latest.summary}</p>
        ${latest.newSystems.length
          ? html`<div class="io-grid">${latest.newSystems.filter((id) => this.knownId(id)).map((id) => this.card(id))}</div>`
          : nothing}
        ${latest.notes.length ? html`<ul class="io-notes">${latest.notes.map((n) => html`<li>${n}</li>`)}</ul>` : nothing}

        ${earlier.length
          ? html`<div class="io-prev-head">Recently added</div>
              ${earlier.map(
                (r) => html`
                  <div class="io-prev-rel">
                    <div class="io-prev-relhead"><span class="io-prev-ver">v${r.version}</span> <span class="io-prev-title">${r.title}</span> <span class="io-prev-date">${r.date}</span></div>
                    <div class="io-grid io-grid-sm">${r.newSystems.filter((id) => this.knownId(id)).map((id) => this.card(id))}</div>
                  </div>
                `,
              )}`
          : nothing}
      </div>
    `;
  }

  // ---- Browse ----
  private browseView(): TemplateResult {
    const all = this.allSystems();
    const present = new Set(all.map((s) => s.category));
    const cats = CATEGORY_ORDER.filter((c) => present.has(c));
    for (const c of present) if (!cats.includes(c)) cats.push(c);
    const q = this.query.trim().toLowerCase();
    const list = all
      .filter((s) => (this.filterCat ? s.category === this.filterCat : true))
      .filter((s) => (q ? `${s.label} ${s.category} ${s.id}`.toLowerCase().includes(q) : true))
      .sort((a, b) => a.label.localeCompare(b.label));
    return html`
      <div class="io-browse-bar">
        <input
          class="io-search"
          placeholder="Filter ${all.length} systems…"
          .value=${this.query}
          @input=${(e: Event) => {
            this.query = (e.target as HTMLInputElement).value;
            this.requestUpdate();
          }}
        />
        <div class="io-chips">
          <button class="io-chip ${this.filterCat === null ? 'on' : ''}" @click=${() => { this.filterCat = null; this.requestUpdate(); }}>All ${all.length}</button>
          ${cats.map(
            (c) => html`<button class="io-chip ${this.filterCat === c ? 'on' : ''}" @click=${() => { this.filterCat = c; this.requestUpdate(); }}>
              ${c} ${all.filter((s) => s.category === c).length}
            </button>`,
          )}
        </div>
      </div>
      <div class="io-scroll">
        ${list.length === 0
          ? html`<div class="io-empty">${this.query.trim() ? `No system matches “${this.query}”.` : 'No systems in this category.'}</div>`
          : html`<div class="io-grid">${list.map((s) => this.card(s.id))}</div>`}
      </div>
    `;
  }

  // ---- About ----
  private aboutView(): TemplateResult {
    return html`
      <div class="io-scroll">
        <div class="io-about">
        <p class="io-about-lede">
          <strong>ETHERSIM</strong> is an open-source, real-time explorer for dynamical systems — strange attractors,
          iterated maps, fractals, reaction–diffusion fields, ray-marched surfaces and more — rendered on the GPU with
          WebGPU. Every system is computed locally in your browser: <strong>no accounts, no cookies, no third-party
          trackers, no ads, no data sharing</strong>. It's open-source and self-hosted; see the
          <a href="/privacy.html" target="_blank" rel="noopener noreferrer">privacy page</a> for the minimal,
          first-party analytics it keeps.
        </p>
        <div class="io-about-row">
          <span class="io-k">Version</span><span class="io-v">v${APP_VERSION}</span>
        </div>
        <div class="io-about-row">
          <span class="io-k">License</span><span class="io-v">${LICENSE_SPDX} · ${COPYRIGHT}</span>
        </div>
        <div class="io-about-row">
          <span class="io-k">Source</span><span class="io-v"><a href=${REPO_URL} target="_blank" rel="noopener noreferrer">${REPO_URL.replace('https://', '')}</a></span>
        </div>
        <button class="io-license-toggle" @click=${() => { this.licenseExpanded = !this.licenseExpanded; this.requestUpdate(); }}>
          ${this.licenseExpanded ? '▾' : '▸'} MIT License text
        </button>
        ${this.licenseExpanded ? html`<pre class="io-license">${LICENSE_TEXT}</pre>` : nothing}

        <h3 class="io-h3">Built with</h3>
        <p class="io-about-note">ETHERSIM stands on the shoulders of these open-source projects — thank you.</p>
        <div class="io-attrib">
          ${ATTRIBUTIONS.map(
            (a) => html`<div class="io-attrib-row">
              <a class="io-attrib-name" href=${a.url} target="_blank" rel="noopener noreferrer">${a.name}</a>
              <span class="io-attrib-ver">v${a.version}</span>
              <span class="io-attrib-lic">${a.license}</span>
              <span class="io-attrib-role">${a.role}</span>
            </div>`,
          )}
        </div>

        <h3 class="io-h3">Version history</h3>
        <div class="io-history">
          ${RELEASES.map(
            (r) => html`<div class="io-hist-rel">
              <div class="io-hist-head">
                <span class="io-hist-ver">v${r.version}</span>
                <span class="io-hist-title">${r.title}</span>
                <span class="io-hist-date">${r.date}</span>
              </div>
              <div class="io-hist-summary">${r.summary}</div>
              ${r.newSystems.length
                ? html`<div class="io-hist-systems">${r.newSystems.length} new: ${r.newSystems.filter((id) => this.knownId(id)).map((id, i) => html`${i ? ', ' : ''}<a @click=${(e: Event) => { e.preventDefault(); this.go(id); }} href="#">${this.labelOf(id)}</a>`)}</div>`
                : nothing}
              ${r.notes.length ? html`<ul class="io-hist-notes">${r.notes.map((n) => html`<li>${n}</li>`)}</ul>` : nothing}
            </div>`,
          )}
        </div>
        <div class="io-about-foot">Made for curiosity · ETHERSIM is not affiliated with any of the projects above.</div>
        </div>
      </div>
    `;
  }

  override render(): TemplateResult | typeof nothing {
    if (!this.open) return nothing;
    const tab = this.tab;
    return html`
      <style>
        .io-back {
          position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center;
          padding: 4vh 3vw; background: rgba(2, 6, 14, 0.66); backdrop-filter: blur(4px); font-family: inherit;
        }
        .io-box {
          width: min(1040px, 96vw); height: min(86vh, 880px); display: flex; flex-direction: column;
          background: #0b1420; border: 1px solid #21384a; border-radius: 14px; overflow: hidden;
          box-shadow: 0 30px 100px rgba(0, 0, 0, 0.65); color: #cfe0ee;
        }
        .io-box:focus { outline: none; }
        .io-top { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-bottom: 1px solid #182c3b; }
        .io-brand { font-weight: 600; letter-spacing: 0.16em; color: #5af0c8; font-size: 14px; }
        .io-brand .io-ver { font-weight: 400; letter-spacing: 0; opacity: 0.45; font-size: 11px; margin-left: 6px; }
        .io-tabs { display: flex; gap: 6px; margin-left: 8px; }
        .io-tab {
          font: inherit; font-size: 12px; letter-spacing: 0.03em; color: #9fd; background: #10303c;
          border: 1px solid #244; border-radius: 999px; padding: 5px 13px; cursor: pointer;
        }
        .io-tab:hover { border-color: #4ad6c8; }
        .io-tab.on { background: #1f5a4a; border-color: #2f8a6a; color: #eafff7; }
        .io-x {
          margin-left: auto; font: inherit; font-size: 15px; line-height: 1; color: #cfe; background: #14323f;
          border: 1px solid #2a4a58; border-radius: 8px; padding: 6px 10px; cursor: pointer;
        }
        .io-x:hover { background: #1c4252; }
        .io-scroll { overflow-y: auto; padding: 16px 18px; flex: 1; }

        /* grid + cards */
        .io-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 12px; }
        .io-grid-sm { grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 9px; margin-top: 7px; }
        .io-card {
          display: flex; flex-direction: column; padding: 0; overflow: hidden; text-align: left; cursor: pointer;
          background: #0e1c2a; border: 1px solid #1d3344; border-radius: 10px; transition: border-color 0.12s, transform 0.12s;
        }
        .io-card:hover { border-color: #4ad6c8; transform: translateY(-2px); }
        .io-card.cur { border-color: #5af0c8; box-shadow: 0 0 0 1px #2f8a6a inset; }
        .io-thumb {
          display: block; width: 100%; aspect-ratio: 8 / 5; overflow: hidden;
          background: linear-gradient(135deg, #0f2230, #15324a 55%, #0d1c2b); /* shown if the image is missing */
        }
        .io-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .io-meta { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 7px 9px; min-width: 0; }
        .io-name { font-size: 12.5px; color: #e6f1fb; line-height: 1.25; width: 100%; }
        .io-card.cur .io-name::after { content: ' ●'; color: #5af0c8; font-size: 0.7em; }
        .io-cat { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 9.5px; letter-spacing: 0.04em; text-transform: uppercase; color: #6fb6a4; opacity: 0.85; }

        /* what's new */
        .io-rel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
        .io-rel-title { font-size: 17px; color: #eafffb; font-weight: 600; }
        .io-rel-sub { font-size: 12px; color: #79a; margin-top: 2px; }
        .io-browse-cta {
          flex: none; font: inherit; font-size: 12px; color: #06140e; background: #3fb795; border: 1px solid #4ad6c8;
          border-radius: 8px; padding: 7px 12px; cursor: pointer; font-weight: 600;
        }
        .io-browse-cta:hover { background: #5af0c8; }
        .io-rel-summary { color: #b8ccdd; font-size: 13px; margin: 10px 0 14px; max-width: 70ch; }
        .io-notes { margin: 12px 0 0; padding-left: 18px; color: #93acc0; font-size: 12.5px; }
        .io-notes li { margin: 3px 0; }
        .io-prev-head { margin: 22px 0 8px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #5a8; border-top: 1px solid #182c3b; padding-top: 14px; }
        .io-prev-rel { margin-bottom: 14px; }
        .io-prev-relhead { font-size: 12px; color: #9fb6c8; }
        .io-prev-ver { color: #5af0c8; }
        .io-prev-title { color: #d6e6f2; }
        .io-prev-date { color: #5d7a8c; margin-left: 6px; }

        /* browse */
        .io-browse-bar { padding: 12px 18px 0; }
        .io-search {
          width: 100%; box-sizing: border-box; padding: 10px 12px; font: inherit; font-size: 14px; color: #dff;
          background: #0e1c2a; border: 1px solid #244; border-radius: 8px; outline: none;
        }
        .io-search::placeholder { color: #5a7; opacity: 0.6; }
        .io-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 2px; }
        .io-chip {
          font: inherit; font-size: 11px; letter-spacing: 0.02em; color: #9fd; background: #10242f;
          border: 1px solid #213b49; border-radius: 999px; padding: 4px 10px; cursor: pointer;
        }
        .io-chip:hover { border-color: #4ad6c8; }
        .io-chip.on { background: #1f5a4a; border-color: #2f8a6a; color: #eafff7; }
        .io-empty { padding: 40px; text-align: center; color: #678; }

        /* about */
        .io-about { max-width: 860px; }
        .io-about-lede { color: #c4d6e6; font-size: 13.5px; line-height: 1.6; margin: 0 0 16px; }
        .io-about-row { display: flex; gap: 12px; padding: 6px 0; border-bottom: 1px solid #142735; font-size: 13px; }
        .io-k { width: 90px; flex: none; color: #6f8aa0; }
        .io-v { color: #dbe8f4; }
        .io-v a { color: #5af0c8; text-decoration: none; }
        .io-v a:hover { text-decoration: underline; }
        .io-license-toggle { margin: 14px 0 0; font: inherit; font-size: 12px; color: #9fd; background: none; border: none; cursor: pointer; padding: 0; }
        .io-license { margin: 8px 0 0; padding: 12px; background: #07111a; border: 1px solid #182c3b; border-radius: 8px; color: #8fa6ba; font-size: 11px; line-height: 1.5; white-space: pre-wrap; max-height: 240px; overflow: auto; }
        .io-h3 { margin: 24px 0 6px; font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; color: #5af0c8; }
        .io-about-note { color: #8aa1b5; font-size: 12px; margin: 0 0 10px; }
        .io-attrib { display: flex; flex-direction: column; gap: 1px; }
        .io-attrib-row { display: grid; grid-template-columns: 130px 64px 92px 1fr; gap: 10px; align-items: baseline; padding: 7px 0; border-bottom: 1px solid #122334; font-size: 12.5px; }
        .io-attrib-name { color: #5af0c8; text-decoration: none; font-weight: 600; }
        .io-attrib-name:hover { text-decoration: underline; }
        .io-attrib-ver { color: #6f8aa0; font-variant-numeric: tabular-nums; }
        .io-attrib-lic { color: #8aa1b5; }
        .io-attrib-role { color: #aebfcf; }
        .io-history { display: flex; flex-direction: column; gap: 12px; }
        .io-hist-rel { border-left: 2px solid #1d3a4a; padding: 2px 0 2px 12px; }
        .io-hist-head { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
        .io-hist-ver { color: #5af0c8; font-weight: 600; font-size: 13px; }
        .io-hist-title { color: #dbe8f4; font-size: 13px; }
        .io-hist-date { color: #5d7a8c; font-size: 11px; }
        .io-hist-summary { color: #9db2c4; font-size: 12px; margin: 2px 0; }
        .io-hist-systems { font-size: 12px; color: #8aa1b5; margin-top: 2px; }
        .io-hist-systems a { color: #7fdcc8; text-decoration: none; cursor: pointer; }
        .io-hist-systems a:hover { text-decoration: underline; }
        .io-hist-notes { margin: 4px 0 0; padding-left: 16px; color: #7d96aa; font-size: 11.5px; }
        .io-about-foot { margin: 22px 0 4px; color: #5d7a8c; font-size: 11px; }

        @media (max-width: 560px) {
          .io-attrib-row { grid-template-columns: 1fr; gap: 1px; }
          .io-rel-head { flex-direction: column; }
        }
      </style>
      <div class="io-back" @pointerdown=${(e: Event) => e.target === e.currentTarget && this.hide()}>
        <div class="io-box" role="dialog" aria-modal="true" aria-label="ETHERSIM — What's New, catalog, and About" tabindex="-1">
          <div class="io-top">
            <span class="io-brand">ETHERSIM <span class="io-ver">v${APP_VERSION}</span></span>
            <div class="io-tabs">
              <button class="io-tab ${tab === 'whatsnew' ? 'on' : ''}" @click=${() => this.showTab('whatsnew')}>What's New</button>
              <button class="io-tab ${tab === 'browse' ? 'on' : ''}" @click=${() => this.showTab('browse')}>Browse all</button>
              <button class="io-tab ${tab === 'about' ? 'on' : ''}" @click=${() => this.showTab('about')}>About</button>
            </div>
            <button class="io-x" @click=${() => this.hide()} title="Close (Esc)">✕</button>
          </div>
          ${tab === 'whatsnew' ? this.whatsNewView() : tab === 'browse' ? this.browseView() : this.aboutView()}
        </div>
      </div>
    `;
  }
}

customElements.define('ether-info-overlay', InfoOverlay);
