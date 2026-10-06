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

const exited = (child) => child.exitCode !== null || child.signalCode !== null;

function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (!exited(child)) child.kill(signal);
}

process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));

function launch(label, command, args, env) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', env });
  child.loadMindLabel = label;
  child.spawnFailed = false;
  child.once('error', (error) => {
    child.spawnFailed = true;
    console.error(`${label} could not start: ${error.message}`);
    stop();
  });
  child.once('exit', (code, signal) => {
    if (!stopping) {
      console.error(`${label} exited${code === null ? '' : ` with code ${code}`}${signal ? ` (${signal})` : ''}.`);
      stop();
    }
  });
  children.push(child);
  return child;
}

async function waitForApi(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (stopping) throw new Error('Development stack is shutting down.');
    try {
      const response = await fetch(`${apiUrl}/api/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // Wait while the API and demo upstreams bind their ports.
    }
    await delay(200);
  }
  throw new Error(`LoadMind API did not become ready at ${apiUrl}.`);
}

async function waitForAnyChildExit() {
  if (children.some((child) => exited(child) || child.spawnFailed)) return;
  await new Promise((resolve) => {
    const onExit = () => resolve();
    for (const child of children) {
      child.once('exit', onExit);
      child.once('error', onExit);
    }
    if (children.some((child) => exited(child) || child.spawnFailed)) resolve();
  });
}

async function waitForChildExit(child, graceMs = 3_000) {
  if (exited(child) || child.spawnFailed) return;
  await new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      if (!exited(child)) child.kill('SIGKILL');
      finish();
    }, graceMs);
    child.once('exit', finish);
    if (exited(child) || child.spawnFailed) finish();
  });
}

try {
  launch('LoadMind API', process.execPath, [path.join(root, 'server', 'main.mjs')], {
    ...process.env,
    HOST: host,
    PORT: String(apiPort),
    NODE_ENV: 'development',
  });
  await waitForApi();
  console.log(`LoadMind API ready at ${apiUrl}`);

  launch('Vite', process.execPath, [viteBin, '--host', '0.0.0.0', '--port', String(vitePort), '--strictPort'], {
    ...process.env,
    LOADMIND_API_URL: apiUrl,
  });
  await waitForAnyChildExit();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  stop();
  await Promise.all(children.map((child) => waitForChildExit(child)));
}
