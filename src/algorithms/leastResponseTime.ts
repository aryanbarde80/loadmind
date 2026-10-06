import { rankCandidates, type AlgorithmDefinition } from './types';

/**
 * Least Response Time (a.k.a. "least time", nginx-style).
 *
 * Combines observed latency with in-flight depth:
 *   score = avgLatency × (activeConnections + 1)
 * which naturally penalises servers that are both slow and busy.
 */
export const leastResponseTime: AlgorithmDefinition = {
  id: 'least-response-time',
  name: 'Least Response Time',
  short: 'LRT',
  family: 'dynamic',
  tagline: 'Route to the fastest server, weighted by how busy it is.',
  howItWorks:
    'The balancer maintains an exponentially-weighted moving average of each upstream\'s response time and multiplies it by (activeConnections + 1). The product is a crude but effective estimate of "how long will this request take if I send it here", and the minimum wins. The +1 keeps an idle-but-slowly-warming server from hoarding traffic.',
  whyUseful:
    'Latency is what users actually feel. When one node degrades — noisy neighbour, cold cache, GC pause, failing disk — least response time detects it within a few requests and drains traffic away, which is exactly the behaviour you want during a partial outage.',
  advantages: [
    'Directly optimises the metric users care about: latency',
    'Detects and routes around degrading nodes in seconds',
    'Combines speed and depth, so it avoids slow-and-busy servers hardest',
  ],
  limitations: [
    'Needs warm-up: EWMA is unreliable right after start-up or scaling',
    'Can oscillate if the EWMA alpha is too aggressive',
    'Does not consider error rate or health signals explicitly',
    'Every balancer needs its own telemetry (no shared truth)',
  ],
  bestFor: ['Latency-sensitive APIs', 'Partial degradations', 'Auto-scaling fleets with warm-up'],
  complexity: 'O(n) time · O(n) state',
  stateless: false,
  createState: () => ({}),
  select(ctx) {
    if (ctx.candidates.length === 0) return null;
    const ranked = rankCandidates(ctx, (s) => score(s.ewmaLatencyMs + s.latencyPenaltyMs, s.activeConnections));
    return ranked[0] ?? null;
  },
  explain(ctx) {
    if (ctx.candidates.length === 0) return 'No upstreams are currently available.';
    const ranked = rankCandidates(ctx, (s) => score(s.ewmaLatencyMs + s.latencyPenaltyMs, s.activeConnections));
    const best = ctx.servers[ranked[0]];
    const worst = ctx.servers[ranked[ranked.length - 1]];
    const delta = (worst.ewmaLatencyMs + worst.latencyPenaltyMs) - (best.ewmaLatencyMs + best.latencyPenaltyMs);
    return `${best.name} wins on latency×depth (${best.ewmaLatencyMs.toFixed(0)}ms × ${best.activeConnections + 1}). Slowest is ${worst.name} at ${worst.ewmaLatencyMs.toFixed(0)}ms — ${delta > 0 ? `${delta.toFixed(0)}ms worse` : 'no spread'}.`;
  },
};

function score(latencyMs: number, connections: number): number {
  return Math.max(1, latencyMs) * (connections + 1);
}
