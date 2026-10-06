import { useState } from 'react';
import {
  BookOpen,
  Code2,
  Cpu,
  FlaskConical,
  Play,
  Rocket,
  Save,
  Trash2,
  Trophy,
  Plus,
} from 'lucide-react';
import { clsx } from '@/lib/clsx';
import { useApp } from '@/state/store';
import { Panel, EmptyState, Meter, Slider } from '@/components/ui/primitives';
import { CodeEditor } from '@/components/playground/CodeEditor';
import { CUSTOM_EXAMPLES } from '@/algorithms/custom';
import { fmtMs, fmtPct, relativeTime } from '@/lib/format';

export function PlaygroundView() {
  const custom = useApp((s) => s.custom);
  const setCustomCode = useApp((s) => s.setCustomCode);
  const setCustomName = useApp((s) => s.setCustomName);
  const saveCustom = useApp((s) => s.saveCustom);
  const deleteCustom = useApp((s) => s.deleteCustom);
  const newCustom = useApp((s) => s.newCustom);
  const selectCustom = useApp((s) => s.selectCustom);
  const runCustomBenchmark = useApp((s) => s.runCustomBenchmark);
  const deployCustom = useApp((s) => s.deployCustom);
  const snapshot = useApp((s) => s.snapshot);
  const [showApi, setShowApi] = useState(false);

  const mine = custom.results.find((r) => r.algorithm === 'custom');
  const builtin = custom.results.filter((r) => r.algorithm !== 'custom');
  const bestBuiltin = builtin.length ? builtin.reduce((a, b) => (a.score > b.score ? a : b)) : null;

  return (
    <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-3">
        <div className="panel flex flex-wrap items-center justify-between gap-4 p-4">
          <div>
            <div className="eyebrow">Custom algorithm playground</div>
            <h2 className="mt-1 font-display text-[20px] font-bold tracking-tight text-white">
              Build your own scheduler
            </h2>
            <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-slate-500">
              Write a <code className="font-mono text-neon-cyan">selectServer(servers, request, state)</code> function. It is
              compiled and run through the exact same simulation engine as the built-ins — same traffic, same pool, same
              metrics — so your score is directly comparable.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn text-[12px]" onClick={() => setShowApi((v) => !v)}>
              <BookOpen className="h-3.5 w-3.5" /> API reference
            </button>
            <button type="button" className="btn text-[12px]" onClick={saveCustom}>
              <Save className="h-3.5 w-3.5" /> Save
            </button>
            <button type="button" className="btn text-[12px]" onClick={runCustomBenchmark} disabled={custom.running}>
              {custom.running ? <Cpu className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {custom.running ? 'Benchmarking…' : 'Run benchmark'}
            </button>
            <button type="button" className="btn btn-primary text-[12px]" onClick={deployCustom}>
              <Rocket className="h-3.5 w-3.5" /> Deploy to live pool
            </button>
          </div>
        </div>

        {showApi && <ApiReference />}

        <Panel
          eyebrow="Editor"
          title={
            <span className="flex items-center gap-2">
              <input
                className="w-[220px] rounded-md border border-white/10 bg-black/30 px-2 py-1 font-display text-[13px] text-slate-100 outline-none focus:border-neon-cyan/50"
                value={custom.name}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="Algorithm name"
              />
            </span>
          }
          icon={<Code2 className="h-3.5 w-3.5" />}
          actions={
            <div className="flex items-center gap-1.5">
              {CUSTOM_EXAMPLES.map((example) => (
                <button
                  key={example.name}
                  type="button"
                  className="btn btn-ghost px-2 py-1 text-[11px]"
                  onClick={() => setCustomCode(example.code)}
                >
                  {example.name}
                </button>
              ))}
            </div>
          }
        >
          <CodeEditor value={custom.code} onChange={setCustomCode} error={custom.error} />
          <div className="mt-2 flex items-center justify-between font-mono text-[10.5px] text-slate-600">
            <span>
              {custom.code.split('\n').length} lines · {custom.code.length} chars · pool of {snapshot.servers.length} servers
              live
            </span>
            <span>return a server object, a server id, an index, or null to drop the request</span>
          </div>
        </Panel>

        {/* Benchmark results */}
        <Panel
          eyebrow="Benchmark"
          title="Your algorithm vs the built-ins"
          icon={<FlaskConical className="h-3.5 w-3.5" />}
          actions={
            custom.lastRunAt ? (
              <span className="font-mono text-[10px] text-slate-600">
                last run {relativeTime(custom.lastRunAt)} · 8,000 requests · chaos injected
              </span>
            ) : null
          }
        >
          {custom.results.length === 0 ? (
            <EmptyState
              icon={<FlaskConical className="h-7 w-7" />}
              title="No benchmark run yet"
              description="Hit Run benchmark to replay 8,000 requests with injected latency, errors, reduced capacity and 1.35× traffic against your algorithm, Round Robin and Least Response Time."
            />
          ) : (
            <div className="space-y-3">
              {mine && (
                <div
                  className={clsx(
                    'rounded-xl border p-4',
                    bestBuiltin && mine.score >= bestBuiltin.score
                      ? 'border-neon-mint/35 bg-neon-mint/[0.06]'
                      : 'border-white/[0.08] bg-white/[0.02]',
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="grid h-11 w-11 place-items-center rounded-xl border border-neon-cyan/30 bg-neon-cyan/10">
                        <Trophy className="h-5 w-5 text-neon-cyan" />
                      </div>
                      <div>
                        <div className="eyebrow">Your algorithm</div>
                        <div className="font-display text-[18px] font-bold text-white">
                          {mine.name} · score {mine.score.toFixed(1)}
                        </div>
                        {bestBuiltin && (
                          <div className="mt-0.5 text-[11.5px] text-slate-400">
                            {mine.score >= bestBuiltin.score ? (
                              <span className="text-neon-mint">
                                 beating {bestBuiltin.name} by {(mine.score - bestBuiltin.score).toFixed(1)} points
                              </span>
                            ) : (
                              <span className="text-neon-amber">
                                 {(bestBuiltin.score - mine.score).toFixed(1)} points behind {bestBuiltin.name}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <BenchStat label="Avg latency" value={fmtMs(mine.avgLatencyMs)} />
                      <BenchStat label="p95" value={fmtMs(mine.p95Ms)} />
                      <BenchStat label="Errors" value={fmtPct(mine.errorRate, 2)} />
                      <BenchStat label="Fairness" value={mine.fairness.toFixed(3)} />
                    </div>
                  </div>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left">
                  <thead className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                    <tr className="border-b border-white/[0.07]">
                      <th className="py-2 pr-3 font-semibold">Algorithm</th>
                      <th className="py-2 pr-3 font-semibold">Score</th>
                      <th className="py-2 pr-3 font-semibold">Avg</th>
                      <th className="py-2 pr-3 font-semibold">p95</th>
                      <th className="py-2 pr-3 font-semibold">Errors</th>
                      <th className="py-2 pr-3 font-semibold">Fairness</th>
                      <th className="py-2 font-semibold">Distribution across pool</th>
                    </tr>
                  </thead>
                  <tbody>
                    {custom.results.map((result) => (
                      <tr key={result.algorithm} className="border-b border-white/[0.04]">
                        <td className="py-2.5 pr-3">
                          <span
                            className={clsx(
                              'text-[12.5px] font-semibold',
                              result.algorithm === 'custom' ? 'text-neon-cyan' : 'text-slate-300',
                            )}
                          >
                            {result.name}
                          </span>
                        </td>
                        <td className="num py-2.5 pr-3 font-mono text-[12px] font-semibold text-white">
                          {result.score.toFixed(1)}
                        </td>
                        <td className="num py-2.5 pr-3 font-mono text-[12px] text-slate-200">{fmtMs(result.avgLatencyMs)}</td>
                        <td className="num py-2.5 pr-3 font-mono text-[12px] text-slate-300">{fmtMs(result.p95Ms)}</td>
                        <td className="num py-2.5 pr-3 font-mono text-[12px] text-slate-300">{fmtPct(result.errorRate, 2)}</td>
                        <td className="num py-2.5 pr-3 font-mono text-[12px] text-slate-300">{result.fairness.toFixed(3)}</td>
                        <td className="py-2.5">
                          <div className="flex h-3 w-full min-w-[120px] overflow-hidden rounded-full bg-white/[0.05]">
                            {result.perServer.map((server, i) => (
                              <div
                                key={server.serverId}
                                title={`${server.name}: ${(server.share * 100).toFixed(1)}%`}
                                style={{
                                  width: `${server.share * 100}%`,
                                  background: ['#22d3ee', '#8b7cf6', '#34e5b0', '#fbbf24', '#fb5a7a', '#3b9dfd'][i % 6],
                                  opacity: 0.75,
                                }}
                              />
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Panel>
      </div>

      {/* ------------------------------------------------------------ sidebar */}
      <div className="min-w-0 space-y-3">
        <Panel
          eyebrow="Saved algorithms"
          title="Local library"
          icon={<Save className="h-3.5 w-3.5" />}
          actions={
            <button type="button" className="btn btn-ghost px-2 py-1 text-[11px]" onClick={newCustom}>
              <Plus className="h-3 w-3" /> New
            </button>
          }
        >
          {custom.records.length === 0 ? (
            <p className="py-4 text-center text-[11.5px] text-slate-600">
              Nothing saved yet. Write an algorithm and hit Save — it persists in localStorage.
            </p>
          ) : (
            <div className="space-y-1.5">
              {custom.records.map((record) => (
                <div
                  key={record.id}
                  className={clsx(
                    'flex items-center gap-2 rounded-lg border px-2.5 py-2',
                    record.id === custom.activeId
                      ? 'border-neon-cyan/40 bg-neon-cyan/[0.06]'
                      : 'border-white/[0.06] bg-white/[0.02]',
                  )}
                >
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => selectCustom(record.id)}>
                    <div className="truncate text-[12px] font-semibold text-slate-200">{record.name}</div>
                    <div className="font-mono text-[10px] text-slate-600">
                      {record.lastResult
                        ? `${fmtMs(record.lastResult.avgLatencyMs)} · score ${record.lastResult.score.toFixed(1)}`
                        : 'not benchmarked'}{' '}
                      · {relativeTime(record.updatedAt)}
                    </div>
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost px-1.5 py-1"
                    onClick={() => deleteCustom(record.id)}
                    title="Delete"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel eyebrow="Benchmark scenario" title="What the run does">
          <div className="space-y-2 text-[11.5px] leading-relaxed text-slate-400">
            <Bullet>8,000 requests replayed against an identical seeded pool.</Bullet>
            <Bullet>180ms of latency injected into one upstream.</Bullet>
            <Bullet>3% error penalty on the last upstream.</Bullet>
            <Bullet>15% capacity removed from another.</Bullet>
            <Bullet>1.35× traffic multiplier for the whole run.</Bullet>
            <Bullet>Round Robin and Least Response Time run the same stream as the control group.</Bullet>
          </div>
          <div className="mt-3 rounded-lg border border-white/[0.06] bg-black/25 p-3">
            <div className="eyebrow mb-1.5">Live pool for reference</div>
            {snapshot.servers.map((server) => (
              <div key={server.id} className="mb-1.5 flex items-center gap-2 last:mb-0">
                <span className="w-[78px] shrink-0 font-mono text-[10.5px] text-slate-400">{server.name}</span>
                <div className="flex-1">
                  <Meter value={server.utilization * 100} tone={server.utilization > 0.85 ? 'rose' : 'cyan'} height={4} />
                </div>
                <span className="num w-14 shrink-0 text-right font-mono text-[10px] text-slate-500">
                  {fmtMs(server.ewmaLatencyMs)}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-neon-cyan" />
      <span>{children}</span>
    </div>
  );
}

function BenchStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div className="eyebrow">{label}</div>
      <div className="num mt-0.5 font-display text-[15px] font-semibold text-white">{value}</div>
    </div>
  );
}

export function ApiReference() {
  const snapshot = useApp((s) => s.snapshot);
  const sample = snapshot.servers[0];
  return (
    <Panel eyebrow="API reference" title="What your function receives">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h4 className="mb-2 font-display text-[12px] font-semibold uppercase tracking-wider text-neon-cyan">
            servers[] — live pool snapshot
          </h4>
          <pre className="overflow-x-auto rounded-lg border border-white/[0.06] bg-black/35 p-3 font-mono text-[11px] leading-relaxed text-slate-400">
            {sample
              ? JSON.stringify(
                  {
                    id: sample.id,
                    name: sample.name,
                    weight: sample.weight,
                    capacity: Math.round(sample.capacity * sample.capacityFactor),
                    cpu: Number(sample.cpu.toFixed(1)),
                    memory: Number(sample.memory.toFixed(1)),
                    activeConnections: sample.activeConnections,
                    ewmaLatencyMs: Number(sample.ewmaLatencyMs.toFixed(1)),
                    errorRate: Number(sample.errorRate.toFixed(4)),
                    utilization: Number(sample.utilization.toFixed(3)),
                    rps: Number(sample.rps.toFixed(1)),
                    status: sample.status,
                    down: sample.down,
                    requestsReceived: sample.requestsReceived,
                    requestsFailed: sample.requestsFailed,
                    latencyPenaltyMs: sample.latencyPenaltyMs,
                  },
                  null,
                  2,
                )
              : '{}'}
          </pre>
        </div>
        <div>
          <h4 className="mb-2 font-display text-[12px] font-semibold uppercase tracking-wider text-neon-cyan">
            request — the inbound call
          </h4>
          <pre className="overflow-x-auto rounded-lg border border-white/[0.06] bg-black/35 p-3 font-mono text-[11px] leading-relaxed text-slate-400">
            {JSON.stringify(
              { id: 4821, clientIp: '24.18.204.77', path: '/api/orders', cost: 1.4, seq: 4821, arrivalTime: 12.35 },
              null,
              2,
            )}
          </pre>
          <h4 className="mb-2 mt-4 font-display text-[12px] font-semibold uppercase tracking-wider text-neon-cyan">
            state — persists between calls
          </h4>
          <p className="text-[11.5px] leading-relaxed text-slate-500">
            A plain object you own: keep counters, cursors, EWMA values or a hash ring in it. It is created once per
            simulation run and lives as long as the run does.
          </p>
          <div className="mt-3 rounded-lg border border-neon-amber/25 bg-neon-amber/[0.05] px-3 py-2 text-[11px] leading-relaxed text-slate-300">
            Always filter out <code className="font-mono text-neon-amber">server.down</code> — sending traffic to a dead
            upstream is counted as a dropped request against your score.
          </div>
        </div>
      </div>
    </Panel>
  );
}

export { Slider };
