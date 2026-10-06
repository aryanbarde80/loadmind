/**
 * Headless smoke test — runs the real engine, algorithms, battle runner and
 * assistant without a browser. Execute with:
 *   npm run smoke
 */
import { SimulationEngine, SIM_STEP } from '../src/simulation/engine';
import { runBattle, runHeadless } from '../src/simulation/headless';
import { compileCustomAlgorithm } from '../src/algorithms/custom';
import { BUILTIN_ALGORITHMS } from '../src/algorithms/registry';
import { SCENARIO_PRESETS } from '../src/simulation/scenarios';
import { serializeRunsCsv } from '../src/analytics/exportCsv';
import type { AlgorithmId, RunRecord } from '../src/types';

let failures = 0;
function check(name: string, condition: boolean, detail = ''): void {
  const status = condition ? 'PASS' : 'FAIL';
  if (!condition) failures++;
  console.log(`  [${status}] ${name}${detail ? ` — ${detail}` : ''}`);
}

function runFor(engine: SimulationEngine, seconds: number): void {
  const steps = Math.round(seconds / SIM_STEP);
  for (let i = 0; i < steps; i++) engine.step(SIM_STEP);
}

console.log('\n=== LoadMind smoke test ===\n');

/* ---------------------------------------------------- 1. engine produces work */
{
  console.log('1. Engine dispatches and completes requests');
  const engine = new SimulationEngine({ baseRps: 400, serverCount: 5, seed: 1234 });
  engine.setAlgorithm('round-robin');
  engine.start();
  runFor(engine, 10);
  const m = engine.metrics.snapshot(engine.servers, engine.simTime);
  check('requests arrived', m.totalRequests > 3000, `${m.totalRequests} arrivals`);
  check('requests completed', m.completed > 2000, `${m.completed} completed`);
  check('throughput sane', m.throughput > 200 && m.throughput < 700, `${m.throughput.toFixed(0)} rps`);
  check('latency plausible', m.avgLatencyMs > 10 && m.avgLatencyMs < 2000, `${m.avgLatencyMs.toFixed(1)}ms`);
  check('p95 >= p50', m.p95Ms >= m.p50Ms, `p50 ${m.p50Ms.toFixed(0)} p95 ${m.p95Ms.toFixed(0)}`);
  check('server telemetry updates', engine.servers.every((s) => s.cpu > 0 && s.memory > 0));
  check('connections tracked', engine.servers.some((s) => s.activeConnections > 0));
}

/* ------------------------------------------- 2. every algorithm distributes */
{
  console.log('\n2. Every built-in algorithm routes traffic');
  for (const definition of BUILTIN_ALGORITHMS) {
    const engine = new SimulationEngine({ baseRps: 400, serverCount: 5, seed: 99 });
    engine.setAlgorithm(definition.id as AlgorithmId);
    engine.start();
    runFor(engine, 6);
    const dist = engine.metrics.distribution(engine.servers);
    const total = dist.reduce((a, d) => a + d.count, 0);
    const served = dist.filter((d) => d.count > 0).length;
    const m = engine.metrics.snapshot(engine.servers, engine.simTime);
    check(
      `${definition.name.padEnd(28)}`,
      total > 1000 && served >= 4 && m.completed > 1000,
      `${total} dispatched across ${served}/5 · ${m.avgLatencyMs.toFixed(0)}ms · err ${(m.errorRate * 100).toFixed(2)}%`,
    );
  }
}

/* ------------------------------------- 3. algorithms genuinely differ */
{
  console.log('\n3. Algorithms produce measurably different behaviour');
  const results = new Map<string, number[]>();
  for (const id of ['round-robin', 'ip-hash', 'least-connections', 'consistent-hash'] as AlgorithmId[]) {
    const engine = new SimulationEngine({ baseRps: 300, serverCount: 5, seed: 4242 });
    engine.setAlgorithm(id);
    engine.start();
    runFor(engine, 8);
    results.set(id, engine.metrics.distribution(engine.servers).map((d) => d.count));
  }
  const rr = results.get('round-robin')!;
  const ip = results.get('ip-hash')!;
  const maxRr = Math.max(...rr) / (rr.reduce((a, b) => a + b, 0) / rr.length);
  const maxIp = Math.max(...ip) / (ip.reduce((a, b) => a + b, 0) / ip.length);
  check('round robin is near-even', maxRr < 1.1, `peak/mean ${maxRr.toFixed(3)}`);
  check('ip hash is skewed by client population', maxIp > maxRr + 0.05, `peak/mean ${maxIp.toFixed(3)}`);
}

/* ------------------------------------------------------ 4. chaos degrades */
{
  console.log('\n4. Chaos injection actually degrades the pool');
  const healthy = new SimulationEngine({ baseRps: 400, serverCount: 5, seed: 7 });
  healthy.setAlgorithm('round-robin');
  healthy.start();
  runFor(healthy, 8);

  const broken = new SimulationEngine({ baseRps: 400, serverCount: 5, seed: 7 });
  broken.setAlgorithm('round-robin');
  broken.setChaos({
    trafficMultiplier: 2.5,
    latencyPenalties: { [broken.servers[1].id]: 400 },
    errorPenalties: { [broken.servers[2].id]: 0.2 },
    capacityReductions: { [broken.servers[3].id]: 0.5 },
    killed: { [broken.servers[0].id]: true },
  });
  broken.start();
  runFor(broken, 8);

  const a = healthy.metrics.snapshot(healthy.servers, healthy.simTime);
  const b = broken.metrics.snapshot(broken.servers, broken.simTime);
  check('killed server is offline', broken.servers[0].down === true);
  check('chaos raises latency', b.avgLatencyMs > a.avgLatencyMs * 1.3, `${a.avgLatencyMs.toFixed(0)}ms → ${b.avgLatencyMs.toFixed(0)}ms`);
  check('chaos raises errors', b.errorRate > a.errorRate + 0.01, `${(a.errorRate * 100).toFixed(2)}% → ${(b.errorRate * 100).toFixed(2)}%`);
  check('removed capacity is applied', broken.servers[3].capacityFactor === 0.5);
}

/* --------------------------------------------------- 5. AI autopilot works */
{
  console.log('\n5. AI Autopilot evaluates and switches');
  const engine = new SimulationEngine({ baseRps: 300, serverCount: 5, seed: 555, pattern: 'flash-crowd' });
  engine.setAutopilot(true, { silent: true });
  engine.start();
  runFor(engine, 22);
  const decision = engine.autopilot.lastDecision;
  check('evaluations happened', engine.autopilot.evaluations > 10, `${engine.autopilot.evaluations} cycles`);
  check('a decision exists', !!decision);
  check('headline is populated', (decision?.headline.length ?? 0) > 20, decision?.headline.slice(0, 90));
  check('summary is populated', (decision?.summary.length ?? 0) > 40);
  check('every algorithm was scored', (decision?.considered.length ?? 0) === 8);
  check('features extracted', !!decision?.features && Number.isFinite(decision.features.spikeFactor));
  check('feed emitted', engine.snapshot().feed.length > 0, `${engine.snapshot().feed.length} feed items`);
  check('switched at least once', engine.autopilot.switches >= 1, `${engine.autopilot.switches} switches`);
  const ranked = decision!.considered.map((c) => `${c.name}:${c.score}`).join(', ');
  console.log(`        scorecard → ${ranked}`);
  console.log(`        active signals → ${engine.autopilot.lastEvaluation?.activeRules.map((r) => r.label).join(', ')}`);
}

/* ---------------------------------------------------------- 6. battle mode */
{
  console.log('\n6. Battle mode runs identical traffic through each algorithm');
  const scenario = SCENARIO_PRESETS.find((s) => s.id === 'degraded-node')!;
  const outcome = runBattle(scenario, ['round-robin', 'least-connections', 'least-response-time', 'autopilot']);
  check('all algorithms returned', outcome.results.length === 4);
  const counts = outcome.results.map((r) => r.requests);
  const spread = (Math.max(...counts) - Math.min(...counts)) / Math.min(...counts);
  check('identical request volumes (within 1%)', spread < 0.01, counts.join('/'));
  check('scores are ordered', outcome.results[0].score >= outcome.results[1].score, outcome.results.map((r) => `${r.name} ${r.score.toFixed(1)}`).join(' | '));
  check('winner has a citation', outcome.winnerReason.length > 40, outcome.winnerReason.slice(0, 90));
  const lrt = outcome.results.find((r) => r.algorithm === 'least-response-time')!;
  const rr = outcome.results.find((r) => r.algorithm === 'round-robin')!;
  check('least-response-time beats round robin on a degraded node', lrt.avgLatencyMs < rr.avgLatencyMs, `LRT ${lrt.avgLatencyMs.toFixed(0)}ms vs RR ${rr.avgLatencyMs.toFixed(0)}ms`);
  const auto = outcome.results.find((r) => r.algorithm === 'autopilot')!;
  check('autopilot switched during the battle', (auto.switches ?? 0) >= 1, `${auto.switches} switches`);
  for (const result of outcome.results) {
    console.log(
      `        ${result.name.padEnd(24)} avg ${result.avgLatencyMs.toFixed(0).padStart(4)}ms  p95 ${result.p95Ms.toFixed(0).padStart(5)}ms  err ${(result.errorRate * 100).toFixed(2).padStart(5)}%  fair ${result.fairness.toFixed(3)}  score ${result.score.toFixed(1)}`,
    );
  }
}

/* ------------------------------------------------ 7. custom algorithms */
{
  console.log('\n7. Custom algorithm playground');
  const good = compileCustomAlgorithm(
    'c1',
    'Fastest server',
    `function selectServer(servers, request, state) {
      const healthy = servers.filter((s) => !s.down);
      if (!healthy.length) return null;
      return healthy.reduce((best, s) => (s.ewmaLatencyMs < best.ewmaLatencyMs ? s : best));
    }`,
  );
  check('compiles valid code', !!good.definition);

  const engine = new SimulationEngine({ baseRps: 300, serverCount: 4, seed: 31 });
  engine.setCustomAlgorithm(good.definition);
  engine.start();
  runFor(engine, 6);
  check('custom algorithm serves traffic', engine.metrics.completed > 800, `${engine.metrics.completed} completed`);
  check('custom algorithm is active', engine.activeAlgorithmId === 'custom');

  let threw = false;
  try {
    compileCustomAlgorithm(
      'bad',
      'Broken',
      `function selectServer(servers) { return undefinedVariable.x; }`,
    );
  } catch (error) {
    threw = true;
    console.log(`        rejected as expected: ${(error as Error).message.slice(0, 70)}`);
  }
  check('rejects broken code', threw);

  let threw2 = false;
  try {
    compileCustomAlgorithm('bad2', 'No function', 'const x = 1;');
  } catch {
    threw2 = true;
  }
  check('rejects code without selectServer', threw2);

  const bench = runHeadless({
    scenario: { ...SCENARIO_PRESETS[0], requests: 3000 },
    algorithm: 'custom',
    custom: { id: 'c1', name: 'Fastest server', code: `function selectServer(servers){const h=servers.filter(s=>!s.down);return h.length?h[0]:null;}` },
  });
  check('custom algorithm benchmarks', bench.requests > 2000 && bench.score > 0, `score ${bench.score.toFixed(1)}`);
}

/* ------------------------------------------------- 8. traffic patterns */
{
  console.log('\n8. Traffic patterns behave differently');
  const byPattern: Record<string, { total: number; peak: number }> = {};
  for (const pattern of ['steady', 'spike', 'wave', 'flash-crowd'] as const) {
    const engine = new SimulationEngine({ baseRps: 300, serverCount: 5, seed: 808, pattern });
    engine.setAlgorithm('round-robin');
    engine.start();
    let peak = 0;
    for (let i = 0; i < 600; i++) {
      engine.step(SIM_STEP);
      const rate = engine.metrics.arrivalRate(engine.simTime);
      if (rate > peak) peak = rate;
    }
    byPattern[pattern] = { total: engine.metrics.totalRequests, peak };
  }
  check('steady stays near base rate', byPattern.steady.peak < 700, `peak ${byPattern.steady.peak.toFixed(0)} rps`);
  check('flash crowd spikes hard', byPattern['flash-crowd'].peak > 1000, `peak ${byPattern['flash-crowd'].peak.toFixed(0)} rps`);
  check('spike pattern exceeds steady', byPattern.spike.peak > byPattern.steady.peak, `${byPattern.spike.peak.toFixed(0)} vs ${byPattern.steady.peak.toFixed(0)}`);
}

/* ----------------------------------------------- 9. assistant is wired */
{
  console.log('\n9. LoadMind AI answers from application state');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { answerQuestion } = require('../src/analytics/chat');
  const engine = new SimulationEngine({ baseRps: 400, serverCount: 5, seed: 2 });
  engine.setAutopilot(true, { silent: true });
  engine.start();
  runFor(engine, 8);
  const snapshot = engine.snapshot();
  const ctx = {
    running: true,
    simTime: snapshot.simTime,
    servers: snapshot.servers,
    metrics: snapshot.metrics,
    distribution: snapshot.distribution,
    algorithmId: snapshot.activeAlgorithm,
    algorithmName: snapshot.activeAlgorithmName,
    autopilotEnabled: true,
    lastDecision: snapshot.autopilot.lastDecision,
    features: snapshot.autopilot.lastFeatures ?? null,
    chaos: snapshot.chaos,
    chaosSummary: 'none',
    runs: [],
    lastBattle: null,
    pattern: snapshot.config.pattern,
    baseRps: snapshot.config.baseRps,
  };
  const questions = [
    'Why is one server receiving fewer requests?',
    'What happens if traffic increases by 300%?',
    'Why did Autopilot switch algorithms?',
    'Is my pool healthy right now?',
    'Which algorithm should I use?',
    'What is the latency?',
    'Explain consistent hashing',
    'asdkjh random gibberish',
  ];
  for (const question of questions) {
    const answer = answerQuestion(question, ctx);
    const ok = answer.text.length > 30;
    check(`Q: ${question.slice(0, 44).padEnd(46)}`, ok, `${answer.text.length} chars`);
  }
}

/* ------------------------------------------- 10. safe Performance Lab CSV */
{
  console.log('\n10. Performance Lab CSV export handles untrusted text');
  const run: RunRecord = {
    id: 'custom-export-test',
    kind: 'custom',
    createdAt: 1_700_000_000_000,
    label: 'CSV export fixture',
    algorithm: 'custom',
    algorithmName: '=HYPERLINK("https://example.test","open")',
    pattern: 'normal',
    baseRps: 300,
    serverCount: 5,
    requests: 1_000,
    avgLatencyMs: 42,
    p95Ms: 85,
    p99Ms: 120,
    throughput: 295,
    errorRate: 0.002,
    fairness: 0.96,
    cpu: 48,
    score: 87.4,
    chaosSummary: 'note, with "quotes"\r\nsecond line',
  };
  const csv = serializeRunsCsv([run]);
  check('UTF-8 BOM and quoted header', csv.startsWith('\uFEFF"id","kind","createdAt","algorithm"'));
  check(
    'formula-like custom name is neutralized',
    csv.includes(`"'=HYPERLINK(""https://example.test"",""open"")"`),
  );
  check(
    'quotes, commas, and newlines stay in an escaped cell',
    csv.includes('"note, with ""quotes""\r\nsecond line"'),
  );
  check('CSV uses CRLF row endings', csv.endsWith('\r\n'));
}

console.log(`\n=== ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} ===\n`);
process.exit(failures === 0 ? 0 : 1);
