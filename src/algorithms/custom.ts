import type { AlgorithmDefinition, AlgorithmContext, AlgorithmState } from './types';

/**
 * Custom algorithm sandbox.
 *
 * Users write a `selectServer(servers, request, state)` function in the
 * playground. We compile it with `new Function`, validate the return value,
 * and wrap it in an `AlgorithmDefinition` so it plugs straight into the
 * engine, battle mode and the metrics pipeline like any built-in.
 */

export interface CompiledCustom {
  definition: AlgorithmDefinition;
  source: string;
}

export class CustomAlgorithmError extends Error {
  constructor(message: string, readonly phase: 'compile' | 'runtime' = 'compile') {
    super(message);
    this.name = 'CustomAlgorithmError';
  }
}

export const CUSTOM_TEMPLATE = `// LoadMind custom algorithm
// Return the server you want, or its index.
//   servers  -> [{ id, name, weight, capacity, cpu, memory,
//                  activeConnections, ewmaLatencyMs, errorRate,
//                  utilization, status, down, requestsReceived }]
//   request  -> { id, clientIp, path, cost, seq, arrivalTime }
//   state    -> a persistent object you can use for counters/cursors
//
// Tip: always filter out down servers.

function selectServer(servers, request, state) {
  const healthy = servers.filter((s) => !s.down);
  if (healthy.length === 0) return null;

  // Pick the healthy server with the lowest latency x (connections + 1)
  return healthy.reduce((best, server) => {
    const score = (s) => s.ewmaLatencyMs * (s.activeConnections + 1);
    return score(server) < score(best) ? server : best;
  });
}
`;

export const CUSTOM_EXAMPLES: { name: string; code: string }[] = [
  {
    name: 'Lowest latency wins',
    code: `function selectServer(servers, request, state) {
  const healthy = servers.filter((s) => !s.down);
  if (!healthy.length) return null;
  return healthy.reduce((best, s) =>
    s.ewmaLatencyMs < best.ewmaLatencyMs ? s : best
  );
}`,
  },
  {
    name: 'Power of two choices',
    code: `function selectServer(servers, request, state) {
  const healthy = servers.filter((s) => !s.down);
  if (!healthy.length) return null;
  // Sample two at random, keep the less loaded one.
  const a = healthy[Math.floor(Math.random() * healthy.length)];
  const b = healthy[Math.floor(Math.random() * healthy.length)];
  return a.activeConnections <= b.activeConnections ? a : b;
}`,
  },
  {
    name: 'CPU-aware with failover',
    code: `function selectServer(servers, request, state) {
  const healthy = servers.filter((s) => !s.down && s.cpu < 92);
  const pool = healthy.length ? healthy : servers.filter((s) => !s.down);
  if (!pool.length) return null;
  return pool.reduce((best, s) => {
    const load = (s.activeConnections + 1) / s.weight + s.cpu / 25;
    const bestLoad = (best.activeConnections + 1) / best.weight + best.cpu / 25;
    return load < bestLoad ? s : best;
  });
}`,
  },
  {
    name: 'Sticky by client (own hash)',
    code: `function selectServer(servers, request, state) {
  const healthy = servers.filter((s) => !s.down);
  if (!healthy.length) return null;
  let h = 2166136261;
  for (let i = 0; i < request.clientIp.length; i++) {
    h ^= request.clientIp.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return healthy[Math.abs(h) % healthy.length];
}`,
  },
];

export function compileCustomAlgorithm(
  id: string,
  name: string,
  code: string,
): CompiledCustom {
  let factory: unknown;
  try {
    // eslint-disable-next-line no-new-func
    factory = new Function(
      `"use strict";\n${code}\n;return typeof selectServer === "function" ? selectServer : null;`,
    )();
  } catch (error) {
    throw new CustomAlgorithmError(`Syntax error: ${(error as Error).message}`);
  }
  if (typeof factory !== 'function') {
    throw new CustomAlgorithmError(
      'No selectServer function found. Define `function selectServer(servers, request, state) { ... }`.',
    );
  }

  const selectServer = factory as (
    servers: unknown[],
    request: unknown,
    state: Record<string, unknown>,
  ) => unknown;

  // Smoke-test the function against a synthetic pool so failures surface at
  // compile time with a useful message rather than mid-simulation.
  const probe = [
    { id: 'probe-a', name: 'PROBE-A', weight: 1, capacity: 100, cpu: 10, memory: 20, activeConnections: 1, ewmaLatencyMs: 40, errorRate: 0, utilization: 0.1, status: 'healthy', down: false, requestsReceived: 1 },
    { id: 'probe-b', name: 'PROBE-B', weight: 2, capacity: 200, cpu: 50, memory: 40, activeConnections: 9, ewmaLatencyMs: 80, errorRate: 0.01, utilization: 0.4, status: 'healthy', down: false, requestsReceived: 9 },
  ];
  let probeResult: unknown;
  try {
    probeResult = selectServer(probe, { id: 1, clientIp: '10.0.0.1', path: '/api', cost: 1, seq: 1, arrivalTime: 0 }, {});
  } catch (error) {
    throw new CustomAlgorithmError(`Runtime error on first call: ${(error as Error).message}`);
  }
  if (probeResult !== null && typeof probeResult !== 'object' && typeof probeResult !== 'number' && typeof probeResult !== 'string') {
    throw new CustomAlgorithmError(
      `selectServer returned ${typeof probeResult}. Return a server object, a server id, or an index.`,
    );
  }

  const definition: AlgorithmDefinition = {
    id,
    name,
    short: 'CUSTOM',
    family: 'adaptive',
    tagline: 'Your own selection strategy.',
    howItWorks:
      'This algorithm was written in the LoadMind playground. It receives the live pool (cpu, memory, connections, latency, error rate, utilisation, health), the inbound request, and a persistent state object, and returns the upstream to use.',
    whyUseful:
      'Custom strategies let you test hypotheses that no built-in covers — combining signals, adding hysteresis, or implementing research papers like power-of-two-choices.',
    advantages: ['Full access to every published metric', 'Persistent state for counters and cursors', 'Runs through the identical simulation used by built-ins'],
    limitations: ['Executed in the page context — treat it as your own code', 'No network or I/O access', 'Must be O(n) or better to stay realistic'],
    bestFor: ['Research', 'Novel heuristics', 'Testing your own ideas'],
    complexity: 'depends on your implementation',
    stateless: true,
    createState: (): AlgorithmState => ({ user: {} as Record<string, unknown> }),
    select(ctx: AlgorithmContext): number | null {
      const servers = ctx.servers.map((s) => toPublicServer(s));
      const request = {
        id: ctx.request.id,
        clientIp: ctx.request.clientIp,
        path: ctx.request.path,
        cost: ctx.request.cost,
        seq: ctx.request.seq,
        arrivalTime: ctx.request.arrivalTime,
      };
      const userState = (ctx.state.user as Record<string, unknown>) ?? {};
      ctx.state.user = userState;
      let result: unknown;
      try {
        result = selectServer(servers, request, userState);
      } catch (error) {
        throw new CustomAlgorithmError(
          `Runtime error: ${(error as Error).message}`,
          'runtime',
        );
      }
      return resolveChoice(ctx, result);
    },
    explain: () => 'Custom algorithm supplied from the LoadMind playground.',
  };

  return { definition, source: code };
}

function resolveChoice(ctx: AlgorithmContext, result: unknown): number | null {
  const { servers, candidates } = ctx;
  if (result === null || result === undefined) return null;
  if (typeof result === 'number') {
    if (!Number.isFinite(result)) return null;
    const idx = Math.round(result);
    if (idx >= 0 && idx < servers.length && !servers[idx].down) return idx;
    // Out-of-range index: fall back to the least-loaded candidate.
    return candidates[0] ?? null;
  }
  if (typeof result === 'string') {
    const idx = servers.findIndex((s) => s.id === result || s.name === result);
    if (idx >= 0 && !servers[idx].down) return idx;
    return candidates[0] ?? null;
  }
  if (typeof result === 'object') {
    const id = (result as { id?: string; name?: string }).id ?? (result as { name?: string }).name;
    const idx = servers.findIndex((s) => s.id === id || s.name === id);
    if (idx >= 0 && !servers[idx].down) return idx;
    return candidates[0] ?? null;
  }
  return candidates[0] ?? null;
}

function toPublicServer(server: AlgorithmContext['servers'][number]) {
  return {
    id: server.id,
    name: server.name,
    weight: server.weight,
    capacity: server.capacity,
    cpu: server.cpu,
    memory: server.memory,
    activeConnections: server.activeConnections,
    ewmaLatencyMs: server.ewmaLatencyMs,
    errorRate: server.errorRate,
    utilization: server.utilization,
    rps: server.rps,
    status: server.status,
    down: server.down,
    requestsReceived: server.requestsReceived,
    requestsFailed: server.requestsFailed,
    latencyPenaltyMs: server.latencyPenaltyMs,
  };
}
