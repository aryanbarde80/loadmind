import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  AlertTriangle,
  Bomb,
  Flame,
  HeartCrack,
  Play,
  RotateCcw,
  ServerOff,
  Skull,
  Timer,
  Trash2,
  TrendingDown,
} from 'lucide-react';
import { clsx } from '@/lib/clsx';
import { useApp } from '@/state/store';
import { Panel, Slider, Meter, StatusBadge, Toggle, EmptyState } from '@/components/ui/primitives';
import { fmtMs, fmtPct } from '@/lib/format';
import { AUTOPILOT_THRESHOLDS } from '@/ai/decisionEngine';
import { runBattle } from '@/simulation/headless';
import type { BattleResult } from '@/types';

export function ChaosView() {
  const snapshot = useApp((s) => s.snapshot);
  const killServer = useApp((s) => s.killServer);
  const adjustLatency = useApp((s) => s.adjustLatency);
  const adjustErrors = useApp((s) => s.adjustErrors);
  const adjustCapacity = useApp((s) => s.adjustCapacity);
  const clearServerChaos = useApp((s) => s.clearServerChaos);
  const clearAllChaos = useApp((s) => s.clearAllChaos);
  const setChaos = useApp((s) => s.setChaos);
  const randomFailure = useApp((s) => s.randomFailure);

  const chaos = snapshot.chaos;
  const killedCount = snapshot.servers.filter((s) => chaos.killed[s.id]).length;

  return (
    <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-3">
        {/* ------------------------------------------------- chaos read-out */}
        <div className="relative overflow-hidden rounded-2xl border border-neon-rose/25 bg-gradient-to-br from-neon-rose/[0.12] via-white/[0.02] to-transparent p-4">
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-neon-rose/10 blur-3xl" />
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Flame className="h-4 w-4 text-neon-rose" />
                <span className="eyebrow text-neon-rose/80">Chaos mode</span>
              </div>
              <h2 className="mt-1 font-display text-[22px] font-bold tracking-tight text-white">
                Break the infrastructure on purpose
              </h2>
              <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-slate-500">
                Kill nodes, inject latency and errors, remove capacity, then watch how the active algorithm and AI Autopilot
                react. Everything here feeds the same simulation the live dashboard is running.
              </p>
            </div>
            <button type="button" className="btn btn-danger px-3 py-2 text-[12px]" onClick={clearAllChaos}>
              <RotateCcw className="h-3.5 w-3.5" /> Clear all chaos
            </button>
          </div>

          <div className="relative mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <ChaosReadout
              label="Traffic spike"
              value={chaos.trafficMultiplier === 1 ? 'none' : `+${((chaos.trafficMultiplier - 1) * 100).toFixed(0)}%`}
              tone={chaos.trafficMultiplier > 1.5 ? 'bad' : chaos.trafficMultiplier > 1 ? 'warn' : 'good'}
            />
            <ChaosReadout
              label="Servers offline"
              value={killedCount === 0 ? 'none' : `${killedCount} offline`}
              tone={killedCount > 0 ? 'bad' : 'good'}
            />
            <ChaosReadout
              label="Latency injected"
              value={latencySummary(chaos.latencyPenalties)}
              tone={maxOf(chaos.latencyPenalties) > 0 ? 'warn' : 'good'}
            />
            <ChaosReadout
              label="Error rate injected"
              value={errorSummary(chaos.errorPenalties)}
              tone={maxOf(chaos.errorPenalties) > 0 ? 'bad' : 'good'}
            />
          </div>
        </div>

        {/* ------------------------------------------------ per-server chaos */}
        <Panel
          eyebrow="Per-upstream fault injection"
          title="Target individual servers"
          icon={<ServerOff className="h-3.5 w-3.5" />}
          bodyClassName="p-0"
        >
          <div className="divide-y divide-white/[0.05]">
            {snapshot.servers.map((server) => {
              const latency = chaos.latencyPenalties[server.id] ?? 0;
              const errors = chaos.errorPenalties[server.id] ?? 0;
              const capacity = chaos.capacityReductions[server.id] ?? 0;
              const killed = chaos.killed[server.id] === true;
              const dirty = latency > 0 || errors > 0 || capacity > 0 || killed;

              return (
                <div key={server.id} className="flex flex-wrap items-center gap-3 px-3.5 py-3">
                  <div className="w-[150px] shrink-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[12.5px] font-bold text-slate-100">{server.name}</span>
                      <StatusBadge status={server.status} />
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-slate-500">
                      {server.activeConnections} conn · {fmtMs(server.ewmaLatencyMs)} · {(server.errorRate * 100).toFixed(2)}% err
                    </div>
                  </div>

                  <div className="min-w-[120px] flex-1">
                    <Meter value={server.utilization * 100} tone={server.utilization > 0.9 ? 'rose' : server.utilization > 0.7 ? 'amber' : 'mint'} height={4} />
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {latency > 0 && <span className="chip border-neon-amber/30 text-[9.5px] text-neon-amber">+{latency}ms</span>}
                      {errors > 0 && (
                        <span className="chip border-neon-rose/30 text-[9.5px] text-neon-rose">+{(errors * 100).toFixed(0)}% err</span>
                      )}
                      {capacity > 0 && (
                        <span className="chip border-neon-violet/30 text-[9.5px] text-[#c3b9ff]">−{(capacity * 100).toFixed(0)}% cap</span>
                      )}
                      {!dirty && <span className="chip text-[9.5px] text-slate-600">nominal</span>}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      className={clsx('btn px-2 py-1 text-[11px]', killed ? 'btn-primary' : 'btn-danger')}
                      onClick={() => killServer(server.id, !killed)}
                    >
                      {killed ? 'Revive' : 'Kill'}
                    </button>
                    <button type="button" className="btn px-2 py-1 text-[11px]" onClick={() => adjustLatency(server.id, 200)}>
                      <Timer className="h-3 w-3" /> +200ms
                    </button>
                    <button type="button" className="btn px-2 py-1 text-[11px]" onClick={() => adjustErrors(server.id, 0.05)}>
                      <HeartCrack className="h-3 w-3" /> +5% err
                    </button>
                    <button type="button" className="btn px-2 py-1 text-[11px]" onClick={() => adjustCapacity(server.id, 0.25)}>
                      <TrendingDown className="h-3 w-3" /> −25% cap
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost px-2 py-1 text-[11px]"
                      onClick={() => {
                        clearServerChaos(server.id);
                        killServer(server.id, false);
                      }}
                      title="Reset this server"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        <ReactionTest />
      </div>

      {/* ------------------------------------------------------- global chaos */}
      <div className="min-w-0 space-y-3">
        <Panel eyebrow="Global chaos" title="System-wide failures" icon={<Bomb className="h-3.5 w-3.5" />}>
          <div className="space-y-4">
            <Slider
              label="Traffic multiplier"
              value={chaos.trafficMultiplier}
              min={1}
              max={8}
              step={0.25}
              accent="amber"
              onChange={(trafficMultiplier) => setChaos({ trafficMultiplier })}
              format={(v) => `${v.toFixed(2)}×`}
            />

            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn btn-danger justify-center text-[12px]" onClick={() => setChaos({ trafficMultiplier: 3 })}>
                <Flame className="h-3.5 w-3.5" /> +200% spike
              </button>
              <button type="button" className="btn btn-danger justify-center text-[12px]" onClick={randomFailure}>
                <Skull className="h-3.5 w-3.5" /> Random failure
              </button>
            </div>

            <div className="rounded-lg border border-white/[0.06] bg-black/25 p-3">
              <Toggle
                checked={chaos.randomFailures}
                onChange={(randomFailures) => setChaos({ randomFailures })}
                size="sm"
                accent="rose"
                label="Chaos monkey"
                description="Randomly kill servers and let them recover automatically."
              />
              {chaos.randomFailures && (
                <div className="mt-3">
                  <Slider
                    label="Failure rate"
                    value={chaos.failureRatePerSec * 100}
                    min={0.5}
                    max={20}
                    step={0.5}
                    accent="rose"
                    onChange={(v) => setChaos({ failureRatePerSec: v / 100 })}
                    format={(v) => `${v.toFixed(1)}%/s`}
                  />
                </div>
              )}
            </div>

            <div className="rounded-lg border border-neon-amber/25 bg-neon-amber/[0.05] p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-[1px] h-3.5 w-3.5 shrink-0 text-neon-amber" />
                <div className="text-[11.5px] leading-relaxed text-slate-300">
                  With AI Autopilot on, every injection is a live test: the decision engine scores all eight algorithms
                  against the damage and switches when the margin clears{' '}
                  <span className="font-mono text-neon-amber">{AUTOPILOT_THRESHOLDS.SWITCH_MARGIN} points</span>.
                </div>
              </div>
            </div>
          </div>
        </Panel>

        <Panel eyebrow="Live impact" title="What the damage is doing">
          <ImpactPanel />
        </Panel>
      </div>
    </div>
  );
}

function ImpactPanel() {
  const snapshot = useApp((s) => s.snapshot);
  const m = snapshot.metrics;
  const baseline = useMemo(() => snapshot.servers.map((s) => s.baseLatencyMs), [snapshot.servers.length]);
  const avgBaseline = baseline.length ? baseline.reduce((a, b) => a + b, 0) / baseline.length : 1;
  const latencyMultiple = m.avgLatencyMs / Math.max(1, avgBaseline);

  return (
    <div className="space-y-3">
      <Row label="Throughput" value={`${m.throughput.toFixed(0)} rps`} tone={m.throughput < snapshot.config.baseRps * 0.6 ? 'bad' : 'good'} />
      <Row label="Avg latency" value={`${fmtMs(m.avgLatencyMs)} (${latencyMultiple.toFixed(1)}× baseline)`} tone={latencyMultiple > 3 ? 'bad' : latencyMultiple > 1.8 ? 'warn' : 'good'} />
      <Row label="p95 latency" value={fmtMs(m.p95Ms)} tone={m.p95Ms > 700 ? 'bad' : m.p95Ms > 300 ? 'warn' : 'good'} />
      <Row label="Error rate" value={fmtPct(m.errorRate, 2)} tone={m.errorRate > 0.05 ? 'bad' : m.errorRate > 0.01 ? 'warn' : 'good'} />
      <Row label="Healthy upstreams" value={`${m.healthyCount}/${snapshot.servers.length}`} tone={m.downCount ? 'bad' : 'good'} />
      <Row label="In flight" value={String(snapshot.inFlight)} tone={snapshot.inFlight > 400 ? 'warn' : 'good'} />
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone: 'good' | 'warn' | 'bad' }) {
  const color = tone === 'bad' ? 'text-neon-rose' : tone === 'warn' ? 'text-neon-amber' : 'text-neon-mint';
  return (
    <div className="flex items-center justify-between border-b border-white/[0.05] pb-2 last:border-0 last:pb-0">
      <span className="text-[11.5px] text-slate-500">{label}</span>
      <span className={clsx('num font-mono text-[12px] font-semibold', color)}>{value}</span>
    </div>
  );
}

/**
 * Runs the current live chaos through a fast headless battle so you can see
 * how each algorithm would have coped with the exact damage you injected.
 */
function ReactionTest() {
  const snapshot = useApp((s) => s.snapshot);
  const [results, setResults] = useState<BattleResult[] | null>(null);
  const [busy, setBusy] = useState(false);

  const run = () => {
    setBusy(true);
    window.setTimeout(() => {
      const chaos = snapshot.chaos;
      const scenario = {
        name: 'Live chaos snapshot',
        requests: 4000,
        serverCount: snapshot.servers.length,
        pattern: snapshot.config.pattern,
        baseRps: snapshot.config.baseRps,
        durationSec: 45,
        chaos: {
          killCount: snapshot.servers.filter((s) => chaos.killed[s.id]).length,
          latencyPenaltyMs: maxOf(chaos.latencyPenalties),
          errorPenalty: maxOf(chaos.errorPenalties),
          capacityReduction: maxOf(chaos.capacityReductions),
          trafficMultiplier: chaos.trafficMultiplier,
        },
        seed: 777,
      };
      const outcome = runBattle(scenario, ['round-robin', 'least-connections', 'least-response-time', 'autopilot']);
      setResults(outcome.results);
      setBusy(false);
    }, 40);
  };

  const data = (results ?? []).map((r) => ({
    name: r.name.length > 16 ? `${r.name.slice(0, 15)}…` : r.name,
    latency: Number(r.avgLatencyMs.toFixed(0)),
    errors: Number((r.errorRate * 100).toFixed(2)),
  }));

  return (
    <Panel
      eyebrow="Reaction test"
      title="How each algorithm handles this exact damage"
      icon={<Play className="h-3.5 w-3.5" />}
      actions={
        <button type="button" className="btn btn-primary px-2.5 py-1 text-[11.5px]" onClick={run} disabled={busy}>
          {busy ? <Timer className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          {busy ? 'Running…' : 'Run 4k-request reaction test'}
        </button>
      }
    >
      {!results ? (
        <EmptyState
          icon={<Bomb className="h-7 w-7" />}
          title="No reaction test yet"
          description="Inject some chaos, then replay the same damage against Round Robin, Least Connections, Least Response Time and AI Autopilot."
        />
      ) : (
        <div className="space-y-3">
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={data} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
              <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 9.5, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval={0} />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={44} />
              <Tooltip
                contentStyle={{
                  background: 'rgba(7,10,18,0.96)',
                  border: '1px solid rgba(148,163,184,0.18)',
                  borderRadius: 10,
                  fontSize: 11,
                }}
                cursor={{ fill: 'rgba(148,163,184,0.06)' }}
              />
              <Bar dataKey="latency" name="avg ms" radius={[3, 3, 0, 0]}>
                {data.map((entry, i) => (
                  <Cell key={entry.name} fill={['#3b9dfd', '#22d3ee', '#34e5b0', '#8b7cf6'][i % 4]} fillOpacity={0.8} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {results.map((result, i) => (
              <div key={result.algorithm} className="rounded-lg border border-white/[0.06] bg-black/25 p-2.5">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: ['#3b9dfd', '#22d3ee', '#34e5b0', '#8b7cf6'][i % 4] }} />
                  <span className="truncate text-[11.5px] font-semibold text-slate-200">{result.name}</span>
                </div>
                <div className="num mt-1.5 font-display text-[17px] font-semibold text-white">{fmtMs(result.avgLatencyMs)}</div>
                <div className="mt-0.5 font-mono text-[10px] text-slate-500">
                  p95 {fmtMs(result.p95Ms)} · {fmtPct(result.errorRate, 2)} err
                </div>
                <div className="mt-1.5">
                  <Meter value={result.score} tone="cyan" height={3} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

function maxOf(record: Record<string, number>): number {
  const values = Object.values(record);
  return values.length ? Math.max(...values) : 0;
}

function latencySummary(record: Record<string, number>): string {
  const max = maxOf(record);
  return max > 0 ? `+${max.toFixed(0)}ms` : 'none';
}

function errorSummary(record: Record<string, number>): string {
  const max = maxOf(record);
  return max > 0 ? `+${(max * 100).toFixed(0)}%` : 'none';
}

function ChaosReadout({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'good' | 'warn' | 'bad';
}) {
  const color = tone === 'bad' ? 'text-neon-rose' : tone === 'warn' ? 'text-neon-amber' : 'text-neon-mint';
  return (
    <div className="rounded-lg border border-white/[0.07] bg-black/30 px-3 py-2">
      <div className="eyebrow">{label}</div>
      <div className={clsx('num mt-0.5 font-mono text-[15px] font-semibold', color)}>{value}</div>
    </div>
  );
}
