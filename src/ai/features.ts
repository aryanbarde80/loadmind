import { clamp, mean, variation } from '@/lib/math';
import type { DistributionBucket, FeatureVector, MetricsSnapshot, ServerState } from '@/types';

/**
 * Feature extraction — turns raw telemetry into the signal set the decision
 * engine reasons over. Keeping this separate means the rules below never have
 * to touch server objects directly, and new signals can be added in one place.
 */

export interface FeatureInput {
  simTime: number;
  servers: readonly ServerState[];
  metrics: MetricsSnapshot;
  distribution: readonly DistributionBucket[];
  /** Recent arrival-rate samples (oldest → newest), ~4 per sim second. */
  arrivalHistory: readonly number[];
  /** Share of traffic coming from the single busiest client (0..1). */
  hotClientShare: number;
  /** How many servers changed status in the last 10 sim seconds. */
  statusChurn: number;
}

export function extractFeatures(input: FeatureInput): FeatureVector {
  const { servers, metrics, arrivalHistory, distribution } = input;
  const alive = servers.filter((s) => !s.down);
  const latencies = alive.map((s) => s.ewmaLatencyMs + s.latencyPenaltyMs);
  const utilizations = alive.map((s) => s.utilization);

  const minLatency = latencies.length ? Math.min(...latencies) : 0;
  const maxLatency = latencies.length ? Math.max(...latencies) : 0;
  const avgLatency = latencies.length ? mean(latencies) : 0;

  // Traffic trend: last 2s versus the 6s before that.
  const recent = arrivalHistory.slice(-8);
  const prior = arrivalHistory.slice(-32, -8);
  const recentAvg = recent.length ? mean(recent) : metrics.arrivalRate;
  const priorAvg = prior.length ? mean(prior) : recentAvg;
  const trafficTrendPct = priorAvg > 0.5 ? ((recentAvg - priorAvg) / priorAvg) * 100 : 0;
  const baseline = arrivalHistory.length ? median(arrivalHistory) : metrics.arrivalRate;
  const spikeFactor = baseline > 0.5 ? metrics.arrivalRate / baseline : 1;

  const shares = distribution.map((d) => d.count);
  const totalShare = shares.reduce((a, b) => a + b, 0);
  const weights = alive.map((s) => s.weight);

  return {
    simTime: input.simTime,
    arrivalRate: metrics.arrivalRate,
    trafficTrendPct,
    spikeFactor,
    avgLatencyMs: metrics.avgLatencyMs || avgLatency,
    p95LatencyMs: metrics.p95Ms,
    latencySpreadMs: maxLatency - minLatency,
    latencySpreadPct: avgLatency > 0 ? ((maxLatency - minLatency) / avgLatency) * 100 : 0,
    errorRate: metrics.errorRate,
    poolCpu: metrics.poolCpu,
    poolMemory: metrics.poolMemory,
    connectionImbalance: metrics.imbalance,
    distributionGini: totalShare > 0 ? metrics.gini : 0,
    weightHeterogeneity: variation(weights),
    ipConcentration: input.hotClientShare,
    healthyCount: metrics.healthyCount,
    degradedCount: metrics.warningCount,
    downCount: metrics.downCount,
    serverCount: servers.length,
    capacityHeadroom: clamp(1 - (metrics.saturation || (utilizations.length ? mean(utilizations) : 0)), 0, 1),
    churnRate: input.statusChurn / Math.max(1, servers.length),
  };
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Plain-English one-liners for each signal, used in explanations. */
export function describeFeature(key: keyof FeatureVector, value: number): string {
  switch (key) {
    case 'trafficTrendPct':
      return `arrival rate ${value >= 0 ? 'up' : 'down'} ${Math.abs(value).toFixed(0)}% versus the previous window`;
    case 'spikeFactor':
      return `current traffic is ${value.toFixed(2)}× the session baseline`;
    case 'latencySpreadMs':
      return `${value.toFixed(0)}ms spread between the fastest and slowest upstream`;
    case 'latencySpreadPct':
      return `${value.toFixed(0)}% latency spread across the pool`;
    case 'errorRate':
      return `${(value * 100).toFixed(2)}% of requests are failing`;
    case 'poolCpu':
      return `pool CPU averaging ${value.toFixed(0)}%`;
    case 'connectionImbalance':
      return `busiest upstream holds ${value.toFixed(2)}× the average connection count`;
    case 'distributionGini':
      return `traffic distribution Gini of ${value.toFixed(3)}`;
    case 'weightHeterogeneity':
      return `capacity weights vary by ${(value * 100).toFixed(0)}%`;
    case 'ipConcentration':
      return `${(value * 100).toFixed(0)}% of traffic comes from the busiest single client`;
    case 'downCount':
      return `${value.toFixed(0)} upstream${value === 1 ? '' : 's'} offline`;
    case 'degradedCount':
      return `${value.toFixed(0)} upstream${value === 1 ? '' : 's'} in a warning state`;
    case 'capacityHeadroom':
      return `${(value * 100).toFixed(0)}% average capacity headroom`;
    case 'churnRate':
      return `${(value * 100).toFixed(0)}% of the pool changed state recently`;
    default:
      return `${key}: ${value.toFixed(2)}`;
  }
}
