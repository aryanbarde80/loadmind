/**
 * Starts a disposable local Vite server and runs both browser suites against it.
 * Generated screenshots are kept under test-results/ rather than the curated
 * portfolio screenshots in screenshots/.
 *
 *   npm run test:browser
 */
import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = process.cwd();
const host = '127.0.0.1';
const port = Number(process.env.LOADMIND_TEST_PORT ?? 5174);
const baseUrl = `http://${host}:${port}`;
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  console.error(`Invalid LOADMIND_TEST_PORT: ${process.env.LOADMIND_TEST_PORT}`);
  process.exit(1);
}
if (!existsSync(viteBin)) {
  console.error('Vite is not installed. Run `npm ci` before the browser test suite.');
  process.exit(1);
}

const server = spawn(
  process.execPath,
  [viteBin, '--host', host, '--port', String(port), '--strictPort'],
  { cwd: root, stdio: 'inherit', env: process.env },
);
let serverExit = null;
let serverError = null;
server.once('error', (error) => {
  serverError = error;
});
server.once('exit', (code, signal) => {
  serverExit = { code, signal };
});

async function waitForServer(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (serverError) throw serverError;
    if (serverExit) {
      throw new Error(`Vite exited before becoming ready (code ${serverExit.code}, signal ${serverExit.signal}).`);
    }
    try {
      const response = await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(1_500) });
      if (response.ok) return;
    } catch {
      // Vite is still starting; retry until the deadline.
    }
    await delay(200);
  }
  throw new Error(`Vite did not become ready at ${baseUrl} within ${timeoutMs / 1_000}s.`);
}

async function stopServer() {
  if (serverExit || serverError) return;
  server.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => server.once('exit', resolve)), delay(3_000)]);
  if (!serverExit) server.kill('SIGKILL');
}

let failed = false;
try {
  await waitForServer();
  console.log(`\nBrowser test server ready at ${baseUrl}\n`);

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
  await stopServer();
}

process.exitCode = failed ? 1 : 0;
