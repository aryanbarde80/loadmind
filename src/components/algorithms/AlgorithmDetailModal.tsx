import { useMemo } from 'react';
import { CheckCircle2, XCircle, Target, Cpu, Gauge } from 'lucide-react';
import { Modal, Meter, Sparkline } from '@/components/ui/primitives';
import { useApp } from '@/state/store';
import { getAlgorithm } from '@/algorithms/registry';
import { explainFor } from '@/algorithms/explain';
import { ALGORITHM_FAMILIES } from '@/algorithms/registry';
import { engine } from '@/state/store';
import { fmtMs, fmtPct } from '@/lib/format';
import { clsx } from '@/lib/clsx';

export function AlgorithmDetailModal() {
  const algorithmDetailId = useApp((s) => s.algorithmDetailId);
  const openAlgorithmDetail = useApp((s) => s.openAlgorithmDetail);
  const setAlgorithm = useApp((s) => s.setAlgorithm);
  const snapshot = useApp((s) => s.snapshot);

  const definition = algorithmDetailId ? getAlgorithm(algorithmDetailId) : null;
  const isActive = definition?.id === snapshot.activeAlgorithm;

  const explanation = useMemo(
    () => (definition ? explainFor(definition, snapshot.servers, snapshot.simTime) : ''),
    [definition, snapshot.simTime, snapshot.servers.length],
  );

  if (!definition) return null;
  const family = ALGORITHM_FAMILIES[definition.family];
  const series = engine.getSeries();
  const latencySeries = series.slice(-60).map((s) => s.latency);
  const total = snapshot.distribution.reduce((a, d) => a + d.count, 0) || 1;

  return (
    <Modal
      open={!!definition}
      onClose={() => openAlgorithmDetail(null)}
      eyebrow={`${family.label} algorithm`}
      title={definition.name}
      width="max-w-4xl"
    >
      <div className="space-y-5">
        {/* Header row */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-[13.5px] leading-relaxed text-slate-300">{definition.howItWorks}</p>
          </div>
          <div className="flex shrink-0 flex-col gap-2">
            <button
              type="button"
              className={clsx('btn text-[12px]', isActive ? 'btn-ghost' : 'btn-primary')}
              disabled={isActive}
              onClick={() => {
                setAlgorithm(definition.id as never);
                openAlgorithmDetail(null);
              }}
            >
              {isActive ? 'Currently active' : 'Activate this algorithm'}
            </button>
            <div className="rounded-lg border border-white/[0.07] bg-black/25 px-3 py-2 font-mono text-[10.5px] text-slate-400">
              {definition.complexity}
            </div>
          </div>
        </div>

        {/* Live behaviour */}
        <div className="rounded-xl border border-neon-cyan/20 bg-neon-cyan/[0.05] p-3.5">
          <div className="eyebrow mb-1.5 text-neon-cyan/80">What it would do with the next request</div>
          <p className="text-[12.5px] leading-relaxed text-slate-200">{explanation}</p>
        </div>

        {/* Why useful */}
        <Section icon={<Target className="h-3.5 w-3.5" />} title="Why it is useful">
          <p className="text-[12.5px] leading-relaxed text-slate-400">{definition.whyUseful}</p>
        </Section>

        {/* Advantages / limitations */}
        <div className="grid gap-4 md:grid-cols-2">
          <Section title="Advantages" tone="good">
            <ul className="space-y-1.5">
              {definition.advantages.map((item) => (
                <li key={item} className="flex gap-2 text-[12px] leading-relaxed text-slate-300">
                  <CheckCircle2 className="mt-[2px] h-3.5 w-3.5 shrink-0 text-neon-mint" />
                  {item}
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Limitations" tone="bad">
            <ul className="space-y-1.5">
              {definition.limitations.map((item) => (
                <li key={item} className="flex gap-2 text-[12px] leading-relaxed text-slate-300">
                  <XCircle className="mt-[2px] h-3.5 w-3.5 shrink-0 text-neon-rose" />
                  {item}
                </li>
              ))}
            </ul>
          </Section>
        </div>

        {/* Best for */}
        <div className="flex flex-wrap gap-1.5">
          {definition.bestFor.map((tag) => (
            <span key={tag} className="chip" style={{ color: family.color, borderColor: `${family.color}33` }}>
              {tag}
            </span>
          ))}
        </div>

        {/* Current performance */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <PerfTile label="Avg latency" value={fmtMs(snapshot.metrics.avgLatencyMs)} />
          <PerfTile label="p95 latency" value={fmtMs(snapshot.metrics.p95Ms)} />
          <PerfTile label="Error rate" value={fmtPct(snapshot.metrics.errorRate, 2)} />
          <PerfTile label="Throughput" value={`${snapshot.metrics.throughput.toFixed(0)} rps`} />
        </div>

        {latencySeries.length > 4 && (
          <div className="rounded-xl border border-white/[0.07] bg-black/25 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="eyebrow">Latency trend (last 30s)</span>
              <span className="font-mono text-[10.5px] text-slate-500">live pool, all algorithms share this metric</span>
            </div>
            <Sparkline values={latencySeries} stroke={family.color} height={54} />
          </div>
        )}

        {/* Distribution */}
        <div className="rounded-xl border border-white/[0.07] bg-black/25 p-3.5">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="eyebrow">Requests distributed by this algorithm</span>
            <span className="font-mono text-[10.5px] text-slate-500">
              {isActive ? 'live' : 'shown while another algorithm is active'}
            </span>
          </div>
          <div className="space-y-2">
            {snapshot.distribution.map((bucket) => (
              <div key={bucket.serverId} className="flex items-center gap-3">
                <span className="w-20 shrink-0 font-mono text-[11px] text-slate-400">{bucket.name}</span>
                <div className="flex-1">
                  <Meter value={bucket.share * 100} tone={bucket.status === 'down' ? 'rose' : 'cyan'} height={6} />
                </div>
                <span className="num w-24 shrink-0 text-right font-mono text-[11px] text-slate-400">
                  {bucket.count.toLocaleString()} · {fmtPct(bucket.share, 1)}
                </span>
                <span className="num w-16 shrink-0 text-right font-mono text-[11px] text-slate-500">
                  {fmtMs(bucket.latencyMs)}
                </span>
              </div>
            ))}
            {snapshot.distribution.length === 0 && (
              <div className="py-3 text-center text-[12px] text-slate-600">No servers in the pool.</div>
            )}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2.5 font-mono text-[10.5px] text-slate-500">
            <span>
              total <span className="text-slate-300">{total.toLocaleString()}</span> requests
            </span>
            <span>
              fairness (Jain) <span className={snapshot.metrics.fairness > 0.95 ? 'text-neon-mint' : 'text-neon-amber'}>{snapshot.metrics.fairness.toFixed(3)}</span>
            </span>
            <span>
              gini <span className="text-slate-300">{snapshot.metrics.gini.toFixed(3)}</span>
            </span>
          </div>
        </div>

        {/* AI verdict */}
        {snapshot.autopilot.lastEvaluation && (
          <div className="rounded-xl border border-neon-violet/25 bg-neon-violet/[0.06] p-3.5">
            <div className="eyebrow mb-2 text-[#c3b9ff]">AI autopilot verdict for this algorithm</div>
            {(() => {
              const entry = snapshot.autopilot.lastEvaluation.ranked.find((r) => r.algorithm === definition.id);
              if (!entry) return <div className="text-[12px] text-slate-400">Not evaluated yet.</div>;
              return (
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="num font-display text-[22px] font-bold text-white">{entry.score.toFixed(1)}</span>
                    <span className="text-[11.5px] text-slate-400">
                      points · ranked #{snapshot.autopilot.lastEvaluation.ranked.findIndex((r) => r.algorithm === definition.id) + 1} of{' '}
                      {snapshot.autopilot.lastEvaluation.ranked.length}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {entry.contributions.map((c) => (
                      <div key={c.label + c.points} className="flex items-start justify-between gap-3 text-[11.5px]">
                        <span className="text-slate-400">
                          <span className="text-slate-200">{c.label}</span> — {c.detail}
                        </span>
                        <span className={clsx('num shrink-0 font-mono', c.points > 0 ? 'text-neon-mint' : 'text-neon-rose')}>
                          {c.points > 0 ? '+' : ''}
                          {c.points.toFixed(1)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </Modal>
  );
}

function Section({
  icon,
  title,
  children,
  tone,
}: {
  icon?: React.ReactNode;
  title: string;
  children: React.ReactNode;
  tone?: 'good' | 'bad';
}) {
  const color = tone === 'good' ? 'text-neon-mint' : tone === 'bad' ? 'text-neon-rose' : 'text-neon-cyan';
  return (
    <section className="rounded-xl border border-white/[0.07] bg-white/[0.018] p-3.5">
      <h4 className={clsx('mb-2 flex items-center gap-2 font-display text-[12px] font-semibold uppercase tracking-[0.12em]', color)}>
        {icon ?? <Cpu className="h-3.5 w-3.5" />}
        {title}
      </h4>
      {children}
    </section>
  );
}

function PerfTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-black/25 px-3 py-2.5">
      <div className="eyebrow">{label}</div>
      <div className="num mt-1 font-display text-[16px] font-semibold text-slate-100">{value}</div>
    </div>
  );
}

export { Gauge };
