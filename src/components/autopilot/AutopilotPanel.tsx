import { useEffect, useRef } from 'react';
import { Sparkles, Activity, Cpu, RefreshCw, Brain, Radio } from 'lucide-react';
import { clsx } from '@/lib/clsx';
import { useApp } from '@/state/store';
import { Panel, Toggle, Meter, EmptyState } from '@/components/ui/primitives';
import { clockTime } from '@/lib/format';
import { getAlgorithmName } from '@/algorithms/registry';

const SEVERITY = {
  info: 'text-slate-400 border-l-slate-600',
  warn: 'text-neon-amber border-l-neon-amber',
  critical: 'text-neon-rose border-l-neon-rose',
  good: 'text-neon-mint border-l-neon-mint',
} as const;

/**
 * AI Autopilot panel — the signature feature.
 *
 * Big toggle, live decision feed, and the current scorecard at a glance.
 */
export function AutopilotPanel({ compact = false }: { compact?: boolean }) {
  const snapshot = useApp((s) => s.snapshot);
  const setAutopilot = useApp((s) => s.setAutopilot);
  const setWhyOpen = useApp((s) => s.setWhyOpen);
  const enabled = snapshot.autopilot.enabled;
  const decision = snapshot.autopilot.lastDecision;
  const ranking = snapshot.autopilot.lastEvaluation;

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {/* Toggle card */}
      <div
        className={clsx(
          'relative overflow-hidden rounded-2xl border p-4 transition-colors duration-300',
          enabled
            ? 'border-neon-violet/40 bg-gradient-to-br from-neon-violet/[0.16] via-neon-violet/[0.04] to-transparent'
            : 'border-white/[0.08] bg-white/[0.02]',
        )}
      >
        {enabled && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -left-8 top-0 h-full w-24 animate-sweep bg-gradient-to-r from-transparent via-neon-violet/10 to-transparent" />
          </div>
        )}
        <div className="relative flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Sparkles className={clsx('h-4 w-4', enabled ? 'text-neon-violet' : 'text-slate-600')} />
              <span className="eyebrow">AI autopilot</span>
            </div>
            <div className="mt-1 flex items-center gap-2.5">
              <span
                className={clsx(
                  'font-display text-[22px] font-bold tracking-tight',
                  enabled ? 'text-white' : 'text-slate-500',
                )}
              >
                AI AUTOPILOT: {enabled ? 'ON' : 'OFF'}
              </span>
              {enabled && <span className="h-2 w-2 animate-blink rounded-full bg-neon-violet shadow-[0_0_10px_rgba(139,124,246,0.9)]" />}
            </div>
            <p className="mt-1.5 max-w-md text-[11.5px] leading-relaxed text-slate-500">
              {enabled
                ? 'Continuously scoring every algorithm against live CPU, memory, connections, latency, errors and traffic trend — switching only when the margin clears the hysteresis threshold.'
                : 'Manual control. Turn on to let the decision engine select and switch algorithms automatically.'}
            </p>
          </div>
          <Toggle checked={enabled} onChange={setAutopilot} size="lg" accent="violet" />
        </div>

        {enabled && (
          <div className="relative mt-3.5 grid grid-cols-3 gap-2 border-t border-white/[0.07] pt-3">
            <MiniCell icon={<Activity className="h-3 w-3" />} label="Evaluations" value={String(snapshot.autopilot.evaluations)} />
            <MiniCell icon={<RefreshCw className="h-3 w-3" />} label="Switches" value={String(snapshot.autopilot.switches)} />
            <MiniCell
              icon={<Brain className="h-3 w-3" />}
              label="Confidence"
              value={decision ? `${(decision.confidence * 100).toFixed(0)}%` : '—'}
            />
          </div>
        )}
      </div>

      {/* Live reasoning */}
      {enabled && decision && (
        <div className="rounded-xl border border-white/[0.07] bg-black/25 p-3">
          <div className="flex items-center justify-between">
            <span className="eyebrow">Current reasoning</span>
            <button type="button" className="btn btn-ghost px-2 py-0.5 text-[11px]" onClick={() => setWhyOpen(true)}>
              Why did AI choose this?
            </button>
          </div>
          <p className="mt-1.5 text-[12px] leading-relaxed text-slate-300">{decision.headline}</p>
          {ranking && (
            <div className="mt-2.5 space-y-1">
              {ranking.ranked.slice(0, 3).map((entry, index) => (
                <div key={entry.algorithm} className="flex items-center gap-2">
                  <span className="w-3 font-mono text-[10px] text-slate-600">{index + 1}</span>
                  <span
                    className={clsx(
                      'w-36 shrink-0 truncate text-[11px]',
                      entry.algorithm === decision.algorithm ? 'font-semibold text-neon-violet' : 'text-slate-400',
                    )}
                  >
                    {getAlgorithmName(entry.algorithm)}
                  </span>
                  <div className="flex-1">
                    <Meter value={entry.score} max={120} tone={index === 0 ? 'violet' : 'blue'} height={4} />
                  </div>
                  <span className="num w-9 shrink-0 text-right font-mono text-[10.5px] text-slate-400">
                    {entry.score.toFixed(0)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Decision feed */}
      <Panel
        eyebrow="AI decision feed"
        title="Live reasoning stream"
        icon={<Radio className="h-3.5 w-3.5" />}
        className="min-h-0 flex-1"
        bodyClassName="overflow-hidden"
        actions={
          <span className="font-mono text-[10px] text-slate-600">
            {snapshot.feed.length} events
          </span>
        }
      >
        <FeedList compact={compact} />
      </Panel>
    </div>
  );
}

function MiniCell({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/25 px-2.5 py-2">
      <div className="flex items-center gap-1 text-[9.5px] uppercase tracking-wider text-slate-500">
        {icon}
        {label}
      </div>
      <div className="num mt-0.5 font-display text-[15px] font-semibold text-slate-100">{value}</div>
    </div>
  );
}

function FeedList({ compact }: { compact?: boolean }) {
  const feed = useApp((s) => s.snapshot.feed);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [feed.length]);

  if (feed.length === 0) {
    return (
      <EmptyState
        icon={<Radio className="h-7 w-7" />}
        title="No decisions yet"
        description="Start the simulation and enable AI Autopilot. Every evaluation, comparison and switch is logged here with a timestamp."
      />
    );
  }

  return (
    <div className={clsx('h-full space-y-1.5 overflow-y-auto pr-1', compact ? 'max-h-[220px]' : '')}>
      {feed
        .slice()
        .reverse()
        .slice(0, 40)
        .map((item) => (
          <div
            key={item.id}
            className={clsx(
              'animate-fade-up rounded-r-md border-l-2 bg-white/[0.022] px-2.5 py-1.5',
              SEVERITY[item.severity],
            )}
          >
            <div className="flex items-baseline gap-2">
              <span className="num font-mono text-[10px] text-slate-500">{clockTime(item.wallClock)}</span>
              <span className="text-[11.5px] leading-snug text-slate-300">{item.message}</span>
            </div>
          </div>
        ))}
      <div ref={endRef} />
    </div>
  );
}

export { Cpu };
