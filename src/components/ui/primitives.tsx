import React from 'react';
import { clsx } from '@/lib/clsx';

/* ------------------------------------------------------------------ Panel */

export function Panel({
  title,
  eyebrow,
  icon,
  actions,
  children,
  className,
  bodyClassName,
  dense,
}: {
  title?: React.ReactNode;
  eyebrow?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  dense?: boolean;
}) {
  return (
    <section className={clsx('panel flex min-h-0 flex-col', className)}>
      {(title || actions) && (
        <header className="panel-head shrink-0">
          <div className="flex min-w-0 items-center gap-2.5">
            {icon && <span className="text-neon-cyan/80">{icon}</span>}
            <div className="min-w-0">
              {eyebrow && <div className="eyebrow">{eyebrow}</div>}
              {title && <h3 className="truncate font-display text-[13.5px] font-semibold tracking-tight text-slate-100">{title}</h3>}
            </div>
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={clsx('min-h-0 flex-1', dense ? 'p-3' : 'p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

/* ----------------------------------------------------------------- Toggle */

export type ToggleAccent = 'cyan' | 'violet' | 'rose';

export function Toggle({
  checked,
  onChange,
  label,
  description,
  size = 'md',
  accent = 'cyan',
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: React.ReactNode;
  description?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  accent?: 'cyan' | 'violet' | 'rose';
}) {
  const dims = size === 'lg' ? { w: 58, h: 30, k: 24 } : size === 'sm' ? { w: 34, h: 18, k: 13 } : { w: 44, h: 24, k: 18 };
  const onColor =
    accent === 'violet' ? 'bg-neon-violet/80' : accent === 'rose' ? 'bg-neon-rose/80' : 'bg-neon-cyan/80';
  const knobGlow =
    accent === 'violet'
      ? 'shadow-[0_0_12px_rgba(139,124,246,0.9)]'
      : accent === 'rose'
        ? 'shadow-[0_0_12px_rgba(251,90,122,0.9)]'
        : 'shadow-[0_0_12px_rgba(34,211,238,0.9)]';

  const control = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative shrink-0 rounded-full border transition-all duration-200',
        checked ? cn(onColor, 'border-white/25') : 'border-white/10 bg-white/[0.07]',
      )}
      style={{ width: dims.w, height: dims.h }}
    >
      <span
        className={clsx(
          'absolute top-1/2 -translate-y-1/2 rounded-full bg-white transition-all duration-200',
          checked ? knobGlow : 'bg-slate-400',
        )}
        style={{
          width: dims.k,
          height: dims.k,
          left: checked ? dims.w - dims.k - 3 : 3,
        }}
      />
    </button>
  );

  if (!label) return control;

  return (
    <label className="flex cursor-pointer items-center gap-3">
      {control}
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-slate-200">{label}</span>
        {description && <span className="block text-[11px] leading-snug text-slate-500">{description}</span>}
      </span>
    </label>
  );
}

const cn = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');

/* ----------------------------------------------------------------- Slider */

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  format,
  accent = 'cyan',
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  label?: React.ReactNode;
  format?: (value: number) => string;
  accent?: 'cyan' | 'violet' | 'amber' | 'rose';
  disabled?: boolean;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className={clsx(disabled && 'opacity-50')}>
      {label && (
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</span>
          <span
            className={clsx(
              'num text-[12px] font-semibold',
              accent === 'violet'
              ? 'text-[#c3b9ff]'
              : accent === 'amber'
                ? 'text-neon-amber'
                : accent === 'rose'
                  ? 'text-neon-rose'
                  : 'text-neon-cyan',
            )}
          >
            {format ? format(value) : value}
          </span>
        </div>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ['--pct' as string]: `${pct}%` }}
        className="w-full"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ Meter */

export function Meter({
  value,
  max = 100,
  tone = 'cyan',
  height = 4,
  showTrack = true,
  className,
}: {
  value: number;
  max?: number;
  tone?: 'cyan' | 'mint' | 'amber' | 'rose' | 'violet' | 'blue';
  height?: number;
  showTrack?: boolean;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const colors: Record<string, string> = {
    cyan: 'from-cyan-400 to-teal-300',
    mint: 'from-emerald-400 to-teal-300',
    amber: 'from-amber-400 to-orange-300',
    rose: 'from-rose-500 to-pink-400',
    violet: 'from-violet-400 to-indigo-400',
    blue: 'from-sky-400 to-blue-400',
  };
  return (
    <div
      className={clsx('w-full overflow-hidden rounded-full', showTrack && 'bg-white/[0.07]', className)}
      style={{ height }}
    >
      <div
        className={clsx('h-full rounded-full bg-gradient-to-r transition-[width] duration-300 ease-out', colors[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------- Stat */

export function Stat({
  label,
  value,
  unit,
  sub,
  tone = 'default',
  className,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  sub?: React.ReactNode;
  tone?: 'default' | 'good' | 'warn' | 'bad' | 'violet';
  className?: string;
}) {
  const toneClass =
    tone === 'good'
      ? 'text-neon-mint'
      : tone === 'warn'
        ? 'text-neon-amber'
        : tone === 'bad'
          ? 'text-neon-rose'
          : tone === 'violet'
            ? 'text-[#c3b9ff]'
            : 'text-slate-100';
  return (
    <div className={clsx('min-w-0', className)}>
      <div className="eyebrow truncate">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={clsx('num font-display text-[19px] font-semibold leading-none tracking-tight', toneClass)}>
          {value}
        </span>
        {unit && <span className="text-[11px] font-medium text-slate-500">{unit}</span>}
      </div>
      {sub && <div className="mt-1 truncate text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ Badge */

export function StatusDot({ status, pulse = true }: { status: 'healthy' | 'warning' | 'down'; pulse?: boolean }) {
  const color = status === 'healthy' ? 'bg-neon-mint' : status === 'warning' ? 'bg-neon-amber' : 'bg-neon-rose';
  const shadow =
    status === 'healthy'
      ? 'shadow-[0_0_8px_rgba(52,229,176,0.9)]'
      : status === 'warning'
        ? 'shadow-[0_0_8px_rgba(251,191,36,0.9)]'
        : 'shadow-[0_0_8px_rgba(251,90,122,0.9)]';
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0">
      {pulse && status !== 'down' && (
        <span className={clsx('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', color)} />
      )}
      <span className={clsx('relative inline-flex h-2 w-2 rounded-full', color, shadow)} />
    </span>
  );
}

export function StatusBadge({ status }: { status: 'healthy' | 'warning' | 'down' }) {
  const map = {
    healthy: 'border-neon-mint/30 bg-neon-mint/10 text-neon-mint',
    warning: 'border-neon-amber/30 bg-neon-amber/10 text-neon-amber',
    down: 'border-neon-rose/30 bg-neon-rose/10 text-neon-rose',
  } as const;
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-[3px] text-[10px] font-semibold uppercase tracking-[0.14em]',
        map[status],
      )}
    >
      <StatusDot status={status} />
      {status}
    </span>
  );
}

/* ------------------------------------------------------------------- Tabs */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  className,
}: {
  options: { value: T; label: React.ReactNode; title?: string }[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <div className={clsx('inline-flex rounded-lg border border-white/[0.07] bg-black/30 p-0.5', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          onClick={() => onChange(option.value)}
          className={clsx(
            'rounded-[7px] font-medium transition-all duration-150',
            size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-[12px]',
            value === option.value
              ? 'bg-neon-cyan/15 text-neon-cyan shadow-[inset_0_0_0_1px_rgba(34,211,238,0.25)]'
              : 'text-slate-500 hover:text-slate-300',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ Modal */

export function Modal({
  open,
  onClose,
  title,
  eyebrow,
  children,
  width = 'max-w-3xl',
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  children: React.ReactNode;
  width?: string;
}) {
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 cursor-default bg-black/70 backdrop-blur-sm"
      />
      <div
        className={clsx(
          'panel animate-fade-up relative z-10 my-auto w-full overflow-hidden',
          width,
        )}
        style={{ boxShadow: '0 40px 120px -40px rgba(0,0,0,1), inset 0 1px 0 rgba(255,255,255,0.06)' }}
      >
        <header className="flex items-center justify-between gap-4 border-b border-white/[0.07] px-5 py-3.5">
          <div>
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            <h2 className="font-display text-[16px] font-semibold tracking-tight text-white">{title}</h2>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost px-2 py-1 text-lg leading-none">
            ×
          </button>
        </header>
        <div className="max-h-[72vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Sparkline */

export function Sparkline({
  values,
  stroke = '#22d3ee',
  fill = true,
  height = 34,
  className,
  strokeWidth = 1.5,
}: {
  values: number[];
  stroke?: string;
  fill?: boolean;
  height?: number;
  className?: string;
  strokeWidth?: number;
}) {
  const width = 120;
  if (values.length < 2) {
    return <div style={{ height }} className={clsx('w-full opacity-30', className)} />;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const points = values.map((v, i) => [i * step, height - ((v - min) / span) * (height - 4) - 2] as const);
  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${path} L${width},${height} L0,${height} Z`;
  const gradientId = `spark-${stroke.replace('#', '')}`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className={clsx('w-full', className)} style={{ height }}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#${gradientId})`} />}
      <path d={path} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* -------------------------------------------------------------- Mini bars */

export function MiniBars({
  values,
  color = '#22d3ee',
  height = 28,
}: {
  values: number[];
  color?: string;
  height?: number;
}) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex items-end gap-[2px]" style={{ height }}>
      {values.map((v, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm transition-[height] duration-200"
          style={{ height: `${Math.max(3, (v / max) * 100)}%`, background: color, opacity: 0.35 + (v / max) * 0.65 }}
        />
      ))}
    </div>
  );
}

/** Empty-state placeholder used across panels. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-[140px] flex-col items-center justify-center gap-3 px-6 text-center">
      {icon && <div className="text-slate-700">{icon}</div>}
      <div>
        <div className="font-display text-[13px] font-semibold text-slate-400">{title}</div>
        {description && <div className="mt-1 max-w-sm text-[12px] leading-relaxed text-slate-600">{description}</div>}
      </div>
      {action}
    </div>
  );
}
