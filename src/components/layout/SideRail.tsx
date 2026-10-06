import {
  Activity,
  Boxes,
  Flame,
  FlaskConical,
  Globe,
  Network,
  ShieldAlert,
  Swords,
  Terminal,
} from 'lucide-react';
import { clsx } from '@/lib/clsx';
import { useApp, type ViewId } from '@/state/store';
import { Logo } from './TopBar';

const NAV: { id: ViewId; label: string; icon: React.ComponentType<{ className?: string }>; hint: string }[] = [
  { id: 'control', label: 'Control Center', icon: Activity, hint: 'Live traffic, pool, autopilot' },
  { id: 'algorithms', label: 'Algorithms', icon: Network, hint: '8 strategies, deep dives' },
  { id: 'battle', label: 'Battle Mode', icon: Swords, hint: 'Same traffic, all algorithms' },
  { id: 'chaos', label: 'Chaos Mode', icon: Flame, hint: 'Break things on purpose' },
  { id: 'playground', label: 'Playground', icon: Terminal, hint: 'Build your own algorithm' },
  { id: 'lab', label: 'Performance Lab', icon: FlaskConical, hint: 'Historical runs & comparison' },
  { id: 'architecture', label: 'Architecture', icon: Boxes, hint: 'How LoadMind works' },
  { id: 'live-proxy', label: 'Live Proxy', icon: Globe, hint: 'Real HTTP routing & upstream health' },
];

export function SideRail() {
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const running = useApp((s) => s.snapshot.running);
  const autopilot = useApp((s) => s.snapshot.autopilot.enabled);

  return (
    <nav className="flex w-[62px] shrink-0 flex-col items-center gap-1 border-r border-white/[0.06] bg-black/30 py-3 backdrop-blur-xl">
      <div className="mb-2">
        <Logo size={32} />
      </div>

      {NAV.map(({ id, label, icon: Icon, hint }) => {
        const active = view === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            title={`${label} — ${hint}`}
            className={clsx(
              'group relative flex h-11 w-11 items-center justify-center rounded-xl border transition-all duration-200',
              active
                ? 'border-neon-cyan/40 bg-neon-cyan/[0.12] text-neon-cyan shadow-[0_0_20px_-8px_rgba(34,211,238,0.7)]'
                : 'border-transparent text-slate-500 hover:bg-white/[0.05] hover:text-slate-200',
            )}
          >
            <Icon className="h-[18px] w-[18px]" />
            <span className="pointer-events-none absolute left-[52px] z-50 hidden whitespace-nowrap rounded-md border border-white/10 bg-void-900/95 px-2 py-1 text-[11px] text-slate-200 shadow-xl group-hover:block">
              {label}
              <span className="ml-1.5 text-slate-600">{hint}</span>
            </span>
            {active && <span className="absolute -left-[1px] h-5 w-[2px] rounded-r bg-neon-cyan" />}
          </button>
        );
      })}

      <div className="mt-auto flex flex-col items-center gap-2">
        <span
          className={clsx(
            'h-2 w-2 rounded-full',
            running ? 'bg-neon-mint shadow-[0_0_8px_rgba(52,229,176,0.9)]' : 'bg-slate-600',
          )}
          title={running ? 'Simulation running' : 'Simulation paused'}
        />
        {autopilot && (
          <span title="AI Autopilot engaged">
            <ShieldAlert className="h-3.5 w-3.5 text-neon-violet" />
          </span>
        )}
      </div>
    </nav>
  );
}
