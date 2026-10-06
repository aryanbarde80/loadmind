import type { AlgorithmDefinition } from './types';
import { createAlgorithmStates } from './registry';
import { createRng } from '@/lib/rng';
import type { ServerState } from '@/types';

/**
 * Run an algorithm's `explain()` against the live pool so the UI can show
 * "what would this algorithm do with the next request?" — using the real
 * selection code path, not prose written ahead of time.
 */

const SAMPLE_IPS = ['24.18.204.77', '66.249.73.190', '104.28.61.9', '172.16.9.44', '192.168.4.201'];

export function explainFor(
  definition: AlgorithmDefinition,
  servers: readonly ServerState[],
  simTime: number,
  clientIp = SAMPLE_IPS[0],
): string {
  const candidates: number[] = [];
  servers.forEach((server, index) => {
    if (!server.down) candidates.push(index);
  });
  const states = createAlgorithmStates();
  const state = states.get(definition.id) ?? definition.createState();
  const rng = createRng(0x5eed);
  try {
    return definition.explain({
      servers,
      candidates,
      request: {
        id: 0,
        clientIp,
        path: '/api/orders',
        cost: 1,
        seq: 0,
        arrivalTime: simTime,
      },
      state,
      rng,
    });
  } catch (error) {
    return `Explanation unavailable: ${(error as Error).message}`;
  }
}

/** Which server the algorithm would pick for the next request. */
export function nextPick(
  definition: AlgorithmDefinition,
  servers: readonly ServerState[],
  simTime: number,
  clientIp = SAMPLE_IPS[0],
): number | null {
  const candidates: number[] = [];
  servers.forEach((server, index) => {
    if (!server.down) candidates.push(index);
  });
  if (candidates.length === 0) return null;
  const states = createAlgorithmStates();
  const state = states.get(definition.id) ?? definition.createState();
  const rng = createRng(0x5eed);
  try {
    return definition.select({
      servers,
      candidates,
      request: { id: 0, clientIp, path: '/api/orders', cost: 1, seq: 0, arrivalTime: simTime },
      state,
      rng,
    });
  } catch {
    return null;
  }
}

export { SAMPLE_IPS };
