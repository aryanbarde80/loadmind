import { fnv1a } from '@/lib/rng';

/**
 * Consistent hash ring with virtual nodes.
 *
 * Used by the Consistent Hashing algorithm: each upstream owns
 * `virtualNodes * weight` points on a 2^32 ring, so adding or removing a
 * server only remaps ~1/N of the key space instead of all of it (which is
 * what a plain `hash % N` scheme does).
 */

export interface RingEntry {
  hash: number;
  serverIndex: number;
  label: string;
}

export class HashRing {
  readonly entries: RingEntry[];
  readonly signature: string;

  constructor(
    serverIndexes: readonly number[],
    labels: readonly string[],
    weights: readonly number[],
    virtualNodes = 64,
  ) {
    const entries: RingEntry[] = [];
    serverIndexes.forEach((serverIndex, i) => {
      const vnodes = Math.max(1, Math.round(virtualNodes * Math.max(0.1, weights[i] ?? 1)));
      for (let v = 0; v < vnodes; v++) {
        entries.push({
          hash: fnv1a(`${labels[i]}#${v}`),
          serverIndex,
          label: labels[i],
        });
      }
    });
    entries.sort((a, b) => a.hash - b.hash);
    this.entries = entries;
    this.signature = serverIndexes
      .map((idx, i) => `${labels[i]}:${weights[i] ?? 1}:${idx}`)
      .join('|');
  }

  get size(): number {
    return this.entries.length;
  }

  /** Index of the ring entry owning `key`. */
  lookup(key: string): number | null {
    if (this.entries.length === 0) return null;
    const h = fnv1a(key);
    let lo = 0;
    let hi = this.entries.length - 1;
    // Binary search for the first entry with hash >= h (wrap around).
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.entries[mid].hash < h) lo = mid + 1;
      else hi = mid;
    }
    if (this.entries[lo].hash < h) lo = 0; // wrap
    return lo;
  }

  /**
   * Walk forward from the owning entry until we find an entry whose server is
   * currently up. This is how a real ring handles failed nodes.
   */
  lookupAlive(
    key: string,
    isAlive: (serverIndex: number) => boolean,
    start = 0,
  ): number | null {
    if (this.entries.length === 0) return null;
    const base = this.lookup(key);
    if (base === null) return null;
    for (let step = start; step < this.entries.length; step++) {
      const entry = this.entries[(base + step) % this.entries.length];
      if (isAlive(entry.serverIndex)) return entry.serverIndex;
    }
    return null;
  }

  /** Share of the keyspace owned by each server (for the ring visualiser). */
  ownership(): { serverIndex: number; label: string; share: number; segments: number }[] {
    const map = new Map<number, { serverIndex: number; label: string; share: number; segments: number }>();
    if (this.entries.length === 0) return [];
    for (let i = 0; i < this.entries.length; i++) {
      const current = this.entries[i];
      const next = this.entries[(i + 1) % this.entries.length];
      const span = (next.hash - current.hash + 2 ** 32) % 2 ** 32;
      const existing = map.get(current.serverIndex) ?? {
        serverIndex: current.serverIndex,
        label: current.label,
        share: 0,
        segments: 0,
      };
      existing.share += span / 2 ** 32;
      existing.segments += 1;
      map.set(current.serverIndex, existing);
    }
    return [...map.values()];
  }
}
