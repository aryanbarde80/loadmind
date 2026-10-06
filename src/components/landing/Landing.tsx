import { useEffect, useRef } from 'react';
import { Activity, ArrowRight, Globe, Play, Sparkles, Swords, Zap } from 'lucide-react';
import { Logo } from '@/components/layout/TopBar';

/**
 * Landing experience.
 *
 * The entry screen exposes both the deterministic simulator and the optional
 * real-HTTP proxy without replacing one with the other.
 */
export function Landing({
  onStart,
  onOpenLiveProxy,
}: {
  onStart: (mode: 'simulation' | 'battle' | 'autopilot') => void;
  onOpenLiveProxy: () => void;
}) {

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center overflow-hidden bg-void-950">
      <Backdrop />
      <div className="relative z-10 w-full max-w-4xl px-6 text-center">
        <div className="mb-6 flex justify-center">
          <div className="animate-float-slow">
            <Logo size={64} />
          </div>
        </div>

        <div className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.42em] text-neon-cyan/70">
          intelligent load balancing platform
        </div>
        <h1 className="font-display text-[54px] font-bold leading-[0.95] tracking-tight text-white sm:text-[76px]">
          LOAD<span className="bg-gradient-to-r from-neon-cyan to-neon-violet bg-clip-text text-transparent">MIND</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl font-display text-[17px] font-medium leading-relaxed text-slate-400 sm:text-[19px]">
          A load balancer that learns how your traffic behaves.
        </p>
        <p className="mx-auto mt-3 max-w-xl text-[13px] leading-relaxed text-slate-600">
          Eight real routing algorithms, a live request-level simulation, an explainable AI autopilot that switches
          strategy as conditions change — and a lab to prove which one actually wins.
        </p>

        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Choice
            icon={<Play className="h-5 w-5" />}
            title="Start Simulation"
            description="Boot the control center with live traffic flowing through the pool."
            accent="cyan"
            onClick={() => onStart('simulation')}
          />
          <Choice
            icon={<Swords className="h-5 w-5" />}
            title="Algorithm Battle"
            description="Replay identical traffic through several algorithms and crown a winner."
            accent="amber"
            onClick={() => onStart('battle')}
          />
          <Choice
            icon={<Sparkles className="h-5 w-5" />}
            title="AI Autopilot"
            description="Start with the decision engine engaged and watch it switch strategies."
            accent="violet"
            onClick={() => onStart('autopilot')}
          />
          <Choice
            icon={<Globe className="h-5 w-5" />}
            title="Live HTTP Proxy"
            description="Send real HTTP requests to health-checked demo services."
            accent="cyan"
            onClick={onOpenLiveProxy}
          />
        </div>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-slate-700">
          <span className="flex items-center gap-1.5">
            <Zap className="h-3 w-3 text-neon-cyan/60" /> request-level simulation
          </span>
          <span className="flex items-center gap-1.5">
            <Activity className="h-3 w-3 text-neon-mint/60" /> 8 algorithms
          </span>
          <span className="flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-neon-violet/60" /> explainable AI
          </span>
        </div>

        <button
          type="button"
          onClick={() => onStart('simulation')}
          className="mt-8 font-mono text-[11px] uppercase tracking-[0.2em] text-slate-600 transition hover:text-slate-300"
        >
          skip intro <ArrowRight className="ml-1 inline h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function Choice({
  icon,
  title,
  description,
  accent,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  accent: 'cyan' | 'amber' | 'violet';
  onClick: () => void;
}) {
  const map = {
    cyan: {
      border: 'border-neon-cyan/35 hover:border-neon-cyan/70',
      text: 'text-neon-cyan',
      glow: 'hover:shadow-[0_28px_60px_-28px_rgba(34,211,238,0.7)]',
      bg: 'hover:bg-neon-cyan/[0.07]',
    },
    amber: {
      border: 'border-neon-amber/35 hover:border-neon-amber/70',
      text: 'text-neon-amber',
      glow: 'hover:shadow-[0_28px_60px_-28px_rgba(251,191,36,0.7)]',
      bg: 'hover:bg-neon-amber/[0.07]',
    },
    violet: {
      border: 'border-neon-violet/35 hover:border-neon-violet/70',
      text: 'text-[#c3b9ff]',
      glow: 'hover:shadow-[0_28px_60px_-28px_rgba(139,124,246,0.8)]',
      bg: 'hover:bg-neon-violet/[0.08]',
    },
  }[accent];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative overflow-hidden rounded-2xl border bg-white/[0.02] p-5 text-left backdrop-blur-sm transition-all duration-200 ${map.border} ${map.glow} ${map.bg}`}
    >
      <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] ${map.text}`}>
        {icon}
      </div>
      <div className="font-display text-[15px] font-semibold text-white">{title}</div>
      <p className="mt-1 text-[11.5px] leading-relaxed text-slate-500">{description}</p>
      <div className={`mt-3 flex items-center gap-1 text-[11px] font-semibold ${map.text} opacity-0 transition group-hover:opacity-100`}>
        Launch <ArrowRight className="h-3 w-3" />
      </div>
    </button>
  );
}

/** Animated particle backdrop for the landing screen. */
function Backdrop() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let raf = 0;
    const particles: { x: number; y: number; vx: number; vy: number; r: number; hue: string }[] = [];

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    for (let i = 0; i < 90; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: 0.25 + Math.random() * 0.75,
        vy: (Math.random() - 0.5) * 0.22,
        r: 0.6 + Math.random() * 1.7,
        hue: Math.random() > 0.55 ? '#22d3ee' : Math.random() > 0.5 ? '#8b7cf6' : '#34e5b0',
      });
    }

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x > width + 10) {
          p.x = -10;
          p.y = Math.random() * height;
        }
        if (p.y < -10) p.y = height + 10;
        if (p.y > height + 10) p.y = -10;

        const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 6);
        gradient.addColorStop(0, p.hue);
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = p.hue;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} className="absolute inset-0 opacity-60" />
      <div className="absolute inset-0 grid-bg opacity-70" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,#04060b_75%)]" />
    </>
  );
}
