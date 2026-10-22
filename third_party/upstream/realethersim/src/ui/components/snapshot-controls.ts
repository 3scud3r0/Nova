import { LitElement, html, type TemplateResult } from 'lit';
import { $engine, $archetypeId } from '../store';
import { migrate } from '../../state/migrations';
import { getFactory } from '../../core/registry';
import { extractText } from '../../state/pngMeta';
import { buildShareUrl } from '../../app/shareLink';

const MAX_JSON = 8 * 1024 * 1024; // 8 MB cap for snapshot JSON
const MAX_PNG = 64 * 1024 * 1024; // 64 MB cap for an imported image

// Snapshot + image export/import/share (FR-3.3). Everything is client-side: nothing is uploaded.
// Imports are validated by the zod schema (via migrate) and the archetype id is checked against the
// registry before anything is applied. Keyboard: Space = pause, ⌘S = screenshot, ⌘E = export, ⌘I =
// import.
export class SnapshotControls extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  private status = '';
  private statusErr = false;
  private clipping = false;

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('keydown', this.onKey);
  }
  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this.onKey);
  }

  private setStatus(msg: string, err = false, ms = 4500): void {
    this.status = msg;
    this.statusErr = err;
    this.requestUpdate();
    if (msg) window.setTimeout(() => this.status === msg && this.setStatus(''), ms);
  }

  private onKey = (e: KeyboardEvent): void => {
    // Don't hijack keys while typing or while a modal (palette / code viewer) is open.
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (document.querySelector('.cmdp-box, .cv-box')) return;
    const k = e.key.toLowerCase();
    const mod = e.metaKey || e.ctrlKey;
    const ae = document.activeElement;
    const onControl = !!ae && ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(ae.tagName);
    if (k === ' ' && !mod) {
      if (onControl) return; // let a focused button take the space
      e.preventDefault();
      const paused = $engine.get()?.togglePause();
      this.setStatus(paused ? 'paused' : 'resumed');
    } else if (mod && k === 's') {
      e.preventDefault();
      void $engine.get()?.exportImage();
    } else if (mod && k === 'e') {
      e.preventDefault();
      this.exportSnapshot();
    } else if (mod && k === 'i') {
      e.preventDefault();
      (this.querySelector('input[type=file]') as HTMLInputElement | null)?.click();
    } else if (!mod && k.startsWith('arrow')) {
      // Pan the view (no rotation) — the sim nudges in the arrow's direction. Focused sliders /
      // selects already returned early above, so arrows there still adjust the control.
      const pan: Record<string, [number, number]> = {
        arrowup: [0, -1],
        arrowdown: [0, 1],
        arrowleft: [1, 0],
        arrowright: [-1, 0],
      };
      const d = pan[k];
      if (d) {
        e.preventDefault();
        $engine.get()?.panView(d[0], d[1]);
      }
    }
  };

  private exportSnapshot(): void {
    const engine = $engine.get();
    if (!engine) return;
    const json = JSON.stringify(engine.exportSnapshot(), null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `ethersim-${$archetypeId.get()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Share the current view as a metadata-embedded PNG + a ready-to-post caption. Uses the Web Share
  // API (with the image file) where available; otherwise downloads the image, copies the caption, and
  // opens an X composer so the user can attach + post in two clicks.
  private async share(): Promise<void> {
    const engine = $engine.get();
    if (!engine) return;
    this.setStatus('preparing image…');
    try {
      const blob = await engine.captureImageBlob();
      const id = $archetypeId.get();
      const f = getFactory(id);
      const file = new File([blob], `ethersim-${id}.png`, { type: 'image/png' });
      // Deep link that reopens this exact view (system + params + camera). Social platforms strip
      // the PNG's embedded snapshot, so the link is how a recipient gets the live, same-settings sim.
      const link = buildShareUrl(engine.exportSnapshot());
      const text = `${f.label} — a live ${f.category} simulation on ETHERSIM. Open this exact view → ${link}`;
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare?.({ files: [file] }) && nav.share) {
        // Native share sheet — this DOES attach the image (mobile, Safari, Edge, recent Chrome).
        await nav.share({ title: `ETHERSIM — ${f.label}`, text, url: link, files: [file] });
        this.setStatus('shared ✓');
      } else {
        // No Web Share file support here. A post can't be given an image via a URL (X's intent is
        // text-only), so save the PNG + copy the caption + open the composer, and say so clearly.
        const url = URL.createObjectURL(file);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(url);
        let copied = false;
        try {
          await navigator.clipboard?.writeText(text);
          copied = true;
        } catch {
          /* clipboard may be blocked */
        }
        window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(text), '_blank', 'noopener');
        this.setStatus(`📷 image saved to your downloads — attach it to the post${copied ? ' (caption copied)' : ''}`, false, 9000);
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        this.setStatus('');
      } else {
        console.error('[ethersim] share failed', err);
        this.setStatus('could not prepare the image', true);
      }
    }
  }

  // Record a short looping clip (WebM + GIF) of the live view — a motion-faithful share asset, since a
  // still frame can't show the 3D animation. Everything is client-side; the files just download.
  private async captureClip(): Promise<void> {
    const engine = $engine.get();
    if (!engine || this.clipping) return;
    this.clipping = true;
    this.requestUpdate();
    try {
      await engine.captureClip((msg) => this.setStatus(msg, false, 12000));
    } catch (err) {
      console.error('[ethersim] clip capture failed', err);
      this.setStatus('clip capture failed', true);
    } finally {
      this.clipping = false;
      this.requestUpdate();
    }
  }

  private async importFile(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      let raw: unknown;
      const isPng = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png');
      if (isPng) {
        if (file.size > MAX_PNG) throw new Error('image too large (max 64 MB)');
        const text = extractText(new Uint8Array(await file.arrayBuffer()), 'ethersim');
        if (!text) throw new Error('no ETHERSIM snapshot embedded in this image');
        raw = JSON.parse(text);
      } else {
        if (file.size > MAX_JSON) throw new Error('snapshot too large (max 8 MB)');
        raw = JSON.parse(await file.text());
      }
      const snap = migrate(raw); // zod-validates; throws on anything malformed
      getFactory(snap.archetypeId); // throws if the archetype isn't registered
      $engine.get()?.importSnapshot(snap);
      this.setStatus(`imported ${getFactory(snap.archetypeId).label} ✓`);
    } catch (err) {
      console.error('[ethersim] import failed', err);
      const msg = err instanceof SyntaxError ? 'not a valid snapshot file' : (err as Error)?.message || 'import failed';
      this.setStatus(`import failed — ${msg}`, true);
    } finally {
      input.value = '';
    }
  }

  override render(): TemplateResult {
    return html`
      <div class="section">
        <h4>Snapshot</h4>
        <div class="row" style="gap:6px;flex-wrap:wrap;justify-content:flex-start">
          <button @click=${() => void $engine.get()?.exportImage()} title="Screenshot (⌘S)">Screenshot</button>
          <button @click=${() => void this.share()} title="Share this view to social media">Share ↗</button>
          <button @click=${() => void this.captureClip()} ?disabled=${this.clipping} title="Record a short looping clip (WebM + GIF) for social — captures the motion a screenshot can't">${this.clipping ? '● recording…' : 'Clip ↗'}</button>
          <button @click=${() => this.exportSnapshot()} title="Export snapshot JSON (⌘E)">Export</button>
          <label class="filebtn" title="Import a snapshot or PNG (⌘I)" style="background:#14203a;border:1px solid var(--panel-border);border-radius:6px;padding:6px 10px;cursor:pointer">
            Import
            <input type="file" accept="application/json,image/png" @change=${(e: Event) => this.importFile(e)} />
          </label>
          <button @click=${() => { const p = $engine.get()?.togglePause(); this.setStatus(p ? 'paused' : 'resumed'); }} title="Pause / resume (Space)">Pause</button>
        </div>
        ${this.status
          ? html`<div style="font-size:11px;margin-top:6px;color:${this.statusErr ? '#f0908a' : '#7fe0c8'}">${this.status}</div>`
          : html`<div class="hint" style="opacity:.5;font-size:11px;margin-top:6px">Screenshot embeds the full setup — re-import the PNG to recreate it. <span style="opacity:.8">Space pause · ⌘S shot · ⌘E export · ⌘I import</span></div>`}
      </div>
    `;
  }
}

customElements.define('ether-snapshot-controls', SnapshotControls);
