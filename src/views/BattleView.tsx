import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Award, Flag, Play, Swords, Timer, Zap } from 'lucide-react';
import { clsx } from '@/lib/clsx';
import { useApp } from '@/state/store';
import { Panel, Slider, Segmented, Meter, EmptyState } from '@/components/ui/primitives';
import { SCENARIO_PRESETS, PATTERN_OPTIONS, chaosSummary } from '@/simulation/scenarios';
import { BUILTIN_ALGORITHMS } from '@/algorithms/registry';
import { fmtMs, fmtPct } from '@/lib/format';
import type { AlgorithmId, BattleResult, TrafficPattern } from '@/types';

const COLORS = ['#22d3ee', '#8b7cf6', '#34e5b0', '#fbbf24', '#fb5a7a', '#3b9dfd'];

const tooltipStyle = {
  contentStyle: {
    background: 'rgba(7,10,18,0.96)',
    border: '1px solid rgba(148,163,184,0.18)',
    borderRadius: 10,
    fontSize: 11,
    fontFamily: 'JetBrains Mono, monospace',
  },
  labelStyle: { color: '#94a3b8', fontSize: 10 },
} as const;

const AXIS = { stroke: 'rgba(148,163,184,0.25)', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' };

export function BattleView() {
  const battle = useApp((s) => s.battle);
  const custom = useApp((s) => s.custom);
  const setBattleScenario = useApp((s) => s.setBattleScenario);
  const patchBattleScenario = useApp((s) => s.patchBattleScenario);
  const toggleBattleAlgorithm = useApp((s) => s.toggleBattleAlgorithm);
  const runBattle = useApp((s) => s.runBattle);

  const options: { id: AlgorithmId; label: string; short: string }[] = [
    ...BUILTIN_ALGORITHMS.map((a) => ({ id: a.id as AlgorithmId, label: a.name, short: a.short })),
    { id: 'autopilot', label: 'AI Autopilot', short: 'AI' },
    ...(custom.records.length ? [{ id: 'custom' as AlgorithmId, label: custom.records[0].name, short: 'CS' }] : []),
  ];

  const busy = battle.status === 'running';

  return (
    <div className="space-y-3">
      {/* ------------------------------------------------------------ header */}
      <div className="panel flex flex-wrap items-center justify-between gap-4 p-4">
        <div>
          <div className="eyebrow">Algorithm battle mode</div>
          <h2 className="mt-1 font-display text-[20px] font-bold tracking-tight text-white">
            Identical traffic. Different schedulers.
          </h2>
          <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-slate-500">
            Every algorithm receives the exact same seeded request stream, the same pool and the same chaos. Each request is
            genuinely routed by the real algorithm implementation — the numbers below come from the simulation, not from
            estimates.
          </p>
        </div>
        <button type="button" className="btn btn-primary px-4 py-2.5 text-[13px]" onClick={runBattle} disabled={busy}>
          {busy ? <Timer className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {busy ? 'Simulating…' : 'Run battle'}
        </button>
      </div>

      <div className="grid gap-3 xl:grid-cols-[360px_minmax(0,1fr)]">
        {/* ------------------------------------------------------ left config */}
        <div className="space-y-3">
          <Panel eyebrow="Traffic scenario" title="Scenario preset" icon={<Flag className="h-3.5 w-3.5" />}>
            <div className="space-y-1.5">
              {SCENARIO_PRESETS.map((preset) => {
                const active = battle.scenarioId === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setBattleScenario(preset.id)}
                    className={clsx(
                      'w-full rounded-lg border px-3 py-2 text-left transition',
                      active
                        ? 'border-neon-cyan/45 bg-neon-cyan/[0.07]'
                        : 'border-white/[0.07] bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]',
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className={clsx('text-[12.5px] font-semibold', active ? 'text-neon-cyan' : 'text-slate-200')}>
                        {preset.name}
                      </span>
                      <span className="font-mono text-[10px] text-slate-500">
                        {preset.requests.toLocaleString()} req
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{preset.description}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <span className="chip text-[9.5px]">{preset.pattern}</span>
                      <span className="chip text-[9.5px]">{preset.serverCount} servers</span>
                      {preset.chaos.killCount > 0 && <span className="chip text-[9.5px] text-neon-rose">-{preset.chaos.killCount} node</span>}
                      {preset.chaos.latencyPenaltyMs > 0 && (
                        <span className="chip text-[9.5px] text-neon-amber">+{preset.chaos.latencyPenaltyMs}ms</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </Panel>

          <Panel eyebrow="Customise" title="Scenario parameters">
            <div className="space-y-3.5">
              <Slider
                label="Requests"
                value={battle.scenario.requests}
                min={2000}
                max={40000}
                step={1000}
                onChange={(requests) => patchBattleScenario({ requests })}
                format={(v) => v.toLocaleString()}
              />
              <Slider
                label="Servers"
                value={battle.scenario.serverCount}
                min={2}
                max={10}
                step={1}
                onChange={(serverCount) => patchBattleScenario({ serverCount })}
                format={(v) => `${v} nodes`}
              />
              <Slider
                label="Base rps"
                value={battle.scenario.baseRps}
                min={100}
                max={1500}
                step={25}
                onChange={(baseRps) => patchBattleScenario({ baseRps })}
                format={(v) => `${v} rps`}
              />
              <div>
                <div className="label">Traffic pattern</div>
                <select
                  className="field"
                  value={battle.scenario.pattern}
                  onChange={(e) => patchBattleScenario({ pattern: e.target.value as TrafficPattern })}
                >
                  {PATTERN_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-3 rounded-lg border border-neon-rose/20 bg-neon-rose/[0.04] p-3">
                <div className="eyebrow text-neon-rose/80">Chaos injected during the battle</div>
                <Slider
                  label="Traffic multiplier"
                  value={battle.scenario.chaos.trafficMultiplier}
                  min={1}
                  max={6}
                  step={0.25}
                  accent="amber"
                  onChange={(v) => patchBattleScenario({ chaos: { ...battle.scenario.chaos, trafficMultiplier: v } })}
                  format={(v) => `${v.toFixed(2)}×`}
                />
                <Slider
                  label="Servers killed"
                  value={battle.scenario.chaos.killCount}
                  min={0}
                  max={4}
                  step={1}
                  accent="amber"
                  onChange={(v) => patchBattleScenario({ chaos: { ...battle.scenario.chaos, killCount: v } })}
                  format={(v) => `${v} offline`}
                />
                <Slider
                  label="Latency penalty"
                  value={battle.scenario.chaos.latencyPenaltyMs}
                  min={0}
                  max={1000}
                  step={25}
                  accent="amber"
                  onChange={(v) => patchBattleScenario({ chaos: { ...battle.scenario.chaos, latencyPenaltyMs: v } })}
                  format={(v) => `+${v}ms`}
                />
                <Slider
                  label="Error penalty"
                  value={battle.scenario.chaos.errorPenalty}
                  min={0}
                  max={0.4}
                  step={0.01}
                  accent="amber"
                  onChange={(v) => patchBattleScenario({ chaos: { ...battle.scenario.chaos, errorPenalty: v } })}
                  format={(v) => `+${(v * 100).toFixed(0)}%`}
                />
                <Slider
                  label="Capacity removed"
                  value={battle.scenario.chaos.capacityReduction}
                  min={0}
                  max={0.7}
                  step={0.05}
                  accent="amber"
                  onChange={(v) => patchBattleScenario({ chaos: { ...battle.scenario.chaos, capacityReduction: v } })}
                  format={(v) => `−${(v * 100).toFixed(0)}%`}
                />
              </div>

              <div className="rounded-lg border border-white/[0.06] bg-black/25 px-3 py-2 font-mono text-[10.5px] text-slate-500">
                chaos: <span className="text-slate-300">{chaosSummary(battle.scenario)}</span>
              </div>
            </div>
          </Panel>

          <Panel eyebrow="Contenders" title="Select 2–4 algorithms" icon={<Swords className="h-3.5 w-3.5" />}>
            <div className="grid grid-cols-2 gap-1.5">
              {options.map((option) => {
                const selected = battle.selected.includes(option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={busy}
                    onClick={() => toggleBattleAlgorithm(option.id)}
                    className={clsx(
                      'flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition',
                      selected
                        ? 'border-neon-cyan/45 bg-neon-cyan/[0.08] text-white'
                        : 'border-white/[0.07] bg-white/[0.02] text-slate-400 hover:border-white/20',
                      busy && 'opacity-60',
                    )}
                  >
                    <span
                      className={clsx(
                        'grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] border text-[9px] font-bold',
                        selected ? 'border-neon-cyan bg-neon-cyan text-void-950' : 'border-white/20',
                      )}
                    >
                      {selected ? '✓' : ''}
                    </span>
                    <span className="truncate text-[11.5px] font-medium">{option.label}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[10.5px] leading-snug text-slate-600">
              AI Autopilot competes by re-evaluating and switching algorithms mid-run, exactly as it does live.
            </p>
          </Panel>
        </div>

        {/* ----------------------------------------------------- right results */}
        <div className="min-w-0 space-y-3">
          {busy && (
            <div className="panel p-6">
              <div className="mb-2 flex items-center justify-between font-mono text-[11px] text-slate-400">
                <span>{battle.label || 'Simulating…'}</span>
                <span className="num">{(battle.progress * 100).toFixed(0)}%</span>
              </div>
              <Meter value={battle.progress * 100} tone="cyan" height={6} />
              <div className="mt-3 grid grid-cols-4 gap-2">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="h-full rounded-full bg-neon-cyan/70 transition-all duration-500"
                      style={{ width: `${Math.max(0, Math.min(1, battle.progress * 4 - i)) * 100}%` }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {battle.error && (
            <div className="panel border-neon-rose/40 bg-neon-rose/[0.06] p-4 text-[12.5px] text-neon-rose">
              {battle.error}
            </div>
          )}

          {battle.status === 'done' && battle.results.length > 0 ? (
            <BattleResults />
          ) : (
            !busy && (
              <Panel>
                <EmptyState
                  icon={<Swords className="h-8 w-8" />}
                  title="No battle results yet"
                  description="Pick a scenario, choose 2–4 algorithms, and hit Run battle. Each contender gets the same seeded traffic."
                  action={
                    <button type="button" className="btn btn-primary text-[12px]" onClick={runBattle}>
                      <Zap className="h-3.5 w-3.5" /> Run battle now
                    </button>
                  }
                />
              </Panel>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function BattleResults() {
  const battle = useApp((s) => s.battle);
  const results = battle.results;
  const winner = results[0];

  const latencyData = results.map((r, i) => ({
    name: r.name,
    avg: Number(r.avgLatencyMs.toFixed(1)),
    p95: Number(r.p95Ms.toFixed(0)),
    p99: Number(r.p99Ms.toFixed(0)),
    color: COLORS[i % COLORS.length],
  }));

  const errorData = results.map((r, i) => ({
    name: r.name,
    errors: Number((r.errorRate * 100).toFixed(2)),
    throughput: Number(r.throughput.toFixed(0)),
    fairness: Number((r.fairness * 100).toFixed(1)),
    score: Number(r.score.toFixed(1)),
    color: COLORS[i % COLORS.length],
  }));

  // Align the per-algorithm latency series on index so they can share an x-axis.
  const seriesData = useMemo(() => {
    const length = Math.min(...results.map((r) => r.latencySeries.length));
    if (!Number.isFinite(length) || length <= 0) return [];
    const rows: Record<string, number | string>[] = [];
    for (let i = 0; i < length; i++) {
      const row: Record<string, number | string> = { t: `${results[0].latencySeries[i].t.toFixed(0)}s` };
      for (const result of results) {
        row[result.name] = Number(result.latencySeries[i].latency.toFixed(0));
      }
      rows.push(row);
    }
    return rows;
  }, [results]);

  return (
    <div className="space-y-3">
      {/* Winner */}
      <div className="relative overflow-hidden rounded-2xl border border-neon-amber/30 bg-gradient-to-br from-neon-amber/[0.14] via-white/[0.02] to-transparent p-5">
        <div className="pointer-events-none absolute -right-10 -top-16 h-52 w-52 rounded-full bg-neon-amber/15 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="grid h-14 w-14 place-items-center rounded-xl border border-neon-amber/40 bg-neon-amber/10">
              <Award className="h-7 w-7 text-neon-amber" />
            </div>
            <div>
              <div className="eyebrow text-neon-amber/80">Winner</div>
              <div className="font-display text-[26px] font-bold leading-none tracking-tight text-white">
                🏆 {winner.name}
              </div>
              <p className="mt-1.5 max-w-xl text-[12px] leading-relaxed text-slate-400">{battle.winnerReason}</p>
            </div>
          </div>
          <div className="flex gap-4">
            <WinStat label="Avg latency" value={fmtMs(winner.avgLatencyMs)} />
            <WinStat label="p95" value={fmtMs(winner.p95Ms)} />
            <WinStat label="Errors" value={fmtPct(winner.errorRate, 2)} />
            <WinStat label="Score" value={winner.score.toFixed(1)} />
            <WinStat label="Runtime" value={`${battle.durationMs.toFixed(0)}ms`} />
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel eyebrow="Latency" title="Average · p95 · p99" bodyClassName="p-2">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={latencyData} margin={{ top: 10, right: 10, left: -12, bottom: 0 }}>
              <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
              <XAxis dataKey="name" tick={{ ...AXIS, fontSize: 9.5 }} axisLine={false} tickLine={false} interval={0} />
              <YAxis tick={AXIS} axisLine={false} tickLine={false} width={46} />
              <Tooltip {...tooltipStyle} cursor={{ fill: 'rgba(148,163,184,0.06)' }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="avg" name="avg ms" radius={[3, 3, 0, 0]}>
                {latencyData.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} fillOpacity={0.85} />
                ))}
              </Bar>
              <Bar dataKey="p95" name="p95 ms" fill="#fbbf24" fillOpacity={0.7} radius={[3, 3, 0, 0]} />
              <Bar dataKey="p99" name="p99 ms" fill="#fb5a7a" fillOpacity={0.6} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel eyebrow="Reliability &amp; efficiency" title="Errors · throughput · fairness" bodyClassName="p-2">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={errorData} margin={{ top: 10, right: 10, left: -12, bottom: 0 }}>
              <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
              <XAxis dataKey="name" tick={{ ...AXIS, fontSize: 9.5 }} axisLine={false} tickLine={false} interval={0} />
              <YAxis tick={AXIS} axisLine={false} tickLine={false} width={46} />
              <Tooltip {...tooltipStyle} cursor={{ fill: 'rgba(148,163,184,0.06)' }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="errors" name="error %" fill="#fb5a7a" fillOpacity={0.75} radius={[3, 3, 0, 0]} />
              <Bar dataKey="throughput" name="rps" fill="#22d3ee" fillOpacity={0.7} radius={[3, 3, 0, 0]} />
              <Bar dataKey="fairness" name="fairness ×100" fill="#34e5b0" fillOpacity={0.6} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      {seriesData.length > 2 && (
        <Panel eyebrow="Time series" title="Latency over the run (same traffic for every contender)" bodyClassName="p-2">
          <ResponsiveContainer width="100%" height={230}>
            <LineChart data={seriesData} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}>
              <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
              <XAxis dataKey="t" tick={AXIS} axisLine={false} tickLine={false} minTickGap={26} />
              <YAxis tick={AXIS} axisLine={false} tickLine={false} width={46} />
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {results.map((result, i) => (
                <Line
                  key={result.algorithm}
                  type="monotone"
                  dataKey={result.name}
                  stroke={COLORS[i % COLORS.length]}
                  strokeWidth={result.algorithm === winner.algorithm ? 2.4 : 1.4}
                  dot={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </Panel>
      )}

      {/* Table */}
      <Panel eyebrow="Full results" title="Every metric, side by side" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left">
            <thead className="bg-white/[0.03] text-[10px] uppercase tracking-[0.14em] text-slate-500">
              <tr>
                <th className="px-3 py-2.5 font-semibold">Algorithm</th>
                <th className="px-3 py-2.5 font-semibold">Score</th>
                <th className="px-3 py-2.5 font-semibold">Avg</th>
                <th className="px-3 py-2.5 font-semibold">p50</th>
                <th className="px-3 py-2.5 font-semibold">p95</th>
                <th className="px-3 py-2.5 font-semibold">p99</th>
                <th className="px-3 py-2.5 font-semibold">Throughput</th>
                <th className="px-3 py-2.5 font-semibold">Errors</th>
                <th className="px-3 py-2.5 font-semibold">Fairness</th>
                <th className="px-3 py-2.5 font-semibold">Gini</th>
                <th className="px-3 py-2.5 font-semibold">Peak util</th>
                <th className="px-3 py-2.5 font-semibold">Switches</th>
              </tr>
            </thead>
            <tbody>
              {results.map((result, index) => (
                <ResultRow key={result.algorithm} result={result} color={COLORS[index % COLORS.length]} isWinner={index === 0} />
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Per-server distribution */}
      <div className="grid gap-3 lg:grid-cols-2">
        {results.map((result, index) => (
          <Panel
            key={result.algorithm}
            eyebrow={`Distribution · ${result.name}`}
            title={`How ${result.name} spread the load`}
            dense
          >
            <div className="space-y-1.5">
              {result.perServer.map((server) => (
                <div key={server.serverId} className="flex items-center gap-2.5">
                  <span className="w-[76px] shrink-0 font-mono text-[10.5px] text-slate-400">{server.name}</span>
                  <div className="flex-1">
                    <Meter value={server.share * 100} tone={server.share > 0.45 ? 'rose' : 'cyan'} height={5} />
                  </div>
                  <span className="num w-12 shrink-0 text-right font-mono text-[10.5px] text-slate-400">
                    {(server.share * 100).toFixed(1)}%
                  </span>
                  <span className="num w-16 shrink-0 text-right font-mono text-[10.5px] text-slate-500">
                    {fmtMs(server.latencyMs)}
                  </span>
                  <span
                    className={clsx(
                      'num w-14 shrink-0 text-right font-mono text-[10.5px]',
                      server.errors > result.requests * 0.02 ? 'text-neon-rose' : 'text-slate-500',
                    )}
                  >
                    {server.errors} err
                  </span>
                </div>
              ))}
              <div className="mt-2 border-t border-white/[0.06] pt-2 font-mono text-[10px] text-slate-600">
                <span style={{ color: COLORS[index % COLORS.length] }}>■</span> {result.requests.toLocaleString()} requests ·
                fairness {result.fairness.toFixed(3)} · peak util {(result.maxUtilization * 100).toFixed(0)}%
              </div>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}

function ResultRow({ result, color, isWinner }: { result: BattleResult; color: string; isWinner: boolean }) {
  return (
    <tr className={clsx('border-t border-white/[0.05]', isWinner && 'bg-neon-amber/[0.05]')}>
      <td className="px-3 py-2.5">
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: color }} />
          <span className={clsx('text-[12.5px] font-semibold', isWinner ? 'text-neon-amber' : 'text-slate-200')}>
            {result.name}
          </span>
          {isWinner && <span className="chip border-neon-amber/40 text-[9.5px] text-neon-amber">winner</span>}
        </span>
      </td>
      <td className="num px-3 py-2.5 font-mono text-[12px] font-semibold text-white">{result.score.toFixed(1)}</td>
      <td className="num px-3 py-2.5 font-mono text-[12px] text-slate-200">{fmtMs(result.avgLatencyMs)}</td>
      <td className="num px-3 py-2.5 font-mono text-[12px] text-slate-400">{fmtMs(result.p50Ms)}</td>
      <td className="num px-3 py-2.5 font-mono text-[12px] text-slate-200">{fmtMs(result.p95Ms)}</td>
      <td className="num px-3 py-2.5 font-mono text-[12px] text-slate-400">{fmtMs(result.p99Ms)}</td>
      <td className="num px-3 py-2.5 font-mono text-[12px] text-slate-200">{result.throughput.toFixed(0)} rps</td>
      <td
        className={clsx(
          'num px-3 py-2.5 font-mono text-[12px]',
          result.errorRate > 0.05 ? 'text-neon-rose' : result.errorRate > 0.01 ? 'text-neon-amber' : 'text-neon-mint',
        )}
      >
        {fmtPct(result.errorRate, 2)}
      </td>
      <td className="num px-3 py-2.5 font-mono text-[12px] text-slate-200">{result.fairness.toFixed(3)}</td>
      <td className="num px-3 py-2.5 font-mono text-[12px] text-slate-400">{result.gini.toFixed(3)}</td>
      <td className="num px-3 py-2.5 font-mono text-[12px] text-slate-400">{(result.maxUtilization * 100).toFixed(0)}%</td>
      <td className="num px-3 py-2.5 font-mono text-[12px] text-slate-400">
        {result.switches !== undefined ? result.switches : '—'}
      </td>
    </tr>
  );
}

function WinStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div className="eyebrow">{label}</div>
      <div className="num mt-0.5 font-display text-[16px] font-semibold text-white">{value}</div>
    </div>
  );
}

export { Segmented };
