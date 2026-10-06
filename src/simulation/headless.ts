import { compileCustomAlgorithm } from '@/algorithms/custom';
import { getAlgorithmName } from '@/algorithms/registry';
import { compositeScore, winnerCitation } from '@/metrics/score';
import { SIM_STEP, SimulationEngine } from './engine';
import type {
  AlgorithmId,
  BattleResult,
  BattleScenario,
  ChaosState,
  SimulationConfig,
} from '@/types';

/**
 * Headless simulation runner.
 *
 * Battle Mode, the custom-algorithm benchmark and the Performance Lab all run
 * through this: it builds a real `SimulationEngine`, steps it as fast as the
 * CPU allows, and reports the same metrics the live UI shows. Nothing is
 * faked — each algorithm genuinely routes every request.
 */

const MAX_STEPS = 60_000;

export interface HeadlessRunOptions {
  scenario: BattleScenario;
  algorithm: AlgorithmId;
  custom?: { id: string; name: string; code: string };
  onProgress?: (fraction: number) => void;
}

export function scenarioChaos(scenario: BattleScenario, servers: { id: string }[]): ChaosState {
  const chaos: ChaosState = {
    trafficMultiplier: scenario.chaos.trafficMultiplier,
    latencyPenalties: {},
    errorPenalties: {},
    capacityReductions: {},
    killed: {},
    randomFailures: false,
    failureRatePerSec: 0,
  };
  servers.forEach((server, index) => {
    if (index < scenario.chaos.killCount) chaos.killed[server.id] = true;
    if (scenario.chaos.latencyPenaltyMs > 0 && index === Math.min(1, servers.length - 1)) {
      chaos.latencyPenalties[server.id] = scenario.chaos.latencyPenaltyMs;
    }
    if (scenario.chaos.errorPenalty > 0 && index === servers.length - 1) {
      chaos.errorPenalties[server.id] = scenario.chaos.errorPenalty;
    }
    if (scenario.chaos.capacityReduction > 0 && index === Math.max(0, servers.length - 2)) {
      chaos.capacityReductions[server.id] = scenario.chaos.capacityReduction;
    }
  });
  return chaos;
}

function buildConfig(scenario: BattleScenario): SimulationConfig {
  return {
    baseRps: scenario.baseRps,
    pattern: scenario.pattern,
    serverCount: scenario.serverCount,
    burstDurationSec: 0,
    burstMultiplier: 1,
    speed: 1,
    retryOnFailure: true,
    seed: scenario.seed,
  };
}

export function runHeadless(options: HeadlessRunOptions): BattleResult {
  const { scenario, algorithm, custom, onProgress } = options;
  const engine = new SimulationEngine(buildConfig(scenario));
  engine.setChaos(scenarioChaos(scenario, engine.servers));

  if (algorithm === 'custom' && custom) {
    const compiled = compileCustomAlgorithm(custom.id, custom.name, custom.code);
    engine.setCustomAlgorithm(compiled.definition);
  } else if (algorithm === 'autopilot') {
    engine.setAutopilot(true, { silent: true });
  } else {
    engine.setAlgorithm(algorithm);
  }

  engine.start();

  const series: { t: number; latency: number; rps: number }[] = [];
  let steps = 0;
  let lastSeriesAt = -1;
  const target = scenario.requests;

  while (steps < MAX_STEPS && engine.metrics.completed < target && engine.simTime < scenario.durationSec) {
    engine.step(SIM_STEP);
    steps += 1;
    if (engine.simTime - lastSeriesAt >= 0.5) {
      lastSeriesAt = engine.simTime;
      const metrics = engine.metrics.snapshot(engine.servers, engine.simTime);
      series.push({ t: Number(engine.simTime.toFixed(2)), latency: metrics.avgLatencyMs, rps: metrics.throughput });
    }
    if (onProgress && steps % 400 === 0) {
      onProgress(Math.min(0.99, engine.metrics.completed / target));
    }
  }

  const simTime = engine.simTime;
  const metrics = engine.metrics.snapshot(engine.servers, simTime);
  const distribution = engine.metrics.distribution(engine.servers);
  const completed = Math.max(1, metrics.completed);
  const maxUtilization = engine.servers.length
    ? Math.max(...engine.servers.map((s) => s.utilization))
    : 0;
  const cpu = engine.servers.length
    ? engine.servers.reduce((a, s) => a + s.cpu, 0) / engine.servers.length
    : 0;

  const result: BattleResult = {
    algorithm,
    name: algorithm === 'custom' ? custom?.name ?? 'Custom' : getAlgorithmName(algorithm),
    isAutopilot: algorithm === 'autopilot',
    requests: metrics.completed,
    succeeded: metrics.succeeded,
    failed: metrics.failed,
    avgLatencyMs: metrics.avgLatencyMs,
    p50Ms: metrics.p50Ms,
    p95Ms: metrics.p95Ms,
    p99Ms: metrics.p99Ms,
    throughput: metrics.completed / Math.max(0.5, simTime),
    errorRate: metrics.failed / completed,
    cpu,
    fairness: metrics.fairness,
    gini: metrics.gini,
    maxUtilization,
    score: 0,
    perServer: distribution.map((d) => ({
      serverId: d.serverId,
      name: d.name,
      count: d.count,
      share: d.share,
      latencyMs: d.latencyMs,
      errors: d.errors,
    })),
    latencySeries: series,
  };

  if (algorithm === 'autopilot') result.switches = engine.autopilot.switches;
  // Provisional score (runBattle recomputes with a shared throughput reference).
  result.score = compositeScore({
    avgLatencyMs: result.avgLatencyMs,
    p95Ms: result.p95Ms,
    errorRate: result.errorRate,
    throughput: result.throughput,
    fairness: result.fairness,
    cpu: result.cpu,
    maxUtilization: result.maxUtilization,
    referenceThroughput: Math.max(1, result.throughput),
  }).score;
  onProgress?.(1);
  return result;
}

export interface BattleOutcome {
  results: BattleResult[];
  winner: AlgorithmId;
  winnerReason: string;
  referenceThroughput: number;
}

export function runBattle(
  scenario: BattleScenario,
  algorithms: AlgorithmId[],
  custom?: { id: string; name: string; code: string },
  onProgress?: (fraction: number, label: string) => void,
): BattleOutcome {
  const raw = algorithms.map((algorithm) => {
    onProgress?.(0, `Running ${algorithm === 'custom' ? custom?.name ?? 'custom' : getAlgorithmName(algorithm)}…`);
    return runHeadless({ scenario, algorithm, custom, onProgress: (f) => onProgress?.(f, '') });
  });

  // Throughput is normalised against the best run so the composite score is
  // comparable across scenarios.
  const referenceThroughput = Math.max(...raw.map((r) => r.throughput), 1);

  const results = raw.map((result) => {
    const breakdown = compositeScore({
      avgLatencyMs: result.avgLatencyMs,
      p95Ms: result.p95Ms,
      errorRate: result.errorRate,
      throughput: result.throughput,
      fairness: result.fairness,
      cpu: result.cpu,
      maxUtilization: result.maxUtilization,
      referenceThroughput,
    });
    return { ...result, score: breakdown.score };
  });

  results.sort((a, b) => b.score - a.score);
  const winner = results[0];
  const runnerUp = results[1];

  return {
    results,
    winner: winner.algorithm,
    winnerReason: winnerCitation(winner, runnerUp),
    referenceThroughput,
  };
}
