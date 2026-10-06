import {
  getAlgorithmName,
  registerAlgorithm,
  requireAlgorithm,
  createAlgorithmStates,
} from '@/algorithms/registry';
import type { AlgorithmDefinition } from '@/algorithms/types';
import { extractFeatures } from '@/ai/features';
import { buildFeed, evaluateAlgorithms, makeDecision } from '@/ai/decisionEngine';
import { clamp, ema, pushBounded } from '@/lib/math';
import { createRng, type Rng } from '@/lib/rng';
import { MetricsCollector } from '@/metrics/collector';
import {
  applyChaosToServers,
  createServerConfigs,
  createServerStates,
  estimateService,
  updateServerTelemetry,
} from './serverModel';
import {
  advanceTraffic,
  createClientPool,
  createTrafficGenerator,
  pickRequestCost,
  triggerBurst,
  type ClientPool,
  type TrafficGenerator,
} from './trafficModel';
import type {
  AlgorithmId,
  AutopilotDecision,
  AutopilotRuntimeSnapshot as AutopilotRuntime,
  BuiltinAlgorithmId,
  ChaosState,
  DecisionFeedItem,
  EngineSnapshot,
  InFlightRequest,
  PacketEvent,
  RequestMeta,
  ServerState,
  SimulationConfig,
} from '@/types';

/** Fixed simulation timestep (sim seconds). 20 steps per simulated second. */
export const SIM_STEP = 0.05;
const MAX_STEPS_PER_ADVANCE = 24;
const PACKET_BUFFER = 900;
const FEED_LIMIT = 90;
const DECISION_LIMIT = 60;
const SERIES_INTERVAL = 0.5;
const ARRIVAL_SAMPLE_INTERVAL = 0.25;
const AUTOPILOT_INTERVAL = 1.2;
const CLIENT_WINDOW = 2;

export const DEFAULT_CONFIG: SimulationConfig = {
  baseRps: 420,
  pattern: 'normal',
  serverCount: 5,
  burstDurationSec: 4,
  burstMultiplier: 3,
  speed: 1,
  retryOnFailure: true,
  seed: 20261006,
};

export const DEFAULT_CHAOS: ChaosState = {
  trafficMultiplier: 1,
  latencyPenalties: {},
  errorPenalties: {},
  capacityReductions: {},
  killed: {},
  randomFailures: false,
  failureRatePerSec: 0.02,
};

/**
 * The LoadMind simulation engine.
 *
 * Framework-free and DOM-free: the same class drives the live UI, the headless
 * battle runner (inside a web worker) and the custom-algorithm benchmark.
 *
 * Per step it:
 *   1. generates arrivals from the traffic pattern,
 *   2. routes each request through the active algorithm,
 *   3. advances in-flight work and completes it,
 *   4. recomputes server telemetry (CPU, memory, latency, errors, health),
 *   5. (optionally) runs the AI decision engine and switches algorithm.
 */
export class SimulationEngine {
  config: SimulationConfig;
  chaos: ChaosState;
  servers: ServerState[] = [];
  algorithmId: AlgorithmId = 'round-robin';
  autopilot: AutopilotRuntime = {
    enabled: false,
    switches: 0,
    evaluations: 0,
    lastDecision: null,
    nextEvaluationAt: 0,
    lastFeatures: null,
    lastEvaluation: null,
  };
  customDefinition: AlgorithmDefinition | null = null;
  metrics = new MetricsCollector();
  running = false;
  simTime = 0;

  private rng: Rng;
  private serverRng: Rng;
  private traffic: TrafficGenerator;
  private clients: ClientPool;
  private inFlight: InFlightRequest[] = [];
  private algorithmStates = createAlgorithmStates();
  private packets: PacketEvent[] = [];
  private packetSeq = 0;
  private requestSeq = 0;
  private accumulator = 0;
  private lastSeriesAt = -1;
  private lastArrivalSampleAt = -1;
  private arrivalHistory: number[] = [];
  private clientCounts = new Map<string, number>();
  private hotClientShare = 0;
  private statusChangeTimes: number[] = [];
  private previousStatuses = new Map<string, string>();
  private pendingFeed: { at: number; item: Omit<DecisionFeedItem, 'id' | 'wallClock'> }[] = [];
  private feed: DecisionFeedItem[] = [];
  private decisions: AutopilotDecision[] = [];
  private seriesVersion = 0;
  private feedCounter = 0;
  private listeners = new Set<(snapshot: EngineSnapshot) => void>();
  private notifyScheduled = false;
  private lastNotifyAt = 0;

  constructor(config: Partial<SimulationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.chaos = { ...DEFAULT_CHAOS, latencyPenalties: {}, errorPenalties: {}, capacityReductions: {}, killed: {} };
    this.rng = createRng(this.config.seed);
    this.serverRng = createRng(this.config.seed ^ 0x9e3779b9);
    this.traffic = createTrafficGenerator(this.config.pattern, createRng(this.config.seed ^ 0x51ed270b));
    this.clients = createClientPool(48, createRng(this.config.seed ^ 0x2545f491));
    this.buildPool();
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  private buildPool(): void {
    const configs = createServerConfigs(this.config.serverCount, this.serverRng);
    this.servers = createServerStates(configs, this.serverRng);
    for (const server of this.servers) this.previousStatuses.set(server.id, server.status);
    this.inFlight = [];
    this.algorithmStates = createAlgorithmStates();
  }

  reset(opts: { keepChaos?: boolean } = {}): void {
    this.simTime = 0;
    this.metrics.reset();
    this.rng = createRng(this.config.seed);
    this.serverRng = createRng(this.config.seed ^ 0x9e3779b9);
    this.traffic = createTrafficGenerator(this.config.pattern, createRng(this.config.seed ^ 0x51ed270b));
    this.clients = createClientPool(48, createRng(this.config.seed ^ 0x2545f491));
    if (!opts.keepChaos) {
      this.chaos = { ...DEFAULT_CHAOS, latencyPenalties: {}, errorPenalties: {}, capacityReductions: {}, killed: {} };
    }
    this.feed = [];
    this.decisions = [];
    this.pendingFeed = [];
    this.packets = [];
    this.arrivalHistory = [];
    this.clientCounts.clear();
    this.statusChangeTimes = [];
    this.autopilot.switches = 0;
    this.autopilot.evaluations = 0;
    this.autopilot.lastDecision = null;
    this.autopilot.nextEvaluationAt = 0;
    this.accumulator = 0;
    this.lastSeriesAt = -1;
    this.lastArrivalSampleAt = -1;
    this.seriesVersion += 1;
    this.buildPool();
    this.notify(true);
  }

  setConfig(patch: Partial<SimulationConfig>): void {
    const next = { ...this.config, ...patch };
    const poolChanged = next.serverCount !== this.config.serverCount;
    const seedChanged = next.seed !== this.config.seed;
    const patternChanged = next.pattern !== this.config.pattern;
    this.config = next;
    if (seedChanged) {
      this.reset({ keepChaos: true });
      return;
    }
    if (poolChanged) this.resizePool(next.serverCount);
    if (patternChanged) this.traffic.pattern = next.pattern;
    this.notify(true);
  }

  private resizePool(count: number): void {
    if (count === this.servers.length) return;
    if (count > this.servers.length) {
      const configs = createServerConfigs(count, this.serverRng);
      const existing = this.servers.length;
      const states = createServerStates(configs.slice(existing), this.serverRng);
      this.servers = [...this.servers, ...states];
    } else {
      this.servers = this.servers.slice(0, count);
      // Re-route in-flight work that belonged to removed upstreams.
      this.inFlight = this.inFlight.filter((r) => this.servers.some((s) => s.id === r.serverId));
    }
    this.algorithmStates = createAlgorithmStates();
  }

  setChaos(patch: Partial<ChaosState>): void {
    this.chaos = { ...this.chaos, ...patch };
    this.notify(true);
  }

  setTrafficMultiplier(multiplier: number): void {
    this.chaos = { ...this.chaos, trafficMultiplier: clamp(multiplier, 0.1, 12) };
    this.notify(true);
  }

  killServer(id: string, killed = true): void {
    this.chaos = { ...this.chaos, killed: { ...this.chaos.killed, [id]: killed } };
    this.pushFeed({
      simTime: this.simTime,
      stage: 'detected',
      message: `${this.servers.find((s) => s.id === id)?.name ?? id} ${killed ? 'was taken offline by chaos' : 'was returned to the pool'}`,
      severity: killed ? 'critical' : 'good',
    });
    this.notify(true);
  }

  addLatency(id: string, deltaMs: number): void {
    const current = this.chaos.latencyPenalties[id] ?? 0;
    this.chaos = {
      ...this.chaos,
      latencyPenalties: { ...this.chaos.latencyPenalties, [id]: Math.max(0, current + deltaMs) },
    };
    this.notify(true);
  }

  addErrorRate(id: string, delta: number): void {
    const current = this.chaos.errorPenalties[id] ?? 0;
    this.chaos = {
      ...this.chaos,
      errorPenalties: { ...this.chaos.errorPenalties, [id]: clamp(current + delta, 0, 0.9) },
    };
    this.notify(true);
  }

  reduceCapacity(id: string, fraction: number): void {
    const current = this.chaos.capacityReductions[id] ?? 0;
    this.chaos = {
      ...this.chaos,
      capacityReductions: { ...this.chaos.capacityReductions, [id]: clamp(current + fraction, 0, 0.9) },
    };
    this.notify(true);
  }

  clearServerChaos(id: string): void {
    const latencyPenalties = { ...this.chaos.latencyPenalties };
    const errorPenalties = { ...this.chaos.errorPenalties };
    const capacityReductions = { ...this.chaos.capacityReductions };
    delete latencyPenalties[id];
    delete errorPenalties[id];
    delete capacityReductions[id];
    this.chaos = { ...this.chaos, latencyPenalties, errorPenalties, capacityReductions };
    this.notify(true);
  }

  clearAllChaos(): void {
    this.chaos = { ...DEFAULT_CHAOS, latencyPenalties: {}, errorPenalties: {}, capacityReductions: {}, killed: {} };
    this.pushFeed({
      simTime: this.simTime,
      stage: 'monitoring',
      message: 'Chaos cleared — pool restored to nominal conditions',
      severity: 'good',
    });
    this.notify(true);
  }

  triggerBurst(multiplier = this.config.burstMultiplier, durationSec = this.config.burstDurationSec): void {
    triggerBurst(this.traffic, multiplier, durationSec);
    this.pushFeed({
      simTime: this.simTime,
      stage: 'detected',
      message: `Manual burst injected: ${multiplier.toFixed(1)}× traffic for ${durationSec.toFixed(0)}s`,
      severity: 'warn',
    });
    this.notify(true);
  }

  // -------------------------------------------------------------------------
  // Algorithm control
  // -------------------------------------------------------------------------

  setAlgorithm(id: AlgorithmId): void {
    if (id === 'autopilot') {
      this.setAutopilot(true);
      return;
    }
    this.autopilot.enabled = false;
    this.algorithmId = id;
    if (id !== 'custom' && !this.autopilot.enabled) {
      this.pushFeed({
        simTime: this.simTime,
        stage: 'switched',
        message: `Manual override — algorithm set to ${getAlgorithmName(id)} (AI autopilot disabled)`,
        severity: 'info',
      });
    }
    this.notify(true);
  }

  setAutopilot(enabled: boolean, opts: { silent?: boolean } = {}): void {
    if (enabled === this.autopilot.enabled) return;
    this.autopilot.enabled = enabled;
    this.algorithmId = enabled ? 'autopilot' : (this.autopilot.lastDecision?.algorithm ?? 'least-response-time');
    if (enabled) {
      this.autopilot.nextEvaluationAt = this.simTime;
      if (!opts.silent) {
        this.pushFeed({
          simTime: this.simTime,
          stage: 'monitoring',
          message: 'AI Autopilot engaged — continuously scoring every algorithm against live telemetry',
          severity: 'good',
        });
      }
    } else if (!opts.silent) {
      this.pushFeed({
        simTime: this.simTime,
        stage: 'monitoring',
        message: `AI Autopilot disengaged — holding ${getAlgorithmName(this.algorithmId)}`,
        severity: 'info',
      });
    }
    this.notify(true);
  }

  setCustomAlgorithm(definition: AlgorithmDefinition | null): void {
    this.customDefinition = definition;
    if (definition) {
      // Registered into the shared registry so battle mode, the metrics
      // pipeline and the assistant can all resolve it like a built-in.
      registerAlgorithm(definition);
      this.algorithmStates.set(definition.id, definition.createState());
      this.algorithmId = definition.id as AlgorithmId;
      this.autopilot.enabled = false;
    }
    this.notify(true);
  }

  get activeAlgorithmId(): BuiltinAlgorithmId | 'custom' {
    if (this.algorithmId === 'custom') return 'custom';
    if (this.customDefinition && this.algorithmId === this.customDefinition.id) return 'custom';
    if (this.algorithmId === 'autopilot') {
      return this.autopilot.lastDecision?.algorithm ?? 'round-robin';
    }
    return this.algorithmId as BuiltinAlgorithmId;
  }

  private resolveDefinition(): AlgorithmDefinition | null {
    const id = this.activeAlgorithmId;
    if (id === 'custom') return this.customDefinition;
    try {
      return requireAlgorithm(id);
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Stepping
  // -------------------------------------------------------------------------

  /** Advance by real elapsed seconds (scaled by the configured sim speed). */
  advance(realSeconds: number): void {
    if (!this.running) return;
    this.accumulator += realSeconds * this.config.speed;
    let steps = 0;
    while (this.accumulator >= SIM_STEP && steps < MAX_STEPS_PER_ADVANCE) {
      this.accumulator -= SIM_STEP;
      this.step(SIM_STEP);
      steps += 1;
    }
    if (steps >= MAX_STEPS_PER_ADVANCE) this.accumulator = 0;
    if (steps > 0) this.notify();
  }

  /** One fixed simulation step. Also used directly by the headless runner. */
  step(dt: number): void {
    this.simTime += dt;

    // 1. Traffic generation -------------------------------------------------
    const patternMultiplier = advanceTraffic(this.traffic, this.simTime, dt, this.rng);
    const targetRps = this.config.baseRps * patternMultiplier * this.chaos.trafficMultiplier;
    const arrivals = this.rng.poisson(targetRps * dt);
    for (let i = 0; i < arrivals; i++) this.dispatchRequest();

    // 2. Chaos + server telemetry -------------------------------------------
    applyChaosToServers(this.servers, this.chaos, dt, this.rng);
    for (const server of this.servers) updateServerTelemetry(server, dt, this.rng, this.simTime);
    this.trackStatusChurn();

    // 3. Advance in-flight work ---------------------------------------------
    this.advanceInFlight(dt);

    // 4. Sampling -------------------------------------------------------------
    if (this.simTime - this.lastArrivalSampleAt >= ARRIVAL_SAMPLE_INTERVAL) {
      this.lastArrivalSampleAt = this.simTime;
      pushBounded(this.arrivalHistory, this.metrics.arrivalRate(this.simTime), 64);
    }
    if (this.simTime - this.lastSeriesAt >= SERIES_INTERVAL) {
      this.lastSeriesAt = this.simTime;
      const snapshot = this.metrics.snapshot(this.servers, this.simTime);
      this.metrics.pushSeries({
        t: this.simTime,
        rps: snapshot.throughput,
        arrivals: snapshot.arrivalRate,
        latency: snapshot.avgLatencyMs,
        p95: snapshot.p95Ms,
        errors: snapshot.errorRate * 100,
        cpu: snapshot.poolCpu,
        connections: this.servers.reduce((a, s) => a + s.activeConnections, 0),
      });
      this.seriesVersion += 1;
    }

    // 5. AI autopilot ---------------------------------------------------------
    if (this.autopilot.enabled && this.simTime >= this.autopilot.nextEvaluationAt) {
      this.runAutopilotCycle();
      this.autopilot.nextEvaluationAt = this.simTime + AUTOPILOT_INTERVAL;
    }

    // 6. Release staged feed messages -----------------------------------------
    this.flushPendingFeed();
  }

  private dispatchRequest(): void {
    this.requestSeq += 1;
    const clientIndex = this.rng.weightedPick(
      this.clients.ips.map((_, i) => i),
      this.clients.weights,
    );
    const clientIp = this.clients.ips[clientIndex];
    const { path, cost } = pickRequestCost(this.rng);
    const request: RequestMeta = {
      id: this.requestSeq,
      clientIp,
      path,
      cost,
      seq: this.requestSeq,
      arrivalTime: this.simTime,
    };

    this.metrics.recordArrival(this.simTime);
    this.trackClient(clientIp);

    const definition = this.resolveDefinition();
    const candidates = this.candidateIndexes();
    if (!definition || candidates.length === 0) {
      this.metrics.recordDispatch(null);
      this.emitPacket(null, 'rejected', 0);
      // No upstream available — the request is rejected at the edge.
      this.metrics.recordCompletion('', 0, 'rejected', this.simTime);
      return;
    }

    const state = this.algorithmStates.get(definition.id) ?? {};
    this.algorithmStates.set(definition.id, state);

    let index: number | null = null;
    try {
      index = definition.select({
        servers: this.servers,
        candidates,
        request,
        state,
        rng: this.rng,
      });
    } catch {
      index = null;
    }

    if (index === null || index < 0 || index >= this.servers.length || this.servers[index].down) {
      if (this.config.retryOnFailure && candidates.length > 0) {
        // Failover: fall back to the least-loaded live upstream.
        index = candidates.reduce((best, i) =>
          this.servers[i].activeConnections < this.servers[best].activeConnections ? i : best,
        );
      } else {
        this.metrics.recordDispatch(null);
        this.emitPacket(null, 'dropped', 0);
        this.metrics.recordCompletion('', 0, 'dropped', this.simTime);
        return;
      }
    }

    const server = this.servers[index];

    // Load shedding: past a deep queue the balancer returns 503 rather than
    // letting the backlog grow without bound (real LBs cap queue depth).
    const slots = Math.max(4, server.capacity * server.capacityFactor);
    if (server.activeConnections > slots * 10) {
      this.metrics.recordDispatch(null);
      this.emitPacket(null, 'dropped', 0);
      this.metrics.recordCompletion('', 0, 'dropped', this.simTime);
      return;
    }

    const { serviceMs, errorProbability } = estimateService(server, request.cost, this.rng);
    const willFail = this.rng.bool(errorProbability);

    server.requestsReceived += 1;
    server.arrivalsThisStep += 1;
    server.activeConnections += 1;
    server.utilization = server.activeConnections / Math.max(4, server.capacity * server.capacityFactor);

    this.metrics.recordDispatch(server.id);
    this.inFlight.push({
      ...request,
      serverId: server.id,
      remaining: serviceMs / 1000,
      serviceMs,
      // Outcome is decided up-front so the traffic map can colour the packet
      // the moment it leaves the balancer, and so latency and errors stay
      // consistent with what the operator sees on screen.
      outcome: willFail ? 'error' : 'success',
    });

    this.emitPacket(server.id, willFail ? 'error' : 'success', serviceMs);
  }

  private advanceInFlight(dt: number): void {
    const completedThisStep = new Map<string, number>();
    for (let i = this.inFlight.length - 1; i >= 0; i--) {
      const req = this.inFlight[i];
      req.remaining -= dt;
      if (req.remaining > 0) continue;

      const server = this.servers.find((s) => s.id === req.serverId);
      const outcome = req.outcome;
      if (server) {
        server.activeConnections = Math.max(0, server.activeConnections - 1);
        server.lastLatencyMs = req.serviceMs;
        server.ewmaLatencyMs = ema(server.ewmaLatencyMs, req.serviceMs, 0.12);
        pushBounded(server.latencySamples, req.serviceMs, 120);
        if (outcome === 'success') server.requestsSucceeded += 1;
        else server.requestsFailed += 1;
        completedThisStep.set(server.id, (completedThisStep.get(server.id) ?? 0) + 1);
      }
      this.metrics.recordCompletion(req.serverId, req.serviceMs, outcome, this.simTime);
      this.inFlight.splice(i, 1);
    }

    for (const server of this.servers) {
      const completed = completedThisStep.get(server.id) ?? 0;
      const instantRps = completed / SIM_STEP;
      server.rps = ema(server.rps, instantRps, 0.18);
    }
  }

  private candidateIndexes(): number[] {
    const indexes: number[] = [];
    for (let i = 0; i < this.servers.length; i++) if (!this.servers[i].down) indexes.push(i);
    return indexes;
  }

  private trackClient(ip: string): void {
    this.clientCounts.set(ip, (this.clientCounts.get(ip) ?? 0) + 1);
    if (this.simTime > 0 && Math.floor(this.simTime / CLIENT_WINDOW) !== Math.floor((this.simTime - SIM_STEP) / CLIENT_WINDOW)) {
      let total = 0;
      let max = 0;
      for (const count of this.clientCounts.values()) {
        total += count;
        if (count > max) max = count;
      }
      this.hotClientShare = total > 0 ? max / total : 0;
      this.clientCounts.clear();
    }
  }

  private trackStatusChurn(): void {
    for (const server of this.servers) {
      const previous = this.previousStatuses.get(server.id);
      if (previous !== server.status) {
        this.previousStatuses.set(server.id, server.status);
        this.statusChangeTimes.push(this.simTime);
      }
    }
    const cutoff = this.simTime - 10;
    while (this.statusChangeTimes.length && this.statusChangeTimes[0] < cutoff) {
      this.statusChangeTimes.shift();
    }
  }

  // -------------------------------------------------------------------------
  // AI autopilot
  // -------------------------------------------------------------------------

  private runAutopilotCycle(): void {
    const metrics = this.metrics.snapshot(this.servers, this.simTime);
    const distribution = this.metrics.distribution(this.servers);
    const features = extractFeatures({
      simTime: this.simTime,
      servers: this.servers,
      metrics,
      distribution,
      arrivalHistory: this.arrivalHistory,
      hotClientShare: this.hotClientShare,
      statusChurn: this.statusChangeTimes.length,
    });
    const current = this.activeAlgorithmId === 'custom' ? null : (this.activeAlgorithmId as BuiltinAlgorithmId);
    const evaluation = evaluateAlgorithms(features, current);
    const force = this.autopilot.lastDecision === null;
    const decision = makeDecision({
      features,
      currentAlgorithm: current,
      simTime: this.simTime,
      metrics: {
        avgLatencyMs: metrics.avgLatencyMs,
        p95Ms: metrics.p95Ms,
        errorRate: metrics.errorRate,
        throughput: metrics.throughput,
      },
      force,
    });

    this.autopilot.evaluations += 1;
    this.autopilot.lastFeatures = features;
    this.autopilot.lastEvaluation = evaluation;

    if (decision.switched) {
      this.autopilot.switches += 1;
      this.algorithmId = 'autopilot';
    }
    this.autopilot.lastDecision = decision;
    pushBounded(this.decisions, decision, DECISION_LIMIT);

    // Only spam-free decisions reach the feed: emit when something changed or
    // every ~6 sim seconds so the operator sees continuous monitoring.
    const shouldAnnounce =
      decision.switched ||
      force ||
      this.feed.length === 0 ||
      this.simTime - (this.feed[this.feed.length - 1]?.simTime ?? 0) > 6;

    if (shouldAnnounce) {
      const items = buildFeed(decision, evaluation);
      const offsets = [0, 260, 620, 1000, 1400, 1750];
      items.forEach((item, i) => {
        this.pendingFeed.push({ at: Date.now() + (offsets[i] ?? 1400), item });
      });
    }
  }

  private flushPendingFeed(): void {
    if (this.pendingFeed.length === 0) return;
    const now = Date.now();
    const due = this.pendingFeed.filter((entry) => entry.at <= now);
    if (due.length === 0) return;
    this.pendingFeed = this.pendingFeed.filter((entry) => entry.at > now);
    for (const entry of due) {
      this.feedCounter += 1;
      pushBounded(this.feed, { ...entry.item, id: `feed-${this.feedCounter}`, wallClock: now }, FEED_LIMIT);
    }
  }

  pushFeed(item: Omit<DecisionFeedItem, 'id' | 'wallClock'>): void {
    this.feedCounter += 1;
    pushBounded(this.feed, { ...item, id: `feed-${this.feedCounter}`, wallClock: Date.now() }, FEED_LIMIT);
  }

  // -------------------------------------------------------------------------
  // Output
  // -------------------------------------------------------------------------

  private emitPacket(serverId: string | null, outcome: PacketEvent['outcome'], latencyMs: number): void {
    this.packetSeq += 1;
    pushBounded(
      this.packets,
      { id: this.packetSeq, serverId, outcome, t: this.simTime, latencyMs },
      PACKET_BUFFER,
    );
  }

  /** Consume packets emitted since the last call (traffic-map animation). */
  drainPackets(sinceId = 0): { packets: PacketEvent[]; lastId: number } {
    const fresh = this.packets.filter((p) => p.id > sinceId);
    const lastId = this.packets.length ? this.packets[this.packets.length - 1].id : sinceId;
    return { packets: fresh, lastId };
  }

  snapshot(): EngineSnapshot {
    const active = this.activeAlgorithmId;
    return {
      simTime: this.simTime,
      running: this.running,
      servers: this.servers,
      metrics: this.metrics.snapshot(this.servers, this.simTime),
      distribution: this.metrics.distribution(this.servers),
      algorithm: this.algorithmId,
      activeAlgorithm: active,
      activeAlgorithmName: active === 'custom' ? this.customDefinition?.name ?? 'Custom' : getAlgorithmName(active),
      autopilot: this.autopilot,
      trafficMultiplier: this.traffic.multiplier * this.chaos.trafficMultiplier,
      inFlight: this.inFlight.length,
      chaos: this.chaos,
      config: this.config,
      feed: this.feed,
      decisions: this.decisions,
      seriesVersion: this.seriesVersion,
    };
  }

  getSeries() {
    return this.metrics.series;
  }

  start(): void {
    this.running = true;
    this.notify(true);
  }

  pause(): void {
    this.running = false;
    this.notify(true);
  }

  subscribe(listener: (snapshot: EngineSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Publish a snapshot to React. Steady-state ticks are throttled to ~12Hz so
   * the UI stays smooth, while operator actions publish immediately.
   */
  private notify(force = false): void {
    if (this.notifyScheduled) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!force && now - this.lastNotifyAt < 80) return;
    this.lastNotifyAt = now;
    this.notifyScheduled = true;
    queueMicrotask(() => {
      this.notifyScheduled = false;
      const snapshot = this.snapshot();
      for (const listener of this.listeners) listener(snapshot);
    });
  }

  /**
   * Cheap per-frame read for the canvas: no percentiles, no distribution —
   * just throughput, the active algorithm and the autopilot flag.
   */
  liteStats(): { throughput: number; algorithm: string; autopilot: boolean; simTime: number } {
    return {
      throughput: this.metrics.throughput(this.simTime),
      algorithm: this.activeAlgorithmId === 'custom'
        ? this.customDefinition?.name ?? 'Custom'
        : getAlgorithmName(this.activeAlgorithmId),
      autopilot: this.autopilot.enabled,
      simTime: this.simTime,
    };
  }
}
