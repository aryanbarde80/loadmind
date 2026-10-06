/**
 * Render smoke test: mounts every view with react-dom/server to catch import,
 * hook and render-time errors without a browser.
 *
 *   npm run render-check
 */
import React from 'react';
import { renderToString } from 'react-dom/server';
import { useApp } from '../src/state/store';

const views = [
  ['ControlView', () => require('../src/views/ControlView').ControlView],
  ['AlgorithmsView', () => require('../src/views/AlgorithmsView').AlgorithmsView],
  ['BattleView', () => require('../src/views/BattleView').BattleView],
  ['ChaosView', () => require('../src/views/ChaosView').ChaosView],
  ['PlaygroundView', () => require('../src/views/PlaygroundView').PlaygroundView],
  ['LabView', () => require('../src/views/LabView').LabView],
  ['ArchitectureView', () => require('../src/views/ArchitectureView').ArchitectureView],
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

// Prime some state so panels with data-dependent branches also render.
try {
  const store = useApp.getState();
  store.setView('control');
  store.openAlgorithmDetail('least-response-time');
  store.setWhyOpen(true);
  store.setChatOpen(true);
  // Seed history so the Performance Lab renders its charts and tables.
  store.saveLiveRun();
  store.saveLiveRun();
} catch (error) {
  console.log(`  [warn] state priming: ${(error as Error).message}`);
}

// zustand uses `getInitialState` as the server snapshot, so SSR components
// read the store's *initial* state. Mutating it lets the data-dependent
// branches (modals, populated lab) render in this harness.
try {
  Object.assign(useApp.getInitialState(), {
    whyOpen: true,
    algorithmDetailId: 'least-response-time',
    'chat.open': true,
  });
} catch {
  /* older zustand builds expose no getInitialState */
}

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
