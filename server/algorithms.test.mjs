import assert from 'node:assert/strict';
import test from 'node:test';
import { createProxyRouter, PROXY_ALGORITHM_IDS } from './algorithms.mjs';

const node = (id, patch = {}) => ({
  id,
  name: id.toUpperCase(),
  healthy: true,
  draining: false,
  weight: 1,
  inFlight: 0,
  ewmaLatencyMs: 100,
  ...patch,
});

test('proxy registry exposes eight strategies plus explainable Autopilot', () => {
  assert.equal(PROXY_ALGORITHM_IDS.length, 9);
  assert.ok(PROXY_ALGORITHM_IDS.includes('autopilot'));
  const router = createProxyRouter({ algorithm: 'autopilot' });
  const result = router.select([node('fast', { ewmaLatencyMs: 20 }), node('slow', { ewmaLatencyMs: 110 })]);
  assert.equal(result.algorithm, 'least-response-time');
  assert.match(result.reason, /latency differs/i);
  assert.match(router.getReason(), /Latency differs/);
});

test('smooth weighted round robin follows configured capacity over a cycle', () => {
  const router = createProxyRouter({ algorithm: 'weighted-round-robin' });
  const pool = [node('a', { weight: 3 }), node('b', { weight: 1 })];
  const counts = new Map();
  for (let i = 0; i < 8; i++) {
    const id = router.select(pool).node.id;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  assert.equal(counts.get('a'), 6);
  assert.equal(counts.get('b'), 2);
});

test('load, latency, health, and affinity strategies use their intended signals', () => {
  const pool = [
    node('heavy', { weight: 3, inFlight: 2, ewmaLatencyMs: 200 }),
    node('light', { weight: 1, inFlight: 1, ewmaLatencyMs: 50 }),
    node('draining', { draining: true, inFlight: 0, ewmaLatencyMs: 1 }),
  ];

  const leastConnections = createProxyRouter({ algorithm: 'least-connections' });
  assert.equal(leastConnections.select(pool).node.id, 'light');
  const weightedConnections = createProxyRouter({ algorithm: 'weighted-least-connections' });
  assert.equal(weightedConnections.select(pool).node.id, 'heavy');
  const latency = createProxyRouter({ algorithm: 'least-response-time' });
  assert.equal(latency.select(pool).node.id, 'light');

  for (const algorithm of ['ip-hash', 'consistent-hash']) {
    const router = createProxyRouter({ algorithm });
    const first = router.select(pool, { clientKey: 'customer-17' }).node.id;
    const repeated = router.select(pool, { clientKey: 'customer-17' }).node.id;
    assert.equal(first, repeated, `${algorithm} should keep the same affinity key stable`);
    assert.notEqual(first, 'draining');
  }
});

test('random strategy accepts an injected deterministic source', () => {
  const router = createProxyRouter({ algorithm: 'random', random: () => 0.99 });
  const selected = router.select([node('a', { weight: 1 }), node('b', { weight: 2 })]);
  assert.equal(selected.node.id, 'b');
});
