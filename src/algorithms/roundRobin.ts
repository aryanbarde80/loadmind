import type { AlgorithmDefinition } from './types';

/**
 * Round Robin — the canonical static algorithm.
 *
 * Each upstream is handed requests in strict rotation. It is perfectly fair
 * when servers are homogeneous and requests cost the same, and completely
 * blind when they are not.
 */
export const roundRobin: AlgorithmDefinition = {
  id: 'round-robin',
  name: 'Round Robin',
  short: 'RR',
  family: 'static',
  tagline: 'One request to each upstream, in order, forever.',
  howItWorks:
    'The balancer keeps a single cursor over the upstream list. Every inbound request advances the cursor by one (wrapping at the end), so over N requests each of the N servers receives exactly N/N of the traffic — regardless of how loaded, slow, or unhealthy any of them is.',
  whyUseful:
    'It is O(1), stateless, trivially predictable and impossible to game. When your fleet is homogeneous and requests are uniform it is genuinely hard to beat, and its predictability makes capacity planning easy.',
  advantages: [
    'O(1) per request with no coordination between balancers',
    'Perfectly even distribution for identical servers',
    'No hot keys, no affinity state, no memory growth',
    'Behaviour is fully predictable — great for reproducible tests',
  ],
  limitations: [
    'Ignores server capacity, health and current load entirely',
    'A single slow server becomes a latency floor for 1/N of all traffic',
    'Heavy requests are treated the same as cheap ones',
    'No session affinity — sticky sessions need another mechanism',
  ],
  bestFor: ['Homogeneous fleets', 'Uniform request cost', 'Predictable capacity planning'],
  complexity: 'O(1) time · O(1) space',
  stateless: true,
  createState: () => ({ cursor: 0 }),
  select(ctx) {
    if (ctx.candidates.length === 0) return null;
    const n = ctx.servers.length;
    let cursor = (ctx.state.cursor as number) ?? 0;
    const alive = new Set(ctx.candidates);
    for (let step = 0; step < n; step++) {
      const idx = (cursor + step) % n;
      if (alive.has(idx)) {
        ctx.state.cursor = (idx + 1) % n;
        return idx;
      }
    }
    return null;
  },
  explain(ctx) {
    if (ctx.candidates.length === 0) return 'No upstreams are currently available.';
    const next = ((ctx.state.cursor as number) ?? 0) % ctx.servers.length;
    const alive = new Set(ctx.candidates);
    if (alive.has(next)) {
      return `Next in rotation: ${ctx.servers[next].name}. Rotation ignores load, so this holds even when that server is the busiest in the pool.`;
    }
    const target = ctx.candidates.find((i) => i >= next) ?? ctx.candidates[0];
    return `Cursor points at a down upstream, skipping ahead to ${ctx.servers[target].name}.`;
  },
};
