// Per-system learn-panel content: plain-English explainer, governing equations (KaTeX LaTeX),
// a parameter→symbol map (so the Math tab can show live slider values), the core code, and
// reference links. Authored against the actual archetype source so the math matches the sim.
export interface DocEquation {
  label: string;
  latex: string;
}
export interface DocParam {
  key: string;
  symbol: string; // KaTeX symbol, e.g. "\\sigma", "r_{max}"
  meaning: string;
}
export interface DocLink {
  label: string;
  url: string;
}
export interface SystemDoc {
  title: string;
  about: string;
  howItWorks: string;
  equations: DocEquation[];
  params: DocParam[];
  code: string;
  links: DocLink[];
}

// Filled by docs.generated.ts (authored content, regenerable) + docs.fractals.ts (hand-curated IFS
// docs). Kept separate so the generated data can be regenerated without touching the panel logic.
import { SYSTEM_DOCS as GENERATED } from './docs.generated';
import { FRACTAL_DOCS } from './docs.fractals';
import { EXTRA_DOCS } from './docs.extra';
import { RAYMARCH_DOCS } from './docs.raymarch';
import { PARAMETRIC_DOCS } from './docs.parametric';

export const SYSTEM_DOCS: Record<string, SystemDoc> = { ...GENERATED, ...FRACTAL_DOCS, ...EXTRA_DOCS, ...RAYMARCH_DOCS, ...PARAMETRIC_DOCS };

export function getDoc(id: string): SystemDoc | null {
  return SYSTEM_DOCS[id] ?? null;
}
