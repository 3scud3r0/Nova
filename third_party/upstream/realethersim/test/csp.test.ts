import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { APP_CSP, APP_DEV_CSP } from '../src/security/csp';

// CSP drift guard. The local copies of the policy (public/_headers, and the private deploy mirror when
// it is checked out alongside) must match the single source in src/security/csp.ts exactly, and the
// app policy must never allow string-eval. The live header is confirmed by curl after each deploy.
const read = (rel: string): string | null => {
  const path = fileURLToPath(new URL(rel, import.meta.url));
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
};
const directive = (csp: string, name: string): string[] | undefined =>
  csp.split(';').map((d) => d.trim().split(/\s+/)).find((d) => d[0] === name)?.slice(1);

describe('content security policy', () => {
  it('the app never allows string-eval or inline scripts', () => {
    for (const csp of [APP_CSP, APP_DEV_CSP]) {
      const script = directive(csp, 'script-src') ?? [];
      expect(script).not.toContain("'unsafe-eval'");
      expect(script).not.toContain("'unsafe-inline'");
    }
  });

  it('public/_headers mirrors the app policy exactly', () => {
    const headers = read('../public/_headers');
    expect(headers).not.toBeNull();
    expect(headers).toContain(`Content-Security-Policy: ${APP_CSP}`);
  });

  it('the local Caddyfile mirror carries the app policy exactly (when the deploy repo is checked out)', () => {
    const caddy = read('../../ethersim-deploy/Caddyfile');
    if (caddy === null) return; // forks / CI without the private deploy repo
    expect(caddy).toContain(`Content-Security-Policy "${APP_CSP}"`);
  });
});
