import { memo } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { clsx } from '@/lib/clsx';
import { useSeries } from '@/state/hooks';
import { useApp } from '@/state/store';
import type { SeriesPoint } from '@/types';

const AXIS = { stroke: 'rgba(148,163,184,0.25)', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' };
const GRID = 'rgba(148,163,184,0.08)';

const tooltipStyle = {
  contentStyle: {
    background: 'rgba(7,10,18,0.96)',
    border: '1px solid rgba(148,163,184,0.18)',
    borderRadius: 10,
    fontSize: 11,
    fontFamily: 'JetBrains Mono, monospace',
    boxShadow: '0 18px 40px -20px rgba(0,0,0,0.9)',
  },
  labelStyle: { color: '#94a3b8', fontSize: 10 },
  itemStyle: { fontSize: 11 },
} as const;

export const ThroughputChart = memo(function ThroughputChart({ height = 168 }: { height?: number }) {
  const data = useSeries().map((p: SeriesPoint) => ({
    t: `${p.t.toFixed(0)}s`,
    rps: Number(p.rps.toFixed(0)),
    arrivals: Number(p.arrivals.toFixed(0)),
    latency: Number(p.latency.toFixed(0)),
    errors: Number(p.errors.toFixed(2)),
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="grad-rps" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.45} />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="grad-arrivals" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8b7cf6" stopOpacity={0.3} />
            <stop offset="100%" stopColor="#8b7cf6" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="t" tick={AXIS} axisLine={{ stroke: GRID }} tickLine={false} minTickGap={28} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} width={44} />
        <Tooltip {...tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }} iconType="plainline" />
        <Area type="monotone" dataKey="arrivals" name="arrivals/s" stroke="#8b7cf6" strokeWidth={1.2} fill="url(#grad-arrivals)" />
        <Area type="monotone" dataKey="rps" name="completed/s" stroke="#22d3ee" strokeWidth={1.8} fill="url(#grad-rps)" />
        <Line type="monotone" dataKey="latency" name="latency ms" stroke="#fbbf24" strokeWidth={1.4} dot={false} yAxisId={0} />
      </AreaChart>
    </ResponsiveContainer>
  );
});

export const LatencyChart = memo(function LatencyChart({ height = 168 }: { height?: number }) {
  const series = useSeries();
  const data = series.map((p) => ({
    t: `${p.t.toFixed(0)}s`,
    avg: Number(p.latency.toFixed(0)),
    p95: Number(p.p95.toFixed(0)),
    errors: Number(p.errors.toFixed(2)),
    cpu: Number(p.cpu.toFixed(0)),
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="grad-p95" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fb5a7a" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#fb5a7a" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="grad-avg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34e5b0" stopOpacity={0.3} />
            <stop offset="100%" stopColor="#34e5b0" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="t" tick={AXIS} axisLine={{ stroke: GRID }} tickLine={false} minTickGap={28} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} width={44} />
        <Tooltip {...tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }} iconType="plainline" />
        <Area type="monotone" dataKey="p95" name="p95 ms" stroke="#fb5a7a" strokeWidth={1.5} fill="url(#grad-p95)" />
        <Area type="monotone" dataKey="avg" name="avg ms" stroke="#34e5b0" strokeWidth={1.8} fill="url(#grad-avg)" />
        <Line type="monotone" dataKey="cpu" name="cpu %" stroke="#3b9dfd" strokeWidth={1.2} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
});

export const DistributionChart = memo(function DistributionChart({ height = 168 }: { height?: number }) {
  const distribution = useApp((s) => s.snapshot.distribution);
  const data = distribution.map((d) => ({
    name: d.name,
    requests: d.count,
    share: Number((d.share * 100).toFixed(1)),
    errors: d.errors,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }} barCategoryGap="26%">
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="name" tick={{ ...AXIS, fontSize: 9.5 }} axisLine={{ stroke: GRID }} tickLine={false} interval={0} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} width={44} />
        <Tooltip {...tooltipStyle} cursor={{ fill: 'rgba(148,163,184,0.06)' }} />
        <Bar dataKey="requests" name="requests" radius={[4, 4, 0, 0]}>
          {data.map((entry, index) => (
            <Cell key={entry.name} fill={index % 2 === 0 ? '#22d3ee' : '#3b9dfd'} fillOpacity={0.75} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
});

/** Tiny inline chart wrapper with a title row. */
export function ChartFrame({
  title,
  hint,
  children,
  className,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('rounded-xl border border-white/[0.06] bg-black/20 p-3', className)}>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="eyebrow">{title}</span>
        {hint && <span className="font-mono text-[10px] text-slate-600">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
