/**
 * Render smoke test: mounts every view with react-dom/server to catch import,
 * hook and render-time errors without a browser.
 *
 *   npm run render-check
 */
import React from 'react';
import { renderToString } from 'react-dom/server';
import { useApp } from '../src/state/store';
import type { RunRecord } from '../src/types';

const views = [
  ['ControlView', () => require('../src/views/ControlView').ControlView],
  ['AlgorithmsView', () => require('../src/views/AlgorithmsView').AlgorithmsView],
  ['BattleView', () => require('../src/views/BattleView').BattleView],
  ['ChaosView', () => require('../src/views/ChaosView').ChaosView],
  ['PlaygroundView', () => require('../src/views/PlaygroundView').PlaygroundView],
  ['LabView', () => require('../src/views/LabView').LabView],
  ['ArchitectureView', () => require('../src/views/ArchitectureView').ArchitectureView],
  ['LiveProxyView', () => require('../src/views/LiveProxyView').LiveProxyView],
  ['Landing', () => require('../src/components/landing/Landing').Landing],
  ['ChatPanel', () => require('../src/components/chat/ChatPanel').ChatPanel],
  ['AlgorithmDetailModal', () => require('../src/components/algorithms/AlgorithmDetailModal').AlgorithmDetailModal],
  ['WhyModal', () => require('../src/components/autopilot/WhyModal').WhyModal],
  ['TopBar', () => require('../src/components/layout/TopBar').TopBar],
  ['SideRail', () => require('../src/components/layout/SideRail').SideRail],
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const errors: string[] = [];
const originalError = console.error;
console.error = (...args: unknown[]) => {
  const first = String(args[0] ?? '');
  // Recharts emits expected sizing warnings outside a browser.
  if (first.includes('width(0)') || first.includes('height(0)')) return;
  errors.push(first);
  originalError(...(args as []));
};

console.log('\n=== LoadMind render check ===\n');

// Zustand uses getInitialState as the server snapshot. Seed that snapshot
// directly so SSR covers open overlays and a populated Performance Lab without
// calling browser-only persistence actions such as saveLiveRun().
const now = Date.now();
const seededRuns: RunRecord[] = [
  {
    id: 'render-lrt',
    kind: 'live',
    createdAt: now - 2_000,
    label: 'Least Response Time · normal',
    algorithm: 'least-response-time',
    algorithmName: 'Least Response Time',
    pattern: 'normal',
    baseRps: 420,
    serverCount: 5,
    requests: 8_400,
    avgLatencyMs: 62,
    p95Ms: 140,
    p99Ms: 210,
    throughput: 414,
    errorRate: 0.002,
    fairness: 0.96,
    cpu: 48,
    score: 87.4,
    chaosSummary: 'none',
  },
  {
    id: 'render-rr',
    kind: 'battle',
    createdAt: now - 1_000,
    label: 'Round Robin · normal',
    algorithm: 'round-robin',
    algorithmName: 'Round Robin',
    pattern: 'normal',
    baseRps: 420,
    serverCount: 5,
    requests: 8_400,
    avgLatencyMs: 78,
    p95Ms: 171,
    p99Ms: 260,
    throughput: 409,
    errorRate: 0.006,
    fairness: 0.99,
    cpu: 52,
    score: 80.2,
    chaosSummary: 'none',
  },
];
const initialState = useApp.getInitialState();
Object.assign(initialState, {
  runs: seededRuns,
  whyOpen: true,
  algorithmDetailId: 'least-response-time',
  chat: { ...initialState.chat, open: true },
});

let failures = 0;
for (const [name, load] of views) {
  try {
    const Component = load() as React.ComponentType<Record<string, unknown>>;
    const html = renderToString(React.createElement(Component, {}));
    const ok = html.length > 40;
    if (!ok) failures++;
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name.padEnd(24)} ${String(html.length).padStart(7)} bytes of markup`);
  } catch (error) {
    failures++;
    console.log(`  [FAIL] ${name.padEnd(24)} ${(error as Error).message.split('\n')[0]}`);
  }
}

const realErrors = errors.filter((e) => !e.includes('Warning: '));
console.log(`\n  console.error calls: ${errors.length} (React warnings: ${errors.length - realErrors.length})`);
console.log(`\n=== ${failures === 0 ? 'ALL VIEWS RENDERED' : `${failures} VIEW(S) FAILED`} ===\n`);
process.exit(failures === 0 ? 0 : 1);
