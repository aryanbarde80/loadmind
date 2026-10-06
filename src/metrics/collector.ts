import { jainIndex, gini, mean, percentile, pushBounded, clamp01 } from '@/lib/math';
import { offeredUtilisation } from '@/simulation/serverModel';
import type {
  DistributionBucket,
  MetricsSnapshot,
  RequestOutcome,
  ServerState,
  SeriesPoint,
} from '@/types';

const LATENCY_RESERVOIR = 1500;
const SERIES_LIMIT = 180;

/**
 * Rolling metrics store.
 *
 * Percentiles are computed from a bounded reservoir of recent latency samples
 * (nearest-rank), so memory stays flat no matter how long the simulation runs.
 */
export class MetricsCollector {
  private latencySamples: number[] = [];
  private perServerSamples = new Map<string, number[]>();
  private perServerCounts = new Map<string, { received: number; errors: number }>();

  totalRequests = 0;
  completed = 0;
  succeeded = 0;
  failed = 0;
  dropped = 0;
  maxLatencyMs = 0;
  /** Timestamps (sim seconds) of completions in the last throughput window. */
  private completionTimes: number[] = [];
  private arrivalTimes: number[] = [];

  series: SeriesPoint[] = [];

  reset(): void {
    this.latencySamples = [];
    this.perServerSamples.clear();
    this.perServerCounts.clear();
    this.completionTimes = [];
    this.arrivalTimes = [];
    this.series = [];
    this.totalRequests = 0;
    this.completed = 0;
    this.succeeded = 0;
    this.failed = 0;
    this.dropped = 0;
    this.maxLatencyMs = 0;
  }

  recordArrival(t: number): void {
    this.totalRequests += 1;
    pushBounded(this.arrivalTimes, t, 4000);
  }

  recordDispatch(serverId: string | null): void {
    if (!serverId) {
      this.dropped += 1;
      return;
    }
    const entry = this.perServerCounts.get(serverId) ?? { received: 0, errors: 0 };
    entry.received += 1;
    this.perServerCounts.set(serverId, entry);
  }

  recordCompletion(serverId: string, latencyMs: number, outcome: RequestOutcome, t: number): void {
    this.completed += 1;
    pushBounded(this.completionTimes, t, 4000);
    pushBounded(this.latencySamples, latencyMs, LATENCY_RESERVOIR);
    pushBounded(this.perServerSamples.get(serverId) ?? this.initServer(serverId), latencyMs, 400);
    if (outcome === 'success') this.succeeded += 1;
    else this.failed += 1;
    if (latencyMs > this.maxLatencyMs) this.maxLatencyMs = latencyMs;
    const entry = this.perServerCounts.get(serverId) ?? { received: 0, errors: 0 };
    if (outcome !== 'success') entry.errors += 1;
    this.perServerCounts.set(serverId, entry);
  }

  private initServer(serverId: string): number[] {
    const arr: number[] = [];
    this.perServerSamples.set(serverId, arr);
    return arr;
  }

  serverLatency(serverId: string): number {
    const samples = this.perServerSamples.get(serverId);
    return samples && samples.length ? mean(samples.slice(-120)) : 0;
  }

  serverPercentile(serverId: string, p: number): number {
    const samples = this.perServerSamples.get(serverId);
    return samples && samples.length ? percentile(samples, p) : 0;
  }

  serverErrors(serverId: string): number {
    return this.perServerCounts.get(serverId)?.errors ?? 0;
  }

  serverReceived(serverId: string): number {
    return this.perServerCounts.get(serverId)?.received ?? 0;
  }

  get avgLatencyMs(): number {
    return this.latencySamples.length ? mean(this.latencySamples) : 0;
  }

  get p50Ms(): number {
    return percentile(this.latencySamples, 50);
  }

  get p95Ms(): number {
    return percentile(this.latencySamples, 95);
  }

  get p99Ms(): number {
    return percentile(this.latencySamples, 99);
  }

  /** Completions per second over the trailing window. */
  throughput(simTime: number, windowSec = 1): number {
    return this.rateOver(this.completionTimes, simTime, windowSec);
  }

  arrivalRate(simTime: number, windowSec = 1): number {
    return this.rateOver(this.arrivalTimes, simTime, windowSec);
  }

  private rateOver(times: number[], simTime: number, windowSec: number): number {
    if (times.length === 0) return 0;
    const cutoff = simTime - windowSec;
    let count = 0;
    for (let i = times.length - 1; i >= 0; i--) {
      if (times[i] < cutoff) break;
      count += 1;
    }
    return count / windowSec;
  }

  distribution(servers: readonly ServerState[]): DistributionBucket[] {
    const total = servers.reduce((acc, s) => acc + (this.perServerCounts.get(s.id)?.received ?? 0), 0);
    return servers.map((server) => {
      const count = this.perServerCounts.get(server.id)?.received ?? 0;
      return {
        serverId: server.id,
        name: server.name,
        count,
        share: total > 0 ? count / total : 0,
        errors: this.perServerCounts.get(server.id)?.errors ?? 0,
        latencyMs: server.ewmaLatencyMs,
        connections: server.activeConnections,
        cpu: server.cpu,
        status: server.status,
        weight: server.weight,
      };
    });
  }

  pushSeries(point: SeriesPoint): void {
    pushBounded(this.series, point, SERIES_LIMIT);
  }

  snapshot(servers: readonly ServerState[], simTime: number): MetricsSnapshot {
    const alive = servers.filter((s) => !s.down);
    const connections = servers.map((s) => s.activeConnections);
    const shares = servers.map((s) => this.perServerCounts.get(s.id)?.received ?? 0);
    const peak = connections.length ? Math.max(...connections) : 0;
    const avgConn = connections.length ? connections.reduce((a, b) => a + b, 0) / connections.length : 0;
    return {
      simTime,
      totalRequests: this.totalRequests,
      completed: this.completed,
      succeeded: this.succeeded,
      failed: this.failed,
      throughput: this.throughput(simTime),
      arrivalRate: this.arrivalRate(simTime),
      avgLatencyMs: this.avgLatencyMs,
      p50Ms: this.p50Ms,
      p95Ms: this.p95Ms,
      p99Ms: this.p99Ms,
      maxLatencyMs: this.maxLatencyMs,
      errorRate: this.completed > 0 ? this.failed / this.completed : 0,
      fairness: jainIndex(shares),
      gini: gini(shares),
      imbalance: avgConn > 0 ? peak / avgConn : 1,
      poolCpu: servers.length ? servers.reduce((a, b) => a + b.cpu, 0) / servers.length : 0,
      poolMemory: servers.length ? servers.reduce((a, b) => a + b.memory, 0) / servers.length : 0,
      saturation: alive.length ? mean(alive.map(offeredUtilisation)) : 0,
      healthyCount: alive.filter((s) => s.status === 'healthy').length,
      warningCount: alive.filter((s) => s.status === 'warning').length,
      downCount: servers.filter((s) => s.down).length,
    };
  }

  /** Share of traffic held by the single busiest upstream (0..1). */
  hotSpotShare(servers: readonly ServerState[]): number {
    const shares = servers.map((s) => this.perServerCounts.get(s.id)?.received ?? 0);
    const total = shares.reduce((a, b) => a + b, 0);
    if (total === 0) return 0;
    return clamp01(Math.max(...shares) / total);
  }
}
