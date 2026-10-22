// Irrational drivers for the hierarchical hyper-oscillator archetype (PRD §2).
export const PHI = 1.618033988749895; // golden ratio φ
export const PI = Math.PI;
export const E = Math.E;
export const FEIGENBAUM_DELTA = 4.66920160910299; // δ
export const FEIGENBAUM_ALPHA = 2.502907875095892; // α

export const IRRATIONAL_DRIVERS = [PHI, PI, E, FEIGENBAUM_DELTA] as const;
