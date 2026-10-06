import { useState } from 'react';
import {
  Boxes,
  Brain,
  ChevronDown,
  Cpu,
  Gauge,
  Network,
  Server,
  Sparkles,
  Users,
  Waypoints,
} from 'lucide-react';
import { clsx } from '@/lib/clsx';
import { useApp } from '@/state/store';
import { Panel } from '@/components/ui/primitives';
import { fmtMs, fmtPct } from '@/lib/format';

interface Node {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
  module: string;
  summary: string;
  responsibilities: string[];
  live: (ctx: LiveCtx) => { label: string; value: string }[];
}

interface LiveCtx {
  rps: number;
  pattern: string;
  clients: number;
  algorithm: string;
  decisions: number;
  servers: number;
  healthy: number;
  samples: number;
  runs: number;
  latency: number;
  errorRate: number;
  autopilot: boolean;
}

const NODES: Node[] = [
  {
    id: 'clients',
    label: 'CLIENTS',
    icon: Users,
    color: '#8b7cf6',
    module: 'simulation/trafficModel.ts',
    summary:
      'A synthetic client population with Zipf-distributed popularity: a handful of IPs (NAT gateways, mobile carriers) generate most of the traffic, which is what makes affinity algorithms behave realistically.',
    responsibilities: [
      'Emits client IPs with a skewed weight distribution',
      'Assigns each request a path with a relative cost (checkout is heavier than static assets)',
      'Feeds the same stream to every algorithm in Battle Mode so comparisons are fair',
    ],
    live: (c) => [
      { label: 'Simulated clients', value: String(c.clients) },
      { label: 'Request paths', value: '6' },
      { label: 'Cost range', value: '0.35× – 2.6×' },
    ],
  },
  {
    id: 'traffic-generator',
    label: 'TRAFFIC GENERATOR',
    icon: Gauge,
    color: '#22d3ee',
    module: 'simulation/trafficModel.ts',
    summary:
      'Turns the operator’s base RPS into arrivals using a Poisson process modulated by the selected pattern (normal, steady, spike, wave, random, flash crowd) plus manual bursts and chaos multipliers.',
    responsibilities: [
      'Poisson arrivals — realistic inter-arrival jitter rather than fixed intervals',
      'Six traffic patterns plus operator-triggered bursts',
      'Fully seeded, so two runs with the same seed see identical traffic',
    ],
    live: (c) => [
      { label: 'Arrival rate', value: `${c.rps.toFixed(0)} rps` },
      { label: 'Pattern', value: c.pattern },
      { label: 'Generator', value: 'Poisson(λ)' },
    ],
  },
  {
    id: 'loadmind',
    label: 'LOADMIND',
    icon: Waypoints,
    color: '#34e5b0',
    module: 'simulation/engine.ts',
    summary:
      'The balancer itself. Every inbound request is dispatched through the active algorithm, given a service-time estimate, tracked in flight, and completed with a latency and outcome.',
    responsibilities: [
      'Fixed 50ms timestep, up to 24 steps per frame — deterministic and frame-rate independent',
      'Failover: retries the least-loaded live upstream when a selection lands on a dead node',
      'Emits packet events that drive the live traffic map',
    ],
    live: (c) => [
      { label: 'Active algorithm', value: c.algorithm },
      { label: 'Avg latency', value: fmtMs(c.latency) },
      { label: 'Error rate', value: fmtPct(c.errorRate, 2) },
    ],
  },
  {
    id: 'ai-engine',
    label: 'AI DECISION ENGINE',
    icon: Brain,
    color: '#a78bfa',
    module: 'ai/decisionEngine.ts',
    summary:
      'Extracts ~18 live signals, scores all eight algorithms against twelve weighted rules, and switches only when the challenger beats the incumbent by more than the hysteresis margin. Every score has a human-readable justification.',
    responsibilities: [
      'Feature extraction: traffic trend, spike factor, latency spread, error rate, imbalance, client concentration, churn…',
      'Rule-based scoring with per-signal evidence — no black box',
      'Hysteresis (7-point incumbent bonus, 6.5-point switch margin) prevents oscillation',
    ],
    live: (c) => [
      { label: 'State', value: c.autopilot ? 'engaged' : 'standby' },
      { label: 'Decisions made', value: String(c.decisions) },
      { label: 'Cycle', value: 'every 1.2s' },
    ],
  },
  {
    id: 'algorithm-engine',
    label: 'ALGORITHM ENGINE',
    icon: Network,
    color: '#3b9dfd',
    module: 'algorithms/',
    summary:
      'Eight pluggable strategies behind one interface: select(servers, request, state) → upstream index. Adding a ninth means writing one file and adding it to the registry — nothing else in the app changes.',
    responsibilities: [
      'Round Robin, Weighted Round Robin (smooth/LVS), Least Connections, Weighted Least Connections',
      'IP Hash, Weighted Random, Least Response Time, Consistent Hashing (64 virtual nodes per weight unit)',
      'Custom user algorithms are compiled into the same interface at runtime',
    ],
    live: (c) => [
      { label: 'Built-in strategies', value: '8' },
      { label: 'Custom registered', value: c.algorithm === 'Custom' ? '1' : '0' },
      { label: 'Selection cost', value: 'O(1) – O(log v)' },
    ],
  },
  {
    id: 'server-pool',
    label: 'SERVER POOL',
    icon: Server,
    color: '#fbbf24',
    module: 'simulation/serverModel.ts',
    summary:
      'Heterogeneous backends with different capacity, baseline latency, CPU efficiency, jitter and error floors. Service time uses an M/M/1-style queueing term, so latency climbs hyperbolically as a node approaches saturation.',
    responsibilities: [
      'Concurrency-limited service with queueing delay and overload errors',
      'Telemetry: CPU, memory, EWMA latency, error rate, utilisation, health status',
      'Chaos hooks: kill, latency injection, error injection, capacity reduction, auto-recovery',
    ],
    live: (c) => [
      { label: 'Upstreams', value: String(c.servers) },
      { label: 'Healthy', value: `${c.healthy}/${c.servers}` },
      { label: 'Queueing model', value: 'M/M/1 style' },
    ],
  },
  {
    id: 'metrics-engine',
    label: 'METRICS ENGINE',
    icon: Cpu,
    color: '#fb5a7a',
    module: 'metrics/collector.ts',
    summary:
      'Rolling telemetry with bounded memory: nearest-rank percentiles over a 1,500-sample reservoir, per-server latency windows, throughput windows, and fairness statistics (Jain’s index, Gini, peak-to-mean imbalance).',
    responsibilities: [
      'p50/p95/p99/max from a bounded reservoir — flat memory at any run length',
      'Distribution fairness and hot-spot detection',
      'Composite scoring (latency 30%, p95 22%, errors 24%, throughput 12%, fairness 6%, efficiency 6%)',
    ],
    live: (c) => [
      { label: 'Latency samples', value: `${Math.min(1500, c.samples).toLocaleString()}` },
      { label: 'Series points', value: '180 rolling' },
      { label: 'Percentiles', value: 'p50 · p95 · p99' },
    ],
  },
  {
    id: 'analytics',
    label: 'ANALYTICS',
    icon: Boxes,
    color: '#22d3ee',
    module: 'analytics/ + storage/',
    summary:
      'Persists battles, live sessions and playground benchmarks to localStorage, aggregates them into a leaderboard, and powers LoadMind AI — the assistant answers from these numbers, not from generic text.',
    responsibilities: [
      'Run history with conditions, latency, errors, fairness and composite score',
      'CSV export and side-by-side experiment comparison',
      'State-aware assistant: distribution, autopilot reasoning, capacity projections, history queries',
    ],
    live: (c) => [
      { label: 'Saved runs', value: String(c.runs) },
      { label: 'Storage', value: 'localStorage' },
      { label: 'Assistant', value: 'state-aware' },
    ],
  },
];

export function ArchitectureView() {
  const snapshot = useApp((s) => s.snapshot);
  const runs = useApp((s) => s.runs);
  const [active, setActive] = useState('loadmind');

  const ctx: LiveCtx = {
    rps: snapshot.metrics.arrivalRate,
    pattern: snapshot.config.pattern,
    clients: 48,
    algorithm: snapshot.activeAlgorithmName,
    decisions: snapshot.autopilot.evaluations,
    servers: snapshot.servers.length,
    healthy: snapshot.metrics.healthyCount,
    samples: snapshot.metrics.completed,
    runs: runs.length,
    latency: snapshot.metrics.avgLatencyMs,
    errorRate: snapshot.metrics.errorRate,
    autopilot: snapshot.autopilot.enabled,
  };

  const node = NODES.find((n) => n.id === active) ?? NODES[0];
  const Icon = node.icon;

  return (
    <div className="grid min-w-0 gap-3 xl:grid-cols-[380px_minmax(0,1fr)]">
      {/* --------------------------------------------------------- flow view */}
      <Panel eyebrow="System architecture" title="Request lifecycle" icon={<Sparkles className="h-3.5 w-3.5" />}>
        <div className="relative">
          {/* spine */}
          <div className="absolute bottom-6 left-[27px] top-6 w-px bg-gradient-to-b from-neon-cyan/40 via-neon-violet/40 to-neon-cyan/40" />
          <div className="space-y-2">
            {NODES.map((item, index) => {
              const ItemIcon = item.icon;
              const selected = item.id === active;
              return (
                <div key={item.id} className="relative">
                  <button
                    type="button"
                    onClick={() => setActive(item.id)}
                    className={clsx(
                      'group flex w-full items-center gap-3 rounded-xl border py-2.5 pl-2 pr-3 text-left transition-all duration-200',
                      selected
                        ? 'border-white/20 bg-white/[0.06] shadow-[0_16px_40px_-24px_rgba(0,0,0,0.9)]'
                        : 'border-white/[0.06] bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]',
                    )}
                  >
                    <span
                      className="relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-lg border transition"
                      style={{
                        borderColor: `${item.color}55`,
                        background: `${item.color}18`,
                        boxShadow: selected ? `0 0 22px -6px ${item.color}` : undefined,
                      }}
                    >
                      <ItemIcon className="h-4 w-4" style={{ color: item.color }} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-[11.5px] font-bold tracking-wider text-slate-100">
                        {item.label}
                      </span>
                      <span className="block truncate font-mono text-[10px] text-slate-600">{item.module}</span>
                    </span>
                    <span className="num shrink-0 font-mono text-[10px] text-slate-600">0{index + 1}</span>
                  </button>
                  {index < NODES.length - 1 && (
                    <div className="flex justify-center py-0.5">
                      <ChevronDown className="relative z-10 h-3 w-3 animate-pulse text-slate-700" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Panel>

      {/* -------------------------------------------------------- detail pane */}
      <div className="min-w-0 space-y-3">
        <div
          className="relative overflow-hidden rounded-2xl border p-5"
          style={{ borderColor: `${node.color}44`, background: `linear-gradient(135deg, ${node.color}14, transparent 60%)` }}
        >
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full blur-3xl" style={{ background: `${node.color}18` }} />
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div
                className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border"
                style={{ borderColor: `${node.color}55`, background: `${node.color}18` }}
              >
                <Icon className="h-6 w-6" style={{ color: node.color }} />
              </div>
              <div>
                <div className="eyebrow" style={{ color: `${node.color}cc` }}>
                  Component
                </div>
                <h2 className="font-display text-[22px] font-bold tracking-tight text-white">{node.label}</h2>
                <code className="font-mono text-[11px] text-slate-500">{node.module}</code>
              </div>
            </div>
            <div className="flex gap-3">
              {node.live(ctx).map((item) => (
                <div key={item.label} className="rounded-lg border border-white/[0.07] bg-black/30 px-3 py-2 text-right">
                  <div className="eyebrow">{item.label}</div>
                  <div className="num mt-0.5 font-mono text-[13px] font-semibold text-slate-100">{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <Panel eyebrow="What it does" title={`${node.label} responsibilities`}>
          <p className="text-[13px] leading-relaxed text-slate-300">{node.summary}</p>
          <ul className="mt-3 space-y-2">
            {node.responsibilities.map((item) => (
              <li key={item} className="flex gap-2.5 text-[12.5px] leading-relaxed text-slate-400">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: node.color }} />
                {item}
              </li>
            ))}
          </ul>
        </Panel>

        <div className="grid gap-3 lg:grid-cols-2">
          <Panel eyebrow="Data flow" title="Interfaces">
            <div className="space-y-2 font-mono text-[11.5px] leading-relaxed text-slate-400">
              <Code>RequestMeta → AlgorithmContext → upstream index</Code>
              <Code>ServerState → ServiceEstimate → latency + outcome</Code>
              <Code>CompletedRequest → MetricsCollector → percentiles</Code>
              <Code>FeatureVector → AlgorithmScore[] → AutopilotDecision</Code>
              <Code>BattleScenario → runHeadless() → BattleResult</Code>
            </div>
          </Panel>
          <Panel eyebrow="Engineering notes" title="Why it is built this way">
            <ul className="space-y-2 text-[12px] leading-relaxed text-slate-400">
              <li>
                <strong className="text-slate-200">Framework-free core.</strong> The engine has no React, DOM or storage
                dependencies, so it runs identically in the page, in the battle worker, or in a test.
              </li>
              <li>
                <strong className="text-slate-200">Deterministic RNG.</strong> Every run is seeded, so "the same traffic"
                in Battle Mode is literally the same traffic.
              </li>
              <li>
                <strong className="text-slate-200">Pluggable algorithms.</strong> One interface, one registry — a new
                strategy needs no UI changes.
              </li>
              <li>
                <strong className="text-slate-200">Explainable AI.</strong> The decision engine returns its full scorecard,
                which is why the assistant and the "Why?" modal can cite real numbers.
              </li>
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/30 px-3 py-2 text-[11px] text-slate-300">{children}</div>
  );
}
