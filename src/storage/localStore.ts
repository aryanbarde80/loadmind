import type { CustomAlgorithmRecord, RunRecord } from '@/types';

/**
 * Thin, defensive localStorage layer.
 *
 * Everything is namespaced and versioned, and every read is validated, so a
 * corrupted or older payload degrades to an empty state instead of crashing
 * the app on boot.
 */

const PREFIX = 'loadmind:v1:';

export const StorageKeys = {
  runs: `${PREFIX}runs`,
  customAlgorithms: `${PREFIX}custom-algorithms`,
  preferences: `${PREFIX}preferences`,
  landingSeen: `${PREFIX}landing-seen`,
} as const;

export interface Preferences {
  defaultAlgorithm: string;
  autopilotOnBoot: boolean;
  reducedMotion: boolean;
  soundEnabled: boolean;
  lastScenarioId: string;
}

export const DEFAULT_PREFERENCES: Preferences = {
  defaultAlgorithm: 'round-robin',
  autopilotOnBoot: true,
  reducedMotion: false,
  soundEnabled: false,
  lastScenarioId: 'baseline',
};

function hasStorage(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
}

export function readJson<T>(key: string, fallback: T, validate?: (value: unknown) => boolean): T {
  if (!hasStorage()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    if (validate && !validate(parsed)) return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

export function writeJson<T>(key: string, value: T): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded — drop the oldest half of the history and retry once.
    if (key === StorageKeys.runs && Array.isArray(value)) {
      try {
        window.localStorage.setItem(key, JSON.stringify((value as unknown[]).slice(0, Math.floor((value as unknown[]).length / 2))));
      } catch {
        /* give up silently */
      }
    }
  }
}

export function removeKey(key: string): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Typed collections
// ---------------------------------------------------------------------------

const MAX_RUNS = 120;

const isRunRecord = (value: unknown): value is RunRecord =>
  typeof value === 'object' && value !== null && 'id' in value && 'algorithm' in value;

export function loadRuns(): RunRecord[] {
  const runs = readJson<RunRecord[]>(StorageKeys.runs, []);
  return Array.isArray(runs) ? runs.filter(isRunRecord) : [];
}

export function saveRun(run: RunRecord): RunRecord[] {
  const runs = [run, ...loadRuns()].slice(0, MAX_RUNS);
  writeJson(StorageKeys.runs, runs);
  return runs;
}

export function deleteRun(id: string): RunRecord[] {
  const runs = loadRuns().filter((r) => r.id !== id);
  writeJson(StorageKeys.runs, runs);
  return runs;
}

export function clearRuns(): void {
  writeJson(StorageKeys.runs, []);
}

const isCustomRecord = (value: unknown): value is CustomAlgorithmRecord =>
  typeof value === 'object' && value !== null && 'id' in value && 'code' in value;

export function loadCustomAlgorithms(): CustomAlgorithmRecord[] {
  const records = readJson<CustomAlgorithmRecord[]>(StorageKeys.customAlgorithms, []);
  return Array.isArray(records) ? records.filter(isCustomRecord) : [];
}

export function saveCustomAlgorithm(record: CustomAlgorithmRecord): CustomAlgorithmRecord[] {
  const existing = loadCustomAlgorithms().filter((r) => r.id !== record.id);
  const next = [record, ...existing];
  writeJson(StorageKeys.customAlgorithms, next);
  return next;
}

export function deleteCustomAlgorithm(id: string): CustomAlgorithmRecord[] {
  const next = loadCustomAlgorithms().filter((r) => r.id !== id);
  writeJson(StorageKeys.customAlgorithms, next);
  return next;
}

export function loadPreferences(): Preferences {
  return { ...DEFAULT_PREFERENCES, ...readJson<Partial<Preferences>>(StorageKeys.preferences, {}) };
}

export function savePreferences(prefs: Partial<Preferences>): void {
  writeJson(StorageKeys.preferences, { ...loadPreferences(), ...prefs });
}

export function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
