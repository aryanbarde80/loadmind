/**
 * Deterministic pseudo-random utilities.
 *
 * Every simulation in LoadMind is driven by a seeded RNG so that a scenario
 * (or a battle) is exactly reproducible — that is what makes comparing two
 * algorithms on "the same traffic" meaningful rather than anecdotal.
 */

/** Fast, decent-quality 32-bit PRNG (mulberry32). */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  next(): number;
  range(min: number, max: number): number;
  int(min: number, max: number): number;
  bool(p: number): boolean;
  /** Box–Muller standard normal. */
  normal(): number;
  /** Gaussian clamped to +/- 3 sigma. */
  gauss(mean: number, stdDev: number): number;
  /** Knuth's method — accurate for small lambda, cheap. */
  poisson(lambda: number): number;
  pick<T>(items: readonly T[]): T;
  weightedPick<T>(items: readonly T[], weights: readonly number[]): T;
  shuffle<T>(items: T[]): T[];
}

export function createRng(seed: number): Rng {
  const next = makeRng(seed);
  const rng: Rng = {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    bool: (p) => next() < p,
    normal() {
      let u = 0;
      let v = 0;
      while (u === 0) u = next();
      while (v === 0) v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    gauss(mean, stdDev) {
      const z = rng.normal();
      return mean + Math.max(-3, Math.min(3, z)) * stdDev;
    },
    poisson(lambda) {
      if (lambda <= 0) return 0;
      if (lambda > 30) {
        // Normal approximation is plenty for a visual simulator.
        return Math.max(0, Math.round(rng.gauss(lambda, Math.sqrt(lambda))));
      }
      const l = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do {
        k += 1;
        p *= next();
      } while (p > l);
      return k - 1;
    },
    pick: (items) => items[Math.floor(next() * items.length) % items.length],
    weightedPick(items, weights) {
      let total = 0;
      for (const w of weights) total += Math.max(0, w);
      if (total <= 0) return rng.pick(items);
      let r = next() * total;
      for (let i = 0; i < items.length; i++) {
        r -= Math.max(0, weights[i]);
        if (r <= 0) return items[i];
      }
      return items[items.length - 1];
    },
    shuffle(items) {
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }
      return items;
    },
  };
  return rng;
}

/** Deterministic 32-bit string hash (FNV-1a). */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Stable hash to a float in [0,1). */
export function hashUnit(str: string): number {
  return fnv1a(str) / 4294967296;
}
