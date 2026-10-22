import { defineConfig, type PluginOption } from 'vite';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { APP_CSP, APP_DEV_CSP } from './src/security/csp';

// Cross-origin isolation headers — required for SharedArrayBuffer (Phase 1 Worker path).
// Harmless for the main-thread vertical slice; keeps the dev/preview server SAB-ready.
const coiHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// The production Content-Security-Policy is sent locally too, so a CSP-only bug (e.g. string-eval,
// which silently broke Custom Equation on the live site) surfaces in dev instead of in production.
// Dev adds only the websocket Vite's HMR client needs; preview serves the build exactly as prod does.
const devHeaders = { ...coiHeaders, 'Content-Security-Policy': APP_DEV_CSP };
const previewHeaders = { ...coiHeaders, 'Content-Security-Policy': APP_CSP };

// DEV-ONLY (apply:'serve') endpoint for the offline thumbnail-capture pass (?capture=thumbs in the
// app). It accepts a base64 WebP and writes public/thumbs/<id>.webp. Never part of the production
// build, and it only ever writes inside public/thumbs with a strictly-validated [A-Za-z0-9_-] id
// (no path separators → no traversal). Not a network/app feature — a local build tool.
function thumbCapturePlugin(): PluginOption {
  return {
    name: 'ethersim-thumb-capture',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__thumb', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        let body = '';
        let size = 0;
        let aborted = false;
        req.on('data', (c: Buffer) => {
          if (aborted) return;
          size += c.length;
          if (size > 8 * 1024 * 1024) {
            aborted = true; // 8 MB hard cap — stop reading and don't try to parse a truncated body
            res.statusCode = 413;
            res.end('too large');
            req.destroy();
            return;
          }
          body += c;
        });
        req.on('end', () => {
          if (aborted) return;
          void (async () => {
            try {
              const { id, dataUrl } = JSON.parse(body) as { id?: string; dataUrl?: string };
              if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
                res.statusCode = 400;
                res.end('bad id');
                return;
              }
              const m = /^data:image\/webp;base64,(.+)$/.exec(dataUrl ?? '');
              if (!m) {
                res.statusCode = 400;
                res.end('bad dataUrl');
                return;
              }
              const dir = resolve(__dirname, 'public/thumbs');
              await mkdir(dir, { recursive: true });
              await writeFile(resolve(dir, `${id}.webp`), Buffer.from(m[1], 'base64'));
              res.statusCode = 200;
              res.end('ok');
            } catch (e) {
              res.statusCode = 500;
              res.end(String(e));
            }
          })();
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [thumbCapturePlugin()],
  server: { headers: devHeaders },
  preview: { headers: previewHeaders },
  worker: { format: 'es' },
  build: {
    target: 'esnext',
    sourcemap: false, // explicit: never ship sourcemaps (they can embed local absolute paths)
    // No inline module-preload polyfill, so the production HTML has zero inline <script> and a
    // strict `script-src 'self'` CSP holds (the app targets modern WebGPU/WebGL browsers anyway).
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        demo: resolve(__dirname, 'demo.html'),
      },
    },
  },
});
