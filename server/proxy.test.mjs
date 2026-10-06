import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { createLoadBalancer } from './proxy.mjs';

async function createUpstream({ id, delayMs = 0, healthStatus = 200 } = {}) {
  let currentHealthStatus = healthStatus;
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://upstream.test');
    if (url.pathname === '/healthz') {
      response.writeHead(currentHealthStatus, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: currentHealthStatus === 200 ? 'ok' : 'fail', id }));
      return;
    }
    const configuredDelay = Number(url.searchParams.get('delayMs'));
    const wait = Number.isFinite(configuredDelay) ? configuredDelay : delayMs;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    const chunks = [];
    try {
      for await (const chunk of request) chunks.push(chunk);
    } catch {
      if (!response.destroyed) response.destroy();
      return;
    }
    response.writeHead(url.pathname === '/api/fail' ? 503 : 200, {
      'content-type': 'application/json',
      'x-upstream': id,
      connection: 'keep-alive',
    });
    response.end(JSON.stringify({
      id,
      method: request.method,
      path: url.pathname,
      body: Buffer.concat(chunks).toString('utf8'),
      requestId: request.headers['x-loadmind-request-id'] || null,
    }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  return {
    server,
    definition: { id, name: id.toUpperCase(), url: `http://127.0.0.1:${address.port}`, weight: 1, healthPath: '/healthz' },
    setHealthStatus: (status) => { currentHealthStatus = status; },
    close: () => new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    }),
  };
}

let upstreams;
let loadBalancer;
let gateway;
let gatewayUrl;

before(async () => {
  upstreams = await Promise.all(['alpha', 'bravo', 'charlie'].map((id) => createUpstream({ id })));
  loadBalancer = createLoadBalancer({ upstreams: upstreams.map((upstream) => upstream.definition), healthCheckIntervalMs: 0 });
  gateway = http.createServer(loadBalancer.handleRequest);
  await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  gatewayUrl = `http://127.0.0.1:${gateway.address().port}`;
});

after(async () => {
  loadBalancer?.close();
  await new Promise((resolve) => {
    gateway?.close(() => resolve());
    gateway?.closeAllConnections?.();
  });
  await Promise.all((upstreams || []).map((upstream) => upstream.close()));
});

test('upstream configuration rejects unsafe ids, duplicates, and credentialed URLs', () => {
  assert.throws(() => createLoadBalancer({ upstreams: [{ id: 'bad/id', url: 'http://127.0.0.1:9000' }] }), /safe header/);
  assert.throws(() => createLoadBalancer({ upstreams: [
    { id: 'duplicate', url: 'http://127.0.0.1:9000' },
    { id: 'duplicate', url: 'http://127.0.0.1:9001' },
  ] }), /unique/);
  assert.throws(() => createLoadBalancer({ upstreams: [{ id: 'private', url: 'http://user:pass@127.0.0.1:9000' }] }), /Credentials/);
  assert.throws(() => createLoadBalancer({ upstreams: [{ id: 'query', url: 'http://127.0.0.1:9000?token=secret' }] }), /query string/);
});

test('round robin forwards real HTTP requests across healthy upstreams', async () => {
  loadBalancer.setAlgorithm('round-robin');
  const ids = [];
  for (let i = 0; i < 6; i++) {
    const response = await fetch(`${gatewayUrl}/proxy/api/info?batch=${i}`);
    assert.equal(response.status, 200);
    ids.push((await response.json()).id);
  }
  assert.deepEqual(ids, ['alpha', 'bravo', 'charlie', 'alpha', 'bravo', 'charlie']);
});

test('proxy preserves method, query, and request body while adding a request id', async () => {
  loadBalancer.setAlgorithm('round-robin');
  const response = await fetch(`${gatewayUrl}/proxy/api/echo?mode=copy`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hello: 'LoadMind' }),
  });
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-loadmind-upstream'), 'alpha');
  const body = JSON.parse(text);
  assert.equal(body.method, 'POST');
  assert.equal(body.path, '/api/echo');
  assert.equal(body.body, JSON.stringify({ hello: 'LoadMind' }));
  assert.match(body.requestId, /^[0-9a-f-]{36}$/i);
  assert.ok(response.headers.get('x-loadmind-request-id'));
});

test('routing strategies are switchable and affinity strategies stay stable', async () => {
  for (const algorithm of [
    'weighted-round-robin', 'least-connections', 'weighted-least-connections', 'ip-hash',
    'random', 'least-response-time', 'consistent-hash', 'autopilot',
  ]) {
    loadBalancer.setAlgorithm(algorithm);
    const response = await fetch(`${gatewayUrl}/proxy/api/info`, { headers: { 'x-loadmind-key': 'customer-42' } });
    assert.equal(response.status, 200, `${algorithm} should route a request`);
  }

  loadBalancer.setAlgorithm('ip-hash');
  const first = await (await fetch(`${gatewayUrl}/proxy/api/info`, { headers: { 'x-loadmind-key': 'sticky-user' } })).json();
  const second = await (await fetch(`${gatewayUrl}/proxy/api/info`, { headers: { 'x-loadmind-key': 'sticky-user' } })).json();
  assert.equal(first.id, second.id);
  assert.throws(() => loadBalancer.setAlgorithm('not-an-algorithm'), /Unknown proxy algorithm/);
});

test('unhealthy upstreams are excluded and an empty healthy pool returns 503', async () => {
  const before = loadBalancer.getStatus().metrics.failedRequests;
  loadBalancer.nodes.forEach((node) => { node.healthy = false; });
  const response = await fetch(`${gatewayUrl}/proxy/api/info`);
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /No healthy upstreams/);
  assert.equal(loadBalancer.getStatus().metrics.failedRequests, before + 1);
  loadBalancer.nodes.forEach((node) => { node.healthy = true; });
});

test('active health checks eject a failing node and restore it after recovery', async () => {
  const probe = await createUpstream({ id: 'health-probe', healthStatus: 503 });
  const healthBalancer = createLoadBalancer({
    upstreams: [probe.definition],
    healthCheckIntervalMs: 0,
    healthFailureThreshold: 2,
  });
  const healthGateway = http.createServer(healthBalancer.handleRequest);
  await new Promise((resolve) => healthGateway.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${healthGateway.address().port}`;
  try {
    await healthBalancer.checkHealth();
    assert.equal(healthBalancer.nodes[0].healthy, true, 'one failed check should not eject the node yet');
    await healthBalancer.checkHealth();
    assert.equal(healthBalancer.nodes[0].healthy, false);
    assert.equal((await fetch(`${url}/proxy/api/info`)).status, 503);

    probe.setHealthStatus(200);
    await healthBalancer.checkHealth();
    assert.equal(healthBalancer.nodes[0].healthy, true);
  } finally {
    healthBalancer.close();
    await new Promise((resolve) => {
      healthGateway.close(() => resolve());
      healthGateway.closeAllConnections?.();
    });
    await probe.close();
  }
});

test('metrics expose percentiles and recent paths without query strings', async () => {
  loadBalancer.setAlgorithm('round-robin');
  await fetch(`${gatewayUrl}/proxy/api/info?access_token=must-not-be-recorded`);
  const status = loadBalancer.getStatus();
  assert.ok(status.metrics.totalRequests >= 1);
  assert.ok(status.metrics.averageLatencyMs >= 0);
  assert.ok(status.metrics.p95LatencyMs >= 0);
  assert.equal(status.recentRequests[0].path, '/proxy/api/info');
  assert.equal(JSON.stringify(status.recentRequests).includes('must-not-be-recorded'), false);
});

test('upstream timeout returns 504 and decrements in-flight connections', async () => {
  const slowBalancer = createLoadBalancer({
    upstreams: [upstreams[0].definition],
    healthCheckIntervalMs: 0,
    requestTimeoutMs: 120,
  });
  const slowGateway = http.createServer(slowBalancer.handleRequest);
  await new Promise((resolve) => slowGateway.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${slowGateway.address().port}/proxy/api/info?delayMs=350`);
    assert.equal(response.status, 504);
    assert.equal(slowBalancer.getStatus().metrics.failedRequests, 1);
    assert.equal(slowBalancer.nodes[0].inFlight, 0);
  } finally {
    slowBalancer.close();
    await new Promise((resolve) => {
      slowGateway.close(() => resolve());
      slowGateway.closeAllConnections?.();
    });
  }
});
