import type { AlgorithmDefinition } from './types';

/**
 * Weighted Random — probabilistic selection.
 *
 * With enough samples randomised selection converges on the same fairness as
 * round robin, needs no shared cursor, and is remarkably robust in practice.
 */
export const randomAlgorithm: AlgorithmDefinition = {
  id: 'random',
  name: 'Random',
  short: 'RND',
  family: 'static',
  tagline: 'Let probability do the scheduling.',
  howItWorks:
    'Each request draws an upstream from a weighted distribution. In LoadMind the weight is the server weight multiplied by a health factor (based on error rate and CPU headroom), so sick servers receive proportionally less traffic without being ejected outright.',
  whyUseful:
    'Randomised balancing needs no coordination and no shared state, which makes it the natural choice when many independent balancers (sidecars, clients, edge nodes) must each make their own decisions. Power-of-two-choices variants built on it are famously close to optimal.',
  advantages: [
    'No shared state — scales to any number of independent balancers',
    'Statistically fair at high request rates',
    'Naturally tolerant to stale or missing telemetry',
  ],
  limitations: [
    'Distribution is only fair in expectation — short bursts skew',
    'Blind to latency and connection depth',
    'Harder to reason about during incident review',
    'Needs a good RNG (a bad one creates hot spots)',
  ],
  bestFor: ['Client-side / sidecar balancing', 'Very large pools', 'Stale telemetry environments'],
  complexity: 'O(n) time · O(1) space',
  stateless: true,
  createState: () => ({}),
  select(ctx) {
    const { servers, candidates, rng } = ctx;
    if (candidates.length === 0) return null;
    const weights = candidates.map((i) => {
      const s = servers[i];
      const health = (1 - Math.min(0.95, s.errorRate * 6)) * (1 - Math.min(0.8, Math.max(0, s.cpu - 70) / 100));
      return Math.max(0.05, s.weight * Math.max(0.05, health));
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rng.next() * total;
    for (let i = 0; i < candidates.length; i++) {
      r -= weights[i];
      if (r <= 0) return candidates[i];
    }
    return candidates[candidates.length - 1];
  },
  explain(ctx) {
    if (ctx.candidates.length === 0) return 'No upstreams are currently available.';
    const weights = ctx.candidates.map((i) => {
      const s = ctx.servers[i];
      const health =
        (1 - Math.min(0.95, s.errorRate * 6)) * (1 - Math.min(0.8, Math.max(0, s.cpu - 70) / 100));
      return Math.max(0.05, s.weight * Math.max(0.05, health));
    });
    const total = weights.reduce((a, b) => a + b, 0);
    const shares = ctx.candidates
      .map((idx, i) => `${ctx.servers[idx].name} ${((weights[i] / total) * 100).toFixed(0)}%`)
      .join(', ');
    return `Weighted lottery over ${ctx.candidates.length} upstreams: ${shares}. Sick servers get smaller tickets rather than being removed.`;
  },
};
