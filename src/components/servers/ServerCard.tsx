import { memo } from 'react';
import { Cpu, MemoryStick, Network, Timer, AlertTriangle, Zap } from 'lucide-react';
import { clsx } from '@/lib/clsx';
import { Meter, Sparkline, StatusBadge } from '@/components/ui/primitives';
import type { ServerState } from '@/types';

const toneFor = (value: number, warn: number, bad: number) => (value >= bad ? 'rose' : value >= warn ? 'amber' : 'mint');

export const ServerCard = memo(function ServerCard({
  server,
  selected,
  onSelect,
  share,
  compact,
  version,
}: {
  server: ServerState;
  selected: boolean;
  onSelect: () => void;
  share: number;
  compact?: boolean;
  /** Bumped every tick: server state mutates in place, so this drives updates. */
  version: number;
}) {
  void version;
  const latencyTone = server.ewmaLatencyMs > server.baseLatencyMs * 2.2 ? 'rose' : server.ewmaLatencyMs > server.baseLatencyMs * 1.5 ? 'amber' : 'mint';
  const errorPct = server.errorRate * 100;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={clsx(
        'group relative w-full overflow-hidden rounded-xl border p-3 text-left transition-all duration-200',
        selected
          ? 'border-neon-cyan/50 bg-neon-cyan/[0.06] shadow-[0_0_0_1px_rgba(34,211,238,0.25),0_18px_40px_-24px_rgba(34,211,238,0.5)]'
          : 'border-white/[0.07] bg-white/[0.022] hover:border-white/20 hover:bg-white/[0.045]',
        server.down && 'opacity-70',
      )}
    >
      {/* share ribbon */}
      <div
        className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-neon-cyan to-neon-violet transition-[width] duration-500"
        style={{ width: `${Math.min(100, share * 100)}%`, opacity: server.down ? 0.2 : 0.85 }}
      />

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-[12.5px] font-bold tracking-wide text-slate-100">{server.name}</div>
          <div className="mt-0.5 font-mono text-[10px] text-slate-500">
            w{server.weight} · cap {Math.round(server.capacity * server.capacityFactor)} · base {server.baseLatencyMs}ms
          </div>
        </div>
        <StatusBadge status={server.status} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
        <Metric
          icon={<Cpu className="h-3 w-3" />}
          label="CPU"
          value={`${server.cpu.toFixed(0)}%`}
          meter={server.cpu}
          tone={toneFor(server.cpu, 70, 88)}
        />
        <Metric
          icon={<MemoryStick className="h-3 w-3" />}
          label="MEM"
          value={`${server.memory.toFixed(0)}%`}
          meter={server.memory}
          tone={toneFor(server.memory, 72, 90)}
        />
        <Metric
          icon={<Network className="h-3 w-3" />}
          label="CONN"
          value={String(server.activeConnections)}
          meter={Math.min(100, server.utilization * 100)}
          tone={toneFor(server.utilization * 100, 75, 92)}
        />
        <Metric
          icon={<Timer className="h-3 w-3" />}
          label="LATENCY"
          value={`${server.ewmaLatencyMs.toFixed(0)}ms`}
          meter={Math.min(100, (server.ewmaLatencyMs / (server.baseLatencyMs * 3)) * 100)}
          tone={latencyTone}
        />
      </div>

      {!compact && (
        <>
          <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2.5">
            <div className="font-mono text-[10px] text-slate-500">
              <span className="num text-slate-300">{server.rps.toFixed(0)}</span> rps
              <span className="mx-1.5 text-slate-700">|</span>
              <span className={clsx('num', errorPct > 3 ? 'text-neon-rose' : 'text-slate-300')}>
                {errorPct.toFixed(2)}%
              </span>{' '}
              err
              <span className="mx-1.5 text-slate-700">|</span>
              <span className="num text-slate-300">{(share * 100).toFixed(1)}%</span> share
            </div>
            {server.latencySamples.length > 2 && (
              <div className="w-[62px]">
                <Sparkline
                  values={server.latencySamples.slice(-28)}
                  stroke={latencyTone === 'rose' ? '#fb5a7a' : latencyTone === 'amber' ? '#fbbf24' : '#34e5b0'}
                  height={18}
                />
              </div>
            )}
          </div>

          {(server.latencyPenaltyMs > 0 || server.errorPenalty > 0 || server.capacityFactor < 1) && (
            <div className="mt-2 flex flex-wrap gap-1">
              {server.latencyPenaltyMs > 0 && (
                <span className="chip border-neon-amber/30 bg-neon-amber/10 text-[10px] text-neon-amber">
                  <Zap className="h-2.5 w-2.5" /> +{server.latencyPenaltyMs}ms chaos
                </span>
              )}
              {server.errorPenalty > 0 && (
                <span className="chip border-neon-rose/30 bg-neon-rose/10 text-[10px] text-neon-rose">
                  <AlertTriangle className="h-2.5 w-2.5" /> +{(server.errorPenalty * 100).toFixed(0)}% errors
                </span>
              )}
              {server.capacityFactor < 1 && (
                <span className="chip border-neon-violet/30 bg-neon-violet/10 text-[10px] text-[#c3b9ff]">
                  −{Math.round((1 - server.capacityFactor) * 100)}% capacity
                </span>
              )}
            </div>
          )}
        </>
      )}
    </button>
  );
});

function Metric({
  icon,
  label,
  value,
  meter,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  meter: number;
  tone: 'mint' | 'amber' | 'rose';
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          <span className="text-slate-600">{icon}</span>
          {label}
        </span>
        <span
          className={clsx(
            'num font-mono text-[12px] font-semibold',
            tone === 'rose' ? 'text-neon-rose' : tone === 'amber' ? 'text-neon-amber' : 'text-slate-200',
          )}
        >
          {value}
        </span>
      </div>
      <div className="mt-1">
        <Meter value={meter} tone={tone} height={3} />
      </div>
    </div>
  );
}
