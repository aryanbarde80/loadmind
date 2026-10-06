import { Activity, Layers3, Network, TriangleAlert } from 'lucide-react';
import { useApp } from '@/state/store';
import { Panel, Stat } from '@/components/ui/primitives';
import { TrafficMap } from '@/components/traffic/TrafficMap';
import { TrafficSimulatorPanel } from '@/components/traffic/TrafficSimulatorPanel';
import { ActiveAlgorithmBanner } from '@/components/algorithms/ActiveAlgorithmBanner';
import { AutopilotPanel } from '@/components/autopilot/AutopilotPanel';
import { ServerGrid } from '@/components/servers/ServerGrid';
import { ChartFrame, DistributionChart, LatencyChart, ThroughputChart } from '@/components/charts/LiveCharts';
import { fmtMs, fmtPct } from '@/lib/format';

export function ControlView() {
  const snapshot = useApp((s) => s.snapshot);
  const selectServer = useApp((s) => s.selectServer);
  const m = snapshot.metrics;

  return (
    <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_370px]">
      {/* ------------------------------------------------------- main column */}
      <div className="min-w-0 space-y-3">
        <ActiveAlgorithmBanner />

        {/* KPI strip */}
        <div className="panel grid grid-cols-2 gap-4 p-3.5 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Throughput" value={m.throughput.toFixed(0)} unit="rps" sub={`${m.arrivalRate.toFixed(0)} arriving`} />
          <Stat
            label="Avg latency"
            value={fmtMs(m.avgLatencyMs)}
            tone={m.avgLatencyMs > 400 ? 'bad' : m.avgLatencyMs > 180 ? 'warn' : 'good'}
            sub={`p50 ${fmtMs(m.p50Ms)}`}
          />
          <Stat
            label="p95 latency"
            value={fmtMs(m.p95Ms)}
            tone={m.p95Ms > 700 ? 'bad' : m.p95Ms > 300 ? 'warn' : 'good'}
            sub={`p99 ${fmtMs(m.p99Ms)}`}
          />
          <Stat
            label="Error rate"
            value={fmtPct(m.errorRate, 2)}
            tone={m.errorRate > 0.05 ? 'bad' : m.errorRate > 0.01 ? 'warn' : 'good'}
            sub={`${m.failed.toLocaleString()} failed`}
          />
          <Stat
            label="Fairness"
            value={m.fairness.toFixed(3)}
            tone={m.fairness > 0.95 ? 'good' : m.fairness > 0.85 ? 'warn' : 'bad'}
            sub={`gini ${m.gini.toFixed(3)}`}
          />
          <Stat
            label="Completed"
            value={m.completed.toLocaleString()}
            sub={`${m.totalRequests.toLocaleString()} arrived`}
          />
        </div>

        {/* Traffic map */}
        <Panel
          eyebrow="Live traffic map"
          title="Request flow · clients → internet → LoadMind → pool"
          icon={<Network className="h-3.5 w-3.5" />}
          className="min-w-0"
          bodyClassName="p-0"
          actions={
            <div className="flex items-center gap-3 font-mono text-[10px]">
              <Legend color="#22d3ee" label="success" />
              <Legend color="#fb5a7a" label="failed" />
              <span className="text-slate-600">click a server to inspect</span>
            </div>
          }
        >
          <div className="h-[300px] w-full sm:h-[360px]">
            <TrafficMap onSelectServer={selectServer} />
          </div>
        </Panel>

        {/* Charts */}
        <div className="grid min-w-0 gap-3 lg:grid-cols-2">
          <ChartFrame title="Throughput vs arrivals" hint="completed/s · arrivals/s · latency">
            <ThroughputChart />
          </ChartFrame>
          <ChartFrame title="Latency percentiles" hint="avg · p95 · cpu">
            <LatencyChart />
          </ChartFrame>
        </div>

        <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <ChartFrame title="Requests distributed per server" hint="live counters">
            <DistributionChart />
          </ChartFrame>
          <Panel eyebrow="Pool pressure" title="Saturation & health" icon={<Activity className="h-3.5 w-3.5" />}>
            <PoolPressure />
          </Panel>
        </div>

        <ServerGrid />
      </div>

      {/* ------------------------------------------------------ side column */}
      <div className="min-w-0 space-y-3">
        <AutopilotPanel />
        <TrafficSimulatorPanel />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1 text-slate-400">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
      {label}
    </span>
  );
}

function PoolPressure() {
  const servers = useApp((s) => s.snapshot.servers);
  const metrics = useApp((s) => s.snapshot.metrics);
  const saturated = servers.filter((s) => !s.down && s.utilization > 0.85);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Cell label="Pool CPU" value={`${metrics.poolCpu.toFixed(0)}%`} tone={metrics.poolCpu > 80 ? 'bad' : metrics.poolCpu > 60 ? 'warn' : 'good'} />
        <Cell label="Pool MEM" value={`${metrics.poolMemory.toFixed(0)}%`} tone={metrics.poolMemory > 85 ? 'bad' : metrics.poolMemory > 70 ? 'warn' : 'good'} />
        <Cell label="In flight" value={String(servers.reduce((a, s) => a + s.activeConnections, 0))} tone="default" />
        <Cell
          label="Offered load"
          value={fmtPct(metrics.saturation)}
          tone={metrics.saturation > 0.9 ? 'bad' : metrics.saturation > 0.7 ? 'warn' : 'good'}
        />
      </div>

      <div className="space-y-1.5">
        {servers.map((server) => (
          <div key={server.id} className="flex items-center gap-2.5">
            <span className="w-[74px] shrink-0 font-mono text-[10.5px] text-slate-400">{server.name}</span>
            <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300"
                style={{
                  width: `${Math.min(100, server.utilization * 100)}%`,
                  background:
                    server.utilization > 0.9
                      ? 'linear-gradient(90deg,#fb5a7a,#f472b6)'
                      : server.utilization > 0.7
                        ? 'linear-gradient(90deg,#fbbf24,#fb923c)'
                        : 'linear-gradient(90deg,#34e5b0,#22d3ee)',
                }}
              />
              {/* saturation marker */}
              <div className="absolute inset-y-0 left-[85%] w-px bg-white/30" />
            </div>
            <span className="num w-11 shrink-0 text-right font-mono text-[10.5px] text-slate-500">
              {(server.utilization * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>

      <div
        className={
          saturated.length
            ? 'flex items-start gap-2 rounded-lg border border-neon-amber/30 bg-neon-amber/[0.07] px-3 py-2 text-[11.5px] text-neon-amber'
            : 'flex items-start gap-2 rounded-lg border border-white/[0.06] bg-black/25 px-3 py-2 text-[11.5px] text-slate-500'
        }
      >
        {saturated.length ? (
          <>
            <TriangleAlert className="mt-[1px] h-3.5 w-3.5 shrink-0" />
            <span>
              {saturated.map((s) => s.name).join(', ')} {saturated.length === 1 ? 'is' : 'are'} above 85% of capacity —
              queueing delay is growing super-linearly.
            </span>
          </>
        ) : (
          <>
            <Layers3 className="mt-[1px] h-3.5 w-3.5 shrink-0" />
            <span>No upstream is above 85% utilisation. The pool has headroom for a spike.</span>
          </>
        )}
      </div>
    </div>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone: 'good' | 'warn' | 'bad' | 'default' }) {
  const color =
    tone === 'bad' ? 'text-neon-rose' : tone === 'warn' ? 'text-neon-amber' : tone === 'good' ? 'text-neon-mint' : 'text-slate-100';
  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/25 px-2.5 py-2">
      <div className="eyebrow">{label}</div>
      <div className={`num mt-0.5 font-display text-[15px] font-semibold ${color}`}>{value}</div>
    </div>
  );
}
