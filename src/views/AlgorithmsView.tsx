import { useMemo, useState } from 'react';
import { Network, Sparkles, Users } from 'lucide-react';
import { useApp } from '@/state/store';
import { Panel, Segmented, StatusDot, EmptyState } from '@/components/ui/primitives';
import { ActiveAlgorithmBanner } from '@/components/algorithms/ActiveAlgorithmBanner';
import { AlgorithmCard } from '@/components/algorithms/AlgorithmCard';
import { AutopilotPanel } from '@/components/autopilot/AutopilotPanel';
import { BUILTIN_ALGORITHMS, getAlgorithm, getAlgorithmName } from '@/algorithms/registry';
import { explainFor, nextPick, SAMPLE_IPS } from '@/algorithms/explain';
import { clsx } from '@/lib/clsx';
import { fmtMs } from '@/lib/format';
import type { AlgorithmDefinition } from '@/algorithms/types';

const FAMILIES = ['all', 'static', 'dynamic', 'affinity'] as const;

export function AlgorithmsView() {
  const snapshot = useApp((s) => s.snapshot);
  const setAlgorithm = useApp((s) => s.setAlgorithm);
  const openAlgorithmDetail = useApp((s) => s.openAlgorithmDetail);
  const [family, setFamily] = useState<(typeof FAMILIES)[number]>('all');

  const scores = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of snapshot.autopilot.lastEvaluation?.ranked ?? []) map.set(entry.algorithm, entry.score);
    return map;
  }, [snapshot.autopilot.lastEvaluation]);

  const visible = BUILTIN_ALGORITHMS.filter((a) => family === 'all' || a.family === family);

  return (
    <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_370px]">
      <div className="min-w-0 space-y-3">
        <ActiveAlgorithmBanner />

        <Panel
          eyebrow="Algorithm control center"
          title="Choose how requests are routed"
          icon={<Network className="h-3.5 w-3.5" />}
          actions={
            <div className="flex items-center gap-2">
              {snapshot.autopilot.enabled && (
                <span className="chip border-neon-violet/40 text-[10px] text-[#c3b9ff]">
                  <Sparkles className="h-2.5 w-2.5" /> autopilot is choosing — picking manually disengages it
                </span>
              )}
              <Segmented
                size="sm"
                value={family}
                onChange={setFamily}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'static', label: 'Static' },
                  { value: 'dynamic', label: 'Dynamic' },
                  { value: 'affinity', label: 'Affinity' },
                ]}
              />
            </div>
          }
        >
          <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {visible.map((definition) => (
              <AlgorithmCard
                key={definition.id}
                id={definition.id}
                active={snapshot.activeAlgorithm === definition.id}
                servers={snapshot.servers}
                simTime={snapshot.simTime}
                score={scores.get(definition.id)}
                onSelect={() => setAlgorithm(definition.id as never)}
                onDetails={() => openAlgorithmDetail(definition.id)}
              />
            ))}
          </div>
        </Panel>

        <SelectionMatrix />
      </div>

      <div className="min-w-0 space-y-3">
        <AutopilotPanel compact />
      </div>
    </div>
  );
}

/**
 * Runs every algorithm against the same pool and the same request, so you can
 * see that the strategies genuinely disagree — they are not cosmetic variants.
 */
function SelectionMatrix() {
  const snapshot = useApp((s) => s.snapshot);
  const [ip, setIp] = useState(SAMPLE_IPS[0]);
  const [customIp, setCustomIp] = useState('');

  const effectiveIp = customIp.trim() || ip;
  const rows = useMemo(() => {
    return BUILTIN_ALGORITHMS.map((definition: AlgorithmDefinition) => {
      const pick = nextPick(definition, snapshot.servers, snapshot.simTime, effectiveIp);
      const server = pick !== null && pick >= 0 ? snapshot.servers[pick] : null;
      return {
        id: definition.id,
        name: definition.name,
        short: definition.short,
        server,
        explanation: explainFor(definition, snapshot.servers, snapshot.simTime, effectiveIp),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveIp, snapshot.simTime, snapshot.servers.length, snapshot.activeAlgorithm]);

  const grouped = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const row of rows) {
      const key = row.server?.name ?? 'none';
      map.set(key, [...(map.get(key) ?? []), row.short]);
    }
    return [...map.entries()];
  }, [rows]);

  return (
    <Panel
      eyebrow="Decision comparison"
      title="What would each algorithm do with this request?"
      icon={<Users className="h-3.5 w-3.5" />}
      actions={
        <div className="flex items-center gap-1.5">
          <select
            className="field w-[150px] py-1.5 font-mono text-[11px]"
            value={ip}
            onChange={(e) => {
              setIp(e.target.value);
              setCustomIp('');
            }}
          >
            {SAMPLE_IPS.map((sample) => (
              <option key={sample} value={sample}>
                {sample}
              </option>
            ))}
          </select>
          <input
            className="field w-[130px] py-1.5 font-mono text-[11px]"
            placeholder="custom IP"
            value={customIp}
            onChange={(e) => setCustomIp(e.target.value)}
          />
        </div>
      }
    >
      {snapshot.servers.every((s) => s.down) ? (
        <EmptyState title="All upstreams are offline" description="Bring a server back to compare selections." />
      ) : (
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left">
              <thead className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                <tr className="border-b border-white/[0.07]">
                  <th className="py-2 pr-3 font-semibold">Algorithm</th>
                  <th className="py-2 pr-3 font-semibold">Would pick</th>
                  <th className="py-2 font-semibold">Reasoning</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-white/[0.04] align-top">
                    <td className="py-2 pr-3">
                      <span className="font-display text-[12px] font-semibold text-slate-200">{row.name}</span>
                    </td>
                    <td className="py-2 pr-3">
                      {row.server ? (
                        <span className="flex items-center gap-1.5 font-mono text-[11.5px] text-neon-cyan">
                          <StatusDot status={row.server.status} pulse={false} />
                          {row.server.name}
                        </span>
                      ) : (
                        <span className="font-mono text-[11.5px] text-neon-rose">no healthy upstream</span>
                      )}
                    </td>
                    <td className="py-2 text-[11.5px] leading-snug text-slate-400">{row.explanation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border border-white/[0.06] bg-black/25 p-3">
            <div className="eyebrow mb-2">
              Consensus for client {effectiveIp} · {fmtMs(snapshot.metrics.avgLatencyMs)} avg latency
            </div>
            <div className="flex flex-wrap gap-1.5">
              {grouped.map(([name, shorts]) => (
                <span
                  key={name}
                  className={clsx(
                    'chip font-mono text-[10.5px]',
                    shorts.length === 1 ? 'border-white/10' : 'border-neon-cyan/30 bg-neon-cyan/[0.07] text-neon-cyan',
                  )}
                >
                  {name} · {shorts.join('/')}
                </span>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              Algorithms that agree are highlighted. Static policies ignore load entirely, affinity policies stay pinned to
              the same node for the same client, and dynamic policies move as latency and connection depth change.
            </p>
          </div>
        </div>
      )}
    </Panel>
  );
}

export { getAlgorithm, getAlgorithmName };
