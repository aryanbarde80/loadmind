import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  Clock3,
  Globe,
  LockKeyhole,
  RefreshCw,
  RotateCcw,
  Send,
  Server,
  ShieldCheck,
  Sparkles,
  Timer,
  Zap,
} from 'lucide-react';
import { Panel, Stat, StatusBadge } from '@/components/ui/primitives';
import { clsx } from '@/lib/clsx';

interface UpstreamStatus {
  id: string;
  name: string;
  weight: number;
  healthy: boolean;
  draining: boolean;
  inFlight: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  ewmaLatencyMs: number;
  lastLatencyMs: number;
  lastStatusCode: number | null;
  consecutiveHealthFailures: number;
  lastHealthCheckAt: string | null;
}

interface RequestEvent {
  requestId: string;
  upstreamId: string | null;
  upstreamName: string;
  method: string;
  path: string;
  statusCode: number;
  latencyMs: number;
  algorithm: string;
  outcome: 'success' | 'error';
  completedAt: string;
}

interface ProxyStatus {
  service: string;
  uptimeSeconds: number;
  algorithm: string;
  algorithmName: string;
  effectiveAlgorithm: string;
  effectiveAlgorithmName: string;
  autopilotReason: string;
  adminAuthRequired: boolean;
  adminControlsAvailable: boolean;
  adminControlMode: 'development' | 'loopback-only' | 'bearer';
  metrics: {
    totalRequests: number;
    completedRequests: number;
    successfulRequests: number;
    failedRequests: number;
    averageLatencyMs: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    inFlight: number;
    healthyUpstreams: number;
    upstreamCount: number;
  };
  upstreams: UpstreamStatus[];
  recentRequests: RequestEvent[];
}

const ALGORITHMS = [
  { id: 'round-robin', name: 'Round Robin', note: 'Rotate evenly through healthy nodes.' },
  { id: 'weighted-round-robin', name: 'Weighted Round Robin', note: 'Give higher-capacity nodes more turns.' },
  { id: 'least-connections', name: 'Least Connections', note: 'Prefer the node with fewer in-flight requests.' },
  { id: 'weighted-least-connections', name: 'Weighted Least Connections', note: 'Compare concurrency relative to node weight.' },
  { id: 'ip-hash', name: 'IP Hash', note: 'Keep a client IP on a stable node.' },
  { id: 'random', name: 'Weighted Random', note: 'Draw a weighted random healthy node.' },
  { id: 'least-response-time', name: 'Least Response Time', note: 'Use observed EWMA latency and concurrency.' },
  { id: 'consistent-hash', name: 'Consistent Hashing', note: 'Use a weighted virtual-node hash ring.' },
  { id: 'autopilot', name: 'AI Autopilot', note: 'Select a strategy from live latency, load, and weights.' },
] as const;

const ROUTES = [
  { value: '/api/info', label: 'GET  /api/info', method: 'GET' },
  { value: '/api/slow?delayMs=260', label: 'GET  /api/slow · 260 ms', method: 'GET' },
  { value: '/api/fail', label: 'GET  /api/fail · intentional 503', method: 'GET' },
  { value: '/api/echo', label: 'POST /api/echo · JSON body', method: 'POST' },
] as const;

function formatMs(value: number) {
  if (!Number.isFinite(value)) return '—';
  return value < 1_000 ? `${value.toFixed(value < 100 ? 1 : 0)} ms` : `${(value / 1_000).toFixed(2)} s`;
}

function formatClock(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

async function readError(response: Response) {
  try {
    const body = await response.json() as { error?: string };
    return body.error || `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

export function LiveProxyView() {
  const [status, setStatus] = useState<ProxyStatus | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [algorithmBusy, setAlgorithmBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [upstreamBusyId, setUpstreamBusyId] = useState<string | null>(null);
  const [requestBusy, setRequestBusy] = useState(false);
  const [adminToken, setAdminToken] = useState('');
  const [controlError, setControlError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<string>(ROUTES[0].value);
  const [echoBody, setEchoBody] = useState('{\n  "message": "hello from LoadMind",\n  "source": "live-proxy-dashboard"\n}');
  const [lastResponse, setLastResponse] = useState<{ status: number; durationMs: number; text: string; upstream: string | null } | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const response = await fetch('/api/live-proxy/status', { cache: 'no-store', signal: AbortSignal.timeout(2_500) });
        if (!response.ok) throw new Error(`Proxy API returned ${response.status}.`);
        const next = await response.json() as ProxyStatus;
        if (!active) return;
        setStatus(next);
        setApiError(null);
        setUpdatedAt(new Date());
      } catch {
        if (!active) return;
        setApiError('The proxy API is not reachable. Start the full stack with npm run dev.');
      } finally {
        if (active) timer = setTimeout(poll, 1_200);
      }
    };
    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const selectedAlgorithm = useMemo(
    () => ALGORITHMS.find((algorithm) => algorithm.id === status?.algorithm) ?? ALGORITHMS[0],
    [status?.algorithm],
  );
  const route = ROUTES.find((item) => item.value === selectedRoute) ?? ROUTES[0];
  const apiOnline = Boolean(status && !apiError);
  const canControl = Boolean(status?.adminControlsAvailable) && apiOnline && !algorithmBusy && !resetBusy && !upstreamBusyId;
  const successRate = status?.metrics.completedRequests
    ? status.metrics.successfulRequests / status.metrics.completedRequests * 100
    : 100;

  const refresh = async () => {
    setRefreshing(true);
    try {
      const response = await fetch('/api/live-proxy/status', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Proxy API returned ${response.status}.`);
      setStatus(await response.json() as ProxyStatus);
      setApiError(null);
      setUpdatedAt(new Date());
    } catch {
      setApiError('Could not refresh the proxy API.');
    } finally {
      setRefreshing(false);
    }
  };

  const authHeaders = () => ({
    'content-type': 'application/json',
    ...(adminToken ? { authorization: `Bearer ${adminToken}` } : {}),
  });

  const changeAlgorithm = async (algorithm: string) => {
    setAlgorithmBusy(true);
    setControlError(null);
    try {
      const response = await fetch('/api/live-proxy/algorithm', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ algorithm }),
      });
      if (!response.ok) throw new Error(await readError(response));
      await refresh();
    } catch (error) {
      setControlError(error instanceof Error ? error.message : 'Could not change the routing strategy.');
    } finally {
      setAlgorithmBusy(false);
    }
  };

  const resetMetrics = async () => {
    setResetBusy(true);
    setControlError(null);
    try {
      const response = await fetch('/api/live-proxy/reset', { method: 'POST', headers: authHeaders() });
      if (!response.ok) throw new Error(await readError(response));
      setLastResponse(null);
      await refresh();
    } catch (error) {
      setControlError(error instanceof Error ? error.message : 'Could not reset metrics.');
    } finally {
      setResetBusy(false);
    }
  };

  const updateUpstream = async (id: string, patch: { weight?: number; draining?: boolean }) => {
    setUpstreamBusyId(id);
    setControlError(null);
    try {
      const response = await fetch(`/api/live-proxy/upstreams/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify(patch),
      });
      if (!response.ok) throw new Error(await readError(response));
      await refresh();
    } catch (error) {
      setControlError(error instanceof Error ? error.message : 'Could not update the upstream.');
    } finally {
      setUpstreamBusyId(null);
    }
  };

  const sendRequest = async () => {
    setRequestBusy(true);
    setRequestError(null);
    const started = performance.now();
    try {
      const response = await fetch(`/proxy${route.value}`, {
        method: route.method,
        headers: {
          'x-loadmind-key': 'dashboard-demo-client',
          ...(route.method === 'POST' ? { 'content-type': 'application/json' } : {}),
        },
        body: route.method === 'POST' ? echoBody : undefined,
        cache: 'no-store',
      });
      const text = await response.text();
      const durationMs = performance.now() - started;
      setLastResponse({
        status: response.status,
        durationMs,
        text: (() => {
          try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
        })(),
        upstream: response.headers.get('x-loadmind-upstream'),
      });
      await refresh();
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'The real HTTP request failed.');
    } finally {
      setRequestBusy(false);
    }
  };

  const latencyBars = useMemo(() => {
    const events = [...(status?.recentRequests ?? [])].slice(0, 20).reverse();
    const max = Math.max(1, ...events.map((event) => event.latencyMs));
    return events.map((event) => ({ ...event, height: Math.max(5, event.latencyMs / max * 100) }));
  }, [status?.recentRequests]);

  return (
    <div className="mx-auto max-w-[1500px] space-y-3 pb-4">
      <section className="panel relative overflow-hidden border-neon-cyan/15 bg-gradient-to-br from-neon-cyan/[0.07] via-white/[0.025] to-neon-violet/[0.05] p-4 sm:p-5">
        <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-neon-cyan/[0.07] blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="chip border-neon-cyan/25 bg-neon-cyan/[0.06] font-mono text-[10px] uppercase tracking-[0.14em] text-neon-cyan">
                <Globe className="h-3 w-3" /> HTTP data plane
              </span>
              <span className={clsx('chip font-mono text-[10px] uppercase tracking-[0.12em]', apiOnline ? 'border-neon-mint/25 text-neon-mint' : 'border-neon-rose/25 text-neon-rose')}>
                <span className={clsx('h-1.5 w-1.5 rounded-full', apiOnline ? 'bg-neon-mint shadow-[0_0_8px_rgba(52,229,176,.8)]' : 'bg-neon-rose')} />
                {apiOnline ? 'connected' : 'disconnected'}
              </span>
            </div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-white sm:text-[30px]">Live Proxy</h1>
            <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-slate-400 sm:text-[13px]">
              Route actual HTTP requests across independent upstream services. The original deterministic simulator stays separate and available in Control Center.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden text-right font-mono text-[10px] text-slate-600 sm:block">
              <div>REAL UPSTREAM TELEMETRY</div>
              <div className="mt-1">{updatedAt ? `updated ${updatedAt.toLocaleTimeString()}` : 'waiting for API…'}</div>
            </div>
            <button type="button" className="btn btn-ghost h-9 w-9 px-0" onClick={() => void refresh()} title="Refresh proxy status" aria-label="Refresh proxy status">
              <RefreshCw className={clsx('h-4 w-4', refreshing && 'animate-spin')} />
            </button>
          </div>
        </div>
        {apiError && (
          <div role="status" className="relative mt-4 flex items-start gap-2 rounded-xl border border-neon-rose/20 bg-neon-rose/[0.06] px-3 py-2.5 text-[12px] text-rose-200">
            <Activity className="mt-0.5 h-4 w-4 shrink-0 text-neon-rose" />
            <span>{apiError}</span>
          </div>
        )}
      </section>

      <div className="panel grid grid-cols-2 gap-4 p-3.5 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Requests received" value={(status?.metrics.totalRequests ?? 0).toLocaleString()} sub="real proxy ingress" />
        <Stat label="Success rate" value={`${successRate.toFixed(1)}%`} tone={successRate > 99 ? 'good' : successRate > 95 ? 'warn' : 'bad'} sub={`${(status?.metrics.failedRequests ?? 0).toLocaleString()} failed`} />
        <Stat label="P95 latency" value={formatMs(status?.metrics.p95LatencyMs ?? 0)} sub={`avg ${formatMs(status?.metrics.averageLatencyMs ?? 0)}`} />
        <Stat label="In flight" value={(status?.metrics.inFlight ?? 0).toLocaleString()} sub="active HTTP requests" />
        <Stat label="Healthy pool" value={`${status?.metrics.healthyUpstreams ?? 0}/${status?.metrics.upstreamCount ?? 0}`} tone={status && status.metrics.healthyUpstreams === status.metrics.upstreamCount ? 'good' : 'warn'} sub="health-check state" />
        <Stat label="Effective route" value={status?.effectiveAlgorithmName ?? '—'} tone="violet" sub={status?.algorithm === 'autopilot' ? 'selected by Autopilot' : 'operator selected'} />
      </div>

      <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.85fr)]">
        <div className="min-w-0 space-y-3">
          <Panel
            eyebrow="Upstream pool · active health checks"
            title="Real services behind the balancer"
            icon={<Server className="h-3.5 w-3.5" />}
            actions={<span className="chip font-mono text-[10px] text-slate-400">{status?.upstreams.length ?? 0} nodes</span>}
          >
            {status?.upstreams.length ? (
              <div className="grid gap-2.5 sm:grid-cols-2 2xl:grid-cols-3">
                {status.upstreams.map((upstream, index) => {
                  const badgeStatus = !upstream.healthy ? 'down' : upstream.draining || upstream.consecutiveHealthFailures > 0 ? 'warning' : 'healthy';
                  const accent = index % 3 === 0 ? 'text-neon-cyan' : index % 3 === 1 ? 'text-[#c3b9ff]' : 'text-neon-mint';
                  return (
                    <article key={upstream.id} className="panel-flat min-w-0 p-3.5 transition hover:border-white/15">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <div className={clsx('grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/[0.07] bg-white/[0.035]', accent)}>
                            <Server className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <h4 className="truncate font-display text-[13px] font-semibold text-slate-100">{upstream.name}</h4>
                            <div className="truncate font-mono text-[10px] text-slate-600">{upstream.id}</div>
                          </div>
                        </div>
                        <StatusBadge status={badgeStatus} />
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/[0.055] pt-3">
                        <MiniMetric label="Weight" value={`${upstream.weight}×`} />
                        <MiniMetric label="In flight" value={String(upstream.inFlight)} />
                        <MiniMetric label="EWMA" value={formatMs(upstream.ewmaLatencyMs)} />
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2 font-mono text-[9px] text-slate-600">
                        <span className="truncate">{upstream.totalRequests.toLocaleString()} requests routed</span>
                        <span className="shrink-0">{upstream.lastStatusCode ? `last ${upstream.lastStatusCode}` : 'awaiting traffic'}</span>
                      </div>
                      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 border-t border-white/[0.055] pt-3">
                        <label className="min-w-0">
                          <span className="label">Capacity weight</span>
                          <select
                            className="field h-8 px-2 py-1 font-mono text-[10px]"
                            value={upstream.weight}
                            disabled={!canControl}
                            aria-label={`Weight for ${upstream.name}`}
                            onChange={(event) => void updateUpstream(upstream.id, { weight: Number(event.target.value) })}
                          >
                            {Array.from({ length: 10 }, (_, weight) => weight + 1).map((weight) => (
                              <option key={weight} value={weight}>{weight}× capacity</option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          className={clsx('btn h-8 px-2.5 text-[10px]', upstream.draining ? 'border-neon-mint/25 text-neon-mint' : 'border-neon-amber/25 text-neon-amber')}
                          disabled={!canControl}
                          aria-label={`${upstream.draining ? 'Resume' : 'Drain'} ${upstream.name}`}
                          onClick={() => void updateUpstream(upstream.id, { draining: !upstream.draining })}
                        >
                          {upstreamBusyId === upstream.id ? 'saving…' : upstream.draining ? 'Resume' : 'Drain'}
                        </button>
                      </div>
                      {upstream.draining && <p className="mt-2 font-mono text-[9px] text-neon-amber">Draining · existing requests finish; new traffic is routed elsewhere.</p>}
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-[12px] text-slate-500">
                Upstream inventory will appear when the HTTP API is online.
              </div>
            )}
          </Panel>

          <Panel
            eyebrow="Request generator · actual network calls"
            title="Send a request through the proxy"
            icon={<Send className="h-3.5 w-3.5" />}
            actions={<span className="chip font-mono text-[10px] text-neon-cyan">/proxy/*</span>}
          >
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <label className="min-w-0">
                <span className="label">Demo route</span>
                <select className="field h-[38px]" value={selectedRoute} onChange={(event) => setSelectedRoute(event.target.value)} aria-label="Demo proxy route">
                  {ROUTES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
              <button type="button" className="btn btn-primary h-[38px] px-4" onClick={() => void sendRequest()} disabled={!apiOnline || requestBusy}>
                {requestBusy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                {requestBusy ? 'Request in flight…' : 'Send real request'}
              </button>
            </div>
            {route.method === 'POST' && (
              <label className="mt-3 block">
                <span className="label">JSON request body</span>
                <textarea className="field min-h-[94px] resize-y font-mono text-[11px] leading-relaxed" value={echoBody} onChange={(event) => setEchoBody(event.target.value)} spellCheck={false} />
              </label>
            )}
            {requestError && <p role="alert" className="mt-3 text-[11px] text-neon-rose">{requestError}</p>}
            {lastResponse && (
              <div className="mt-3 overflow-hidden rounded-xl border border-white/[0.07] bg-black/35">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-2">
                  <div className="flex items-center gap-2 font-mono text-[10px]">
                    <span className={clsx('rounded-md border px-1.5 py-0.5', lastResponse.status < 400 ? 'border-neon-mint/25 bg-neon-mint/[0.06] text-neon-mint' : 'border-neon-rose/25 bg-neon-rose/[0.06] text-neon-rose')}>
                      HTTP {lastResponse.status}
                    </span>
                    {lastResponse.upstream && <span className="text-slate-400">via {lastResponse.upstream}</span>}
                  </div>
                  <span className="font-mono text-[10px] text-slate-500">round trip {formatMs(lastResponse.durationMs)}</span>
                </div>
                <pre className="max-h-52 overflow-auto p-3 font-mono text-[10.5px] leading-relaxed text-slate-300">{lastResponse.text}</pre>
              </div>
            )}
          </Panel>
        </div>

        <div className="min-w-0 space-y-3">
          <Panel eyebrow="Routing strategy" title="Choose the real-request policy" icon={<Sparkles className="h-3.5 w-3.5" />}>
            <label className="block">
              <span className="label">Active algorithm</span>
              <select
                className="field h-10"
                value={status?.algorithm ?? 'round-robin'}
                onChange={(event) => void changeAlgorithm(event.target.value)}
                disabled={!canControl || !status}
                aria-label="Live proxy routing strategy"
              >
                {ALGORITHMS.map((algorithm) => <option key={algorithm.id} value={algorithm.id}>{algorithm.name}</option>)}
              </select>
            </label>
            <p className="mt-2 min-h-8 text-[11px] leading-relaxed text-slate-500">{selectedAlgorithm.note}</p>

            {status?.algorithm === 'autopilot' && (
              <div className="mt-3 rounded-xl border border-neon-violet/20 bg-neon-violet/[0.06] p-3">
                <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.13em] text-[#c3b9ff]">
                  <Sparkles className="h-3 w-3" /> Why Autopilot chose this
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-slate-300">{status.autopilotReason}</p>
                <div className="mt-2 text-[10px] text-slate-500">Currently routing with <span className="text-slate-300">{status.effectiveAlgorithmName}</span>.</div>
              </div>
            )}

            {status?.adminAuthRequired && (
              <label className="mt-3 block">
                <span className="label flex items-center gap-1.5"><LockKeyhole className="h-3 w-3" />Operator bearer token · memory only</span>
                <input className="field h-9 font-mono text-[11px]" type="password" value={adminToken} onChange={(event) => setAdminToken(event.target.value)} placeholder="LOADMIND_ADMIN_TOKEN" autoComplete="new-password" />
              </label>
            )}
            {status && !status.adminControlsAvailable && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-neon-amber/20 bg-neon-amber/[0.05] p-2.5 text-[10.5px] leading-relaxed text-amber-200">
                <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Remote controls are locked. Configure <code className="font-mono">LOADMIND_ADMIN_TOKEN</code> on the server to enable authenticated operator actions.
              </div>
            )}
            {controlError && <p role="alert" className="mt-3 text-[10.5px] leading-relaxed text-neon-rose">{controlError}</p>}

            <div className="mt-4 flex items-center justify-between gap-2 border-t border-white/[0.06] pt-3">
              <div className="min-w-0">
                <div className="font-mono text-[9px] uppercase tracking-wider text-slate-600">Effective strategy</div>
                <div className="truncate text-[12px] font-semibold text-neon-cyan">{status?.effectiveAlgorithmName ?? 'Waiting…'}</div>
              </div>
              <span className="chip shrink-0 font-mono text-[9px] text-slate-500">{algorithmBusy ? 'applying…' : 'live'}</span>
            </div>

            <button type="button" className="btn btn-ghost mt-3 w-full justify-center text-[11px]" disabled={!canControl || !status} onClick={() => void resetMetrics()}>
              <RotateCcw className={clsx('h-3 w-3', resetBusy && 'animate-spin')} />
              Reset proxy metrics
            </button>
          </Panel>

          <Panel
            eyebrow="Observed network timings"
            title="Recent request latency"
            icon={<Timer className="h-3.5 w-3.5" />}
            actions={<span className="font-mono text-[10px] text-slate-500">p50 {formatMs(status?.metrics.p50LatencyMs ?? 0)}</span>}
          >
            {latencyBars.length ? (
              <>
                <div className="flex h-24 items-end gap-1.5 border-b border-l border-white/[0.07] px-2 pb-1">
                  {latencyBars.map((event) => (
                    <div key={event.requestId} className="group relative flex h-full min-w-1 flex-1 items-end" title={`${event.upstreamName} · ${formatMs(event.latencyMs)} · HTTP ${event.statusCode}`}>
                      <span className={clsx('w-full rounded-t-sm opacity-80 transition group-hover:opacity-100', event.outcome === 'success' ? 'bg-gradient-to-t from-neon-cyan/30 to-neon-cyan' : 'bg-gradient-to-t from-neon-rose/30 to-neon-rose')} style={{ height: `${event.height}%` }} />
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex items-center justify-between font-mono text-[9px] text-slate-600">
                  <span>older</span><span>each bar = one completed HTTP request</span><span>newer</span>
                </div>
              </>
            ) : (
              <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-white/[0.08] text-[11px] text-slate-600">Send a request to plot observed latency.</div>
            )}
            <div className="mt-3 grid grid-cols-2 gap-3 border-t border-white/[0.06] pt-3">
              <MiniMetric label="P50 observed" value={formatMs(status?.metrics.p50LatencyMs ?? 0)} />
              <MiniMetric label="P95 observed" value={formatMs(status?.metrics.p95LatencyMs ?? 0)} />
            </div>
          </Panel>
        </div>
      </div>

      <Panel
        eyebrow="Bounded, body-free event log"
        title="Most recent proxy requests"
        icon={<Clock3 className="h-3.5 w-3.5" />}
        actions={<span className="chip font-mono text-[10px] text-slate-500">{status?.recentRequests.length ?? 0} / 40 retained</span>}
      >
        {status?.recentRequests.length ? (
          <div className="max-h-[340px] overflow-auto">
            <table className="w-full min-w-[650px] border-collapse text-left">
              <thead className="sticky top-0 bg-[#080b12] font-mono text-[9px] uppercase tracking-[0.15em] text-slate-600">
                <tr>
                  <th className="px-2 py-2 font-medium">Time</th>
                  <th className="px-2 py-2 font-medium">Request</th>
                  <th className="px-2 py-2 font-medium">Upstream</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 text-right font-medium">Latency</th>
                  <th className="px-2 py-2 text-right font-medium">Algorithm</th>
                </tr>
              </thead>
              <tbody>
                {status.recentRequests.map((event) => (
                  <tr key={event.requestId} className="border-t border-white/[0.045] hover:bg-white/[0.025]">
                    <td className="whitespace-nowrap px-2 py-2 font-mono text-[10px] text-slate-600">{formatClock(event.completedAt)}</td>
                    <td className="px-2 py-2 font-mono text-[10px] text-slate-300"><span className="mr-2 text-slate-600">{event.method}</span>{event.path}</td>
                    <td className="px-2 py-2 text-[11px] text-slate-400">{event.upstreamName}</td>
                    <td className="px-2 py-2"><span className={clsx('rounded-md border px-1.5 py-0.5 font-mono text-[9px]', event.statusCode < 400 ? 'border-neon-mint/20 text-neon-mint' : 'border-neon-rose/20 text-neon-rose')}>{event.statusCode || 'ERR'}</span></td>
                    <td className="num px-2 py-2 text-right font-mono text-[10px] text-slate-300">{formatMs(event.latencyMs)}</td>
                    <td className="px-2 py-2 text-right font-mono text-[9px] text-slate-600">{event.algorithm}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex min-h-24 items-center justify-center text-[11px] text-slate-600">No requests yet. Use the request generator above to exercise the live data plane.</div>
        )}
      </Panel>

      <div className="grid gap-3 lg:grid-cols-3">
        <InfoCard icon={<ShieldCheck className="h-4 w-4 text-neon-mint" />} title="Health-aware routing" text="Periodic HTTP health checks remove failing nodes from the eligible pool; recovery makes them routable again." />
        <InfoCard icon={<Activity className="h-4 w-4 text-neon-cyan" />} title="Measured, not simulated" text="Latency and concurrency come from actual proxy requests. Recent event history and percentile samples are bounded in memory." />
        <InfoCard icon={<ArrowUpRight className="h-4 w-4 text-[#c3b9ff]" />} title="Bring your own services" text="Set LOADMIND_UPSTREAMS to a JSON array of HTTP(S) endpoints; the three demo services are just the local default." />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-1 font-mono text-[9px] text-slate-700">
        <span>Request query strings and bodies are not stored in the proxy event log.</span>
        <span className="flex items-center gap-1.5"><Clock3 className="h-3 w-3" />uptime {Math.floor(status?.uptimeSeconds ?? 0)}s</span>
      </div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-slate-600">{label}</div>
      <div className="num mt-1 truncate font-mono text-[11px] font-semibold text-slate-200">{value}</div>
    </div>
  );
}

function InfoCard({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="panel-flat flex gap-3 p-3.5">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0">
        <h3 className="text-[12px] font-semibold text-slate-200">{title}</h3>
        <p className="mt-1 text-[10.5px] leading-relaxed text-slate-500">{text}</p>
      </div>
    </div>
  );
}
