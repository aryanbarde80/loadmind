import { memo } from 'react';
import { CheckCircle2, ChevronRight } from 'lucide-react';
import { clsx } from '@/lib/clsx';
import { ALGORITHM_FAMILIES, getAlgorithm } from '@/algorithms/registry';
import { explainFor, nextPick } from '@/algorithms/explain';
import type { AlgorithmDefinition } from '@/algorithms/types';
import type { ServerState } from '@/types';

export const AlgorithmCard = memo(function AlgorithmCard({
  id,
  active,
  servers,
  simTime,
  onSelect,
  onDetails,
  score,
}: {
  id: string;
  active: boolean;
  servers: ServerState[];
  simTime: number;
  onSelect: () => void;
  onDetails: () => void;
  score?: number;
}) {
  const definition = getAlgorithm(id);
  if (!definition) return null;
  const family = ALGORITHM_FAMILIES[definition.family];
  const explanation = explainFor(definition, servers, simTime);
  const pick = nextPick(definition, servers, simTime);
  const pickName = pick !== null && pick >= 0 ? servers[pick]?.name : null;

  return (
    <div
      className={clsx(
        'group relative flex flex-col overflow-hidden rounded-xl border transition-all duration-200',
        active
          ? 'border-neon-cyan/50 bg-neon-cyan/[0.055] shadow-[0_0_0_1px_rgba(34,211,238,0.22),0_20px_50px_-30px_rgba(34,211,238,0.6)]'
          : 'border-white/[0.07] bg-white/[0.022] hover:border-white/[0.18] hover:bg-white/[0.04]',
      )}
    >
      <button type="button" onClick={onSelect} className="flex flex-1 flex-col items-start p-3.5 text-left">
        <div className="flex w-full items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="rounded border px-1.5 py-[1px] font-mono text-[9.5px] font-bold"
                style={{
                  color: family.color,
                  borderColor: `${family.color}44`,
                  background: `${family.color}14`,
                }}
              >
                {definition.short}
              </span>
              <h4 className="truncate font-display text-[13px] font-semibold tracking-tight text-slate-100">
                {definition.name}
              </h4>
            </div>
            <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-snug text-slate-500">{definition.tagline}</p>
          </div>
          {active && <CheckCircle2 className="h-4 w-4 shrink-0 text-neon-cyan" />}
        </div>

        <div className="mt-3 w-full rounded-lg border border-white/[0.06] bg-black/25 px-2.5 py-2">
          <div className="eyebrow mb-1">Next request →</div>
          <div className="font-mono text-[10.5px] leading-relaxed text-slate-400">
            {pickName ? (
              <>
                <span className="text-neon-cyan">{pickName}</span> — {explanation}
              </>
            ) : (
              <span className="text-neon-rose">No healthy upstream available</span>
            )}
          </div>
        </div>

        <div className="mt-2.5 flex w-full items-center justify-between">
          <div className="flex flex-wrap items-center gap-1">
            <span className="chip text-[10px]">{definition.complexity.split('·')[0].trim()}</span>
            {score !== undefined && (
              <span
                className={clsx(
                  'chip text-[10px]',
                  score >= 70 ? 'border-neon-mint/30 text-neon-mint' : score >= 55 ? 'border-neon-amber/30 text-neon-amber' : 'border-neon-rose/30 text-neon-rose',
                )}
              >
                AI score {score.toFixed(0)}
              </span>
            )}
          </div>
          <span className="flex items-center gap-0.5 text-[10.5px] font-medium text-slate-500 opacity-0 transition group-hover:opacity-100">
            Details <ChevronRight className="h-3 w-3" />
          </span>
        </div>
      </button>

      <button
        type="button"
        onClick={onDetails}
        className="border-t border-white/[0.06] px-3.5 py-2 text-left text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-500 transition hover:bg-white/[0.04] hover:text-neon-cyan"
      >
        How it works · pros &amp; cons
      </button>
    </div>
  );
});

export function algorithmFamilyColor(id: string): string {
  const definition = getAlgorithm(id);
  if (!definition) return '#94a3b8';
  return ALGORITHM_FAMILIES[definition.family].color;
}

export type { AlgorithmDefinition };
