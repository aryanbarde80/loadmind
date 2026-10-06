import http from 'node:http';
import https from 'node:https';
import { randomUUID } from 'node:crypto';
import { createProxyRouter, PROXY_ALGORITHM_IDS, PROXY_ALGORITHM_NAMES } from './algorithms.mjs';

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function cleanHeaders(headers = {}) {
  const output = { ...headers };
  const connectionTokens = String(headers.connection || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  for (const name of [...HOP_BY_HOP_HEADERS, ...connectionTokens]) delete output[name];
  return output;
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.ceil(fraction * ordered.length) - 1)];
}

function normalizeUpstream(upstream, index) {
  const id = String(upstream.id || `upstream-${index + 1}`);
  const url = new URL(upstream.url);
  if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError(`Upstream ${id} must use HTTP or HTTPS.`);
  if (url.username || url.password) throw new TypeError(`Credentials must not be embedded in the URL for upstream ${id}.`);
  url.hash = '';
  return {
    id,
    name: String(upstream.name || id),
    url: url.toString().replace(/\/$/, ''),
    weight: Math.max(1, Math.min(10, Math.round(Number(upstream.weight) || 1))),
    healthPath: upstream.healthPath || '/healthz',
    healthy: upstream.healthy !== false,
    draining: false,
    inFlight: 0,
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    ewmaLatencyMs: 0,
    lastLatencyMs: 0,
    lastStatusCode: null,
    consecutiveHealthFailures: 0,
    lastHealthCheckAt: null,
  };
}

function writeJson(response, statusCode, body) {
  if (response.headersSent || response.destroyed) return;
  const payload = Buffer.from(JSON.stringify(body));
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store',
  });
  response.end(payload);
}

/**
 * HTTP reverse proxy with health checks, eight selectable routing strategies,
 * bounded rolling latency samples, and privacy-conscious request events.
 * Request bodies and query strings are never retained in metrics.
 */
export function createLoadBalancer({
  upstreams,
  algorithm = 'round-robin',
  requestTimeoutMs = 5_000,
  healthCheckIntervalMs = 5_000,
  healthFailureThreshold = 2,
  healthPath = '/healthz',
  random = Math.random,
} = {}) {
  if (!Array.isArray(upstreams) || upstreams.length === 0) {
    throw new TypeError('At least one upstream is required.');
  }
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 100 || requestTimeoutMs > 120_000) {
    throw new RangeError('requestTimeoutMs must be an integer from 100 to 120000.');
  }

  const nodes = upstreams.map(normalizeUpstream);
  const router = createProxyRouter({ algorithm, random });
  const startedAt = Date.now();
  const latencySamples = [];
  const recentRequests = [];
  const metrics = {
    totalRequests: 0,
    completedRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    totalLatencyMs: 0,
    latencySamples,
  };
  let healthTimer = null;
  let healthCheckInProgress = false;

  const addRecent = (event) => {
    recentRequests.unshift(event);
    if (recentRequests.length > 40) recentRequests.length = 40;
  };

  const checkHealth = async () => {
    if (healthCheckInProgress) return;
    healthCheckInProgress = true;
    try {
      await Promise.all(nodes.map(async (node) => {
        const started = performance.now();
        try {
          const target = new URL(node.healthPath, `${node.url}/`);
          const result = await fetch(target, { signal: AbortSignal.timeout(Math.min(requestTimeoutMs, 2_500)) });
          if (!result.ok) throw new Error(`health check returned ${result.status}`);
          await result.body?.cancel();
          node.healthy = true;
          node.consecutiveHealthFailures = 0;
        } catch {
          node.consecutiveHealthFailures++;
          if (node.consecutiveHealthFailures >= healthFailureThreshold) node.healthy = false;
        } finally {
          node.lastHealthCheckAt = new Date().toISOString();
          node.healthCheckLatencyMs = Number((performance.now() - started).toFixed(2));
        }
      }));
    } finally {
      healthCheckInProgress = false;
    }
  };

  const handleRequest = (request, response) => {
    const parsed = new URL(request.url || '/', 'http://loadmind.local');
    if (parsed.pathname !== '/proxy' && !parsed.pathname.startsWith('/proxy/')) {
      writeJson(response, 404, { error: 'Use /proxy/* to send a request through LoadMind.' });
      return;
    }

    const startedAtMs = performance.now();
    const requestId = randomUUID();
    metrics.totalRequests++;
    const selection = router.select(nodes, {
      clientIp: request.socket.remoteAddress || 'unknown',
      clientKey: request.headers['x-loadmind-key'] || request.socket.remoteAddress || 'anonymous',
    });
    if (!selection.node) {
      metrics.completedRequests++;
      metrics.failedRequests++;
      const latencyMs = Math.max(0, performance.now() - startedAtMs);
      metrics.totalLatencyMs += latencyMs;
      latencySamples.push(latencyMs);
      if (latencySamples.length > 500) latencySamples.shift();
      addRecent({
        requestId,
        upstreamId: null,
        upstreamName: 'No healthy upstream',
        method: request.method || 'GET',
        path: parsed.pathname,
        statusCode: 503,
        latencyMs: Number(latencyMs.toFixed(2)),
        algorithm: selection.algorithm,
        outcome: 'error',
        completedAt: new Date().toISOString(),
      });
      writeJson(response, 503, { error: 'No healthy upstreams are available.', requestId });
      return;
    }

    const node = selection.node;
    const upstreamUrl = new URL(node.url);
    const basePath = upstreamUrl.pathname.replace(/\/$/, '');
    const incomingPath = parsed.pathname.slice('/proxy'.length) || '/';
    upstreamUrl.pathname = `${basePath}${incomingPath}` || '/';
    upstreamUrl.search = parsed.search;

    node.totalRequests++;
    node.inFlight++;

    const transport = upstreamUrl.protocol === 'https:' ? https : http;
    const headers = cleanHeaders(request.headers);
    headers.host = upstreamUrl.host;
    headers['x-loadmind-request-id'] = requestId;
    const clientAddress = request.socket.remoteAddress || 'unknown';
    const priorForwardedFor = String(request.headers['x-forwarded-for'] || '').trim();
    headers['x-forwarded-for'] = priorForwardedFor ? `${priorForwardedFor}, ${clientAddress}` : clientAddress;
    headers['x-forwarded-host'] = request.headers['x-forwarded-host'] || request.headers.host || '';
    headers['x-forwarded-proto'] = request.headers['x-forwarded-proto'] || (request.socket.encrypted ? 'https' : 'http');

    let finished = false;
    const finish = (statusCode, networkError = null) => {
      if (finished) return;
      finished = true;
      const latencyMs = Math.max(0, performance.now() - startedAtMs);
      node.inFlight = Math.max(0, node.inFlight - 1);
      node.lastLatencyMs = latencyMs;
      node.ewmaLatencyMs = node.ewmaLatencyMs === 0 ? latencyMs : node.ewmaLatencyMs * 0.8 + latencyMs * 0.2;
      node.lastStatusCode = statusCode ?? null;
      metrics.completedRequests++;
      metrics.totalLatencyMs += latencyMs;
      latencySamples.push(latencyMs);
      if (latencySamples.length > 500) latencySamples.shift();

      const failed = Boolean(networkError) || statusCode >= 400;
      if (failed) {
        metrics.failedRequests++;
        node.failedRequests++;
      } else {
        metrics.successfulRequests++;
        node.successfulRequests++;
      }

      addRecent({
        requestId,
        upstreamId: node.id,
        upstreamName: node.name,
        method: request.method || 'GET',
        path: parsed.pathname,
        statusCode: statusCode ?? 0,
        latencyMs: Number(latencyMs.toFixed(2)),
        algorithm: selection.algorithm,
        outcome: failed ? 'error' : 'success',
        completedAt: new Date().toISOString(),
      });
    };

    const outgoing = transport.request(upstreamUrl, {
      method: request.method,
      headers,
      timeout: requestTimeoutMs,
    }, (upstreamResponse) => {
      const responseHeaders = cleanHeaders(upstreamResponse.headers);
      responseHeaders['x-loadmind-upstream'] = node.id;
      responseHeaders['x-loadmind-request-id'] = requestId;
      responseHeaders['x-loadmind-algorithm'] = selection.algorithm;
      response.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
      upstreamResponse.pipe(response);
      upstreamResponse.on('end', () => finish(upstreamResponse.statusCode || 502));
      upstreamResponse.on('error', (error) => {
        finish(upstreamResponse.statusCode || 502, error);
        response.destroy(error);
      });
    });

    outgoing.setTimeout(requestTimeoutMs, () => {
      const error = Object.assign(new Error('Upstream request timed out.'), { code: 'ETIMEDOUT' });
      outgoing.destroy(error);
    });
    outgoing.on('error', (error) => {
      const statusCode = error.code === 'ETIMEDOUT' ? 504 : 502;
      if (!response.headersSent && !response.destroyed) {
        writeJson(response, statusCode, { error: error.message, requestId, upstream: node.id });
      } else if (!response.destroyed) {
        response.destroy(error);
      }
      finish(statusCode, error);
    });
    request.on('aborted', () => {
      outgoing.destroy(new Error('Client aborted the request.'));
    });
    response.on('close', () => {
      if (!response.writableFinished) {
        outgoing.destroy();
        finish(499, new Error('Client closed the response.'));
      }
    });
    request.pipe(outgoing);
  };

  if (healthCheckIntervalMs > 0) {
    healthTimer = setInterval(checkHealth, healthCheckIntervalMs);
    healthTimer.unref?.();
    void checkHealth();
  }

  const getStatus = () => ({
    service: 'LoadMind HTTP Proxy',
    uptimeSeconds: Number(((Date.now() - startedAt) / 1_000).toFixed(1)),
    algorithm: router.getAlgorithm(),
    algorithmName: PROXY_ALGORITHM_NAMES[router.getAlgorithm()],
    effectiveAlgorithm: router.getEffectiveAlgorithm(),
    effectiveAlgorithmName: PROXY_ALGORITHM_NAMES[router.getEffectiveAlgorithm()],
    autopilotReason: router.getReason(),
    metrics: {
      ...metrics,
      latencySamples: undefined,
      averageLatencyMs: metrics.completedRequests ? Number((metrics.totalLatencyMs / metrics.completedRequests).toFixed(2)) : 0,
      p50LatencyMs: Number(percentile(latencySamples, 0.5).toFixed(2)),
      p95LatencyMs: Number(percentile(latencySamples, 0.95).toFixed(2)),
      inFlight: nodes.reduce((sum, node) => sum + node.inFlight, 0),
      healthyUpstreams: nodes.filter((node) => node.healthy).length,
      upstreamCount: nodes.length,
    },
    upstreams: nodes.map((node) => ({
      id: node.id,
      name: node.name,
      weight: node.weight,
      healthy: node.healthy,
      draining: node.draining,
      inFlight: node.inFlight,
      totalRequests: node.totalRequests,
      successfulRequests: node.successfulRequests,
      failedRequests: node.failedRequests,
      ewmaLatencyMs: Number(node.ewmaLatencyMs.toFixed(2)),
      lastLatencyMs: Number(node.lastLatencyMs.toFixed(2)),
      lastStatusCode: node.lastStatusCode,
      consecutiveHealthFailures: node.consecutiveHealthFailures,
      lastHealthCheckAt: node.lastHealthCheckAt,
    })),
    recentRequests: [...recentRequests],
  });

  const resetMetrics = () => {
    metrics.totalRequests = 0;
    metrics.completedRequests = 0;
    metrics.successfulRequests = 0;
    metrics.failedRequests = 0;
    metrics.totalLatencyMs = 0;
    latencySamples.length = 0;
    recentRequests.length = 0;
    for (const node of nodes) {
      node.totalRequests = 0;
      node.successfulRequests = 0;
      node.failedRequests = 0;
      node.lastLatencyMs = 0;
      node.lastStatusCode = null;
    }
  };

  return {
    nodes,
    handleRequest,
    getStatus,
    setAlgorithm: (next) => router.setAlgorithm(next),
    checkHealth,
    resetMetrics,
    close: () => {
      if (healthTimer) clearInterval(healthTimer);
    },
    algorithms: PROXY_ALGORITHM_IDS,
  };
}
