import { BUILTIN_ALGORITHMS, getAlgorithmName } from '@/algorithms/registry';
import { describeFeature } from '@/ai/features';
import { clamp, mean } from '@/lib/math';
import { offeredUtilisation } from '@/simulation/serverModel';
import { fmtMs, fmtPct } from '@/lib/format';
import { aggregateByAlgorithm, recentRuns } from './history';
import type {
  AutopilotDecision,
  ChaosState,
  DistributionBucket,
  FeatureVector,
  MetricsSnapshot,
  RunRecord,
  ServerState,
} from '@/types';

/**
 * LoadMind AI — the in-app assistant.
 *
 * Deliberately not a generic chatbot: every answer is computed from the live
 * engine snapshot, the last battle, or the persisted run history. If it does
 * not have the data, it says so and suggests a question it can answer.
 */

export interface ChatContext {
  running: boolean;
  simTime: number;
  servers: ServerState[];
  metrics: MetricsSnapshot;
  distribution: DistributionBucket[];
  algorithmId: string;
  algorithmName: string;
  autopilotEnabled: boolean;
  lastDecision: AutopilotDecision | null;
  features: FeatureVector | null;
  chaos: ChaosState;
  chaosSummary: string;
  runs: RunRecord[];
  lastBattle: {
    scenarioName: string;
    winner: string;
    winnerName: string;
    winnerReason: string;
    results: { algorithm: string; name: string; avgLatencyMs: number; p95Ms: number; errorRate: number; throughput: number; score: number }[];
  } | null;
  pattern: string;
  baseRps: number;
}

export interface ChatAnswer {
  text: string;
  bullets?: string[];
  chips?: { label: string; value: string; tone?: 'good' | 'warn' | 'bad' | 'neutral' }[];
  suggestions?: string[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  bullets?: string[];
  chips?: ChatAnswer['chips'];
  suggestions?: string[];
  at: number;
}

const SUGGESTIONS = [
  'Why is one server receiving fewer requests?',
  'Which algorithm performed best today?',
  'What happens if traffic increases by 300%?',
  'Why did Autopilot switch algorithms?',
  'Compare my last three simulations',
  'Is my pool healthy right now?',
];

export const CHAT_SUGGESTIONS = SUGGESTIONS;

type Intent = {
  id: string;
  patterns: RegExp[];
  answer: (ctx: ChatContext, match: RegExpMatchArray | null) => ChatAnswer;
};

const INTENTS: Intent[] = [
  // -------------------------------------------------------------------------
  {
    id: 'distribution',
    patterns: [
      /(why .*(server|node|upstream)\s*\w*\s*(receiv|get|handl)|fewer requests|less traffic|more requests|distribution|skewed|unbalanced|hot.?spot)/i,
    ],
    answer: (ctx) => {
      const alive = ctx.distribution.filter((d) => d.status !== 'down');
      const ranked = [...alive].sort((a, b) => b.share - a.share);
      if (ranked.length === 0) {
        return { text: 'Every upstream is currently down, so no requests are being distributed at all.' };
      }
      const busiest = ranked[0];
      const quietest = ranked[ranked.length - 1];
      const down = ctx.distribution.filter((d) => d.status === 'down');
      const expected = 1 / alive.length;

      const bullets: string[] = [];
      bullets.push(
        `${busiest.name} leads with ${fmtPct(busiest.share)} of traffic (${busiest.count.toLocaleString()} requests) versus an even share of ${fmtPct(expected)}.`,
      );
      bullets.push(
        `${quietest.name} is quietest at ${fmtPct(quietest.share)} — ${quietest.connections} active connections, ${fmtMs(quietest.latencyMs)} average latency, weight ${quietest.weight}.`,
      );
      if (down.length) {
        bullets.push(`${down.map((d) => d.name).join(', ')} ${down.length === 1 ? 'is' : 'are'} offline and receive nothing, which inflates everyone else's share.`);
      }
      if (Math.abs(quietest.weight - busiest.weight) > 0.4) {
        bullets.push(`Capacity weights differ (${quietest.weight} vs ${busiest.weight}), so an unequal split is expected under ${ctx.algorithmName}.`);
      }
      bullets.push(
        ctx.algorithmName.includes('Round Robin') || ctx.algorithmName.includes('Random')
          ? `${ctx.algorithmName} is static: it cannot see that ${quietest.name} has spare capacity, so it keeps handing out the same share regardless of load.`
          : `${ctx.algorithmName} is load-aware, so the imbalance reflects real differences in latency or connection depth rather than blind rotation.`,
      );

      const spreadPct = (busiest.share - quietest.share) * 100;
      return {
        text: `Here is how traffic is splitting across the pool right now (${ctx.algorithmName} active):`,
        bullets,
        chips: [
          { label: 'Busiest', value: `${busiest.name} · ${fmtPct(busiest.share)}`, tone: spreadPct > 25 ? 'warn' : 'neutral' },
          { label: 'Quietest', value: `${quietest.name} · ${fmtPct(quietest.share)}`, tone: 'neutral' },
          { label: 'Spread', value: `${spreadPct.toFixed(1)} pts`, tone: spreadPct > 25 ? 'warn' : 'good' },
          { label: 'Gini', value: ctx.metrics.gini.toFixed(3), tone: ctx.metrics.gini > 0.2 ? 'warn' : 'good' },
        ],
        suggestions: ['Which algorithm would balance this better?', 'Switch to Least Connections'],
      };
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'best-algorithm',
    patterns: [/(which|what) algorithm.*(best|win|perform|fastest)|best performing|who won|leaderboard|today/i],
    answer: (ctx) => {
      if (ctx.lastBattle) {
        const top = ctx.lastBattle.results[0];
        const second = ctx.lastBattle.results[1];
        return {
          text: `In the last battle (${ctx.lastBattle.scenarioName}), **${ctx.lastBattle.winnerName}** won${second ? ` ahead of ${second.name}` : ''}.`,
          bullets: [
            `${ctx.lastBattle.winnerName}: ${fmtMs(top.avgLatencyMs)} avg, ${fmtMs(top.p95Ms)} p95, ${fmtPct(top.errorRate, 2)} errors, score ${top.score.toFixed(1)}.`,
            ...(second
              ? [`${second.name}: ${fmtMs(second.avgLatencyMs)} avg — ${(((second.avgLatencyMs - top.avgLatencyMs) / second.avgLatencyMs) * 100).toFixed(0)}% slower than the winner.`]
              : []),
            ctx.lastBattle.winnerReason,
          ],
          suggestions: ['Why did it win?', 'Compare my last three simulations'],
        };
      }
      const aggregates = aggregateByAlgorithm(ctx.runs);
      if (aggregates.length === 0) {
        return {
          text: 'No completed runs yet, so I have no historical evidence. Run a Battle or save a live session and I will rank the algorithms from real data.',
          suggestions: ['Run an Algorithm Battle', 'What can you tell me?'],
        };
      }
      const top = aggregates[0];
      return {
        text: `Across ${ctx.runs.length} saved run${ctx.runs.length === 1 ? '' : 's'}, **${top.algorithmName}** has the highest average composite score (${top.score.toFixed(1)}/100 from ${top.runs} run${top.runs === 1 ? '' : 's'}, ${top.wins} win${top.wins === 1 ? '' : 's'}).`,
        bullets: aggregates.slice(0, 4).map(
          (a) =>
            `${a.algorithmName}: score ${a.score.toFixed(1)} · ${fmtMs(a.avgLatencyMs)} avg · ${fmtMs(a.p95Ms)} p95 · ${fmtPct(a.errorRate, 2)} errors · fairness ${a.fairness.toFixed(3)}`,
        ),
        suggestions: ['Compare my last three simulations', 'Why is one server receiving fewer requests?'],
      };
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'traffic-projection',
    patterns: [/(what (happens|if)).*(traffic|load|rps|requests)|increase (traffic|load) by|300%|scale (up|test)|projection|headroom/i],
    answer: (ctx) => {
      const multiplierMatch = ctx.metrics.arrivalRate > 0 ? null : null;
      void multiplierMatch;
      const current = ctx.metrics.arrivalRate || ctx.baseRps;
      const alive = ctx.servers.filter((s) => !s.down);
      const utilizations = alive.map(offeredUtilisation);
      const avgUtil = utilizations.length ? mean(utilizations) : 0;
      const peakUtil = utilizations.length ? Math.max(...utilizations) : 0;

      const scaleFor = (mult: number) => {
        const nextUtil = avgUtil * mult;
        const queueFactor = nextUtil < 0.97 ? 1 / Math.max(0.06, 1 - nextUtil) : 14;
        return {
          mult,
          rps: current * mult,
          util: nextUtil,
          latency: ctx.metrics.avgLatencyMs * Math.min(14, queueFactor / Math.max(0.35, 1 / Math.max(0.06, 1 - avgUtil))),
          saturated: nextUtil >= 0.97,
        };
      };

      const scenarios = [scaleFor(1.5), scaleFor(2), scaleFor(3), scaleFor(4)];
      const bullets = scenarios.map((s) => {
        if (s.saturated) {
          return `**${s.mult.toFixed(1)}× (${s.rps.toFixed(0)} rps)** — utilisation hits ${fmtPct(Math.min(2, s.util))}, past the queueing knee. Expect a latency cliff, growing error rate and dropped requests.`;
        }
        return `**${s.mult.toFixed(1)}× (${s.rps.toFixed(0)} rps)** — utilisation ${fmtPct(s.util)}, average latency drifts to about ${fmtMs(s.latency)} (queueing grows as 1/(1−ρ)).`;
      });

      const headroomRps = avgUtil > 0 ? (current / avgUtil) * 0.85 - current : current * 3;
  // Beyond ~8x current traffic a single number stops being meaningful.
  const headroomLabel =
    headroomRps > current * 8
      ? 'more than 8× current traffic'
      : `**${Math.max(0, headroomRps).toFixed(0)} rps**`;
      return {
        text: `Projecting from live telemetry: the pool is absorbing **${current.toFixed(0)} rps** at **${fmtPct(avgUtil)} average utilisation** (busiest upstream ${fmtPct(peakUtil)}).`,
        bullets: [
          ...bullets,
          headroomRps > current * 0.25
            ? `You have roughly ${headroomLabel} of headroom before the busiest server crosses into dangerous queueing territory.`
            : 'The pool is already past its comfortable operating point — expect queueing, not graceful degradation.',
          peakUtil > 0.8
            ? 'Because one upstream is already near saturation, a static algorithm will keep sending it the same share — switch to Least Connections or Least Response Time before ramping.'
            : 'With this much headroom, static algorithms stay predictable; load-aware algorithms only help once latency starts diverging.',
        ],
        chips: [
          { label: 'Now', value: `${current.toFixed(0)} rps`, tone: 'neutral' },
          { label: 'Avg utilisation', value: fmtPct(avgUtil), tone: avgUtil > 0.8 ? 'bad' : avgUtil > 0.6 ? 'warn' : 'good' },
          { label: 'Headroom', value: headroomRps > current * 8 ? '>8×' : `${Math.max(0, headroomRps).toFixed(0)} rps`, tone: headroomRps > current ? 'good' : 'warn' },
        ],
        suggestions: ['Add a 3× traffic spike', 'Which algorithm handles spikes best?'],
      };
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'autopilot-why',
    patterns: [/(why did|why has|explain).*(autopilot|ai|switch|change)|autopilot (switch|decision|reason)|why.*switched/i],
    answer: (ctx) => {
      const decision = ctx.lastDecision;
      if (!ctx.autopilotEnabled && !decision) {
        return {
          text: 'AI Autopilot has not run yet. Flip the AI AUTOPILOT toggle in the Control Center and I will start scoring every algorithm against live telemetry each second.',
          suggestions: ['Turn on AI Autopilot', 'How does Autopilot decide?'],
        };
      }
      if (!decision) {
        return {
          text: 'Autopilot is engaged and monitoring, but it has not completed an evaluation cycle yet — the first decision lands about a second in.',
          suggestions: ['Is my pool healthy right now?'],
        };
      }
      const drivers = decision.reasons.filter((r) => r.points > 0).slice(0, 4);
      const f = decision.features;
      return {
        text: `**${decision.switched ? `Switched to ${getAlgorithmName(decision.algorithm)}` : `Held on ${getAlgorithmName(decision.algorithm)}`}** — ${decision.headline}`,
        bullets: [
          decision.summary,
          ...drivers.map((d) => `${d.label}: ${d.detail} (${d.points > 0 ? '+' : ''}${d.points.toFixed(1)} pts)`),
          `Signals at the time: ${describeFeature('spikeFactor', f.spikeFactor)}, ${describeFeature('latencySpreadMs', f.latencySpreadMs)}, ${describeFeature('errorRate', f.errorRate)}.`,
        ],
        chips: [
          { label: 'Confidence', value: fmtPct(decision.confidence), tone: decision.confidence > 0.7 ? 'good' : 'warn' },
          { label: 'Switches', value: String(ctx.lastDecision ? countSwitches(ctx) : 0), tone: 'neutral' },
          { label: 'Trend', value: `${f.trafficTrendPct >= 0 ? '+' : ''}${f.trafficTrendPct.toFixed(0)}%`, tone: f.trafficTrendPct > 20 ? 'warn' : 'good' },
        ],
        suggestions: ['What is Autopilot considering right now?', 'Force Autopilot to re-evaluate'],
      };
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'compare-runs',
    patterns: [/compare (my |the )?(last|previous|recent) (three|3|few|\d+)|compare.*(runs|simulations|experiments)/i],
    answer: (ctx) => {
      const match = ctx.runs.length ? null : null;
      void match;
      const countMatch = /(\d+)/.exec('3');
      void countMatch;
      const runs = recentRuns(ctx.runs, 3).reverse();
      if (runs.length < 2) {
        return {
          text: `I only have ${runs.length} saved run${runs.length === 1 ? '' : 's'}. Save at least two (live sessions are saved with **Save run**, battles save automatically) and I will put them side by side.`,
          suggestions: ['Run an Algorithm Battle', 'Which algorithm performed best today?'],
        };
      }
      const best = runs.reduce((a, b) => (b.score > a.score ? b : a));
      return {
        text: `Comparing your ${runs.length} most recent saved runs — **${best.algorithmName}** scored highest (${best.score.toFixed(1)}/100).`,
        bullets: runs.map(
          (r) =>
            `**${r.algorithmName}** (${r.pattern}, ${r.serverCount} servers${r.chaosSummary !== 'none' ? `, ${r.chaosSummary}` : ''}): ${fmtMs(r.avgLatencyMs)} avg · ${fmtMs(r.p95Ms)} p95 · ${fmtPct(r.errorRate, 2)} errors · ${r.throughput.toFixed(0)} rps · score ${r.score.toFixed(1)}`,
        ),
        chips: [
          { label: 'Best score', value: `${best.algorithmName} · ${best.score.toFixed(1)}`, tone: 'good' },
          { label: 'Lowest p95', value: `${runs.reduce((a, b) => (b.p95Ms < a.p95Ms ? b : a)).algorithmName}`, tone: 'good' },
          { label: 'Runs compared', value: String(runs.length), tone: 'neutral' },
        ],
        suggestions: ['Which algorithm performed best today?', 'Open the Performance Lab'],
      };
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'health',
    patterns: [/(is|are) (my |the )?(pool|servers|fleet|system) (healthy|ok|fine)|health (check|status)|status (report|summary)|how are we doing|any (problems|issues)/i],
    answer: (ctx) => {
      const warning = ctx.servers.filter((s) => s.status === 'warning' && !s.down);
      const down = ctx.servers.filter((s) => s.down);
      const hottest = [...ctx.servers].filter((s) => !s.down).sort((a, b) => b.cpu - a.cpu)[0];
      const slowest = [...ctx.servers].filter((s) => !s.down).sort((a, b) => b.ewmaLatencyMs - a.ewmaLatencyMs)[0];
      const verdict =
        down.length > 0 || ctx.metrics.errorRate > 0.05
          ? 'The pool is **degraded** — action recommended.'
          : warning.length > 0 || ctx.metrics.errorRate > 0.01
            ? 'The pool is **under stress** but serving traffic.'
            : 'The pool is **healthy**.';
      return {
        text: `${verdict} ${ctx.metrics.healthyCount}/${ctx.servers.length} upstreams healthy, ${warning.length} in warning, ${down.length} offline.`,
        bullets: [
          `Throughput ${ctx.metrics.throughput.toFixed(0)} rps at ${fmtMs(ctx.metrics.avgLatencyMs)} average (p95 ${fmtMs(ctx.metrics.p95Ms)}, p99 ${fmtMs(ctx.metrics.p99Ms)}).`,
          `Error rate ${fmtPct(ctx.metrics.errorRate, 2)} · pool CPU ${ctx.metrics.poolCpu.toFixed(0)}% · memory ${ctx.metrics.poolMemory.toFixed(0)}%.`,
          hottest ? `Hottest upstream: ${hottest.name} at ${hottest.cpu.toFixed(0)}% CPU and ${hottest.activeConnections} connections.` : 'No live upstreams.',
          slowest ? `Slowest upstream: ${slowest.name} at ${fmtMs(slowest.ewmaLatencyMs)} (baseline ${slowest.baseLatencyMs}ms).` : '',
          down.length ? `Offline: ${down.map((s) => s.name).join(', ')} — traffic is being redistributed across the survivors.` : '',
          ctx.chaosSummary !== 'none' ? `Chaos active: ${ctx.chaosSummary}.` : 'No chaos injected.',
        ].filter(Boolean),
        chips: [
          { label: 'Healthy', value: String(ctx.metrics.healthyCount), tone: 'good' },
          { label: 'Warning', value: String(warning.length), tone: warning.length ? 'warn' : 'neutral' },
          { label: 'Down', value: String(down.length), tone: down.length ? 'bad' : 'neutral' },
        ],
        suggestions: ['Why is one server receiving fewer requests?', 'What should I change?'],
      };
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'recommendation',
    patterns: [/(what|which) (should|would|do) i (use|change|pick|switch)|recommend|advice|what would you do|optimise|optimize/i],
    answer: (ctx) => {
      if (!ctx.features) {
        return { text: 'Start the simulation and I will recommend an algorithm based on live conditions.', suggestions: ['Start the simulation'] };
      }
      const f = ctx.features;
      const recommendation = pickRecommendation(f);
      return {
        text: `Based on live conditions I would use **${getAlgorithmName(recommendation.id)}**.`,
        bullets: [recommendation.reason, ...recommendation.evidence],
        chips: [
          { label: 'Traffic trend', value: `${f.trafficTrendPct >= 0 ? '+' : ''}${f.trafficTrendPct.toFixed(0)}%`, tone: f.trafficTrendPct > 20 ? 'warn' : 'good' },
          { label: 'Latency spread', value: fmtMs(f.latencySpreadMs), tone: f.latencySpreadMs > 40 ? 'warn' : 'good' },
          { label: 'Errors', value: fmtPct(f.errorRate, 2), tone: f.errorRate > 0.02 ? 'bad' : 'good' },
        ],
        suggestions: ['Apply that algorithm', 'Turn on AI Autopilot'],
      };
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'latency',
    patterns: [/(latency|response time|slow|p95|p99|tail)/i],
    answer: (ctx) => {
      const sorted = [...ctx.servers].filter((s) => !s.down).sort((a, b) => a.ewmaLatencyMs - b.ewmaLatencyMs);
      const fastest = sorted[0];
      const slowest = sorted[sorted.length - 1];
      return {
        text: `Current latency: **${fmtMs(ctx.metrics.avgLatencyMs)} average**, p50 ${fmtMs(ctx.metrics.p50Ms)}, p95 ${fmtMs(ctx.metrics.p95Ms)}, p99 ${fmtMs(ctx.metrics.p99Ms)} (max ${fmtMs(ctx.metrics.maxLatencyMs)}).`,
        bullets: [
          fastest && slowest
            ? `${fastest.name} is fastest at ${fmtMs(fastest.ewmaLatencyMs)}; ${slowest.name} is slowest at ${fmtMs(slowest.ewmaLatencyMs)} — a ${fmtMs(slowest.ewmaLatencyMs - fastest.ewmaLatencyMs)} spread.`
            : 'No live upstreams to compare.',
          slowest && slowest.latencyPenaltyMs > 0
            ? `${slowest.name} carries ${slowest.latencyPenaltyMs}ms of injected chaos latency on top of its ${slowest.baseLatencyMs}ms baseline.`
            : '',
          ctx.metrics.p99Ms > ctx.metrics.p95Ms * 1.6
            ? 'The p99 is far above the p95, which is the signature of queueing: a subset of requests is waiting behind saturated servers.'
            : 'The tail is close to the median, so latency is dominated by service time rather than queueing.',
          'Tail latency is what users feel — if p95 matters more than averages, Least Response Time or Weighted Least Connections will beat any static policy.',
        ].filter(Boolean),
        chips: [
          { label: 'p95', value: fmtMs(ctx.metrics.p95Ms), tone: ctx.metrics.p95Ms > 400 ? 'bad' : ctx.metrics.p95Ms > 200 ? 'warn' : 'good' },
          { label: 'p99', value: fmtMs(ctx.metrics.p99Ms), tone: ctx.metrics.p99Ms > 600 ? 'bad' : 'neutral' },
        ],
        suggestions: ['What should I change?', 'Explain Least Response Time'],
      };
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'algorithm-explain',
    patterns: [/(explain|how does|what is|tell me about|describe) (the )?(round robin|weighted round robin|least connections|weighted least connections|ip hash|consistent hash|random|least response time|autopilot|algorithm)/i],
    answer: (ctx, match) => {
      const asked = (match?.[2] ?? '').toLowerCase();
      const found = ctx.distribution.length >= 0 ? matchAlgorithm(asked) : null;
      if (!found) {
        return explainFallback(ctx);
      }
      return {
        text: `**${found.name}** — ${found.tagline}`,
        bullets: [found.howItWorks, `Best for: ${found.bestFor.join(', ')}.`, `Watch out for: ${found.limitations[0]}`],
        suggestions: ['Which algorithm performed best today?', 'What should I change?'],
      };
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'capabilities',
    patterns: [/(what can you|help|who are you|what do you do|commands|options)/i],
    answer: (ctx) => ({
      text: 'I am **LoadMind AI**. I read the live simulation, the algorithm registry, the last battle and your saved run history — so I answer from your actual numbers, not generic advice.',
      bullets: [
        `Live now: ${ctx.algorithmName} routing ${ctx.metrics.throughput.toFixed(0)} rps at ${fmtMs(ctx.metrics.avgLatencyMs)} average across ${ctx.servers.length} upstreams${ctx.autopilotEnabled ? ' (AI Autopilot engaged)' : ''}.`,
        `History: ${ctx.runs.length} saved run${ctx.runs.length === 1 ? '' : 's'} in the Performance Lab.`,
        ctx.lastBattle ? `Last battle: ${ctx.lastBattle.scenarioName}, won by ${ctx.lastBattle.winnerName}.` : 'No battles run in this session yet.',
      ],
      suggestions: SUGGESTIONS,
    }),
  },
];

function countSwitches(ctx: ChatContext): number {
  return ctx.lastDecision ? Math.max(1, ctx.lastDecision.considered.length - 1) : 0;
}

function matchAlgorithm(asked: string) {
  const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  const target = normalise(asked);
  return (
    BUILTIN_ALGORITHMS.find((a) => normalise(a.name) === target) ??
    BUILTIN_ALGORITHMS.find((a) => normalise(a.name).includes(target) || target.includes(normalise(a.name)))
  );
}

function pickRecommendation(f: FeatureVector): { id: string; reason: string; evidence: string[] } {
  const evidence: string[] = [];
  if (f.errorRate > 0.02) evidence.push(`Errors at ${fmtPct(f.errorRate, 2)} — health-aware routing matters more than raw speed.`);
  if (f.latencySpreadMs > 40) evidence.push(`Upstreams differ by ${fmtMs(f.latencySpreadMs)}; a static rotation would keep feeding the slow one.`);
  if (f.spikeFactor > 1.6) evidence.push(`Traffic is ${f.spikeFactor.toFixed(2)}× baseline, so reaction speed is the deciding factor.`);
  if (f.weightHeterogeneity > 0.3) evidence.push(`Capacity weights vary by ${(f.weightHeterogeneity * 100).toFixed(0)}% — normalise by weight.`);
  if (f.downCount > 0) evidence.push(`${f.downCount} upstream(s) offline; avoid full rehashing.`);
  if (f.connectionImbalance > 1.6) evidence.push(`Connections are ${f.connectionImbalance.toFixed(1)}× apart.`);
  if (evidence.length === 0) evidence.push('Conditions are stable and evenly distributed — predictability is worth more than reactivity here.');

  if (f.errorRate > 0.02 || f.latencySpreadMs > 40 || f.spikeFactor > 1.6) {
    return { id: 'least-response-time', reason: 'Latency and error signals are live, so route to whichever upstream is actually answering fastest.', evidence };
  }
  if (f.weightHeterogeneity > 0.3 || f.connectionImbalance > 1.6) {
    return { id: 'weighted-least-connections', reason: 'The pool is asymmetric — normalise connection counts by capacity.', evidence };
  }
  if (f.downCount > 0 || f.churnRate > 0.2) {
    return { id: 'consistent-hash', reason: 'Pool membership is unstable; consistent hashing keeps affinity without a full rehash.', evidence };
  }
  return { id: 'round-robin', reason: 'Conditions are calm and the fleet is balanced — the simplest predictable policy is the right call.', evidence };
}

function explainFallback(ctx: ChatContext): ChatAnswer {
  return {
    text: `Right now **${ctx.algorithmName}** is active. Ask me about traffic distribution, latency, autopilot decisions, or your saved runs.`,
    suggestions: SUGGESTIONS,
  };
}

export function answerQuestion(question: string, ctx: ChatContext): ChatAnswer {
  const trimmed = question.trim();
  if (!trimmed) {
    return { text: 'Ask me something about the live simulation — for example, why one server is quieter than the others.', suggestions: SUGGESTIONS };
  }

  let best: { intent: Intent; match: RegExpMatchArray | null; score: number } | null = null;
  for (const intent of INTENTS) {
    for (const pattern of intent.patterns) {
      const match = trimmed.match(pattern);
      if (match) {
        const score = match[0].length;
        if (!best || score > best.score) best = { intent, match, score };
      }
    }
  }

  if (best) return best.intent.answer(ctx, best.match);

  // No intent matched: fall back to a state summary plus the closest topics.
  return {
    text: `I could not map that to a specific analysis, but here is the live state: **${ctx.algorithmName}** is serving ${ctx.metrics.throughput.toFixed(0)} rps at ${fmtMs(ctx.metrics.avgLatencyMs)} average, ${fmtPct(ctx.metrics.errorRate, 2)} errors, ${ctx.metrics.healthyCount}/${ctx.servers.length} upstreams healthy${ctx.autopilotEnabled ? ', AI Autopilot engaged' : ''}.`,
    bullets: [
      'Try asking about distribution, latency, autopilot decisions, capacity headroom, or your saved runs.',
      ctx.chaosSummary !== 'none' ? `Chaos currently active: ${ctx.chaosSummary}.` : 'No chaos injected right now.',
    ],
    suggestions: SUGGESTIONS,
  };
}

/** Live "system vitals" line shown at the top of the chat. */
export function vitalsLine(ctx: ChatContext): string {
  const util = ctx.servers.length
    ? clamp(mean(ctx.servers.filter((s) => !s.down).map((s) => s.utilization)), 0, 2)
    : 0;
  return `${ctx.algorithmName} · ${ctx.metrics.throughput.toFixed(0)} rps · ${fmtMs(ctx.metrics.avgLatencyMs)} · ${fmtPct(ctx.metrics.errorRate, 1)} err · ${fmtPct(util)} util`;
}
