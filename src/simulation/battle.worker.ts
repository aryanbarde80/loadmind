/// <reference lib="webworker" />
import { runBattle } from './headless';
import type { AlgorithmId, BattleScenario } from '@/types';

/**
 * Battle Mode worker.
 *
 * A full battle runs 2–4 × 10,000-request simulations. Doing that on the main
 * thread would freeze the UI for hundreds of milliseconds, so it happens here
 * and streams progress back to the control centre.
 */

export interface BattleRequest {
  type: 'run';
  scenario: BattleScenario;
  algorithms: AlgorithmId[];
  custom?: { id: string; name: string; code: string };
}

export type BattleResponse =
  | { type: 'progress'; fraction: number; label: string }
  | { type: 'done'; results: ReturnType<typeof runBattle>['results']; winner: AlgorithmId; winnerReason: string }
  | { type: 'error'; message: string };

self.onmessage = (event: MessageEvent<BattleRequest>) => {
  const data = event.data;
  if (data?.type !== 'run') return;

  try {
    const total = data.algorithms.length;
    let done = 0;
    const outcome = runBattle(data.scenario, data.algorithms, data.custom, (fraction, label) => {
      const overall = (done + fraction) / total;
      (self as unknown as Worker).postMessage({
        type: 'progress',
        fraction: overall,
        label: label || `Simulating ${Math.round(overall * 100)}%`,
      } satisfies BattleResponse);
      if (fraction >= 1) done += 1;
    });
    (self as unknown as Worker).postMessage({
      type: 'done',
      results: outcome.results,
      winner: outcome.winner,
      winnerReason: outcome.winnerReason,
    } satisfies BattleResponse);
  } catch (error) {
    (self as unknown as Worker).postMessage({
      type: 'error',
      message: (error as Error).message,
    } satisfies BattleResponse);
  }
};
