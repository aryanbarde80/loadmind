import http from 'node:http';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readBody(request, limitBytes = 1_048_576) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limitBytes) throw Object.assign(new Error('Request body exceeds the 1 MiB demo limit.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}

/** Start independent HTTP upstreams for the self-contained local demo. */
export async function startDemoUpstreams({
  host = '127.0.0.1',
  definitions = [
    { id: 'edge-a', name: 'EDGE-A', port: 9101, latencyMs: 18, weight: 3, region: 'us-east' },
    { id: 'core-b', name: 'CORE-B', port: 9102, latencyMs: 58, weight: 2, region: 'us-central' },
    { id: 'cache-c', name: 'CACHE-C', port: 9103, latencyMs: 105, weight: 1, region: 'us-west' },
  ],
} = {}) {
  if (!Array.isArray(definitions) || definitions.length === 0) throw new TypeError('At least one demo upstream is required.');
  const servers = [];
  const upstreams = [];

  try {
    for (const definition of definitions) {
      const server = http.createServer(async (request, response) => {
        const url = new URL(request.url || '/', 'http://upstream.local');
        response.setHeader('x-demo-upstream', definition.id);
        response.setHeader('cache-control', 'no-store');

        if (url.pathname === '/healthz') {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ status: 'ok', upstream: definition.id }));
          return;
        }

        if (url.pathname === '/api/fail') {
          response.writeHead(503, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: 'intentional demo upstream failure', upstream: definition.id }));
          return;
        }

        if (url.pathname !== '/api/info' && url.pathname !== '/api/echo' && url.pathname !== '/api/slow') {
          response.writeHead(404, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: 'demo route not found', path: url.pathname, upstream: definition.id }));
          return;
        }

        const requestedDelay = Number(url.searchParams.get('delayMs'));
        const delayMs = Number.isFinite(requestedDelay)
          ? Math.max(0, Math.min(1_000, requestedDelay))
          : definition.latencyMs;
        await sleep(delayMs);

        if (url.pathname === '/api/echo') {
          try {
            const body = await readBody(request);
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify({
              upstream: definition.id,
              name: definition.name,
              method: request.method,
              bytesReceived: body.length,
              body: body.toString('utf8'),
              requestId: request.headers['x-loadmind-request-id'] ?? null,
            }));
          } catch (error) {
            response.writeHead(error.statusCode || 400, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ error: error.message, upstream: definition.id }));
          }
          return;
        }

        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          upstream: definition.id,
          name: definition.name,
          region: definition.region,
          method: request.method,
          path: url.pathname,
          requestId: request.headers['x-loadmind-request-id'] ?? null,
          delayMs,
          handledAt: new Date().toISOString(),
        }));
      });

      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(definition.port, host, () => {
          server.off('error', reject);
          resolve();
        });
      });

      const address = server.address();
      servers.push(server);
      upstreams.push({
        id: definition.id,
        name: definition.name,
        url: `http://${host}:${address.port}`,
        weight: definition.weight,
        healthPath: '/healthz',
      });
    }
  } catch (error) {
    await Promise.all(servers.map(closeServer));
    throw error;
  }

  let closed = false;
  return {
    upstreams,
    async close() {
      if (closed) return;
      closed = true;
      await Promise.all(servers.map(closeServer));
    },
  };
}
