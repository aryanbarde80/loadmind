import type { AlgorithmDefinition, AlgorithmContext } from './types';

/**
 * Weighted Round Robin — smooth (LVS/nginx style) interleaving.
 *
 * Instead of emitting runs like A A A B C, the smooth variant interleaves
 * picks so that the weighted share is reached with minimal burstiness.
 */
export const weightedRoundRobin: AlgorithmDefinition = {
  id: 'weighted-round-robin',
  name: 'Weighted Round Robin',
  short: 'WRR',
  family: 'static',
  tagline: 'Round robin, but big servers get a bigger slice.',
  howItWorks:
    'Every upstream carries a weight (relative capacity). Using the smooth weighted round robin scheme, each selection adds each server\'s weight to its running credit, picks the server with the highest credit, then subtracts the total weight from the winner. The result is an interleaved sequence that matches the weight ratio without long runs to a single node.',
  whyUseful:
    'Real fleets are rarely homogeneous. Weights let you send 3× more traffic to a 3× bigger box (or gently bleed traffic into a canary) while keeping the O(1) simplicity of round robin.',
  advantages: [
    'Still O(1) per request, no shared state required',
    'Interleaved output avoids the burstiness of naive weight expansion',
    'Great for mixed instance sizes and canary traffic shaping',
  ],
  limitations: [
    'Weights are static — they do not react to real-time load',
    'A weighted-but-sick server keeps receiving its full share',
    'Requires operators to keep weights aligned with real capacity',
    'Uneven weights reduce effective peak capacity during spikes',
  ],
  bestFor: ['Mixed instance sizes', 'Canary / staged rollouts', 'Known static capacity ratios'],
  complexity: 'O(n) time · O(n) space',
  stateless: false,
  createState: () => ({ credits: [] as number[], initialised: '' }),
  select(ctx) {
    return smoothPick(ctx);
  },
  explain(ctx) {
    const alive = ctx.candidates;
    if (alive.length === 0) return 'No upstreams are currently available.';
    const total = alive.reduce((acc, i) => acc + Math.max(0.1, ctx.servers[i].weight), 0);
    const best = alive.reduce((a, b) => (ctx.servers[b].weight > ctx.servers[a].weight ? b : a));
    return `${ctx.servers[best].name} carries the highest weight (${ctx.servers[best].weight} of ${total.toFixed(0)} total), so it receives the largest share of the rotation.`;
  },
};

function smoothPick(ctx: AlgorithmContext): number | null {
  const { servers, candidates, state } = ctx;
  if (candidates.length === 0) return null;
  const signature = servers.map((s) => `${s.id}:${s.weight}`).join('|');
  let credits = state.credits as number[];
  if (state.initialised !== signature || credits.length !== servers.length) {
    credits = servers.map(() => 0);
    state.credits = credits;
    state.initialised = signature;
  }
  const alive = new Set(candidates);
  const total = candidates.reduce((acc, i) => acc + Math.max(0.1, servers[i].weight), 0);

  let best = -1;
  let bestCredit = -Infinity;
  for (let i = 0; i < servers.length; i++) {
    if (!alive.has(i)) continue;
    credits[i] += Math.max(0.1, servers[i].weight);
    if (credits[i] > bestCredit) {
      bestCredit = credits[i];
      best = i;
    }
  }
  if (best < 0) return null;
  credits[best] -= total;
  return best;
}
