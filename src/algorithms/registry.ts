import type { AlgorithmDefinition, AlgorithmState } from './types';
import { roundRobin } from './roundRobin';
import { weightedRoundRobin } from './weightedRoundRobin';
import { leastConnections } from './leastConnections';
import { weightedLeastConnections } from './weightedLeastConnections';
import { ipHash } from './ipHash';
import { randomAlgorithm } from './random';
import { leastResponseTime } from './leastResponseTime';
import { consistentHash } from './consistentHash';
import type { BuiltinAlgorithmId } from '@/types';

/**
 * The algorithm registry.
 *
 * Adding a new strategy is a two-step process: implement
 * `AlgorithmDefinition` in this folder, then add it to the array below.
 * Nothing else in the app (UI, battle mode, autopilot, chat) needs to change —
 * they all read from this registry.
 */
export const BUILTIN_ALGORITHMS: AlgorithmDefinition[] = [
  roundRobin,
  weightedRoundRobin,
  leastConnections,
  weightedLeastConnections,
  ipHash,
  randomAlgorithm,
  leastResponseTime,
  consistentHash,
];

export const BUILTIN_IDS: BuiltinAlgorithmId[] = BUILTIN_ALGORITHMS.map((a) => a.id as BuiltinAlgorithmId);

const registry = new Map<string, AlgorithmDefinition>();
for (const algorithm of BUILTIN_ALGORITHMS) registry.set(algorithm.id, algorithm);

export function getAlgorithm(id: string): AlgorithmDefinition | undefined {
  return registry.get(id);
}

export function requireAlgorithm(id: string): AlgorithmDefinition {
  const algorithm = registry.get(id);
  if (!algorithm) throw new Error(`Unknown algorithm: ${id}`);
  return algorithm;
}

export function getAlgorithmName(id: string): string {
  return registry.get(id)?.name ?? id;
}

export function getAlgorithmShort(id: string): string {
  return registry.get(id)?.short ?? '??';
}

/** Register (or replace) an algorithm at runtime — used by the playground. */
export function registerAlgorithm(algorithm: AlgorithmDefinition): void {
  registry.set(algorithm.id, algorithm);
}

export function isBuiltin(id: string): boolean {
  return BUILTIN_ALGORITHMS.some((a) => a.id === id);
}

/** Fresh private state for every algorithm (cursors, rings, credits). */
export function createAlgorithmStates(): Map<string, AlgorithmState> {
  const states = new Map<string, AlgorithmState>();
  for (const algorithm of BUILTIN_ALGORITHMS) states.set(algorithm.id, algorithm.createState());
  return states;
}

export const ALGORITHM_FAMILIES = {
  static: { label: 'Static', color: '#3b9dfd', blurb: 'Fixed rules, no feedback from the fleet.' },
  dynamic: { label: 'Dynamic', color: '#34e5b0', blurb: 'Reacts to live load and latency.' },
  affinity: { label: 'Affinity', color: '#8b7cf6', blurb: 'Keeps a client pinned to a server.' },
  adaptive: { label: 'Adaptive', color: '#fbbf24', blurb: 'Changes strategy as conditions change.' },
} as const;
