/**
 * Starts a disposable Vite UI plus three real demo upstreams and the HTTP proxy,
 * then runs browser E2E and visual assertions against the complete stack.
 */
import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = process.cwd();
const host = '127.0.0.1';
const port = Number(process.env.LOADMIND_TEST_PORT ?? 5174);
const apiPort = Number(process.env.LOADMIND_TEST_API_PORT ?? 8788);
const baseUrl = `http://${host}:${port}`;
const apiUrl = `http://${host}:${apiPort}`;
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const children = [];

for (const [label, value] of [['LOADMIND_TEST_PORT', port], ['LOADMIND_TEST_API_PORT', apiPort]]) {
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    console.error(`Invalid ${label}: ${value}`);
    process.exit(1);
  }
}
if (!existsSync(viteBin)) {
  console.error('Vite is not installed. Run `npm ci` before the browser test suite.');
  process.exit(1);
}

function launch(name, command, args, env = process.env) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', env });
  child.label = name;
  child.exitState = null;
  child.spawnError = null;
  child.once('error', (error) => { child.spawnError = error; });
  child.once('exit', (code, signal) => { child.exitState = { code, signal }; });
  children.push(child);
  return child;
}

async function waitForHttp(url, child, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.spawnError) throw child.spawnError;
    if (child.exitState) throw new Error(`${child.label} exited before becoming ready (code ${child.exitState.code}, signal ${child.exitState.signal}).`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_500) });
      if (response.ok) return;
    } catch {
      // The process may still be binding its listener.
    }
    await delay(200);
  }
  throw new Error(`${child.label} did not become ready at ${url} within ${timeoutMs / 1_000}s.`);
}

async function stop(child) {
  if (!child || child.exitState || child.spawnError) return;
  child.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(4_000)]);
  if (!child.exitState) child.kill('SIGKILL');
}

let failed = false;
try {
  const api = launch('LoadMind proxy API', process.execPath, [path.join(root, 'server', 'main.mjs')], {
    ...process.env,
    HOST: host,
    PORT: String(apiPort),
    NODE_ENV: 'development',
  });
  await waitForHttp(`${apiUrl}/api/health`, api);
  console.log(`\nProxy API ready at ${apiUrl}\n`);

  const vite = launch('Vite browser-test server', process.execPath, [viteBin, '--host', host, '--port', String(port), '--strictPort'], {
    ...process.env,
    LOADMIND_API_URL: apiUrl,
  });
  await waitForHttp(`${baseUrl}/`, vite);
  console.log(`\nComplete browser test stack ready at ${baseUrl}\n`);

  const env = { ...process.env, BASE_URL: baseUrl };
  for (const [name, script] of [
    ['End-to-end browser checks', 'scripts/e2e.mjs'],
    ['Visual assertions', 'scripts/visual-check.mjs'],
  ]) {
    console.log(`\n>>> ${name}\n`);
    const result = spawnSync(process.execPath, [script], { cwd: root, env, stdio: 'inherit' });
    if (result.error) {
      console.error(`${name} could not start: ${result.error.message}`);
      failed = true;
    } else if (result.status !== 0) {
      console.error(`${name} failed${result.signal ? ` (${result.signal})` : ''}.`);
      failed = true;
    }
  }
} catch (error) {
  console.error(`\nBrowser test setup failed: ${error.message}`);
  failed = true;
} finally {
  await Promise.all([...children].reverse().map(stop));
}

process.exitCode = failed ? 1 : 0;
