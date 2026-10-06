import { fnv1a } from '@/lib/rng';
import type { AlgorithmDefinition } from './types';

/**
 * IP Hash — deterministic session affinity.
 *
 * `hash(clientIp) % N` gives every client a fixed upstream, which gives you
 * free session stickiness without cookies or a shared session store.
 */
export const ipHash: AlgorithmDefinition = {
  id: 'ip-hash',
  name: 'IP Hash',
  short: 'IP',
  family: 'affinity',
  tagline: 'The same client always lands on the same server.',
  howItWorks:
    'The client IP is hashed with FNV-1a and reduced modulo the number of healthy upstreams. The same IP therefore always maps to the same server, giving sticky sessions for free. When the chosen server is down the balancer re-probes forward through the pool until it finds a live node.',
  whyUseful:
    'Legacy applications that keep session state in process memory, caches that benefit from client locality, and rate limiting per client all want a stable mapping. IP hash delivers that with zero state on the balancer.',
  advantages: [
    'Session affinity with no cookies, no shared session store',
    'Excellent cache locality per client',
    'O(1) and stateless — any balancer computes the same answer',
  ],
  limitations: [
    'Changing the pool size remaps almost every client (thundering rehash)',
    'Clients behind NAT or a corporate proxy appear as one giant client',
    'Completely ignores load — a hot client sticks to a hot server',
    'Uneven client populations produce badly skewed distribution',
  ],
  bestFor: ['Stateful / sticky sessions', 'Per-client caching', 'Client-scoped rate limiting'],
  complexity: 'O(1) time · O(1) space',
  stateless: true,
  createState: () => ({}),
  select(ctx) {
    const { servers, candidates } = ctx;
    if (candidates.length === 0) return null;
    const h = fnv1a(ctx.request.clientIp);
    const start = h % candidates.length;
    // The chosen slot is down: probe forward for the next live upstream.
    const alive = new Set(candidates);
    for (let step = 0; step < servers.length; step++) {
      const idx = candidates[(start + step) % candidates.length];
      if (alive.has(idx)) return idx;
    }
    return candidates[start] ?? null;
  },
  explain(ctx) {
    if (ctx.candidates.length === 0) return 'No upstreams are currently available.';
    const h = fnv1a(ctx.request.clientIp);
    const start = h % ctx.candidates.length;
    return `hash(${ctx.request.clientIp}) mod ${ctx.candidates.length} = ${start}, so this client is pinned to ${ctx.servers[ctx.candidates[start]].name} for the lifetime of the pool.`;
  },
};
