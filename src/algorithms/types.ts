import type { Rng } from '@/lib/rng';
import type { RequestMeta, ServerState } from '@/types';

/**
 * Contract every load-balancing algorithm implements.
 *
 * An algorithm is a pure-ish function from (pool state, request, private
 * state) to the index of the chosen upstream. It never touches the UI, never
 * mutates the pool, and receives a private `state` bag so stateful strategies
 * (round-robin cursors, hash rings) stay isolated from each other.
 */

export interface AlgorithmContext {
  /** Full ordered pool — includes down servers (index-stable). */
  servers: readonly ServerState[];
  /** Indices of servers that are currently up. */
  candidates: readonly number[];
  request: RequestMeta;
  /** Private, persistent per-algorithm state. */
  state: AlgorithmState;
  rng: Rng;
}

export type AlgorithmState = Record<string, unknown>;

export interface AlgorithmDefinition {
  id: string;
  name: string;
  /** Short label for tight UI spaces. */
  short: string;
  family: 'static' | 'dynamic' | 'affinity' | 'adaptive';
  tagline: string;
  howItWorks: string;
  whyUseful: string;
  advantages: string[];
  limitations: string[];
  bestFor: string[];
  /** Time/space complexity string shown in the detail panel. */
  complexity: string;
  /** Stateless algorithms are trivially horizontally scalable. */
  stateless: boolean;
  /** Synthetic "default" score used before live telemetry exists. */
  createState(): AlgorithmState;
  select(ctx: AlgorithmContext): number | null;
  /** One-line explanation of what the algorithm would do right now. */
  explain(ctx: AlgorithmContext): string;
}

export const noCandidates = (ctx: AlgorithmContext): boolean => ctx.candidates.length === 0;

/** Pick the first candidate; convenience for fallback paths. */
export function firstCandidate(ctx: AlgorithmContext): number | null {
  return ctx.candidates.length ? ctx.candidates[0] : null;
}

/** Return candidates sorted by a numeric key (ascending = best first). */
export function rankCandidates(
  ctx: AlgorithmContext,
  key: (server: ServerState, index: number) => number,
): number[] {
  return [...ctx.candidates].sort((a, b) => {
    const ka = key(ctx.servers[a], a);
    const kb = key(ctx.servers[b], b);
    if (ka === kb) return a - b;
    return ka - kb;
  });
}

export function describeServer(server: ServerState): string {
  return `${server.name} (${server.activeConnections} conn, ${server.ewmaLatencyMs.toFixed(0)}ms)`;
}
