import { clamp, ema } from '@/lib/math';
import type { Rng } from '@/lib/rng';
import type { ChaosState, ServerConfig, ServerState } from '@/types';

/**
 * Backend pool model.
 *
 * Servers are deliberately heterogeneous: real fleets contain mixed instance
 * types, older hardware and noisy neighbours. That heterogeneity is what makes
 * algorithm choice matter — with identical servers, every static algorithm
 * performs the same.
 */

const NAME_POOL = [
  'edge-01',
  'edge-02',
  'core-03',
  'core-04',
  'compute-05',
  'compute-06',
  'cache-07',
  'cache-08',
  'api-09',
  'api-10',
  'gpu-11',
  'batch-12',
];

/** Instance "shapes" — each has a capacity / speed / efficiency profile. */
const SHAPES = [
  { label: 'c6g.large', capacity: [70, 100], latency: [70, 105], cpuPerRequest: 1.15, weight: 1 },
  { label: 'c6g.xlarge', capacity: [120, 165], latency: [52, 78], cpuPerRequest: 0.95, weight: 2 },
  { label: 'm6i.xlarge', capacity: [95, 135], latency: [62, 96], cpuPerRequest: 1.05, weight: 2 },
  { label: 'r6g.2xlarge', capacity: [150, 210], latency: [45, 70], cpuPerRequest: 0.85, weight: 3 },
  { label: 't3.medium', capacity: [45, 70], latency: [95, 145], cpuPerRequest: 1.35, weight: 1 },
] as const;

export function createServerConfigs(count: number, rng: Rng): ServerConfig[] {
  const configs: ServerConfig[] = [];
  for (let i = 0; i < count; i++) {
    const shape = i === 0 ? SHAPES[1] : SHAPES[rng.int(0, SHAPES.length - 1)];
    const capacity = Math.round(rng.range(shape.capacity[0], shape.capacity[1]));
    const baseLatencyMs = Math.round(rng.range(shape.latency[0], shape.latency[1]));
    const weight =
      shape.weight * (baseLatencyMs > 110 ? 0.5 : baseLatencyMs > 85 ? 0.75 : 1) || 1;
    configs.push({
      id: `srv-${i + 1}`,
      name: NAME_POOL[i % NAME_POOL.length].toUpperCase(),
      weight: Math.max(1, Math.round(weight * 10) / 10),
      capacity,
      baseLatencyMs,
      jitterMs: Math.round(baseLatencyMs * rng.range(0.08, 0.22)),
      baseErrorRate: rng.range(0.0004, 0.004),
      cpuPerRequest: shape.cpuPerRequest,
    });
  }
  return configs;
}

export function createServerStates(configs: ServerConfig[], rng: Rng): ServerState[] {
  return configs.map((config) => ({
    ...config,
    status: 'healthy' as const,
    down: false,
    cpu: rng.range(8, 22),
    memory: rng.range(24, 42),
    activeConnections: 0,
    ewmaLatencyMs: config.baseLatencyMs,
    rps: 0,
    offeredRps: 0,
    arrivalsThisStep: 0,
    errorRate: config.baseErrorRate,
    utilization: 0,
    requestsReceived: 0,
    requestsSucceeded: 0,
    requestsFailed: 0,
    latencyPenaltyMs: 0,
    errorPenalty: 0,
    capacityFactor: 1,
    recoveryIn: null,
    lastLatencyMs: config.baseLatencyMs,
    latencySamples: [],
  }));
}

/**
 * Offered-load utilisation (0..1+): how close this upstream is to its
 * queueing cliff, computed as `arrivalRate x serviceTime / slots`.
 *
 * This is the metric that predicts queueing. Concurrency/capacity is useful
 * for showing queue depth, but it understates pressure at low load and
 * overstates it once requests start waiting.
 */
export function offeredUtilisation(server: ServerState): number {
  const slots = Math.max(4, server.capacity * server.capacityFactor);
  // 1.26 is the mean cost multiplier of the simulated path mix.
  const serviceSec = (server.baseLatencyMs * 1.26) / 1000;
  return (server.offeredRps * serviceSec) / slots;
}

export interface ServiceEstimate {
  serviceMs: number;
  errorProbability: number;
}

/**
 * Estimate how long a request will take on a given server right now.
 *
 * Queueing model: the server exposes `capacity` concurrent slots. Offered
 * load is measured in erlangs, `a = arrivalRate x unloadedServiceTime`, and
 * utilisation is `rho = a / slots`. Waiting time then grows like M/M/c:
 *
 *     W = S / (1 - rho)            (rho -> 1 gives the classic latency cliff)
 *     L = lambda x W               (Little's law: in-service + queue depth)
 *
 * Crucially, utilisation is driven by the *arrival rate*, not by the
 * instantaneous connection count. Deriving rho from concurrency instead
 * creates a positive feedback loop with no fixed point above 25% load, which
 * makes healthy pools collapse for no physical reason.
 */
export function estimateService(
  server: ServerState,
  requestCost: number,
  rng: Rng,
): ServiceEstimate {
  const slots = Math.max(4, server.capacity * server.capacityFactor);
  // Unloaded service time for this request.
  const base = Math.max(1, server.baseLatencyMs * requestCost);
  const offered = (server.offeredRps * base) / 1000; // erlangs
  const rho = clamp(offered / slots, 0, 0.995);
  const queueFactor = 1 / Math.max(0.03, 1 - rho);

  const jitter = rng.gauss(0, server.jitterMs);
  const cpuDrag = server.cpu > 90 ? (server.cpu - 90) * 2.6 : 0;
  const serviceMs = Math.max(
    1,
    base * queueFactor + server.latencyPenaltyMs + jitter + cpuDrag,
  );

  // Errors: baseline, chaos, saturation past 95% utilisation, CPU exhaustion.
  const saturationErrors = rho > 1 ? Math.min(0.65, (rho - 1) * 1.2) : rho > 0.95 ? (rho - 0.95) * 0.6 : 0;
  const cpuErrors = server.cpu > 95 ? 0.05 : 0;
  const errorProbability = Math.min(
    0.9,
    server.baseErrorRate + server.errorPenalty + saturationErrors + cpuErrors,
  );

  return { serviceMs, errorProbability };
}

/** Advance a server's resource telemetry after a tick. */
export function updateServerTelemetry(server: ServerState, dt: number, rng: Rng, simTime: number): void {
  const effectiveCapacity = Math.max(4, server.capacity * server.capacityFactor);
  const load = server.activeConnections / effectiveCapacity;

  if (server.down) {
    server.cpu = ema(server.cpu, 0, 0.25);
    server.memory = ema(server.memory, 4, 0.05);
    server.activeConnections = 0;
    server.rps = ema(server.rps, 0, 0.4);
    server.utilization = 0;
    server.status = 'down';
    return;
  }

  // CPU tracks concurrency plus the cost of any injected latency penalty.
  const cpuTarget = clamp(
    3 + load * 92 * server.cpuPerRequest + (server.latencyPenaltyMs > 0 ? 6 : 0) + rng.gauss(0, 2.2),
    1,
    100,
  );
  server.cpu = ema(server.cpu, cpuTarget, clamp(dt * 3.2, 0.05, 0.6));

  // Memory: baseline + working set + slow sinusoidal drift (GC / cache churn).
  const memTarget = clamp(
    18 + Math.min(1.15, load) * 58 + Math.sin(simTime / 26 + server.capacity) * 5 + rng.gauss(0, 1.1),
    5,
    99,
  );
  server.memory = ema(server.memory, memTarget, clamp(dt * 1.1, 0.02, 0.3));

  // Offered load (erlangs base) is tracked from arrivals, not completions, so
  // the queueing model stays stable while still reacting within ~0.3s.
  const instantArrivals = server.arrivalsThisStep / Math.max(1e-6, dt);
  server.arrivalsThisStep = 0;
  server.offeredRps = ema(server.offeredRps, instantArrivals, clamp(dt * 4, 0.05, 0.7));
  server.utilization = load;

  server.errorRate = ema(
    server.errorRate,
    server.requestsReceived > 0 ? server.requestsFailed / server.requestsReceived : server.baseErrorRate,
    clamp(dt * 1.6, 0.02, 0.4),
  );

  if (server.cpu > 88 || server.errorRate > 0.035 || server.utilization > 0.9 || server.ewmaLatencyMs > server.baseLatencyMs * 2.4) {
    server.status = 'warning';
  } else {
    server.status = 'healthy';
  }
}

export function applyChaosToServers(servers: ServerState[], chaos: ChaosState, dt: number, rng: Rng): void {
  for (const server of servers) {
    server.latencyPenaltyMs = chaos.latencyPenalties[server.id] ?? 0;
    server.errorPenalty = chaos.errorPenalties[server.id] ?? 0;
    server.capacityFactor = 1 - (chaos.capacityReductions[server.id] ?? 0);
    const shouldBeDown = chaos.killed[server.id] === true;

    if (shouldBeDown && !server.down) {
      server.down = true;
      server.status = 'down';
      server.recoveryIn = null;
    } else if (!shouldBeDown && server.down && chaos.killed[server.id] === false) {
      server.down = false;
      server.status = 'healthy';
      server.ewmaLatencyMs = server.baseLatencyMs * 1.6;
      server.errorRate = server.baseErrorRate;
      server.requestsFailed = 0;
      server.requestsReceived = 0;
    }

    // Random failure injection (chaos monkey) with automatic recovery.
    if (chaos.randomFailures && !server.down && server.recoveryIn === null) {
      if (rng.bool(chaos.failureRatePerSec * dt)) {
        server.down = true;
        server.status = 'down';
        server.recoveryIn = rng.range(6, 18);
      }
    }

    if (server.recoveryIn !== null) {
      server.recoveryIn -= dt;
      if (server.recoveryIn <= 0) {
        server.recoveryIn = null;
        if (chaos.killed[server.id] !== true) {
          server.down = false;
          server.status = 'healthy';
          server.ewmaLatencyMs = server.baseLatencyMs * 1.8;
        }
      }
    }
  }
}
