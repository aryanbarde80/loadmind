import { clamp } from '@/lib/math';
import { BUILTIN_IDS, getAlgorithmName } from '@/algorithms/registry';
import type {
  AlgorithmRanking,
  AlgorithmScore,
  AutopilotDecision,
  BuiltinAlgorithmId,
  DecisionFeedItem,
  FeatureVector,
  ScoreContribution,
} from '@/types';
import { describeFeature } from './features';

/**
 * LoadMind AI decision engine.
 *
 * Deterministic, explainable, rule-based scoring: every candidate algorithm
 * starts at a neutral 50 and each active signal adds or subtracts points with
 * a human-readable justification. The winner is the highest score; the full
 * scorecard is retained so the UI can answer "why did the AI choose this?"
 * with real numbers rather than a platitude.
 *
 * It is deliberately not a black box: the output of every evaluation is the
 * same structure a human SRE would use to justify a change on a call.
 */

const BASE_SCORE = 50;
/** Minimum score advantage required before the autopilot switches. */
const SWITCH_MARGIN = 6.5;
/** Extra points given to the incumbent to prevent oscillation. */
const HYSTERESIS_BONUS = 7;

type Rule = {
  id: string;
  /** Returns 0 when the signal is inactive. */
  weight: (f: FeatureVector) => number;
  /** Per-algorithm points applied proportionally to `weight`. */
  impact: Partial<Record<BuiltinAlgorithmId, number>>;
  label: string;
  /** Signal description used in the explanation panel. */
  describe: (f: FeatureVector) => string;
  /** Which feature is driving this rule (for the "evidence" chips). */
  feature: keyof FeatureVector;
};

/**
 * impact values are "points at full signal strength" — a rule firing at 50%
 * strength contributes half its points.
 */
const RULES: Rule[] = [
  {
    id: 'traffic-surge',
    weight: (f) => ramp(f.trafficTrendPct, 12, 60),
    impact: {
      'least-response-time': 14,
      'least-connections': 10,
      'weighted-least-connections': 10,
      'round-robin': -12,
      'weighted-round-robin': -9,
      'ip-hash': -5,
      'consistent-hash': -3,
      random: 2,
    },
    label: 'Traffic surge',
    describe: (f) => `Traffic ${describeFeature('trafficTrendPct', f.trafficTrendPct)}.`,
    feature: 'trafficTrendPct',
  },
  {
    id: 'spike-active',
    weight: (f) => ramp((f.spikeFactor - 1) * 100, 40, 220),
    impact: {
      'least-response-time': 16,
      'least-connections': 12,
      'weighted-least-connections': 12,
      'round-robin': -14,
      'weighted-round-robin': -10,
      'ip-hash': -8,
      'consistent-hash': -4,
      random: 3,
    },
    label: 'Active spike',
    describe: (f) => `Live spike: ${describeFeature('spikeFactor', f.spikeFactor)}.`,
    feature: 'spikeFactor',
  },
  {
    id: 'latency-spread',
    weight: (f) => ramp(f.latencySpreadPct, 25, 90),
    impact: {
      'least-response-time': 20,
      'least-connections': 7,
      'weighted-least-connections': 7,
      'round-robin': -13,
      'weighted-round-robin': -11,
      random: -3,
      'ip-hash': -4,
      'consistent-hash': -3,
    },
    label: 'Latency divergence',
    describe: (f) =>
      `Upstreams disagree on latency — ${describeFeature('latencySpreadMs', f.latencySpreadMs)}.`,
    feature: 'latencySpreadMs',
  },
  {
    id: 'error-rate',
    weight: (f) => ramp(f.errorRate * 100, 0.8, 8),
    impact: {
      'least-response-time': 15,
      'weighted-least-connections': 10,
      'least-connections': 9,
      random: 7,
      'round-robin': -2,
      'weighted-round-robin': -2,
      'ip-hash': -10,
      'consistent-hash': -7,
    },
    label: 'Elevated errors',
    describe: (f) => `Errors climbing: ${describeFeature('errorRate', f.errorRate)}.`,
    feature: 'errorRate',
  },
  {
    id: 'node-loss',
    weight: (f) => ramp(f.downCount, 0.4, 2),
    impact: {
      'consistent-hash': 12,
      'least-connections': 9,
      'weighted-least-connections': 9,
      'least-response-time': 7,
      'round-robin': 4,
      'weighted-round-robin': 4,
      'ip-hash': -20,
      random: 3,
    },
    label: 'Upstream loss',
    describe: (f) => `${describeFeature('downCount', f.downCount)} — affinity must survive rehashing.`,
    feature: 'downCount',
  },
  {
    id: 'connection-imbalance',
    weight: (f) => ramp((f.connectionImbalance - 1) * 100, 20, 120),
    impact: {
      'weighted-least-connections': 17,
      'least-connections': 15,
      'least-response-time': 11,
      'round-robin': -9,
      'weighted-round-robin': -7,
      random: -2,
      'ip-hash': -8,
      'consistent-hash': -7,
    },
    label: 'Connection imbalance',
    describe: (f) => `Load is lopsided: ${describeFeature('connectionImbalance', f.connectionImbalance)}.`,
    feature: 'connectionImbalance',
  },
  {
    id: 'weight-heterogeneity',
    weight: (f) => ramp(f.weightHeterogeneity * 100, 18, 70),
    impact: {
      'weighted-round-robin': 16,
      'weighted-least-connections': 18,
      'consistent-hash': 7,
      random: 5,
      'least-connections': -9,
      'round-robin': -7,
      'least-response-time': -2,
      'ip-hash': -1,
    },
    label: 'Heterogeneous capacity',
    describe: (f) => `Pool is not uniform: ${describeFeature('weightHeterogeneity', f.weightHeterogeneity)}.`,
    feature: 'weightHeterogeneity',
  },
  {
    id: 'cpu-pressure',
    weight: (f) => ramp(f.poolCpu, 62, 92),
    impact: {
      'least-response-time': 13,
      'weighted-least-connections': 12,
      'least-connections': 11,
      random: 4,
      'round-robin': -8,
      'weighted-round-robin': -5,
      'ip-hash': -2,
      'consistent-hash': -1,
    },
    label: 'CPU pressure',
    describe: (f) => `${describeFeature('poolCpu', f.poolCpu)} — work must follow spare capacity.`,
    feature: 'poolCpu',
  },
  {
    id: 'saturation',
    weight: (f) => ramp((0.28 - f.capacityHeadroom) * 100, 6, 28),
    impact: {
      'least-connections': 13,
      'weighted-least-connections': 14,
      'least-response-time': 12,
      'round-robin': -10,
      'weighted-round-robin': -8,
      random: 1,
      'ip-hash': -5,
      'consistent-hash': -4,
    },
    label: 'Approaching saturation',
    describe: (f) => `Only ${describeFeature('capacityHeadroom', f.capacityHeadroom)} left before queueing collapses.`,
    feature: 'capacityHeadroom',
  },
  {
    id: 'client-concentration',
    weight: (f) => ramp(f.ipConcentration * 100, 18, 55),
    impact: {
      'consistent-hash': 13,
      'ip-hash': 9,
      'least-response-time': -4,
      'least-connections': -3,
      'weighted-least-connections': -3,
      'round-robin': -1,
      'weighted-round-robin': -1,
      random: -1,
    },
    label: 'Client concentration',
    describe: (f) => `${describeFeature('ipConcentration', f.ipConcentration)} — cache locality is worth protecting.`,
    feature: 'ipConcentration',
  },
  {
    id: 'topology-churn',
    weight: (f) => ramp(f.churnRate * 100, 8, 60),
    impact: {
      'consistent-hash': 14,
      'least-connections': 6,
      'weighted-least-connections': 6,
      'least-response-time': 4,
      'ip-hash': -14,
      'round-robin': 2,
      'weighted-round-robin': 2,
      random: 2,
    },
    label: 'Topology churn',
    describe: (f) => `Pool membership is unstable (${describeFeature('churnRate', f.churnRate)}).`,
    feature: 'churnRate',
  },
  {
    id: 'calm-conditions',
    weight: (f) => {
      const stress =
        ramp((f.spikeFactor - 1) * 100, 15, 90) +
        ramp(f.latencySpreadPct, 20, 80) +
        ramp(f.errorRate * 100, 0.5, 5) +
        ramp((f.connectionImbalance - 1) * 100, 15, 100);
      return clamp(1 - stress / 2.2, 0, 1);
    },
    impact: {
      'round-robin': 11,
      'weighted-round-robin': 7,
      'consistent-hash': 4,
      'ip-hash': 3,
      random: 2,
      'least-response-time': -7,
      'least-connections': -4,
      'weighted-least-connections': -3,
    },
    label: 'Stable conditions',
    describe: () => 'Pool is calm: latency, errors and load are all evenly distributed.',
    feature: 'avgLatencyMs',
  },
];

/** Linear ramp: 0 below `lo`, 1 above `hi`. */
function ramp(value: number, lo: number, hi: number): number {
  if (hi === lo) return value >= hi ? 1 : 0;
  return clamp((value - lo) / (hi - lo), 0, 1);
}

export type EvaluationResult = AlgorithmRanking;

export function evaluateAlgorithms(
  features: FeatureVector,
  currentAlgorithm: BuiltinAlgorithmId | null,
): EvaluationResult {
  const activeRules = RULES.map((rule) => {
    const strength = rule.weight(features);
    return {
      rule,
      strength,
      value: features[rule.feature],
      evidence: rule.describe(features),
    };
  }).filter((r) => r.strength > 0.02);

  const ranked: AlgorithmScore[] = BUILTIN_IDS.map((id) => {
    const contributions: ScoreContribution[] = [];
    let score = BASE_SCORE;
    for (const { rule, strength, evidence } of activeRules) {
      const points = (rule.impact[id] ?? 0) * strength;
      if (Math.abs(points) < 0.15) continue;
      score += points;
      contributions.push({
        label: rule.label,
        detail: evidence,
        points: Math.round(points * 10) / 10,
      });
    }
    if (currentAlgorithm === id) {
      score += HYSTERESIS_BONUS;
      contributions.push({
        label: 'Incumbent stability',
        detail: `${getAlgorithmName(id)} is already active; switching has a coordination cost, so it starts with a ${HYSTERESIS_BONUS}-point advantage.`,
        points: HYSTERESIS_BONUS,
      });
    }
    contributions.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
    return {
      algorithm: id,
      name: getAlgorithmName(id),
      score: Math.round(score * 10) / 10,
      contributions: contributions.slice(0, 6),
    };
  });

  ranked.sort((a, b) => b.score - a.score);
  const winner = ranked[0].algorithm;
  const runnerUp = ranked[1]?.algorithm ?? null;
  const margin = ranked[0].score - (ranked[1]?.score ?? ranked[0].score);
  const signalStrength = activeRules.reduce((acc, r) => acc + r.strength, 0);
  const confidence = clamp(0.42 + margin / 55 + signalStrength * 0.028, 0.35, 0.98);

  return {
    ranked,
    winner,
    runnerUp,
    margin,
    confidence,
    activeRules: activeRules.map(({ rule, strength, evidence, value }) => ({
      id: rule.id,
      label: rule.label,
      strength,
      evidence,
      feature: rule.feature,
      value,
    })),
  };
}

export interface DecisionOptions {
  features: FeatureVector;
  currentAlgorithm: BuiltinAlgorithmId | null;
  simTime: number;
  metrics: { avgLatencyMs: number; p95Ms: number; errorRate: number; throughput: number };
  /** Force a decision even if the margin is small (used on autopilot enable). */
  force?: boolean;
}

let decisionCounter = 0;

/**
 * Run one autopilot evaluation cycle and produce a full, explainable decision.
 */
export function makeDecision(options: DecisionOptions): AutopilotDecision {
  const { features, currentAlgorithm, simTime, metrics } = options;
  const evaluation = evaluateAlgorithms(features, currentAlgorithm);
  const winner = evaluation.winner;
  const switched = currentAlgorithm !== winner && (options.force || evaluation.margin >= SWITCH_MARGIN);
  const winnerScore = evaluation.ranked[0];
  const topReasons = winnerScore.contributions.filter((c) => c.points > 0).slice(0, 3);

  const headline = buildHeadline(features, currentAlgorithm, winner, switched, topReasons);
  const summary = buildSummary(features, switched, evaluation, currentAlgorithm);

  decisionCounter += 1;
  return {
    id: `dec-${simTime.toFixed(2)}-${decisionCounter}`,
    wallClock: Date.now(),
    simTime,
    previousAlgorithm: currentAlgorithm,
    algorithm: switched ? winner : (currentAlgorithm ?? winner),
    switched,
    confidence: evaluation.confidence,
    headline,
    summary,
    reasons: winnerScore.contributions,
    considered: evaluation.ranked,
    features,
    metrics,
  };
}

function buildHeadline(
  f: FeatureVector,
  current: BuiltinAlgorithmId | null,
  next: BuiltinAlgorithmId,
  switched: boolean,
  reasons: ScoreContribution[],
): string {
  const parts: string[] = [];
  if (f.trafficTrendPct > 12) parts.push(`Traffic has increased by ${f.trafficTrendPct.toFixed(0)}%`);
  else if (f.trafficTrendPct < -12) parts.push(`Traffic has dropped by ${Math.abs(f.trafficTrendPct).toFixed(0)}%`);
  if (f.spikeFactor > 1.6) parts.push(`a ${f.spikeFactor.toFixed(1)}× spike is in progress`);
  if (f.latencySpreadMs > 25) {
    parts.push(`upstream latency differs by ${f.latencySpreadMs.toFixed(0)}ms`);
  }
  if (f.errorRate > 0.01) parts.push(`error rate is ${(f.errorRate * 100).toFixed(1)}%`);
  if (f.downCount > 0) parts.push(`${f.downCount} upstream${f.downCount === 1 ? '' : 's'} ${f.downCount === 1 ? 'is' : 'are'} offline`);
  if (f.connectionImbalance > 1.5) parts.push(`connection counts are ${f.connectionImbalance.toFixed(1)}× apart`);
  if (parts.length === 0) parts.push(reasons[0]?.detail ?? 'Conditions are stable');

  const lead = capitalise(parts.slice(0, 2).join(' and '));
  if (!switched) return `${lead}. Holding on ${getAlgorithmName(next)}.`;
  if (!current) return `${lead}. Selecting ${getAlgorithmName(next)}.`;
  return `${lead}. Switching from ${getAlgorithmName(current)} to ${getAlgorithmName(next)}.`;
}

function buildSummary(
  f: FeatureVector,
  switched: boolean,
  evaluation: EvaluationResult,
  current: BuiltinAlgorithmId | null,
): string {
  const winnerScore = evaluation.ranked[0];
  const runnerUp = evaluation.ranked[1];
  const lines: string[] = [];
  lines.push(
    `Evaluated ${evaluation.ranked.length} algorithms against ${evaluation.activeRules.length} active signal${evaluation.activeRules.length === 1 ? '' : 's'}.`,
  );
  if (switched) {
    lines.push(
      `${winnerScore.name} scored ${winnerScore.score.toFixed(1)}${
        runnerUp ? ` versus ${runnerUp.score.toFixed(1)} for ${runnerUp.name}` : ''
      } — a ${evaluation.margin.toFixed(1)}-point margin, above the ${SWITCH_MARGIN}-point switching threshold.`,
    );
  } else if (current) {
    lines.push(
      `${getAlgorithmName(current)} remains the best choice (${winnerScore.score.toFixed(1)} points). The challenger${
        runnerUp ? ` (${runnerUp.name}, ${runnerUp.score.toFixed(1)})` : ''
      } does not clear the ${SWITCH_MARGIN}-point margin needed to justify a switch.`,
    );
  }
  const why = winnerScore.contributions.filter((c) => c.points > 1)[0];
  if (why) lines.push(`Primary driver: ${why.label.toLowerCase()} — ${why.detail}`);
  if (f.capacityHeadroom < 0.2) {
    lines.push(`Headroom is tight at ${(f.capacityHeadroom * 100).toFixed(0)}%; load-aware selection is critical here.`);
  }
  return lines.join(' ');
}

function capitalise(text: string): string {
  if (!text) return text;
  return text[0].toUpperCase() + text.slice(1);
}

/**
 * Staged feed messages emitted over the ~1.5s following a decision so the
 * operator sees the reasoning unfold rather than a single opaque line.
 */
export function buildFeed(
  decision: AutopilotDecision,
  evaluation: EvaluationResult,
): Omit<DecisionFeedItem, 'id' | 'wallClock'>[] {
  const items: Omit<DecisionFeedItem, 'id' | 'wallClock'>[] = [];
  const f = decision.features;

  if (f.trafficTrendPct > 12 || f.spikeFactor > 1.6) {
    items.push({
      simTime: decision.simTime,
      stage: 'detected',
      message: `Traffic spike detected: ${f.trafficTrendPct > 0 ? '+' : ''}${f.trafficTrendPct.toFixed(0)}% versus baseline (${(f.spikeFactor).toFixed(2)}×)`,
      severity: 'warn',
    });
  }
  if (f.errorRate > 0.01) {
    items.push({
      simTime: decision.simTime,
      stage: 'detected',
      message: `Error rate ${(f.errorRate * 100).toFixed(2)}% exceeds the 1% comfort threshold`,
      severity: f.errorRate > 0.05 ? 'critical' : 'warn',
    });
  }
  if (f.latencySpreadMs > 25) {
    items.push({
      simTime: decision.simTime,
      stage: 'detected',
      message: `Latency divergence of ${f.latencySpreadMs.toFixed(0)}ms detected across the pool`,
      severity: 'warn',
    });
  }
  if (f.downCount > 0) {
    items.push({
      simTime: decision.simTime,
      stage: 'detected',
      message: `${f.downCount} upstream${f.downCount === 1 ? '' : 's'} unreachable — pool membership changed`,
      severity: 'critical',
    });
  }

  items.push({
    simTime: decision.simTime,
    stage: 'degrading',
    message: `${getAlgorithmName(decision.previousAlgorithm ?? decision.algorithm)} performance ${
      f.errorRate > 0.02 || f.latencySpreadPct > 40 ? 'degrading' : 'holding steady'
    } at ${decision.metrics.avgLatencyMs.toFixed(0)}ms avg / ${decision.metrics.p95Ms.toFixed(0)}ms p95`,
    severity: f.errorRate > 0.02 || f.latencySpreadPct > 40 ? 'warn' : 'info',
  });

  items.push({
    simTime: decision.simTime,
    stage: 'comparing',
    message: `Comparing ${evaluation.ranked.length} algorithms across ${evaluation.activeRules.length} active signals…`,
    severity: 'info',
  });

  items.push({
    simTime: decision.simTime,
    stage: 'recommended',
    message: `Recommended: ${getAlgorithmName(decision.algorithm)} — score ${evaluation.ranked[0].score.toFixed(1)} (confidence ${(decision.confidence * 100).toFixed(0)}%)`,
    severity: 'good',
  });

  items.push({
    simTime: decision.simTime,
    stage: decision.switched ? 'switched' : 'holding',
    message: decision.switched
      ? `Algorithm switched automatically → ${getAlgorithmName(decision.algorithm)}`
      : `No switch required — ${getAlgorithmName(decision.algorithm)} retains the lead (margin ${evaluation.margin.toFixed(1)} < ${SWITCH_MARGIN})`,
    severity: decision.switched ? 'good' : 'info',
  });

  return items;
}

/** Re-export so consumers can reason about thresholds in the UI. */
export const AUTOPILOT_THRESHOLDS = { SWITCH_MARGIN, HYSTERESIS_BONUS, BASE_SCORE };
