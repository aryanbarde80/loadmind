import { clamp } from '@/lib/math';
import type { Rng } from '@/lib/rng';
import type { TrafficPattern } from '@/types';

/**
 * Traffic generation model.
 *
 * Each pattern mutates a multiplier applied to the operator's base RPS. The
 * burst control injects a manual, time-boxed multiplier on top of that.
 */

export interface TrafficGenerator {
  pattern: TrafficPattern;
  /** Current multiplier applied to base RPS. */
  multiplier: number;
  /** Sim-seconds remaining on an operator-triggered burst. */
  burstRemaining: number;
  burstMultiplier: number;
  burstDurationSec: number;
  private: {
    nextEventAt: number;
    randomWalk: number;
    spikeUntil: number;
    spikeStrength: number;
    flashUntil: number;
    flashPeak: number;
    lastWalkAt: number;
  };
}

export function createTrafficGenerator(pattern: TrafficPattern, rng: Rng): TrafficGenerator {
  return {
    pattern,
    multiplier: 1,
    burstRemaining: 0,
    burstMultiplier: 3,
    burstDurationSec: 4,
    private: {
      nextEventAt: rng.range(4, 10),
      randomWalk: 1,
      spikeUntil: -1,
      spikeStrength: 1,
      flashUntil: -1,
      flashPeak: 1,
      lastWalkAt: 0,
    },
  };
}

export function triggerBurst(generator: TrafficGenerator, multiplier: number, durationSec: number): void {
  generator.burstRemaining = durationSec;
  generator.burstMultiplier = multiplier;
}

/** Advance the pattern model and return the arrival multiplier. */
export function advanceTraffic(generator: TrafficGenerator, simTime: number, dt: number, rng: Rng): number {
  const s = generator.private;

  if (generator.burstRemaining > 0) generator.burstRemaining = Math.max(0, generator.burstRemaining - dt);

  let base = 1;
  switch (generator.pattern) {
    case 'steady':
      base = 1 + rng.gauss(0, 0.02);
      break;

    case 'normal':
      base = 1 + Math.sin(simTime / 9) * 0.12 + Math.sin(simTime / 3.3) * 0.05 + rng.gauss(0, 0.05);
      break;

    case 'wave':
      base = 1 + Math.sin((simTime / 22) * Math.PI * 2) * 0.65 + rng.gauss(0, 0.03);
      break;

    case 'spike': {
      if (simTime >= s.nextEventAt) {
        s.spikeUntil = simTime + rng.range(1.5, 3.5);
        s.spikeStrength = rng.range(2.2, 4.2);
        s.nextEventAt = simTime + rng.range(7, 15);
      }
      base = simTime < s.spikeUntil ? s.spikeStrength : 1;
      base *= 1 + rng.gauss(0, 0.04);
      break;
    }

    case 'flash-crowd': {
      if (simTime >= s.nextEventAt && simTime > s.flashUntil) {
        s.flashUntil = simTime + rng.range(14, 24);
        s.flashPeak = rng.range(4, 7);
        s.nextEventAt = simTime + rng.range(22, 40);
      }
      if (simTime < s.flashUntil) {
        const t = s.flashUntil - simTime;
        // Ramp in, hold, decay out.
        base = t > 10 ? 1 + (s.flashPeak - 1) * ((14 - t) / 4) : 1 + (s.flashPeak - 1) * (t / 10);
        base = clamp(base, 1, s.flashPeak);
      } else {
        base = 1;
      }
      base *= 1 + rng.gauss(0, 0.05);
      break;
    }

    case 'random': {
      if (simTime - s.lastWalkAt >= 0.4) {
        s.lastWalkAt = simTime;
        s.randomWalk = clamp(s.randomWalk + rng.gauss(0, 0.22), 0.35, 2.3);
      }
      base = s.randomWalk;
      break;
    }
  }

  const burst = generator.burstRemaining > 0 ? generator.burstMultiplier : 1;
  generator.multiplier = Math.max(0.05, base * burst);
  return generator.multiplier;
}

export const PATTERN_META: Record<
  TrafficPattern,
  { label: string; description: string; color: string; icon: string }
> = {
  normal: {
    label: 'Normal',
    description: 'Gentle diurnal drift with light noise — a healthy production baseline.',
    color: '#34e5b0',
    icon: 'activity',
  },
  steady: {
    label: 'Steady',
    description: 'Flat arrival rate. Removes traffic variance so algorithm differences are isolated.',
    color: '#3b9dfd',
    icon: 'minus',
  },
  spike: {
    label: 'Spike',
    description: 'Short 2–4× bursts every 7–15s. Punishes algorithms that cannot shed load.',
    color: '#fbbf24',
    icon: 'zap',
  },
  wave: {
    label: 'Wave',
    description: 'Sinusoidal 20s cycle between 0.35× and 1.65× — capacity should breathe with it.',
    color: '#22d3ee',
    icon: 'waves',
  },
  random: {
    label: 'Random',
    description: 'Random walk between 0.35× and 2.3×. No pattern to learn, only reaction speed matters.',
    color: '#8b7cf6',
    icon: 'shuffle',
  },
  'flash-crowd': {
    label: 'Flash Crowd',
    description: 'Ramps to 4–7× over 4s, holds, then decays. The classic "we got posted" scenario.',
    color: '#fb5a7a',
    icon: 'flame',
  },
};

/**
 * Client population with a Zipf-ish skew: a handful of IPs (NAT gateways,
 * mobile carriers) generate most of the traffic. This is what makes affinity
 * algorithms (IP hash / consistent hashing) behave interestingly — and
 * sometimes badly.
 */
export interface ClientPool {
  ips: string[];
  weights: number[];
  /** Number of distinct clients seen. */
  distinct: number;
}

const PATHS = [
  { path: '/api/orders', cost: 1.4, weight: 22 },
  { path: '/api/search', cost: 1.9, weight: 18 },
  { path: '/api/checkout', cost: 2.6, weight: 8 },
  { path: '/api/users/me', cost: 0.7, weight: 26 },
  { path: '/static/app.js', cost: 0.35, weight: 18 },
  { path: '/api/recommendations', cost: 2.1, weight: 8 },
];

export function createClientPool(size: number, rng: Rng): ClientPool {
  const ips: string[] = [];
  const weights: number[] = [];
  for (let i = 0; i < size; i++) {
    const octet = (i % 250) + 1;
    ips.push(`${24 + (i % 40)}.${(i * 7) % 200}.${(i * 13) % 250}.${octet}`);
    weights.push(1 / (i + 1) ** 0.72);
  }
  // Shuffle the skew so it is not correlated with index.
  const order = ips.map((_, i) => i);
  rng.shuffle(order);
  return {
    ips: order.map((i) => ips[i]),
    weights: order.map((i) => weights[i]),
    distinct: size,
  };
}

export function pickRequestCost(rng: Rng): { path: string; cost: number } {
  const entry = rng.weightedPick(PATHS, PATHS.map((p) => p.weight));
  return { path: entry.path, cost: entry.cost * rng.range(0.8, 1.25) };
}
