import { Modal, Meter } from '@/components/ui/primitives';
import { useApp } from '@/state/store';
import { getAlgorithmName } from '@/algorithms/registry';
import { describeFeature } from '@/ai/features';
import { AUTOPILOT_THRESHOLDS } from '@/ai/decisionEngine';
import { fmtMs, fmtPct, clockTime } from '@/lib/format';
import { clsx } from '@/lib/clsx';
import type { FeatureVector } from '@/types';

/** "Why did AI choose this?" — the full, numeric justification. */
export function WhyModal() {
  const open = useApp((s) => s.whyOpen);
  const setWhyOpen = useApp((s) => s.setWhyOpen);
  const snapshot = useApp((s) => s.snapshot);

  const decision = snapshot.autopilot.lastDecision;
  const ranking = snapshot.autopilot.lastEvaluation;
  const features = decision?.features ?? snapshot.autopilot.lastFeatures;

  return (
    <Modal
      open={open}
      onClose={() => setWhyOpen(false)}
      eyebrow="AI decision engine · explainability"
      title="Why did AI choose this?"
      width="max-w-5xl"
    >
      {!decision || !ranking ? (
        <div className="py-8 text-center text-[13px] text-slate-500">
          No decision recorded yet. Enable AI Autopilot and let the simulation run for a second or two.
        </div>
      ) : (
        <div className="space-y-5">
          {/* Verdict */}
          <div
            className={clsx(
              'rounded-xl border p-4',
              decision.switched
                ? 'border-neon-violet/30 bg-gradient-to-r from-neon-violet/[0.12] to-transparent'
                : 'border-white/[0.08] bg-white/[0.02]',
            )}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <div className="eyebrow">Decision</div>
                <div className="mt-1 font-display text-[19px] font-semibold text-white">{decision.headline}</div>
              </div>
              <div className="flex gap-4">
                <HeaderStat label="Confidence" value={fmtPct(decision.confidence)} />
                <HeaderStat label="Margin" value={`${ranking.margin.toFixed(1)} pts`} />
                <HeaderStat label="Signals" value={String(ranking.activeRules.length)} />
                <HeaderStat label="Time" value={clockTime(decision.wallClock)} />
              </div>
            </div>
            <p className="mt-3 text-[12.5px] leading-relaxed text-slate-400">{decision.summary}</p>
          </div>

          {/* Metrics at decision time */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard label="Avg latency" value={fmtMs(decision.metrics.avgLatencyMs)} />
            <MetricCard label="p95 latency" value={fmtMs(decision.metrics.p95Ms)} />
            <MetricCard label="Error rate" value={fmtPct(decision.metrics.errorRate, 2)} />
            <MetricCard label="Throughput" value={`${decision.metrics.throughput.toFixed(0)} rps`} />
          </div>

          {/* Active signals */}
          <section>
            <h4 className="eyebrow mb-2">Signals that fired</h4>
            <div className="space-y-1.5">
              {ranking.activeRules.length === 0 && (
                <div className="rounded-lg border border-white/[0.06] bg-black/25 px-3 py-2 text-[12px] text-slate-500">
                  No stress signals detected — the pool is inside its comfort envelope.
                </div>
              )}
              {[...ranking.activeRules]
                .sort((a, b) => b.strength - a.strength)
                .map((rule) => (
                  <div
                    key={rule.id}
                    className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-black/25 px-3 py-2"
                  >
                    <span className="w-40 shrink-0 text-[11.5px] font-semibold text-slate-200">{rule.label}</span>
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-slate-400">{rule.evidence}</span>
                    <div className="w-24 shrink-0">
                      <Meter value={rule.strength * 100} tone={rule.strength > 0.7 ? 'rose' : rule.strength > 0.4 ? 'amber' : 'cyan'} height={4} />
                    </div>
                    <span className="num w-10 shrink-0 text-right font-mono text-[11px] text-slate-400">
                      {(rule.strength * 100).toFixed(0)}%
                    </span>
                  </div>
                ))}
            </div>
          </section>

          {/* Scorecard */}
          <section>
            <h4 className="eyebrow mb-2">
              Scorecard · every algorithm scored against the same signals (winner needs +
              {AUTOPILOT_THRESHOLDS.SWITCH_MARGIN} pts over the incumbent's {AUTOPILOT_THRESHOLDS.HYSTERESIS_BONUS}-pt
              advantage)
            </h4>
            <div className="overflow-hidden rounded-xl border border-white/[0.07]">
              <table className="w-full text-left">
                <thead className="bg-white/[0.03] text-[10px] uppercase tracking-[0.14em] text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-semibold">#</th>
                    <th className="px-3 py-2 font-semibold">Algorithm</th>
                    <th className="px-3 py-2 font-semibold">Score</th>
                    <th className="px-3 py-2 font-semibold">Top contributing signals</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.ranked.map((entry, index) => {
                    const isWinner = entry.algorithm === decision.algorithm;
                    return (
                      <tr
                        key={entry.algorithm}
                        className={clsx(
                          'border-t border-white/[0.05] align-top',
                          isWinner ? 'bg-neon-cyan/[0.06]' : 'bg-transparent',
                        )}
                      >
                        <td className="px-3 py-2.5 font-mono text-[11px] text-slate-500">{index + 1}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className={clsx('text-[12.5px] font-semibold', isWinner ? 'text-neon-cyan' : 'text-slate-200')}>
                              {getAlgorithmName(entry.algorithm)}
                            </span>
                            {isWinner && <span className="chip border-neon-cyan/40 text-[9.5px] text-neon-cyan">chosen</span>}
                          </div>
                          <div className="mt-1.5 w-32">
                            <Meter value={entry.score} max={120} tone={isWinner ? 'cyan' : 'blue'} height={4} />
                          </div>
                        </td>
                        <td className="num px-3 py-2.5 font-mono text-[13px] font-semibold text-slate-100">
                          {entry.score.toFixed(1)}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="space-y-0.5">
                            {entry.contributions.slice(0, 3).map((c) => (
                              <div key={c.label} className="flex items-start gap-2 text-[11px]">
                                <span className={clsx('num w-9 shrink-0 font-mono', c.points > 0 ? 'text-neon-mint' : 'text-neon-rose')}>
                                  {c.points > 0 ? '+' : ''}
                                  {c.points.toFixed(1)}
                                </span>
                                <span className="text-slate-400">
                                  <span className="text-slate-200">{c.label}:</span> {c.detail}
                                </span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Feature vector */}
          {features && <FeatureTable features={features} />}
        </div>
      )}
    </Modal>
  );
}

function HeaderStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div className="eyebrow">{label}</div>
      <div className="num font-display text-[14px] font-semibold text-slate-100">{value}</div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-black/25 px-3 py-2.5">
      <div className="eyebrow">{label}</div>
      <div className="num mt-1 font-display text-[16px] font-semibold text-slate-100">{value}</div>
    </div>
  );
}

const FEATURE_LABELS: { key: keyof FeatureVector; label: string; format?: (v: number) => string }[] = [
  { key: 'arrivalRate', label: 'Arrival rate', format: (v) => `${v.toFixed(0)} rps` },
  { key: 'trafficTrendPct', label: 'Traffic trend', format: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` },
  { key: 'spikeFactor', label: 'Spike factor', format: (v) => `${v.toFixed(2)}×` },
  { key: 'avgLatencyMs', label: 'Average latency', format: (v) => fmtMs(v) },
  { key: 'p95LatencyMs', label: 'p95 latency', format: (v) => fmtMs(v) },
  { key: 'latencySpreadMs', label: 'Latency spread', format: (v) => fmtMs(v) },
  { key: 'errorRate', label: 'Error rate', format: (v) => fmtPct(v, 2) },
  { key: 'poolCpu', label: 'Pool CPU', format: (v) => `${v.toFixed(0)}%` },
  { key: 'poolMemory', label: 'Pool memory', format: (v) => `${v.toFixed(0)}%` },
  { key: 'connectionImbalance', label: 'Connection imbalance', format: (v) => `${v.toFixed(2)}×` },
  { key: 'distributionGini', label: 'Distribution gini', format: (v) => v.toFixed(3) },
  { key: 'weightHeterogeneity', label: 'Weight spread', format: (v) => fmtPct(v) },
  { key: 'ipConcentration', label: 'Busiest-client share', format: (v) => fmtPct(v) },
  { key: 'healthyCount', label: 'Healthy upstreams', format: (v) => v.toFixed(0) },
  { key: 'degradedCount', label: 'Degraded upstreams', format: (v) => v.toFixed(0) },
  { key: 'downCount', label: 'Down upstreams', format: (v) => v.toFixed(0) },
  { key: 'capacityHeadroom', label: 'Capacity headroom', format: (v) => fmtPct(v) },
  { key: 'churnRate', label: 'Topology churn', format: (v) => fmtPct(v) },
];

function FeatureTable({ features }: { features: FeatureVector }) {
  return (
    <section>
      <h4 className="eyebrow mb-2">Raw signals the engine reasoned over</h4>
      <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURE_LABELS.map(({ key, label, format }) => (
          <div key={key} className="rounded-lg border border-white/[0.06] bg-black/25 px-3 py-2">
            <div className="text-[10.5px] uppercase tracking-wider text-slate-500">{label}</div>
            <div className="num mt-0.5 font-mono text-[13px] font-semibold text-slate-100">
              {format ? format(features[key]) : features[key].toFixed(2)}
            </div>
            <div className="mt-0.5 text-[10px] leading-snug text-slate-600">{describeFeature(key, features[key])}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
