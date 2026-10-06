/** Small numeric helpers shared by the simulation, metrics and scoring code. */

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

export const clamp01 = (v: number): number => clamp(v, 0, 1);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Exponential moving average helper: `value` moves toward `target`. */
export function ema(previous: number, target: number, alpha: number): number {
  return previous + (target - previous) * clamp01(alpha);
}

export const mean = (xs: readonly number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

/** Nearest-rank percentile on an UNSORTED copy (does not mutate input). */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = clamp(Math.ceil((p / 100) * sorted.length) - 1, 0, sorted.length - 1);
  return sorted[idx];
}

export function stdDev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Jain's fairness index: 1.0 = perfectly fair distribution. */
export function jainIndex(values: readonly number[]): number {
  if (values.length === 0) return 1;
  const sum = values.reduce((a, b) => a + b, 0);
  const sumSq = values.reduce((a, b) => a + b * b, 0);
  if (sumSq === 0) return 1;
  return (sum * sum) / (values.length * sumSq);
}

/** Gini coefficient: 0 = perfectly equal, 1 = maximally unequal. */
export function gini(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const total = sorted.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) weighted += (i + 1) * sorted[i];
  return (2 * weighted) / (n * total) - (n + 1) / n;
}

/** Coefficient of variation (std-dev / mean). */
export function variation(values: readonly number[]): number {
  const m = mean(values);
  if (m === 0) return 0;
  return stdDev(values) / m;
}

export function round(value: number, decimals = 0): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

export function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

export function maxOf(values: readonly number[]): number {
  return values.length ? Math.max(...values) : 0;
}

export function minOf(values: readonly number[]): number {
  return values.length ? Math.min(...values) : 0;
}

/** Push into a bounded ring buffer (keeps the newest `limit` items). */
export function pushBounded<T>(buffer: T[], value: T, limit: number): T[] {
  buffer.push(value);
  if (buffer.length > limit) buffer.splice(0, buffer.length - limit);
  return buffer;
}

/** Normalise a value into 0..100 given an expected "good" and "bad" bound. */
export function scoreBand(value: number, good: number, bad: number, invert = true): number {
  if (good === bad) return 50;
  const t = clamp01((value - good) / (bad - good));
  return (invert ? 1 - t : t) * 100;
}
