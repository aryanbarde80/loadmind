import { rankCandidates, type AlgorithmDefinition } from './types';

/**
 * Weighted Least Connections — normalises connection count by capacity.
 *
 * Chooses the upstream minimising `activeConnections / weight`, so a
 * 4x-larger box is expected to hold 4x the connections.
 */
export const weightedLeastConnections: AlgorithmDefinition = {
  id: 'weighted-least-connections',
  name: 'Weighted Least Connections',
  short: 'WLC',
  family: 'dynamic',
  tagline: 'Least busy — relative to how much work it can hold.',
  howItWorks:
    'Exactly like least connections, except the connection count is divided by the server weight before comparison. A server with weight 4 is considered "equally busy" to a weight-1 server only when it holds four times as many connections, which makes the equilibrium point match real capacity.',
  whyUseful:
    'It is the default upstream selection in LVS and HAProxy for good reason: it adapts to live conditions AND respects that your fleet is not made of identical machines.',
  advantages: [
    'Adapts to live load while respecting static capacity differences',
    'Converges to a balanced utilisation ratio instead of a balanced count',
    'Handles heterogeneous fleets without manual tuning',
  ],
  limitations: [
    'Wrong weights actively hurt — worse than plain least connections',
    'Still blind to latency and error rate',
    'Needs accurate capacity numbers from the operator',
    'Non-obvious during incidents: "why does the big box hold 400 conns?"',
  ],
  bestFor: ['Mixed instance sizes with variable load', 'Long-running requests', 'Capacity-asymmetric pools'],
  complexity: 'O(n) time · O(n) state',
  stateless: false,
  createState: () => ({}),
  select(ctx) {
    if (ctx.candidates.length === 0) return null;
    const ranked = rankCandidates(
      ctx,
      (s) => (s.activeConnections + 1) / Math.max(0.1, s.weight) + s.utilization * 0.05,
    );
    return ranked[0] ?? null;
  },
  explain(ctx) {
    if (ctx.candidates.length === 0) return 'No upstreams are currently available.';
    const ranked = rankCandidates(ctx, (s) => (s.activeConnections + 1) / Math.max(0.1, s.weight));
    const best = ctx.servers[ranked[0]];
    const ratio = (best.activeConnections + 1) / Math.max(0.1, best.weight);
    return `${best.name} has the lowest load ratio: ${best.activeConnections} connections ÷ weight ${best.weight} = ${ratio.toFixed(1)}.`;
  },
};
