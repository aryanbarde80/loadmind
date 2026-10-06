import type { RunRecord } from '@/types';

const HEADERS = [
  'id',
  'kind',
  'createdAt',
  'algorithm',
  'pattern',
  'servers',
  'baseRps',
  'requests',
  'avgLatencyMs',
  'p95Ms',
  'p99Ms',
  'throughput',
  'errorRate',
  'fairness',
  'cpu',
  'score',
  'chaos',
] as const;

/** Quote a single RFC 4180 cell and neutralize spreadsheet formulas in text. */
function encodeCell(value: string | number): string {
  const raw = String(value);
  const looksLikeFormula = typeof value === 'string' && (/^[\t\r\n]/.test(raw) || /^\s*[=+\-@]/.test(raw));
  const safe = looksLikeFormula ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * Export saved runs as UTF-8 CSV. Every field is quoted, embedded quotes are
 * doubled, and formula-like user text is prefixed so spreadsheet programs do
 * not evaluate a custom algorithm name as a formula.
 */
export function serializeRunsCsv(runs: readonly RunRecord[]): string {
  const rows: (string | number)[][] = [
    [...HEADERS],
    ...runs.map((run) => [
      run.id,
      run.kind,
      new Date(run.createdAt).toISOString(),
      run.algorithmName,
      run.pattern,
      run.serverCount,
      run.baseRps,
      run.requests,
      run.avgLatencyMs.toFixed(2),
      run.p95Ms.toFixed(2),
      run.p99Ms.toFixed(2),
      run.throughput.toFixed(2),
      (run.errorRate * 100).toFixed(3),
      run.fairness.toFixed(4),
      run.cpu.toFixed(2),
      run.score.toFixed(2),
      run.chaosSummary,
    ]),
  ];

  return `\uFEFF${rows.map((row) => row.map(encodeCell).join(',')).join('\r\n')}\r\n`;
}
