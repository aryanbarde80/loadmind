import { useEffect } from 'react';
import { Command } from 'lucide-react';
import { useApp } from '@/state/store';
import { useEngineClock } from '@/state/hooks';
import { TopBar } from '@/components/layout/TopBar';
import { SideRail } from '@/components/layout/SideRail';
import { Landing } from '@/components/landing/Landing';
import { ControlView } from '@/views/ControlView';
import { AlgorithmsView } from '@/views/AlgorithmsView';
import { BattleView } from '@/views/BattleView';
import { ChaosView } from '@/views/ChaosView';
import { PlaygroundView } from '@/views/PlaygroundView';
import { LabView } from '@/views/LabView';
import { ArchitectureView } from '@/views/ArchitectureView';
import { LiveProxyView } from '@/views/LiveProxyView';
import { AlgorithmDetailModal } from '@/components/algorithms/AlgorithmDetailModal';
import { WhyModal } from '@/components/autopilot/WhyModal';
import { ChatPanel } from '@/components/chat/ChatPanel';

export default function App() {
  useEngineClock();

  const view = useApp((s) => s.view);
  const booted = useApp((s) => s.booted);
  const boot = useApp((s) => s.boot);
  const toast = useApp((s) => s.savedToast);
  const snapshot = useApp((s) => s.snapshot);
  const toggleRunning = useApp((s) => s.toggleRunning);
  const setChatOpen = useApp((s) => s.setChatOpen);

  // Keyboard shortcuts: space = run/pause, ⌘/ctrl+K = ask AI.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (event.code === 'Space') {
        event.preventDefault();
        toggleRunning();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setChatOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleRunning, setChatOpen]);

  return (
    <div className="flex h-screen w-full overflow-hidden">
      {booted && <SideRail />}

      <div className="flex min-w-0 flex-1 flex-col">
        {booted && <TopBar />}

        <main className="min-h-0 flex-1 overflow-y-auto p-3">
          {view === 'control' && <ControlView />}
          {view === 'algorithms' && <AlgorithmsView />}
          {view === 'battle' && <BattleView />}
          {view === 'chaos' && <ChaosView />}
          {view === 'playground' && <PlaygroundView />}
          {view === 'lab' && <LabView />}
          {view === 'architecture' && <ArchitectureView />}
          {view === 'live-proxy' && <LiveProxyView />}
        </main>

        {booted && (
          <footer className="flex h-8 shrink-0 items-center gap-4 border-t border-white/[0.06] bg-black/30 px-4 font-mono text-[10px] text-slate-600">
            <span className="flex items-center gap-1.5">
              <span
                className={`h-1.5 w-1.5 rounded-full ${snapshot.running ? 'bg-neon-mint' : 'bg-slate-600'}`}
              />
              {view === 'live-proxy' ? 'simulator remains separate' : snapshot.running ? 'simulation running' : 'simulation paused'}
            </span>
            {view !== 'live-proxy' && <span>seed {snapshot.config.seed}</span>}
            {view !== 'live-proxy' && <span>tick 50ms</span>}
            <span>
              {view === 'live-proxy'
                ? 'real HTTP mode · active health checks'
                : `${snapshot.servers.length} upstreams · ${snapshot.metrics.completed.toLocaleString()} requests completed`}
            </span>
            <span className="ml-auto hidden items-center gap-1.5 sm:flex">
              <Command className="h-3 w-3" />K ask AI · space run/pause
            </span>
            <button
              type="button"
              onClick={() => useApp.setState({ booted: false })}
              className="hidden transition hover:text-slate-300 sm:block"
              title="Show the introduction screen again"
            >
              replay intro
            </button>
            <span>LoadMind v1.0</span>
          </footer>
        )}
      </div>

      {booted && <ChatPanel />}
      <AlgorithmDetailModal />
      <WhyModal />

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 animate-fade-up rounded-lg border border-neon-cyan/30 bg-void-900/95 px-4 py-2.5 text-[12.5px] text-neon-cyan shadow-[0_20px_50px_-20px_rgba(0,0,0,1)] backdrop-blur-xl">
          {toast}
        </div>
      )}

      {!booted && (
        <Landing
          onStart={boot}
          onOpenLiveProxy={() => {
            useApp.getState().dismissBoot();
            useApp.getState().setView('live-proxy');
          }}
        />
      )}
    </div>
  );
}
