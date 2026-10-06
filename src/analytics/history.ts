import { mean } from '@/lib/math';
import { createId, saveRun } from '@/storage/localStore';
import type { RunRecord, RunRecordKind } from '@/types';

/**
 * Performance Lab analytics.
 *
 * Every live session, battle and playground benchmark can be persisted here
 * and then queried — "which algorithm won most?", "what was my p95 trend?",
 * "how do my last three runs compare?".
 */

export interface SaveLiveRunInput {
  algorithm: string;
  algorithmName: string;
  pattern: string;
  baseRps: number;
  serverCount: number;
  requests: number;
  avgLatencyMs: number;
  p95Ms: number;
  p99Ms: number;
  throughput: number;
  errorRate: number;
  fairness: number;
  cpu: number;
  score: number;
  chaosSummary: string;
}

export function persistLiveRun(input: SaveLiveRunInput): RunRecord {
  const record: RunRecord = {
    id: createId('live'),
    kind: 'live',
    createdAt: Date.now(),
    label: `${input.algorithmName} · ${input.pattern}`,
    ...input,
  } as RunRecord;
  saveRun(record);
  return record;
}

export function persistBattleResults(
  scenarioName: string,
  results: { algorithm: string; algorithmName?: string; name: string; avgLatencyMs: number; p95Ms: number; p99Ms: number; throughput: number; errorRate: number; fairness: number; cpu: number; score: number; requests: number }[],
  pattern: string,
  baseRps: number,
  serverCount: number,
  chaosSummary: string,
): RunRecord[] {
  return results.map((result) => {
    const record: RunRecord = {
      id: createId('battle'),
      kind: 'battle',
      createdAt: Date.now(),
      label: `${scenarioName} · ${result.name}`,
      algorithm: result.algorithm as RunRecord['algorithm'],
      algorithmName: result.name,
      pattern: pattern as RunRecord['pattern'],
      baseRps,
      serverCount,
      requests: result.requests,
      avgLatencyMs: result.avgLatencyMs,
      p95Ms: result.p95Ms,
      p99Ms: result.p99Ms,
      throughput: result.throughput,
      errorRate: result.errorRate,
      fairness: result.fairness,
      cpu: result.cpu,
      score: result.score,
      chaosSummary,
    };
    saveRun(record);
    return record;
  });
}

export function persistCustomRun(
  name: string,
  result: { avgLatencyMs: number; p95Ms: number; p99Ms: number; throughput: number; errorRate: number; fairness: number; cpu: number; score: number; requests: number },
  pattern: string,
  baseRps: number,
  serverCount: number,
): RunRecord {
  const record: RunRecord = {
    id: createId('custom'),
    kind: 'custom',
    createdAt: Date.now(),
    label: `Playground · ${name}`,
    algorithm: 'custom',
    algorithmName: name,
    pattern: pattern as RunRecord['pattern'],
    baseRps,
    serverCount,
    requests: result.requests,
    avgLatencyMs: result.avgLatencyMs,
    p95Ms: result.p95Ms,
    p99Ms: result.p99Ms,
    throughput: result.throughput,
    errorRate: result.errorRate,
    fairness: result.fairness,
    cpu: result.cpu,
    score: result.score,
    chaosSummary: 'none',
  };
  saveRun(record);
  return record;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface AlgorithmAggregate {
  algorithm: string;
  algorithmName: string;
  runs: number;
  wins: number;
  avgLatencyMs: number;
  p95Ms: number;
  errorRate: number;
  throughput: number;
  score: number;
  fairness: number;
}

export function aggregateByAlgorithm(runs: RunRecord[]): AlgorithmAggregate[] {
  const map = new Map<string, RunRecord[]>();
  for (const run of runs) {
    const list = map.get(run.algorithm) ?? [];
    list.push(run);
    map.set(run.algorithm, list);
  }

  // "Wins" are computed inside each battle group: the highest score of the
  // runs sharing a createdAt timestamp within a battle.
  const battleGroups = new Map<number, RunRecord[]>();
  for (const run of runs) {
    if (run.kind !== 'battle') continue;
    const key = Math.round(run.createdAt / 1000);
    const list = battleGroups.get(key) ?? [];
    list.push(run);
    battleGroups.set(key, list);
  }
  const winCounts = new Map<string, number>();
  for (const group of battleGroups.values()) {
    if (group.length === 0) continue;
    const best = group.reduce((a, b) => (b.score > a.score ? b : a));
    winCounts.set(best.algorithm, (winCounts.get(best.algorithm) ?? 0) + 1);
  }

  return [...map.entries()]
    .map(([algorithm, list]) => ({
      algorithm,
      algorithmName: list[0]?.algorithmName ?? algorithm,
      runs: list.length,
      wins: winCounts.get(algorithm) ?? 0,
      avgLatencyMs: mean(list.map((r) => r.avgLatencyMs)),
      p95Ms: mean(list.map((r) => r.p95Ms)),
      errorRate: mean(list.map((r) => r.errorRate)),
      throughput: mean(list.map((r) => r.throughput)),
      score: mean(list.map((r) => r.score)),
      fairness: mean(list.map((r) => r.fairness)),
    }))
    .sort((a, b) => b.score - a.score);
}

export function filterRuns(
  runs: RunRecord[],
  filter: { kind?: RunRecordKind | 'all'; algorithm?: string | 'all'; search?: string },
): RunRecord[] {
  return runs.filter((run) => {
    if (filter.kind && filter.kind !== 'all' && run.kind !== filter.kind) return false;
    if (filter.algorithm && filter.algorithm !== 'all' && run.algorithm !== filter.algorithm) return false;
    if (filter.search) {
      const needle = filter.search.toLowerCase();
      const haystack = `${run.algorithmName} ${run.pattern} ${run.label} ${run.chaosSummary}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

export function recentRuns(runs: RunRecord[], count = 3): RunRecord[] {
  return [...runs].sort((a, b) => b.createdAt - a.createdAt).slice(0, count);
}

export function bestRun(runs: RunRecord[]): RunRecord | null {
  if (runs.length === 0) return null;
  return runs.reduce((best, run) => (run.score > best.score ? run : best));
}

export interface ComparisonRow {
  metric: string;
  unit: string;
  values: (number | string)[];
  best: 'low' | 'high' | 'none';
}

export function compareRuns(runs: RunRecord[]): ComparisonRow[] {
  return [
    { metric: 'Average latency', unit: 'ms', values: runs.map((r) => r.avgLatencyMs), best: 'low' },
    { metric: 'p95 latency', unit: 'ms', values: runs.map((r) => r.p95Ms), best: 'low' },
    { metric: 'p99 latency', unit: 'ms', values: runs.map((r) => r.p99Ms), best: 'low' },
    { metric: 'Error rate', unit: '%', values: runs.map((r) => r.errorRate * 100), best: 'low' },
    { metric: 'Throughput', unit: 'rps', values: runs.map((r) => r.throughput), best: 'high' },
    { metric: 'Fairness', unit: '', values: runs.map((r) => r.fairness), best: 'high' },
    { metric: 'Composite score', unit: '', values: runs.map((r) => r.score), best: 'high' },
    { metric: 'Requests', unit: '', values: runs.map((r) => r.requests), best: 'none' },
  ];
}
