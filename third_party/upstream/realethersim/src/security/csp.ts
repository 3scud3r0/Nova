// Content-Security-Policy — the single source of truth for every place a CSP is sent:
//   • production: the front door's security headers (kept in the private deploy config)
//   • public/_headers (a Cloudflare/Netlify-style mirror, copied into the build output)
//   • vite dev + preview (so a CSP-only bug shows up locally instead of first on the live site —
//     the silent Custom Equation breakage happened precisely because dev sent no CSP)
// test/csp.test.ts asserts the local copies contain exactly these strings; after a deploy, confirm the
// live policy with `curl -sI https://ethersim.ai/ | grep -i content-security`.

type Csp = Record<string, string[]>;

export function serializeCsp(csp: Csp): string {
  return Object.entries(csp)
    .map(([directive, sources]) => (sources.length ? `${directive} ${sources.join(' ')}` : directive))
    .join('; ');
}

// The app never evaluates strings as code: no 'unsafe-eval', no inline scripts.
export const APP_CSP_DIRECTIVES: Csp = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'"], // inline <style> + Tweakpane/KaTeX inject styles at runtime
  'img-src': ["'self'", 'data:', 'blob:'],
  'font-src': ["'self'", 'data:'],
  'connect-src': ["'self'"],
  'worker-src': ["'self'", 'blob:'],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'frame-ancestors': ["'none'"],
  'form-action': ["'none'"],
};
export const APP_CSP = serializeCsp(APP_CSP_DIRECTIVES);

// Dev server only: Vite's HMR client needs a websocket back to the dev server.
export const APP_DEV_CSP = serializeCsp({
  ...APP_CSP_DIRECTIVES,
  'connect-src': [...APP_CSP_DIRECTIVES['connect-src'], 'ws:', 'wss:'],
});
