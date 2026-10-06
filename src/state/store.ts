import { create } from 'zustand';
import { SimulationEngine, DEFAULT_CONFIG, DEFAULT_CHAOS } from '@/simulation/engine';
import { SCENARIO_PRESETS, chaosSummary as scenarioChaosSummary } from '@/simulation/scenarios';
import { runBattle as runBattleSync, type BattleOutcome } from '@/simulation/headless';
import { compileCustomAlgorithm, CUSTOM_TEMPLATE } from '@/algorithms/custom';
import { getAlgorithmName } from '@/algorithms/registry';
import { compositeScore } from '@/metrics/score';
import {
  createId,
  loadCustomAlgorithms,
  loadPreferences,
  loadRuns,
  savePreferences,
  deleteCustomAlgorithm,
  deleteRun,
  clearRuns,
  saveCustomAlgorithm,
  readJson,
  writeJson,
  StorageKeys,
} from '@/storage/localStore';
import {
  aggregateByAlgorithm,
  persistBattleResults,
  persistCustomRun,
  persistLiveRun,
} from '@/analytics/history';
import { answerQuestion, type ChatMessage } from '@/analytics/chat';
import type {
  AlgorithmId,

  BattleResult,
  BattleScenario,
  ChaosState,
  CustomAlgorithmRecord,
  EngineSnapshot,
  RunRecord,
  SimulationConfig,
  TrafficPattern,
} from '@/types';

/** The single simulation instance driving the whole application. */
export const engine = new SimulationEngine(DEFAULT_CONFIG);

export type ViewId = 'control' | 'algorithms' | 'battle' | 'chaos' | 'playground' | 'lab' | 'architecture' | 'live-proxy';

export interface BattleState {
  status: 'idle' | 'running' | 'done' | 'error';
  progress: number;
  label: string;
  scenarioId: string;
  scenario: BattleScenario;
  selected: AlgorithmId[];
  results: BattleResult[];
  winner: AlgorithmId | null;
  winnerName: string;
  winnerReason: string;
  error: string | null;
  durationMs: number;
}

export interface CustomState {
  records: CustomAlgorithmRecord[];
  activeId: string | null;
  code: string;
  name: string;
  error: string | null;
  running: boolean;
  results: BattleResult[];
  lastRunAt: number | null;
}

export interface AppState {
  snapshot: EngineSnapshot;
  view: ViewId;
  booted: boolean;
  selectedServerId: string | null;
  algorithmDetailId: string | null;
  whyOpen: boolean;
  runs: RunRecord[];
  battle: BattleState;
  custom: CustomState;
  chat: { open: boolean; messages: ChatMessage[]; thinking: boolean };
  preferences: ReturnType<typeof loadPreferences>;
  savedToast: string | null;

  // navigation / boot
  setView: (view: ViewId) => void;
  boot: (mode?: 'simulation' | 'battle' | 'autopilot') => void;
  dismissBoot: () => void;

  // engine control
  syncFromEngine: () => void;
  start: () => void;
  pause: () => void;
  toggleRunning: () => void;
  resetSimulation: () => void;
  setAlgorithm: (id: AlgorithmId) => void;
  setAutopilot: (enabled: boolean) => void;
  setConfig: (patch: Partial<SimulationConfig>) => void;
  setPattern: (pattern: TrafficPattern) => void;
  triggerBurst: () => void;

  // chaos
  setChaos: (patch: Partial<ChaosState>) => void;
  killServer: (id: string, killed?: boolean) => void;
  adjustLatency: (id: string, delta: number) => void;
  adjustErrors: (id: string, delta: number) => void;
  adjustCapacity: (id: string, delta: number) => void;
  clearServerChaos: (id: string) => void;
  clearAllChaos: () => void;
  randomFailure: () => void;

  // ui
  selectServer: (id: string | null) => void;
  openAlgorithmDetail: (id: string | null) => void;
  setWhyOpen: (open: boolean) => void;
  toast: (message: string) => void;
  togglePreference: (key: 'reducedMotion' | 'soundEnabled' | 'autopilotOnBoot') => void;

  // battle
  setBattleScenario: (id: string) => void;
  patchBattleScenario: (patch: Partial<BattleScenario>) => void;
  toggleBattleAlgorithm: (id: AlgorithmId) => void;
  runBattle: () => void;

  // playground
  setCustomCode: (code: string) => void;
  setCustomName: (name: string) => void;
  selectCustom: (id: string) => void;
  saveCustom: () => void;
  deleteCustom: (id: string) => void;
  newCustom: () => void;
  runCustomBenchmark: () => void;
  deployCustom: () => void;

  // history
  saveLiveRun: () => void;
  removeRun: (id: string) => void;
  clearHistory: () => void;

  // chat
  setChatOpen: (open: boolean) => void;
  askQuestion: (question: string) => void;
  clearChat: () => void;
}

const initialPreferences = loadPreferences();
const initialRuns = loadRuns();
const initialCustom = loadCustomAlgorithms();

const initialScenario = SCENARIO_PRESETS.find((s) => s.id === initialPreferences.lastScenarioId) ?? SCENARIO_PRESETS[0];

const initialBattle: BattleState = {
  status: 'idle',
  progress: 0,
  label: '',
  scenarioId: initialScenario.id,
  scenario: stripPreset(initialScenario),
  selected: ['round-robin', 'least-connections', 'least-response-time', 'autopilot'],
  results: [],
  winner: null,
  winnerName: '',
  winnerReason: '',
  error: null,
  durationMs: 0,
};

function stripPreset(preset: (typeof SCENARIO_PRESETS)[number]): BattleScenario {
  const { id: _id, description: _d, icon: _i, ...scenario } = preset;
  return { ...scenario, chaos: { ...scenario.chaos } };
}

const WELCOME: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  at: Date.now(),
  text: 'LoadMind AI online. I read the live simulation, the algorithm registry, your last battle and every saved run.',
  bullets: [
    'Ask why a server is quiet, which algorithm won, what a 3× traffic spike would do, or why Autopilot switched.',
  ],
  suggestions: [
    'Why is one server receiving fewer requests?',
    'Which algorithm performed best today?',
    'What happens if traffic increases by 300%?',
  ],
};

export const useApp = create<AppState>((set, get) => ({
  snapshot: engine.snapshot() as unknown as EngineSnapshot,
  view: 'control',
  booted: readJson<boolean>(StorageKeys.landingSeen, false),
  selectedServerId: null,
  algorithmDetailId: null,
  whyOpen: false,
  runs: initialRuns,
  battle: initialBattle,
  custom: {
    records: initialCustom,
    activeId: initialCustom[0]?.id ?? null,
    code: initialCustom[0]?.code ?? CUSTOM_TEMPLATE,
    name: initialCustom[0]?.name ?? 'My Algorithm',
    error: null,
    running: false,
    results: [],
    lastRunAt: null,
  },
  chat: { open: false, messages: [WELCOME], thinking: false },
  preferences: initialPreferences,
  savedToast: null,

  /* ------------------------------------------------------------------ nav */
  setView: (view) => set({ view }),
  dismissBoot: () => {
    writeJson(StorageKeys.landingSeen, true);
    set({ booted: true });
  },
  boot: (mode = 'simulation') => {
    if (mode === 'autopilot') {
      engine.setAutopilot(true);
    } else if (mode === 'battle') {
      engine.setAlgorithm('least-response-time');
    }
    engine.start();
    get().syncFromEngine();
    if (mode === 'battle') set({ view: 'battle' });
    writeJson(StorageKeys.landingSeen, true);
    set({ booted: true });
  },

  /* --------------------------------------------------------------- engine */
  syncFromEngine: () => set({ snapshot: engine.snapshot() as unknown as EngineSnapshot }),
  start: () => {
    engine.start();
    get().syncFromEngine();
  },
  pause: () => {
    engine.pause();
    get().syncFromEngine();
  },
  toggleRunning: () => (engine.running ? get().pause() : get().start()),
  resetSimulation: () => {
    engine.reset();
    get().syncFromEngine();
  },
  setAlgorithm: (id) => {
    engine.setAlgorithm(id);
    if (id !== 'autopilot') {
      savePreferences({ defaultAlgorithm: id });
    }
    get().syncFromEngine();
  },
  setAutopilot: (enabled) => {
    engine.setAutopilot(enabled);
    savePreferences({ autopilotOnBoot: enabled });
    get().syncFromEngine();
  },
  setConfig: (patch) => {
    engine.setConfig(patch);
    get().syncFromEngine();
  },
  setPattern: (pattern) => get().setConfig({ pattern }),
  triggerBurst: () => {
    engine.triggerBurst();
    get().syncFromEngine();
  },

  /* ---------------------------------------------------------------- chaos */
  setChaos: (patch) => {
    engine.setChaos(patch);
    get().syncFromEngine();
  },
  killServer: (id, killed = true) => {
    engine.killServer(id, killed);
    get().syncFromEngine();
  },
  adjustLatency: (id, delta) => {
    engine.addLatency(id, delta);
    get().syncFromEngine();
  },
  adjustErrors: (id, delta) => {
    engine.addErrorRate(id, delta);
    get().syncFromEngine();
  },
  adjustCapacity: (id, delta) => {
    engine.reduceCapacity(id, delta);
    get().syncFromEngine();
  },
  clearServerChaos: (id) => {
    engine.clearServerChaos(id);
    get().syncFromEngine();
  },
  clearAllChaos: () => {
    engine.setChaos({ ...DEFAULT_CHAOS });
    engine.clearAllChaos();
    get().syncFromEngine();
  },
  randomFailure: () => {
    const alive = engine.servers.filter((s) => !s.down);
    if (alive.length === 0) return;
    const victim = alive[Math.floor(Math.random() * alive.length)];
    engine.killServer(victim.id, true);
    const recoverIn = 8 + Math.random() * 10;
    window.setTimeout(() => {
      engine.killServer(victim.id, false);
      get().syncFromEngine();
    }, recoverIn * 1000);
    get().syncFromEngine();
  },

  /* ------------------------------------------------------------------- ui */
  selectServer: (id) => set({ selectedServerId: id }),
  openAlgorithmDetail: (id) => set({ algorithmDetailId: id }),
  setWhyOpen: (open) => set({ whyOpen: open }),
  toast: (message) => {
    set({ savedToast: message });
    window.setTimeout(() => {
      if (get().savedToast === message) set({ savedToast: null });
    }, 2400);
  },
  togglePreference: (key) => {
    const prefs = { ...get().preferences, [key]: !get().preferences[key] };
    savePreferences({ [key]: prefs[key] });
    set({ preferences: prefs });
  },

  /* ---------------------------------------------------------------- battle */
  setBattleScenario: (id) => {
    const preset = SCENARIO_PRESETS.find((s) => s.id === id) ?? SCENARIO_PRESETS[0];
    savePreferences({ lastScenarioId: id });
    set((state) => ({
      battle: { ...state.battle, scenarioId: id, scenario: stripPreset(preset), results: [], winner: null, status: 'idle' },
    }));
  },
  patchBattleScenario: (patch) =>
    set((state) => ({
      battle: {
        ...state.battle,
        scenario: { ...state.battle.scenario, ...patch, chaos: { ...state.battle.scenario.chaos, ...(patch.chaos ?? {}) } },
      },
    })),
  toggleBattleAlgorithm: (id) =>
    set((state) => {
      const MAX = 4;
      let selected: AlgorithmId[];
      if (state.battle.selected.includes(id)) {
        selected = state.battle.selected.filter((a) => a !== id);
      } else if (state.battle.selected.length >= MAX) {
        // At the limit: swap out the oldest pick so the click always lands.
        selected = [...state.battle.selected.slice(1), id];
      } else {
        selected = [...state.battle.selected, id];
      }
      return { battle: { ...state.battle, selected } };
    }),
  runBattle: () => {
    const state = get();
    if (state.battle.selected.length < 2) {
      set((s) => ({ battle: { ...s.battle, error: 'Select at least two algorithms to battle.' } }));
      return;
    }
    const startedAt = performance.now();
    set((s) => ({
      battle: { ...s.battle, status: 'running', progress: 0, label: 'Spinning up isolated simulations…', error: null, results: [], winner: null },
    }));

    const custom = state.custom.activeId
      ? state.custom.records.find((r) => r.id === state.custom.activeId)
      : undefined;
    const needsCustom = state.battle.selected.includes('custom');
    const customPayload =
      needsCustom && custom ? { id: custom.id, name: custom.name, code: custom.code } : undefined;

    const finish = (outcome: BattleOutcome | null, error?: string) => {
      const durationMs = performance.now() - startedAt;
      if (!outcome) {
        set((s) => ({ battle: { ...s.battle, status: 'error', error: error ?? 'Battle failed', durationMs } }));
        return;
      }
      const winnerResult = outcome.results.find((r) => r.algorithm === outcome.winner) ?? outcome.results[0];
      persistBattleResults(
        state.battle.scenario.name,
        outcome.results,
        state.battle.scenario.pattern,
        state.battle.scenario.baseRps,
        state.battle.scenario.serverCount,
        scenarioChaosSummary(state.battle.scenario),
      );
      set((s) => ({
        runs: loadRuns(),
        battle: {
          ...s.battle,
          status: 'done',
          progress: 1,
          label: 'Complete',
          results: outcome.results,
          winner: outcome.winner,
          winnerName: winnerResult?.name ?? '',
          winnerReason: outcome.winnerReason,
          durationMs,
        },
      }));
    };

    try {
      const worker = new Worker(new URL('../simulation/battle.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent) => {
        const message = event.data as
          | { type: 'progress'; fraction: number; label: string }
          | { type: 'done'; results: BattleResult[]; winner: AlgorithmId; winnerReason: string }
          | { type: 'error'; message: string };
        if (message.type === 'progress') {
          set((s) => ({ battle: { ...s.battle, progress: message.fraction, label: message.label || s.battle.label } }));
        } else if (message.type === 'done') {
          finish({ results: message.results, winner: message.winner, winnerReason: message.winnerReason, referenceThroughput: 1 } as BattleOutcome);
          worker.terminate();
        } else {
          finish(null, message.message);
          worker.terminate();
        }
      };
      worker.onerror = (event) => {
        // Worker unavailable (e.g. blocked module worker) — fall back to the
        // main thread so the feature still works.
        worker.terminate();
        try {
          finish(runBattleSync(state.battle.scenario, state.battle.selected, customPayload, (fraction, label) =>
            set((s) => ({ battle: { ...s.battle, progress: fraction, label: label || s.battle.label } })),
          ));
        } catch (error) {
          finish(null, (error as Error).message);
        }
        void event;
      };
      worker.postMessage({ type: 'run', scenario: state.battle.scenario, algorithms: state.battle.selected, custom: customPayload });
    } catch (error) {
      try {
        finish(runBattleSync(state.battle.scenario, state.battle.selected, customPayload, (fraction, label) =>
          set((s) => ({ battle: { ...s.battle, progress: fraction, label: label || s.battle.label } })),
        ));
      } catch (syncError) {
        finish(null, (syncError as Error).message || (error as Error).message);
      }
    }
  },

  /* ------------------------------------------------------------ playground */
  setCustomCode: (code) => set((s) => ({ custom: { ...s.custom, code, error: null } })),
  setCustomName: (name) => set((s) => ({ custom: { ...s.custom, name } })),
  selectCustom: (id) =>
    set((s) => {
      const record = s.custom.records.find((r) => r.id === id);
      return { custom: { ...s.custom, activeId: id, code: record?.code ?? s.custom.code, name: record?.name ?? s.custom.name, error: null } };
    }),
  saveCustom: () => {
    const { custom } = get();
    const now = Date.now();
    const existing = custom.records.find((r) => r.id === custom.activeId);
    const record: CustomAlgorithmRecord = {
      id: custom.activeId ?? createId('custom'),
      name: custom.name.trim() || 'My Algorithm',
      code: custom.code,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastResult: existing?.lastResult ?? null,
    };
    const records = saveCustomAlgorithm(record);
    set((s) => ({ custom: { ...s.custom, records, activeId: record.id } }));
    get().toast('Algorithm saved locally');
  },
  deleteCustom: (id) => {
    const records = deleteCustomAlgorithm(id);
    set((s) => ({
      custom: {
        ...s.custom,
        records,
        activeId: s.custom.activeId === id ? (records[0]?.id ?? null) : s.custom.activeId,
        code: s.custom.activeId === id ? (records[0]?.code ?? CUSTOM_TEMPLATE) : s.custom.code,
        name: s.custom.activeId === id ? (records[0]?.name ?? 'My Algorithm') : s.custom.name,
      },
    }));
  },
  newCustom: () =>
    set((s) => ({
      custom: { ...s.custom, activeId: null, code: CUSTOM_TEMPLATE, name: 'My Algorithm', error: null, results: [] },
    })),
  runCustomBenchmark: () => {
    const { custom } = get();
    set((s) => ({ custom: { ...s.custom, running: true, error: null } }));
    // Yield a frame so the "running" state paints before we block.
    window.setTimeout(() => {
      const state = get();
      try {
        const compiled = compileCustomAlgorithm(custom.activeId ?? 'custom-playground', custom.name || 'My Algorithm', custom.code);
        const scenario: BattleScenario = {
          name: 'Playground benchmark',
          requests: 8000,
          serverCount: Math.max(3, Math.min(8, state.snapshot.config.serverCount)),
          pattern: state.snapshot.config.pattern,
          baseRps: Math.max(120, state.snapshot.config.baseRps),
          durationSec: 60,
          chaos: { killCount: 0, latencyPenaltyMs: 180, errorPenalty: 0.03, capacityReduction: 0.15, trafficMultiplier: 1.35 },
          seed: 5150,
        };
        const outcome = runBattleSync(
          scenario,
          ['custom', 'round-robin', 'least-response-time'],
          { id: compiled.definition.id, name: compiled.definition.name, code: custom.code },
        );
        const mine = outcome.results.find((r) => r.algorithm === 'custom') ?? outcome.results[0];
        const records = saveCustomAlgorithm({
          id: custom.activeId ?? compiled.definition.id,
          name: custom.name || 'My Algorithm',
          code: custom.code,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          lastResult: {
            avgLatencyMs: mine.avgLatencyMs,
            p95Ms: mine.p95Ms,
            errorRate: mine.errorRate,
            throughput: mine.throughput,
            score: mine.score,
          },
        });
        persistCustomRun(
          custom.name || 'My Algorithm',
          { ...mine, fairness: mine.fairness, cpu: mine.cpu, requests: mine.requests },
          scenario.pattern,
          scenario.baseRps,
          scenario.serverCount,
        );
        set((s) => ({
          runs: loadRuns(),
          custom: { ...s.custom, running: false, results: outcome.results, lastRunAt: Date.now(), records, activeId: s.custom.activeId ?? compiled.definition.id, error: null },
        }));
      } catch (error) {
        set((s) => ({
          custom: { ...s.custom, running: false, error: (error as Error).message },
        }));
      }
    }, 60);
  },
  deployCustom: () => {
    const { custom } = get();
    try {
      const compiled = compileCustomAlgorithm(custom.activeId ?? 'custom-playground', custom.name || 'My Algorithm', custom.code);
      engine.setCustomAlgorithm(compiled.definition);
      engine.start();
      // Jump to the control center (without opening a modal that would cover
      // the UI) so the operator immediately sees their algorithm routing live
      // traffic.
      set({ view: 'control' });
      get().syncFromEngine();
      get().toast(`${compiled.definition.name} deployed to the live pool`);
    } catch (error) {
      set((s) => ({ custom: { ...s.custom, error: (error as Error).message } }));
    }
  },

  /* --------------------------------------------------------------- history */
  saveLiveRun: () => {
    const snapshot = engine.snapshot();
    const throughput = snapshot.metrics.throughput || 1;
    const breakdown = compositeScore({
      avgLatencyMs: snapshot.metrics.avgLatencyMs,
      p95Ms: snapshot.metrics.p95Ms,
      errorRate: snapshot.metrics.errorRate,
      throughput,
      fairness: snapshot.metrics.fairness,
      cpu: snapshot.metrics.poolCpu,
      maxUtilization: Math.max(...snapshot.servers.map((s) => s.utilization), 0),
      referenceThroughput: throughput,
    });
    persistLiveRun({
      algorithm: snapshot.activeAlgorithm,
      algorithmName: snapshot.activeAlgorithmName,
      pattern: snapshot.config.pattern,
      baseRps: snapshot.config.baseRps,
      serverCount: snapshot.servers.length,
      requests: snapshot.metrics.completed,
      avgLatencyMs: snapshot.metrics.avgLatencyMs,
      p95Ms: snapshot.metrics.p95Ms,
      p99Ms: snapshot.metrics.p99Ms,
      throughput,
      errorRate: snapshot.metrics.errorRate,
      fairness: snapshot.metrics.fairness,
      cpu: snapshot.metrics.poolCpu,
      score: breakdown.score,
      chaosSummary: describeChaos(snapshot.chaos, snapshot.servers),
    });
    set({ runs: loadRuns() });
    get().toast('Run saved to Performance Lab');
  },
  removeRun: (id) => set({ runs: deleteRun(id) }),
  clearHistory: () => {
    clearRuns();
    set({ runs: [] });
  },

  /* ------------------------------------------------------------------ chat */
  setChatOpen: (open) => set((s) => ({ chat: { ...s.chat, open } })),
  clearChat: () => set((s) => ({ chat: { ...s.chat, messages: [WELCOME] } })),
  askQuestion: (question) => {
    const state = get();
    const snapshot = engine.snapshot();
    const userMessage: ChatMessage = { id: createId('q'), role: 'user', text: question, at: Date.now() };
    set((s) => ({ chat: { ...s.chat, messages: [...s.chat.messages, userMessage], thinking: true } }));

    window.setTimeout(() => {
      const ctx = buildChatContext(get());
      const answer = answerQuestion(question, ctx);
      const reply: ChatMessage = {
        id: createId('a'),
        role: 'assistant',
        text: answer.text,
        bullets: answer.bullets,
        chips: answer.chips,
        suggestions: answer.suggestions,
        at: Date.now(),
      };
      set((s) => ({ chat: { ...s.chat, messages: [...s.chat.messages, reply], thinking: false } }));
      void snapshot;
    }, 260);
    void state;
  },
}));

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function buildChatContext(state: AppState) {
  const snapshot = engine.snapshot();
  const lastBattle =
    state.battle.status === 'done' && state.battle.results.length
      ? {
          scenarioName: state.battle.scenario.name,
          winner: state.battle.winner ?? 'round-robin',
          winnerName: state.battle.winnerName || 'Winner',
          winnerReason: state.battle.winnerReason,
          results: state.battle.results.map((r) => ({
            algorithm: r.algorithm,
            name: r.name,
            avgLatencyMs: r.avgLatencyMs,
            p95Ms: r.p95Ms,
            errorRate: r.errorRate,
            throughput: r.throughput,
            score: r.score,
          })),
        }
      : null;

  return {
    running: snapshot.running,
    simTime: snapshot.simTime,
    servers: snapshot.servers,
    metrics: snapshot.metrics,
    distribution: snapshot.distribution,
    algorithmId: snapshot.activeAlgorithm,
    algorithmName: snapshot.activeAlgorithmName,
    autopilotEnabled: snapshot.autopilot.enabled,
    lastDecision: snapshot.autopilot.lastDecision,
    features: snapshot.autopilot.lastFeatures ?? null,
    chaos: snapshot.chaos,
    chaosSummary: describeChaos(snapshot.chaos, snapshot.servers),
    runs: state.runs,
    lastBattle,
    pattern: snapshot.config.pattern,
    baseRps: snapshot.config.baseRps,
  };
}

export function describeChaos(chaos: ChaosState, servers: { id: string; name: string }[]): string {
  const parts: string[] = [];
  if (chaos.trafficMultiplier !== 1) parts.push(`${chaos.trafficMultiplier.toFixed(1)}× traffic`);
  const killed = servers.filter((s) => chaos.killed[s.id]);
  if (killed.length) parts.push(`${killed.length} offline`);
  const latency = Object.entries(chaos.latencyPenalties).filter(([, v]) => v > 0);
  if (latency.length) parts.push(`+${Math.max(...latency.map(([, v]) => v)).toFixed(0)}ms`);
  const errors = Object.entries(chaos.errorPenalties).filter(([, v]) => v > 0);
  if (errors.length) parts.push(`+${(Math.max(...errors.map(([, v]) => v)) * 100).toFixed(0)}% errors`);
  const capacity = Object.entries(chaos.capacityReductions).filter(([, v]) => v > 0);
  if (capacity.length) parts.push(`-${(Math.max(...capacity.map(([, v]) => v)) * 100).toFixed(0)}% capacity`);
  return parts.length ? parts.join(' · ') : 'none';
}

/** Aggregate leaderboard for the lab (recomputed on demand). */
export const selectLeaderboard = (runs: RunRecord[]) => aggregateByAlgorithm(runs);

export { getAlgorithmName };
