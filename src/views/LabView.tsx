import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Award, Database, Download, FlaskConical, GitCompare, Save, Trash2 } from 'lucide-react';
import { clsx } from '@/lib/clsx';
import { useApp } from '@/state/store';
import { Panel, EmptyState, Segmented, Meter } from '@/components/ui/primitives';
import { aggregateByAlgorithm, compareRuns, recentRuns } from '@/analytics/history';
import { serializeRunsCsv } from '@/analytics/exportCsv';
import { fmtMs, fmtPct, relativeTime, clockTime } from '@/lib/format';
import type { RunRecord, RunRecordKind } from '@/types';

const COLORS = ['#22d3ee', '#8b7cf6', '#34e5b0', '#fbbf24'];

export function LabView() {
  const runs = useApp((s) => s.runs);
  const removeRun = useApp((s) => s.removeRun);
  const clearHistory = useApp((s) => s.clearHistory);
  const saveLiveRun = useApp((s) => s.saveLiveRun);
  const [kind, setKind] = useState<RunRecordKind | 'all'>('all');
  const [selected, setSelected] = useState<string[]>([]);

  const filtered = useMemo(
    () => runs.filter((run) => kind === 'all' || run.kind === kind),
    [runs, kind],
  );
  const leaderboard = useMemo(() => aggregateByAlgorithm(filtered), [filtered]);
  const chronological = useMemo(() => [...filtered].sort((a, b) => a.createdAt - b.createdAt), [filtered]);

  const toggleSelected = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id].slice(-4),
    );

  const comparisonRuns = useMemo(
    () => runs.filter((run) => selected.includes(run.id)),
    [runs, selected],
  );

  const exportCsv = () => {
    const blob = new Blob([serializeRunsCsv(runs)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `loadmind-runs-${Date.now()}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  return (
    <div className="space-y-3">
      <div className="panel flex flex-wrap items-center justify-between gap-4 p-4">
        <div>
          <div className="eyebrow">Performance lab</div>
          <h2 className="mt-1 font-display text-[20px] font-bold tracking-tight text-white">
            Historical runs &amp; experiment comparison
          </h2>
          <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-slate-500">
            {runs.length} saved run{runs.length === 1 ? '' : 's'} stored locally. Battles save automatically; live sessions
            save on demand; playground benchmarks save after every run.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            size="sm"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'all', label: 'All' },
              { value: 'battle', label: 'Battles' },
              { value: 'live', label: 'Live' },
              { value: 'custom', label: 'Custom' },
            ]}
          />
          <button type="button" className="btn text-[12px]" onClick={saveLiveRun}>
            <Save className="h-3.5 w-3.5" /> Save current run
          </button>
          <button type="button" className="btn text-[12px]" onClick={exportCsv} disabled={runs.length === 0}>
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
          <button
            type="button"
            className="btn btn-danger text-[12px]"
            onClick={clearHistory}
            disabled={runs.length === 0}
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </button>
        </div>
      </div>

      {runs.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Database className="h-8 w-8" />}
            title="No runs recorded"
            description="Run an Algorithm Battle, save a live session, or benchmark a custom algorithm. Results accumulate here and power the LoadMind AI assistant's historical answers."
          />
        </Panel>
      ) : (
        <>
          {/* Leaderboard + trend */}
          <div className="grid gap-3 lg:grid-cols-2">
            <Panel eyebrow="Leaderboard" title="Average performance by algorithm" bodyClassName="p-2">
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={leaderboard.slice(0, 8)} margin={{ top: 10, right: 10, left: -14, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
                  <XAxis
                    dataKey="algorithmName"
                    tick={{ fontSize: 9.5, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                  />
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
                  <Bar dataKey="score" name="composite score" radius={[4, 4, 0, 0]}>
                    {leaderboard.slice(0, 8).map((entry, i) => (
                      <Cell key={entry.algorithm} fill={COLORS[i % COLORS.length]} fillOpacity={0.8} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Panel>

            <Panel eyebrow="Trend" title="Average latency over saved runs" bodyClassName="p-2">
              <ResponsiveContainer width="100%" height={230}>
                <LineChart data={chronological.slice(-40)} margin={{ top: 10, right: 10, left: -14, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
                  <XAxis
                    dataKey="createdAt"
                    tick={{ fontSize: 9.5, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => clockTime(v).slice(0, 5)}
                    minTickGap={24}
                  />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={44} />
                  <Tooltip
                    contentStyle={{
                      background: 'rgba(7,10,18,0.96)',
                      border: '1px solid rgba(148,163,184,0.18)',
                      borderRadius: 10,
                      fontSize: 11,
                    }}
                    labelFormatter={(v) => clockTime(Number(v))}
                  />
                  <Line type="monotone" dataKey="avgLatencyMs" name="avg ms" stroke="#22d3ee" strokeWidth={1.8} dot={false} />
                  <Line type="monotone" dataKey="p95Ms" name="p95 ms" stroke="#fb5a7a" strokeWidth={1.4} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </Panel>
          </div>

          {/* Wins table */}
          <Panel eyebrow="Aggregate stats" title="Every algorithm that has been measured" bodyClassName="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left">
                <thead className="bg-white/[0.03] text-[10px] uppercase tracking-[0.14em] text-slate-500">
                  <tr>
                    <th className="px-3 py-2.5 font-semibold">Algorithm</th>
                    <th className="px-3 py-2.5 font-semibold">Runs</th>
                    <th className="px-3 py-2.5 font-semibold">Battle wins</th>
                    <th className="px-3 py-2.5 font-semibold">Avg latency</th>
                    <th className="px-3 py-2.5 font-semibold">p95</th>
                    <th className="px-3 py-2.5 font-semibold">Errors</th>
                    <th className="px-3 py-2.5 font-semibold">Throughput</th>
                    <th className="px-3 py-2.5 font-semibold">Fairness</th>
                    <th className="px-3 py-2.5 font-semibold">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((entry, index) => (
                    <tr key={entry.algorithm} className="border-t border-white/[0.05]">
                      <td className="px-3 py-2.5">
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ background: COLORS[index % COLORS.length] }} />
                          <span className="text-[12.5px] font-semibold text-slate-200">{entry.algorithmName}</span>
                          {index === 0 && (
                            <span className="chip border-neon-amber/40 text-[9.5px] text-neon-amber">
                              <Award className="h-2.5 w-2.5" /> top
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="num px-3 py-2.5 font-mono text-[12px] text-slate-300">{entry.runs}</td>
                      <td className="num px-3 py-2.5 font-mono text-[12px] text-slate-300">{entry.wins}</td>
                      <td className="num px-3 py-2.5 font-mono text-[12px] text-slate-200">{fmtMs(entry.avgLatencyMs)}</td>
                      <td className="num px-3 py-2.5 font-mono text-[12px] text-slate-300">{fmtMs(entry.p95Ms)}</td>
                      <td className="num px-3 py-2.5 font-mono text-[12px] text-slate-300">{fmtPct(entry.errorRate, 2)}</td>
                      <td className="num px-3 py-2.5 font-mono text-[12px] text-slate-300">{entry.throughput.toFixed(0)} rps</td>
                      <td className="num px-3 py-2.5 font-mono text-[12px] text-slate-300">{entry.fairness.toFixed(3)}</td>
                      <td className="num px-3 py-2.5 font-mono text-[12px] font-semibold text-white">{entry.score.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* Comparison */}
          <Panel
            eyebrow="Experiment comparison"
            title="Select up to 4 runs to compare"
            icon={<GitCompare className="h-3.5 w-3.5" />}
            actions={
              selected.length > 0 ? (
                <button type="button" className="btn btn-ghost px-2 py-1 text-[11px]" onClick={() => setSelected([])}>
                  Clear selection
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost px-2 py-1 text-[11px]"
                  onClick={() => setSelected(recentRuns(filtered, 3).map((r) => r.id))}
                >
                  Compare last 3
                </button>
              )
            }
          >
            {comparisonRuns.length === 0 ? (
              <p className="py-3 text-center text-[11.5px] text-slate-600">
                Tick runs in the table below to line them up side by side.
              </p>
            ) : (
              <ComparisonTable runs={comparisonRuns} />
            )}
          </Panel>

          {/* Runs list */}
          <Panel eyebrow="Run history" title={`${filtered.length} runs`} icon={<FlaskConical className="h-3.5 w-3.5" />} bodyClassName="p-0">
            <div className="max-h-[440px] overflow-y-auto">
              <table className="w-full min-w-[900px] text-left">
                <thead className="sticky top-0 bg-void-900/95 text-[10px] uppercase tracking-[0.14em] text-slate-500 backdrop-blur">
                  <tr>
                    <th className="w-8 px-3 py-2.5" />
                    <th className="px-3 py-2.5 font-semibold">Run</th>
                    <th className="px-3 py-2.5 font-semibold">Kind</th>
                    <th className="px-3 py-2.5 font-semibold">Conditions</th>
                    <th className="px-3 py-2.5 font-semibold">Avg</th>
                    <th className="px-3 py-2.5 font-semibold">p95</th>
                    <th className="px-3 py-2.5 font-semibold">Errors</th>
                    <th className="px-3 py-2.5 font-semibold">Score</th>
                    <th className="px-3 py-2.5 font-semibold">When</th>
                    <th className="w-10 px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {[...filtered]
                    .sort((a, b) => b.createdAt - a.createdAt)
                    .map((run) => (
                      <tr key={run.id} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
                        <td className="px-3 py-2.5">
                          <input
                            type="checkbox"
                            checked={selected.includes(run.id)}
                            onChange={() => toggleSelected(run.id)}
                            className="h-3.5 w-3.5 accent-neon-cyan"
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="text-[12px] font-semibold text-slate-200">{run.algorithmName}</div>
                          <div className="font-mono text-[10px] text-slate-600">{run.requests.toLocaleString()} req</div>
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={clsx(
                              'chip text-[9.5px]',
                              run.kind === 'battle'
                                ? 'border-neon-violet/30 text-[#c3b9ff]'
                                : run.kind === 'custom'
                                  ? 'border-neon-cyan/30 text-neon-cyan'
                                  : 'border-white/10 text-slate-400',
                            )}
                          >
                            {run.kind}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[10.5px] text-slate-500">
                          {run.pattern} · {run.serverCount} srv · {run.baseRps} rps
                          <div className="text-slate-600">{run.chaosSummary}</div>
                        </td>
                        <td className="num px-3 py-2.5 font-mono text-[12px] text-slate-200">{fmtMs(run.avgLatencyMs)}</td>
                        <td className="num px-3 py-2.5 font-mono text-[12px] text-slate-300">{fmtMs(run.p95Ms)}</td>
                        <td className="num px-3 py-2.5 font-mono text-[12px] text-slate-300">{fmtPct(run.errorRate, 2)}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="num font-mono text-[12px] font-semibold text-white">{run.score.toFixed(1)}</span>
                            <div className="w-12">
                              <Meter value={run.score} tone="cyan" height={3} />
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[10.5px] text-slate-600">{relativeTime(run.createdAt)}</td>
                        <td className="px-3 py-2.5">
                          <button
                            type="button"
                            className="btn btn-ghost px-1.5 py-1"
                            onClick={() => removeRun(run.id)}
                            title="Delete run"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function ComparisonTable({ runs }: { runs: RunRecord[] }) {
  const rows = compareRuns(runs);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] text-left">
        <thead className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
          <tr className="border-b border-white/[0.07]">
            <th className="py-2 pr-3 font-semibold">Metric</th>
            {runs.map((run, i) => (
              <th key={run.id} className="py-2 pr-3 font-semibold">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                  <span className="normal-case tracking-normal text-slate-300">{run.algorithmName}</span>
                </span>
                <span className="mt-0.5 block font-mono text-[9.5px] font-normal normal-case tracking-normal text-slate-600">
                  {run.pattern} · {run.serverCount} srv
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const numeric = row.values.filter((v): v is number => typeof v === 'number');
            const best =
              row.best === 'none' || numeric.length === 0
                ? null
                : row.best === 'low'
                  ? Math.min(...numeric)
                  : Math.max(...numeric);
            return (
              <tr key={row.metric} className="border-b border-white/[0.04]">
                <td className="py-2 pr-3 text-[11.5px] text-slate-400">{row.metric}</td>
                {row.values.map((value, i) => {
                  const isBest = best !== null && typeof value === 'number' && value === best;
                  return (
                    <td
                      key={i}
                      className={clsx(
                        'num py-2 pr-3 font-mono text-[12px]',
                        isBest ? 'font-semibold text-neon-mint' : 'text-slate-300',
                      )}
                    >
                      {typeof value === 'number' ? formatMetric(value, row.unit) : value}
                      {isBest && <span className="ml-1 text-[9px] text-neon-mint">best</span>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatMetric(value: number, unit: string): string {
  if (unit === 'ms') return `${value.toFixed(1)}ms`;
  if (unit === '%') return `${value.toFixed(2)}%`;
  if (unit === 'rps') return `${value.toFixed(0)} rps`;
  if (value > 100) return value.toFixed(0);
  return value.toFixed(3);
}
