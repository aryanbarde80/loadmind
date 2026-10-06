import { HashRing } from '@/lib/hashRing';
import type { AlgorithmDefinition } from './types';

/**
 * Consistent Hashing — stable affinity that survives pool changes.
 *
 * Clients (keys) and servers both land on a 2^32 ring; a key is served by the
 * next server clockwise. Adding or removing a node remaps only ~1/N of keys.
 */
export const consistentHash: AlgorithmDefinition = {
  id: 'consistent-hash',
  name: 'Consistent Hashing',
  short: 'CH',
  family: 'affinity',
  tagline: 'Sticky routing that survives servers coming and going.',
  howItWorks:
    'Each upstream is placed on a hash ring as many virtual nodes (LoadMind uses 64 × weight). A request key (here the client IP) is hashed and routed clockwise to the nearest virtual node. Because positions are independent of pool size, adding or removing a server only remaps the keys that lived in the arc it owned — roughly 1/N of traffic instead of nearly all of it.',
  whyUseful:
    'It is the answer whenever you need affinity but your pool changes: autoscaling groups, rolling deploys, sharded caches. It keeps cache hit rates high and avoids cache stampedes when capacity shifts.',
  advantages: [
    'Only ~1/N of keys remap when the pool changes',
    'Weighted virtual nodes give fine-grained capacity control',
    'Excellent cache locality and stable per-client routing',
    'Failed nodes are skipped by walking the ring forward',
  ],
  limitations: [
    'Skewed key populations still create hot spots (needs bounded loads)',
    'Ring rebuild cost on weight changes',
    'Ignores server load — a sticky hot client stays sticky',
    'Harder to debug than a simple modulo scheme',
  ],
  bestFor: ['Autoscaling pools', 'Sharded caches', 'Rolling deploys with stateful clients'],
  complexity: 'O(log v) time · O(v) space (v = virtual nodes)',
  stateless: false,
  createState: () => ({ ring: null as HashRing | null, signature: '' }),
  select(ctx) {
    const { servers, candidates, state } = ctx;
    if (candidates.length === 0) return null;
    const ring = ensureRing(state, servers.map((s) => s.id), servers.map((s) => s.name), servers.map((s) => s.weight));
    const alive = new Set(candidates);
    return ring.lookupAlive(ctx.request.clientIp, (idx) => alive.has(idx));
  },
  explain(ctx) {
    if (ctx.candidates.length === 0) return 'No upstreams are currently available.';
    const ring = ensureRing(
      ctx.state,
      ctx.servers.map((s) => s.id),
      ctx.servers.map((s) => s.name),
      ctx.servers.map((s) => s.weight),
    );
    const alive = new Set(ctx.candidates);
    const idx = ring.lookupAlive(ctx.request.clientIp, (i) => alive.has(i));
    if (idx === null) return 'Ring lookup found no live owner.';
    const owner = ring.ownership().find((o) => o.serverIndex === idx);
    return `${ctx.servers[idx].name} owns this arc of the ring${owner ? ` (${(owner.share * 100).toFixed(1)}% of keyspace, ${owner.segments} virtual segments)` : ''}. Pool changes remap only the affected arc.`;
  },
};

function ensureRing(
  state: Record<string, unknown>,
  ids: string[],
  labels: string[],
  weights: number[],
): HashRing {
  const signature = ids.map((id, i) => `${id}:${weights[i]}`).join('|');
  let ring = state.ring as HashRing | null;
  if (!ring || state.signature !== signature) {
    ring = new HashRing(
      ids.map((_, i) => i),
      labels,
      weights,
    );
    state.ring = ring;
    state.signature = signature;
  }
  return ring;
}
