import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createRuntime } from './main.mjs';
import { startDemoUpstreams } from './demo-upstreams.mjs';

let cluster;
let runtime;
let baseUrl;
let staticRoot;
const adminToken = 'test-only-admin-token';

before(async () => {
  staticRoot = mkdtempSync(path.join(os.tmpdir(), 'loadmind-static-'));
  mkdirSync(path.join(staticRoot, 'assets'));
  writeFileSync(path.join(staticRoot, 'index.html'), '<!doctype html><title>LoadMind test shell</title>');
  writeFileSync(path.join(staticRoot, 'assets', 'app.js'), 'globalThis.loadmindTest = true;');
  cluster = await startDemoUpstreams({
    definitions: [
      { id: 'test-a', name: 'TEST-A', port: 0, latencyMs: 0, weight: 2, region: 'test' },
      { id: 'test-b', name: 'TEST-B', port: 0, latencyMs: 0, weight: 1, region: 'test' },
    ],
  });
  runtime = await createRuntime({
    host: '127.0.0.1',
    port: 0,
    upstreams: cluster.upstreams,
    demo: false,
    adminToken,
    production: true,
    staticRoot,
    healthCheckIntervalMs: 0,
  });
  await runtime.listen();
  baseUrl = `http://127.0.0.1:${runtime.server.address().port}`;
});

after(async () => {
  await runtime?.close();
  await cluster?.close();
  if (staticRoot) rmSync(staticRoot, { recursive: true, force: true });
});

test('runtime exposes liveness and real upstream telemetry', async () => {
  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).service, 'loadmind');

  const status = await fetch(`${baseUrl}/api/live-proxy/status`);
  assert.equal(status.status, 200);
  const data = await status.json();
  assert.equal(data.algorithm, 'round-robin');
  assert.equal(data.adminAuthRequired, true);
  assert.equal(data.upstreams.length, 2);
});

test('production runtime serves the SPA shell and static assets', async () => {
  const shell = await fetch(`${baseUrl}/`, { headers: { accept: 'text/html' } });
  assert.equal(shell.status, 200);
  assert.match(shell.headers.get('content-type') || '', /text\/html/);
  assert.match(await shell.text(), /LoadMind test shell/);

  const route = await fetch(`${baseUrl}/performance/lab`, { headers: { accept: 'text/html' } });
  assert.equal(route.status, 200);
  assert.match(await route.text(), /LoadMind test shell/);

  const asset = await fetch(`${baseUrl}/assets/app.js`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type') || '', /javascript/);
  assert.equal(await asset.text(), 'globalThis.loadmindTest = true;');
});

test('operator routes are protected and accept the configured bearer token', async () => {
  const denied = await fetch(`${baseUrl}/api/live-proxy/algorithm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ algorithm: 'least-response-time' }),
  });
  assert.equal(denied.status, 401);

  const malformed = await fetch(`${baseUrl}/api/live-proxy/algorithm`, {
    method: 'POST',
    headers: { authorization: adminToken, 'content-type': 'application/json' },
    body: JSON.stringify({ algorithm: 'least-response-time' }),
  });
  assert.equal(malformed.status, 401);

  const allowed = await fetch(`${baseUrl}/api/live-proxy/algorithm`, {
    method: 'POST',
    headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ algorithm: 'least-response-time' }),
  });
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).algorithm, 'least-response-time');
});

test('same origin can make a proxied request and reset metrics with authorization', async () => {
  const response = await fetch(`${baseUrl}/proxy/api/info`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(['test-a', 'test-b'].includes(body.upstream));
  assert.ok(response.headers.get('x-loadmind-request-id'));

  const reset = await fetch(`${baseUrl}/api/live-proxy/reset`, {
    method: 'POST',
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(reset.status, 200);
  const status = await (await fetch(`${baseUrl}/api/live-proxy/status`)).json();
  assert.equal(status.metrics.totalRequests, 0);
});
