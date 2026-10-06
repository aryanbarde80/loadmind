import { rankCandidates, type AlgorithmDefinition } from './types';

/**
 * Least Connections — the classic dynamic algorithm.
 *
 * Sends each request to whichever upstream currently holds the fewest
 * in-flight connections. Handles heterogeneous request cost well.
 */
export const leastConnections: AlgorithmDefinition = {
  id: 'least-connections',
  name: 'Least Connections',
  short: 'LC',
  family: 'dynamic',
  tagline: 'Give it to whoever is least busy right now.',
  howItWorks:
    'On every request the balancer reads the live connection count of each healthy upstream and chooses the minimum. Because a slow request occupies its connection for longer, servers that are struggling naturally accumulate connections and get avoided — without the balancer ever needing to know why.',
  whyUseful:
    'It is the cheapest way to adapt to real conditions. Long polling, streaming, uploads and any workload where requests differ wildly in duration are dramatically better served by least connections than by round robin.',
  advantages: [
    'Adapts automatically to requests of differing duration',
    'Degrades gracefully when one node slows down',
    'No configuration or weights to maintain',
  ],
  limitations: [
    'Connection count is a proxy for load, not the load itself',
    'A fast-but-saturated server and an idle one can look identical',
    'Requires shared connection state per balancer',
    'Ignores latency: a server can hold few connections and still be slow',
  ],
  bestFor: ['Long-lived connections', 'Variable request cost', 'WebSocket / streaming fleets'],
  complexity: 'O(n) time · O(n) state',
  stateless: false,
  createState: () => ({}),
  select(ctx) {
    if (ctx.candidates.length === 0) return null;
    const ranked = rankCandidates(ctx, (s) => s.activeConnections + s.utilization);
    return ranked[0] ?? null;
  },
  explain(ctx) {
    if (ctx.candidates.length === 0) return 'No upstreams are currently available.';
    const ranked = rankCandidates(ctx, (s) => s.activeConnections + s.utilization);
    const best = ctx.servers[ranked[0]];
    const worst = ctx.servers[ranked[ranked.length - 1]];
    return `${best.name} is least loaded at ${best.activeConnections} active connections (busiest: ${worst.name} at ${worst.activeConnections}).`;
  },
};
