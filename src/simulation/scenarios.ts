import type { BattleScenario, TrafficPattern } from '@/types';

/** Traffic scenario presets used by Battle Mode and the playground. */

export interface ScenarioPreset extends BattleScenario {
  id: string;
  description: string;
  icon: string;
}

export const SCENARIO_PRESETS: ScenarioPreset[] = [
  {
    id: 'baseline',
    name: 'Baseline Production',
    description: 'Steady 400 rps across 5 healthy servers. Establishes the control result.',
    icon: 'activity',
    requests: 10000,
    serverCount: 5,
    pattern: 'steady',
    baseRps: 400,
    durationSec: 40,
    chaos: { killCount: 0, latencyPenaltyMs: 0, errorPenalty: 0, capacityReduction: 0, trafficMultiplier: 1 },
    seed: 4242,
  },
  {
    id: 'flash-crowd',
    name: 'Flash Crowd',
    description: 'Traffic ramps 6× in four seconds. Rewards algorithms that react fast.',
    icon: 'flame',
    requests: 10000,
    serverCount: 5,
    pattern: 'flash-crowd',
    baseRps: 350,
    durationSec: 60,
    chaos: { killCount: 0, latencyPenaltyMs: 0, errorPenalty: 0, capacityReduction: 0, trafficMultiplier: 1 },
    seed: 9911,
  },
  {
    id: 'degraded-node',
    name: 'Noisy Neighbour',
    description: 'One server runs 450ms slower than the rest. Latency-aware routing should win.',
    icon: 'alert-triangle',
    requests: 10000,
    serverCount: 5,
    pattern: 'normal',
    baseRps: 420,
    durationSec: 45,
    chaos: { killCount: 0, latencyPenaltyMs: 450, errorPenalty: 0, capacityReduction: 0, trafficMultiplier: 1 },
    seed: 7077,
  },
  {
    id: 'partial-outage',
    name: 'Partial Outage',
    description: 'Two of six upstreams are killed mid-run. Tests failover and rehashing behaviour.',
    icon: 'server-off',
    requests: 10000,
    serverCount: 6,
    pattern: 'normal',
    baseRps: 480,
    durationSec: 50,
    chaos: { killCount: 2, latencyPenaltyMs: 120, errorPenalty: 0, capacityReduction: 0, trafficMultiplier: 1 },
    seed: 3311,
  },
  {
    id: 'error-storm',
    name: 'Error Storm',
    description: 'One upstream returns 12% errors. Health-aware distribution is the only defence.',
    icon: 'siren',
    requests: 10000,
    serverCount: 4,
    pattern: 'wave',
    baseRps: 380,
    durationSec: 45,
    chaos: { killCount: 0, latencyPenaltyMs: 60, errorPenalty: 0.12, capacityReduction: 0, trafficMultiplier: 1 },
    seed: 8181,
  },
  {
    id: 'black-friday',
    name: 'Black Friday',
    description: '3× traffic, one dead server, degraded capacity. Everything fails at once.',
    icon: 'zap',
    requests: 14000,
    serverCount: 6,
    pattern: 'spike',
    baseRps: 520,
    durationSec: 60,
    chaos: {
      killCount: 1,
      latencyPenaltyMs: 250,
      errorPenalty: 0.04,
      capacityReduction: 0.3,
      trafficMultiplier: 2.2,
    },
    seed: 1212,
  },
];

export function getScenarioPreset(id: string): ScenarioPreset {
  return SCENARIO_PRESETS.find((s) => s.id === id) ?? SCENARIO_PRESETS[0];
}

export function chaosSummary(scenario: BattleScenario): string {
  const parts: string[] = [];
  if (scenario.chaos.trafficMultiplier !== 1) parts.push(`${scenario.chaos.trafficMultiplier.toFixed(1)}× traffic`);
  if (scenario.chaos.killCount > 0) parts.push(`${scenario.chaos.killCount} offline`);
  if (scenario.chaos.latencyPenaltyMs > 0) parts.push(`+${scenario.chaos.latencyPenaltyMs}ms`);
  if (scenario.chaos.errorPenalty > 0) parts.push(`+${(scenario.chaos.errorPenalty * 100).toFixed(0)}% errors`);
  if (scenario.chaos.capacityReduction > 0) parts.push(`-${(scenario.chaos.capacityReduction * 100).toFixed(0)}% capacity`);
  return parts.length ? parts.join(' · ') : 'none';
}

export const PATTERN_OPTIONS: { value: TrafficPattern; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'steady', label: 'Steady' },
  { value: 'spike', label: 'Spike' },
  { value: 'wave', label: 'Wave' },
  { value: 'random', label: 'Random' },
  { value: 'flash-crowd', label: 'Flash Crowd' },
];
