import { Activity, Github, MessageSquare, Pause, Play, RotateCcw, Save, Sparkles } from 'lucide-react';
import { clsx } from '@/lib/clsx';
import { useApp } from '@/state/store';
import { Toggle } from '@/components/ui/primitives';
import { fmtMs, fmtPct, simClock } from '@/lib/format';

export function TopBar() {
  const snapshot = useApp((s) => s.snapshot);
  const toggleRunning = useApp((s) => s.toggleRunning);
  const resetSimulation = useApp((s) => s.resetSimulation);
  const saveLiveRun = useApp((s) => s.saveLiveRun);
  const setAutopilot = useApp((s) => s.setAutopilot);
  const setChatOpen = useApp((s) => s.setChatOpen);
  const chatOpen = useApp((s) => s.chat.open);
  const view = useApp((s) => s.view);
  const isLiveProxy = view === 'live-proxy';
  const m = snapshot.metrics;

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-white/[0.06] bg-black/25 px-4 backdrop-blur-xl">
      <div className="flex items-center gap-2.5">
        <Logo />
        <div className="leading-none">
          <div className="font-display text-[15px] font-bold tracking-tight text-white">LOADMIND</div>
          <div className="mt-[3px] font-mono text-[9px] uppercase tracking-[0.2em] text-slate-600">
            {isLiveProxy ? 'real HTTP reverse proxy' : 'intelligent load balancing'}
          </div>
        </div>
      </div>

      <div className="mx-1 hidden h-8 w-px bg-white/[0.07] lg:block" />

      {/* Simulator vitals are hidden while inspecting the independent HTTP data plane. */}
      {!isLiveProxy && <div className="hidden min-w-0 flex-1 items-center gap-4 lg:flex">
        <Vital label="RPS" value={m.throughput.toFixed(0)} sub={`${m.arrivalRate.toFixed(0)} in`} />
        <Vital
          label="P95"
          value={fmtMs(m.p95Ms)}
          tone={m.p95Ms > 700 ? 'bad' : m.p95Ms > 300 ? 'warn' : 'good'}
          sub={`avg ${fmtMs(m.avgLatencyMs)}`}
        />
        <Vital
          label="ERR"
          value={fmtPct(m.errorRate, 2)}
          tone={m.errorRate > 0.05 ? 'bad' : m.errorRate > 0.01 ? 'warn' : 'good'}
          sub={`${m.failed.toLocaleString()} failed`}
        />
        <Vital label="POOL" value={`${m.healthyCount}/${snapshot.servers.length}`} sub={`${m.downCount} down`} tone={m.downCount ? 'bad' : 'good'} />
        <Vital label="CLOCK" value={simClock(snapshot.simTime)} sub={`${snapshot.inFlight} in flight`} />
      </div>}

      <div className="ml-auto flex items-center gap-2">
        {isLiveProxy ? (
          <span className="hidden items-center gap-1.5 rounded-lg border border-neon-cyan/20 bg-neon-cyan/[0.06] px-2.5 py-2 font-mono text-[9px] uppercase tracking-wider text-neon-cyan sm:inline-flex">
            <Activity className="h-3 w-3" /> real HTTP mode
          </span>
        ) : (
          <>
            <div className="hidden items-center gap-2 rounded-lg border border-white/[0.07] bg-black/30 px-2.5 py-1.5 xl:flex">
              <Sparkles className={clsx('h-3.5 w-3.5', snapshot.autopilot.enabled ? 'text-neon-violet' : 'text-slate-600')} />
              <span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">autopilot</span>
              <Toggle checked={snapshot.autopilot.enabled} onChange={setAutopilot} size="sm" accent="violet" />
            </div>

            <button type="button" onClick={toggleRunning} className={clsx('btn px-2.5 py-1.5', !snapshot.running && 'btn-primary')}>
              {snapshot.running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{snapshot.running ? 'Pause' : 'Run'}</span>
            </button>
            <button type="button" onClick={resetSimulation} className="btn btn-ghost px-2 py-1.5" title="Reset">
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={saveLiveRun} className="btn btn-ghost px-2 py-1.5" title="Save run to Performance Lab">
              <Save className="h-3.5 w-3.5" />
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => setChatOpen(!chatOpen)}
          className={clsx('btn px-2.5 py-1.5', chatOpen && 'btn-violet')}
          title="LoadMind AI"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Ask AI</span>
        </button>
      </div>
    </header>
  );
}

function Vital({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'warn' | 'bad' }) {
  const color = tone === 'bad' ? 'text-neon-rose' : tone === 'warn' ? 'text-neon-amber' : tone === 'good' ? 'text-neon-mint' : 'text-slate-100';
  return (
    <div className="leading-none">
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-slate-600">{label}</span>
        <span className={clsx('num font-mono text-[13px] font-semibold', color)}>{value}</span>
      </div>
      {sub && <div className="mt-1 font-mono text-[9.5px] text-slate-600">{sub}</div>}
    </div>
  );
}

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <div
      className="relative grid shrink-0 place-items-center rounded-lg border border-neon-cyan/25 bg-gradient-to-br from-neon-cyan/20 to-neon-violet/20"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 32 32" width={size * 0.68} height={size * 0.68} fill="none">
        <path d="M6 22 L13 10 L20 22" stroke="#22d3ee" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M16 22 L23 10 L28 18" stroke="#8b7cf6" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export { Activity, Github };
