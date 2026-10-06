import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { createLoadBalancer } from './proxy.mjs';
import { startDemoUpstreams } from './demo-upstreams.mjs';

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff2', 'font/woff2'],
]);

function sendJson(response, statusCode, body) {
  const payload = Buffer.from(JSON.stringify(body));
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store',
  });
  response.end(payload);
}

async function readJson(request, maxBytes = 8_192) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw Object.assign(new Error('Request body is too large.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('Expected a valid JSON request body.'), { statusCode: 400 });
  }
}

function isLoopback(address = '') {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function hasValidBearer(request, expected) {
  if (!expected) return false;
  const match = /^Bearer\s+(.+)$/i.exec(String(request.headers.authorization || ''));
  if (!match) return false;
  const a = Buffer.from(match[1]);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function serveStatic(request, response, root) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url || '/', 'http://loadmind.local').pathname);
  } catch {
    sendJson(response, 400, { error: 'Malformed URL.' });
    return;
  }
  const resolvedRoot = path.resolve(root);
  const requested = path.resolve(resolvedRoot, `.${pathname}`);
  const relative = path.relative(resolvedRoot, requested);
  let filename = relative.startsWith('..') || path.isAbsolute(relative) ? null : requested;

  if (filename) {
    try {
      if (fs.statSync(filename).isDirectory()) filename = path.join(filename, 'index.html');
    } catch {
      filename = null;
    }
  }
  if (!filename || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
    const acceptsHtml = String(request.headers.accept || '').includes('text/html');
    filename = acceptsHtml ? path.join(resolvedRoot, 'index.html') : null;
  }
  if (!filename || !fs.existsSync(filename)) {
    sendJson(response, 404, { error: 'Not found.' });
    return;
  }

  const contentType = MIME_TYPES.get(path.extname(filename).toLowerCase()) || 'application/octet-stream';
  const stat = fs.statSync(filename);
  response.writeHead(200, {
    'content-type': contentType,
    'content-length': stat.size,
    'cache-control': filename.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  if (request.method === 'HEAD') response.end();
  else fs.createReadStream(filename).pipe(response);
}

function parseUpstreams(raw) {
  if (!raw) return null;
  let config;
  try {
    config = JSON.parse(raw);
  } catch {
    throw new Error('LOADMIND_UPSTREAMS must be a JSON array.');
  }
  if (!Array.isArray(config) || config.length === 0) throw new Error('LOADMIND_UPSTREAMS must contain at least one upstream.');
  return config;
}

/** Create an embeddable runtime used by the CLI, integration tests, and Docker. */
export async function createRuntime({
  host = '127.0.0.1',
  port = 0,
  upstreams = null,
  demo = true,
  demoOptions = {},
  staticRoot = null,
  adminToken = process.env.LOADMIND_ADMIN_TOKEN || '',
  production = process.env.NODE_ENV === 'production',
  algorithm = process.env.LOADMIND_ALGORITHM || 'round-robin',
  healthCheckIntervalMs = 5_000,
} = {}) {
  let demoCluster = null;
  let targets = upstreams;
  if (!targets) {
    if (!demo) throw new Error('No upstreams configured. Set LOADMIND_UPSTREAMS or enable demo mode.');
    demoCluster = await startDemoUpstreams(demoOptions);
    targets = demoCluster.upstreams;
  }

  const proxy = createLoadBalancer({
    upstreams: targets,
    algorithm,
    healthCheckIntervalMs,
  });
  const staticDirectory = staticRoot || (production ? path.resolve('dist') : null);

  const server = http.createServer(async (request, response) => {
    const parsed = new URL(request.url || '/', 'http://loadmind.local');
    const pathname = parsed.pathname;

    if (pathname === '/api/health' && request.method === 'GET') {
      sendJson(response, 200, { status: 'ok', service: 'loadmind', mode: staticDirectory ? 'production' : 'development' });
      return;
    }
    if (pathname === '/api/live-proxy/status' && request.method === 'GET') {
      const localControls = !production || isLoopback(request.socket.remoteAddress);
      sendJson(response, 200, {
        ...proxy.getStatus(),
        adminAuthRequired: Boolean(adminToken),
        adminControlsAvailable: Boolean(adminToken) || localControls,
        adminControlMode: adminToken ? 'bearer' : production ? 'loopback-only' : 'development',
      });
      return;
    }
    if (pathname === '/api/live-proxy/algorithm' && request.method === 'POST') {
      const localDevelopmentControl = !production || isLoopback(request.socket.remoteAddress);
      if (adminToken ? !hasValidBearer(request, adminToken) : !localDevelopmentControl) {
        sendJson(response, 401, { error: 'Operator authentication is required to change proxy settings.' });
        return;
      }
      try {
        const body = await readJson(request);
        proxy.setAlgorithm(body.algorithm);
        sendJson(response, 200, { ok: true, algorithm: proxy.getStatus().algorithm });
      } catch (error) {
        sendJson(response, error.statusCode || 400, { error: error.message });
      }
      return;
    }
    if (pathname === '/api/live-proxy/reset' && request.method === 'POST') {
      const localDevelopmentControl = !production || isLoopback(request.socket.remoteAddress);
      if (adminToken ? !hasValidBearer(request, adminToken) : !localDevelopmentControl) {
        sendJson(response, 401, { error: 'Operator authentication is required to reset proxy metrics.' });
        return;
      }
      proxy.resetMetrics();
      sendJson(response, 200, { ok: true });
      return;
    }
    if (pathname === '/api/live-proxy/status' || pathname === '/api/live-proxy/algorithm' || pathname === '/api/live-proxy/reset') {
      response.setHeader('allow', pathname.endsWith('/status') ? 'GET' : 'POST');
      sendJson(response, 405, { error: 'Method not allowed.' });
      return;
    }
    if (pathname === '/proxy' || pathname.startsWith('/proxy/')) {
      proxy.handleRequest(request, response);
      return;
    }
    if (pathname.startsWith('/api/')) {
      sendJson(response, 404, { error: 'API route not found.' });
      return;
    }
    if (staticDirectory && ['GET', 'HEAD'].includes(request.method || 'GET')) {
      await serveStatic(request, response, staticDirectory);
      return;
    }
    sendJson(response, 404, { error: 'Not found. In development, open the Vite app on port 5173.' });
  });

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    proxy.close();
    await new Promise((resolve) => {
      const forceClose = setTimeout(() => server.closeAllConnections?.(), 3_000).unref();
      server.close(() => {
        clearTimeout(forceClose);
        resolve();
      });
    });
    await demoCluster?.close();
  };

  return {
    server,
    proxy,
    demoCluster,
    async listen() {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          resolve();
        });
      });
      return server.address();
    },
    close,
  };
}

export async function start() {
  const runtime = await createRuntime({
    host: process.env.HOST || '0.0.0.0',
    port: Number(process.env.PORT || (process.env.NODE_ENV === 'production' ? 4173 : 8787)),
    upstreams: parseUpstreams(process.env.LOADMIND_UPSTREAMS),
    demo: process.env.LOADMIND_DEMO_MODE !== 'false',
  });
  const address = await runtime.listen();
  console.log(`LoadMind proxy listening at http://${address.address}:${address.port}`);
  console.log(`Demo upstreams: ${runtime.proxy.getStatus().upstreams.map((upstream) => `${upstream.name}=${upstream.url}`).join(', ')}`);

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal}: draining LoadMind proxy...`);
    const timeout = setTimeout(() => process.exit(1), 10_000).unref();
    try {
      await runtime.close();
      clearTimeout(timeout);
      process.exit(0);
    } catch (error) {
      console.error('Shutdown failed:', error);
      process.exit(1);
    }
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  start().catch((error) => {
    console.error('LoadMind proxy failed to start:', error.message);
    process.exitCode = 1;
  });
}
