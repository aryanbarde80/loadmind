/** Start the local HTTP proxy API and Vite UI as one development stack. */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = process.cwd();
const host = '127.0.0.1';
const apiPort = Number(process.env.LOADMIND_API_PORT || 8787);
const vitePort = Number(process.env.LOADMIND_VITE_PORT || 5173);
const apiUrl = `http://${host}:${apiPort}`;
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const children = [];
let stopping = false;

function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill(signal);
}

process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));

async function waitForApi(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${apiUrl}/api/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // Wait while the API and demo upstreams bind their ports.
    }
    if (stopping) throw new Error('Development stack is shutting down.');
    await delay(200);
  }
  throw new Error(`LoadMind API did not become ready at ${apiUrl}.`);
}

try {
  const api = spawn(process.execPath, [path.join(root, 'server', 'main.mjs')], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, HOST: host, PORT: String(apiPort), NODE_ENV: 'development' },
  });
  children.push(api);
  api.once('exit', (code) => {
    if (!stopping) {
      console.error(`LoadMind API exited${code === null ? '' : ` with code ${code}`}.`);
      stop();
    }
  });

  await waitForApi();
  console.log(`LoadMind API ready at ${apiUrl}`);

  const vite = spawn(process.execPath, [viteBin, '--host', '0.0.0.0', '--port', String(vitePort), '--strictPort'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, LOADMIND_API_URL: apiUrl },
  });
  children.push(vite);
  vite.once('exit', (code) => {
    if (!stopping) {
      console.error(`Vite exited${code === null ? '' : ` with code ${code}`}.`);
      stop();
    }
  });

  await new Promise((resolve) => {
    const onExit = () => resolve();
    for (const child of children) child.once('exit', onExit);
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  stop();
  await Promise.all(children.map((child) => new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
      resolve();
    }, 3_000).unref();
  })));
}
