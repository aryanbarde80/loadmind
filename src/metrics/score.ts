import { clamp, scoreBand } from '@/lib/math';

/**
 * Composite scoring used by Battle Mode and the Performance Lab.
 *
 * A single number is useless unless you can see where it came from, so the
 * breakdown is returned alongside the score and rendered in the UI.
 */

export interface ScoreInput {
  avgLatencyMs: number;
  p95Ms: number;
  errorRate: number;
  throughput: number;
  fairness: number;
  cpu: number;
  maxUtilization: number;
  /** Reference throughput used to normalise the throughput component. */
  referenceThroughput: number;
}

export interface ScoreBreakdown {
  score: number;
  parts: { key: string; label: string; value: number; weight: number; points: number; detail: string }[];
}

const WEIGHTS = {
  latency: 0.3,
  p95: 0.22,
  errors: 0.24,
  throughput: 0.12,
  fairness: 0.06,
  efficiency: 0.06,
};

export function compositeScore(input: ScoreInput): ScoreBreakdown {
  const latencyScore = scoreBand(input.avgLatencyMs, 40, 600);
  const p95Score = scoreBand(input.p95Ms, 80, 1200);
  const errorScore = scoreBand(input.errorRate, 0, 0.25);
  const throughputScore = scoreBand(
    input.throughput,
    input.referenceThroughput * 0.5,
    input.referenceThroughput * 1.15,
    false,
  );
  const fairnessScore = clamp(input.fairness * 100, 0, 100);
  // Efficiency: high utilisation is good, but saturation beyond 0.95 is bad.
  const efficiencyScore =
    input.maxUtilization <= 0.95
      ? clamp(input.maxUtilization * 100, 0, 100)
      : clamp(100 - (input.maxUtilization - 0.95) * 600, 0, 100);

  const parts = [
    {
      key: 'latency',
      label: 'Average latency',
      value: input.avgLatencyMs,
      weight: WEIGHTS.latency,
      points: latencyScore * WEIGHTS.latency,
      detail: `${input.avgLatencyMs.toFixed(1)}ms average response time`,
    },
    {
      key: 'p95',
      label: 'Tail latency (p95)',
      value: input.p95Ms,
      weight: WEIGHTS.p95,
      points: p95Score * WEIGHTS.p95,
      detail: `${input.p95Ms.toFixed(0)}ms at the 95th percentile`,
    },
    {
      key: 'errors',
      label: 'Error rate',
      value: input.errorRate,
      weight: WEIGHTS.errors,
      points: errorScore * WEIGHTS.errors,
      detail: `${(input.errorRate * 100).toFixed(2)}% of requests failed`,
    },
    {
      key: 'throughput',
      label: 'Throughput',
      value: input.throughput,
      weight: WEIGHTS.throughput,
      points: throughputScore * WEIGHTS.throughput,
      detail: `${input.throughput.toFixed(0)} req/s completed`,
    },
    {
      key: 'fairness',
      label: 'Distribution fairness',
      value: input.fairness,
      weight: WEIGHTS.fairness,
      points: fairnessScore * WEIGHTS.fairness,
      detail: `Jain's index ${input.fairness.toFixed(3)} across the pool`,
    },
    {
      key: 'efficiency',
      label: 'Capacity efficiency',
      value: input.maxUtilization,
      weight: WEIGHTS.efficiency,
      points: efficiencyScore * WEIGHTS.efficiency,
      detail: `busiest server at ${(input.maxUtilization * 100).toFixed(0)}% of capacity`,
    },
  ];

  const score = parts.reduce((acc, p) => acc + p.points, 0);
  return { score: clamp(score, 0, 100), parts };
}

/** Human-readable winner citation used in battle results. */
export function winnerCitation(
  winner: { name: string; avgLatencyMs: number; p95Ms: number; errorRate: number; fairness: number },
  runnerUp: { name: string; avgLatencyMs: number } | undefined,
): string {
  const bits: string[] = [];
  if (runnerUp && runnerUp.avgLatencyMs > 0) {
    const delta = ((runnerUp.avgLatencyMs - winner.avgLatencyMs) / runnerUp.avgLatencyMs) * 100;
    if (delta > 1) bits.push(`${delta.toFixed(0)}% lower average latency than ${runnerUp.name}`);
  }
  if (winner.errorRate < 0.005) bits.push('near-zero error rate');
  else bits.push(`${(winner.errorRate * 100).toFixed(2)}% error rate`);
  if (winner.fairness > 0.97) bits.push('an almost perfectly even distribution');
  bits.push(`p95 held at ${winner.p95Ms.toFixed(0)}ms`);
  return `Best overall performance under this traffic pattern — ${bits.join(', ')}.`;
}
