export const PROXY_ALGORITHM_IDS = Object.freeze([
  'round-robin',
  'weighted-round-robin',
  'least-connections',
  'weighted-least-connections',
  'ip-hash',
  'random',
  'least-response-time',
  'consistent-hash',
  'autopilot',
]);

export const PROXY_ALGORITHM_NAMES = Object.freeze({
  'round-robin': 'Round Robin',
  'weighted-round-robin': 'Weighted Round Robin',
  'least-connections': 'Least Connections',
  'weighted-least-connections': 'Weighted Least Connections',
  'ip-hash': 'IP Hash',
  random: 'Random',
  'least-response-time': 'Least Response Time',
  'consistent-hash': 'Consistent Hashing',
  autopilot: 'AI Autopilot',
});

const hash32 = (value) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

const weightOf = (node) => Math.max(1, Math.min(10, Math.round(Number(node.weight) || 1)));
const byId = (a, b) => a.id.localeCompare(b.id);

function autopilotChoice(nodes) {
  const latency = nodes.map((node) => Math.max(1, node.ewmaLatencyMs || 100));
  const spread = Math.max(...latency) / Math.min(...latency);
  if (spread >= 1.7) {
    return { algorithm: 'least-response-time', reason: `Latency differs ${spread.toFixed(1)}× across healthy upstreams.` };
  }
  if (nodes.some((node) => node.inFlight >= 2)) {
    return { algorithm: 'least-connections', reason: 'Requests are in flight, so Autopilot is balancing current concurrency.' };
  }
  if (new Set(nodes.map(weightOf)).size > 1) {
    return { algorithm: 'weighted-least-connections', reason: 'The pool has different weights, so capacity is part of the decision.' };
  }
  return { algorithm: 'round-robin', reason: 'The healthy pool is even; simple rotation is the fairest choice.' };
}

function buildRing(nodes) {
  const ring = [];
  for (const node of nodes) {
    const replicas = weightOf(node) * 64;
    for (let replica = 0; replica < replicas; replica++) {
      ring.push({ point: hash32(`${node.id}:${replica}`), node });
    }
  }
  ring.sort((a, b) => a.point - b.point || byId(a.node, b.node));
  return ring;
}

/** Stateful real-HTTP routing strategies, independent from the UI. */
export function createProxyRouter({ algorithm = 'round-robin', random = Math.random } = {}) {
  let selectedAlgorithm = 'round-robin';
  let roundRobinCursor = 0;
  let weightedCurrent = new Map();
  let ringKey = '';
  let ring = [];
  let lastEffectiveAlgorithm = 'round-robin';
  let lastReason = 'Default routing strategy.';

  const setAlgorithm = (next) => {
    if (!PROXY_ALGORITHM_IDS.includes(next)) throw new RangeError(`Unknown proxy algorithm: ${next}`);
    selectedAlgorithm = next;
    lastEffectiveAlgorithm = next === 'autopilot' ? lastEffectiveAlgorithm : next;
    lastReason = next === 'autopilot' ? 'Autopilot evaluates live upstream latency and concurrency.' : `Operator selected ${PROXY_ALGORITHM_NAMES[next]}.`;
    return selectedAlgorithm;
  };

  const select = (nodes, request = {}) => {
    const candidates = nodes.filter((node) => node.healthy && !node.draining).sort(byId);
    if (candidates.length === 0) return { node: null, algorithm: selectedAlgorithm, reason: 'No healthy upstreams are available.' };

    let effective = selectedAlgorithm;
    if (selectedAlgorithm === 'autopilot') {
      const choice = autopilotChoice(candidates);
      effective = choice.algorithm;
      lastReason = choice.reason;
    }

    let node;
    switch (effective) {
      case 'round-robin': {
        node = candidates[roundRobinCursor % candidates.length];
        roundRobinCursor = (roundRobinCursor + 1) % candidates.length;
        break;
      }
      case 'weighted-round-robin': {
        const activeIds = new Set(candidates.map((candidate) => candidate.id));
        for (const id of weightedCurrent.keys()) if (!activeIds.has(id)) weightedCurrent.delete(id);
        let totalWeight = 0;
        node = candidates[0];
        for (const candidate of candidates) {
          const weight = weightOf(candidate);
          totalWeight += weight;
          const current = (weightedCurrent.get(candidate.id) ?? 0) + weight;
          weightedCurrent.set(candidate.id, current);
          if (current > weightedCurrent.get(node.id)) node = candidate;
        }
        weightedCurrent.set(node.id, weightedCurrent.get(node.id) - totalWeight);
        break;
      }
      case 'least-connections':
        node = candidates.reduce((best, candidate) => candidate.inFlight < best.inFlight ? candidate : best);
        break;
      case 'weighted-least-connections':
        node = candidates.reduce((best, candidate) =>
          candidate.inFlight / weightOf(candidate) < best.inFlight / weightOf(best) ? candidate : best,
        );
        break;
      case 'ip-hash': {
        const key = String(request.clientKey || request.clientIp || request.remoteAddress || 'anonymous');
        node = candidates[hash32(key) % candidates.length];
        break;
      }
      case 'random': {
        const totalWeight = candidates.reduce((sum, candidate) => sum + weightOf(candidate), 0);
        let ticket = Math.min(0.999999999, Math.max(0, random())) * totalWeight;
        node = candidates[candidates.length - 1];
        for (const candidate of candidates) {
          ticket -= weightOf(candidate);
          if (ticket < 0) {
            node = candidate;
            break;
          }
        }
        break;
      }
      case 'least-response-time':
        node = candidates.reduce((best, candidate) =>
          (candidate.ewmaLatencyMs || 100) * (candidate.inFlight + 1) / weightOf(candidate) <
          (best.ewmaLatencyMs || 100) * (best.inFlight + 1) / weightOf(best) ? candidate : best,
        );
        break;
      case 'consistent-hash': {
        const key = String(request.clientKey || request.clientIp || request.remoteAddress || 'anonymous');
        const currentRingKey = candidates.map((candidate) => `${candidate.id}:${weightOf(candidate)}`).join('|');
        if (currentRingKey !== ringKey) {
          ring = buildRing(candidates);
          ringKey = currentRingKey;
        }
        const point = hash32(key);
        let low = 0;
        let high = ring.length;
        while (low < high) {
          const mid = (low + high) >>> 1;
          if (ring[mid].point < point) low = mid + 1;
          else high = mid;
        }
        node = ring[low % ring.length].node;
        break;
      }
      default:
        throw new RangeError(`Unsupported proxy algorithm: ${effective}`);
    }

    lastEffectiveAlgorithm = effective;
    if (selectedAlgorithm !== 'autopilot') lastReason = `Selected ${node.name} using ${PROXY_ALGORITHM_NAMES[effective]}.`;
    return { node, algorithm: effective, reason: lastReason };
  };

  setAlgorithm(algorithm);
  return {
    select,
    setAlgorithm,
    getAlgorithm: () => selectedAlgorithm,
    getEffectiveAlgorithm: () => lastEffectiveAlgorithm,
    getReason: () => lastReason,
  };
}
