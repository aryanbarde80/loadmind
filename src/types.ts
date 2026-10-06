/**
 * LoadMind — shared domain types.
 *
 * The simulation core is deliberately framework-agnostic: everything in
 * `simulation/`, `algorithms/`, `ai/`, `metrics/` operates on these plain
 * data structures so the same code can run in the browser, in a worker, or
 * in a test harness.
 */

export type AlgorithmId =
  | 'round-robin'
  | 'weighted-round-robin'
  | 'least-connections'
  | 'weighted-least-connections'
  | 'ip-hash'
  | 'random'
  | 'least-response-time'
  | 'consistent-hash'
  | 'autopilot'
  | 'custom';

export type BuiltinAlgorithmId = Exclude<AlgorithmId, 'autopilot' | 'custom'>;

export type ServerStatus = 'healthy' | 'warning' | 'down';

export type RequestOutcome = 'success' | 'error' | 'rejected' | 'dropped';

export type TrafficPattern = 'normal' | 'steady' | 'spike' | 'wave' | 'random' | 'flash-crowd';

// ---------------------------------------------------------------------------
// Servers
// ---------------------------------------------------------------------------

export interface ServerConfig {
  id: string;
  name: string;
  /** Relative share of traffic for weighted algorithms (1..10). */
  weight: number;
  /** Max concurrent in-flight connections before queueing collapses. */
  capacity: number;
  /** Service time floor in ms at zero load. */
  baseLatencyMs: number;
  /** Latency jitter (std-dev) in ms. */
  jitterMs: number;
  /** Baseline (healthy) error probability 0..1. */
  baseErrorRate: number;
  /** Relative CPU cost per unit of load (slow servers burn more CPU). */
  cpuPerRequest: number;
}

export interface ServerState extends ServerConfig {
  status: ServerStatus;
  /** Hard-down flag (killed by chaos / failure). */
  down: boolean;
  cpu: number; // 0..100
  memory: number; // 0..100
  activeConnections: number;
  /** EWMA of completed-request latency, ms. */
  ewmaLatencyMs: number;
  /** EWMA of requests per second served. */
  rps: number;
  /** EWMA of requests per second arriving (drives the queueing model). */
  offeredRps: number;
  /** Dispatches in the current step — consumed then reset by the telemetry pass. */
  arrivalsThisStep: number;
  errorRate: number; // 0..1
  utilization: number; // 0..1+
  requestsReceived: number;
  requestsSucceeded: number;
  requestsFailed: number;
  /** Extra latency injected by chaos, ms. */
  latencyPenaltyMs: number;
  /** Extra error probability injected by chaos, 0..1. */
  errorPenalty: number;
  /** CPU capacity multiplier removed by chaos (1 = full). */
  capacityFactor: number;
  /** Sim-seconds remaining until automatic recovery (chaos random failure). */
  recoveryIn: number | null;
  /** Last completed request latency, ms (for sparklines). */
  lastLatencyMs: number;
  /** Rolling latency samples used for per-server percentiles. */
  latencySamples: number[];
}

export type ServerSnapshot = Readonly<ServerState>;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export interface RequestMeta {
  id: number;
  /** Client IP — drives IP hash / consistent hashing. */
  clientIp: string;
  path: string;
  /** Arrival time in simulation seconds. */
  arrivalTime: number;
  /** Monotonic arrival index. */
  seq: number;
  /** Weight of the request (some paths are heavier). */
  cost: number;
}

export interface InFlightRequest extends RequestMeta {
  serverId: string;
  /** Decided at dispatch time so the packet can be coloured on the map. */
  outcome: RequestOutcome;
  /** Remaining service time in sim seconds. */
  remaining: number;
  /** Total expected service time (ms) — used to derive queue depth. */
  serviceMs: number;
}

export interface CompletedRequest {
  id: number;
  serverId: string;
  latencyMs: number;
  outcome: RequestOutcome;
  completedAt: number;
}

/** A visual packet travelling across the traffic map. */
export interface PacketEvent {
  id: number;
  serverId: string | null;
  outcome: RequestOutcome;
  /** Simulation timestamp when the request was dispatched. */
  t: number;
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export interface MetricsSnapshot {
  simTime: number;
  totalRequests: number;
  completed: number;
  succeeded: number;
  failed: number;
  /** Completed requests per second (EWMA + windowed). */
  throughput: number;
  /** Arrival rate per second (EWMA). */
  arrivalRate: number;
  avgLatencyMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxLatencyMs: number;
  errorRate: number;
  /** Fairness of the distribution across servers (Jain's index, 0..1). */
  fairness: number;
  /** Gini coefficient of the load distribution (0 = perfectly fair). */
  gini: number;
  /** Peak-to-mean ratio of active connections across alive servers. */
  imbalance: number;
  /** Aggregate CPU across the pool, 0..100. */
  poolCpu: number;
  /** Aggregate memory across the pool, 0..100. */
  poolMemory: number;
  /** Mean offered-load utilisation (0..1+) — distance from the queueing cliff. */
  saturation: number;
  healthyCount: number;
  warningCount: number;
  downCount: number;
}

export interface SeriesPoint {
  t: number;
  rps: number;
  arrivals: number;
  latency: number;
  p95: number;
  errors: number;
  cpu: number;
  connections: number;
}

export interface DistributionBucket {
  serverId: string;
  name: string;
  count: number;
  share: number;
  errors: number;
  latencyMs: number;
  connections: number;
  cpu: number;
  status: ServerStatus;
  weight: number;
}

// ---------------------------------------------------------------------------
// AI autopilot
// ---------------------------------------------------------------------------

export interface FeatureVector {
  simTime: number;
  arrivalRate: number;
  trafficTrendPct: number;
  spikeFactor: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  latencySpreadMs: number;
  latencySpreadPct: number;
  errorRate: number;
  poolCpu: number;
  poolMemory: number;
  connectionImbalance: number;
  distributionGini: number;
  weightHeterogeneity: number;
  ipConcentration: number;
  healthyCount: number;
  degradedCount: number;
  downCount: number;
  serverCount: number;
  capacityHeadroom: number;
  churnRate: number;
}

export interface ScoreContribution {
  label: string;
  detail: string;
  /** Signed contribution to the algorithm's score. */
  points: number;
}

export interface AlgorithmScore {
  algorithm: BuiltinAlgorithmId;
  name: string;
  score: number;
  contributions: ScoreContribution[];
}

export type DecisionStage =
  | 'monitoring'
  | 'detected'
  | 'degrading'
  | 'comparing'
  | 'recommended'
  | 'switched'
  | 'holding';

export interface DecisionFeedItem {
  id: string;
  wallClock: number;
  simTime: number;
  stage: DecisionStage;
  message: string;
  severity: 'info' | 'warn' | 'good' | 'critical';
}

export interface AutopilotDecision {
  id: string;
  wallClock: number;
  simTime: number;
  previousAlgorithm: BuiltinAlgorithmId | null;
  algorithm: BuiltinAlgorithmId;
  switched: boolean;
  confidence: number;
  headline: string;
  summary: string;
  reasons: ScoreContribution[];
  considered: AlgorithmScore[];
  features: FeatureVector;
  metrics: {
    avgLatencyMs: number;
    p95Ms: number;
    errorRate: number;
    throughput: number;
  };
}

export interface ActiveRule {
  id: string;
  label: string;
  /** 0..1 — how strongly the signal is firing. */
  strength: number;
  evidence: string;
  feature: keyof FeatureVector;
  value: number;
}

export interface AlgorithmRanking {
  ranked: AlgorithmScore[];
  winner: BuiltinAlgorithmId;
  runnerUp: BuiltinAlgorithmId | null;
  margin: number;
  confidence: number;
  activeRules: ActiveRule[];
}

export interface AutopilotRuntimeSnapshot {
  enabled: boolean;
  switches: number;
  evaluations: number;
  lastDecision: AutopilotDecision | null;
  nextEvaluationAt: number;
  lastFeatures: FeatureVector | null;
  lastEvaluation: AlgorithmRanking | null;
}

export interface EngineSnapshot {
  simTime: number;
  running: boolean;
  servers: ServerState[];
  metrics: MetricsSnapshot;
  distribution: DistributionBucket[];
  algorithm: AlgorithmId;
  activeAlgorithm: BuiltinAlgorithmId | 'custom';
  activeAlgorithmName: string;
  autopilot: AutopilotRuntimeSnapshot;
  trafficMultiplier: number;
  inFlight: number;
  chaos: ChaosState;
  config: SimulationConfig;
  feed: DecisionFeedItem[];
  decisions: AutopilotDecision[];
  seriesVersion: number;
}

// ---------------------------------------------------------------------------
// Simulation configuration
// ---------------------------------------------------------------------------

export interface SimulationConfig {
  /** Target inbound requests/sec before pattern modulation. */
  baseRps: number;
  pattern: TrafficPattern;
  serverCount: number;
  /** Length of a synthetic burst in seconds. */
  burstDurationSec: number;
  /** Multiplier applied while a burst is active. */
  burstMultiplier: number;
  /** Sim seconds per real second. */
  speed: number;
  /** Retry a different upstream once when the chosen one is down. */
  retryOnFailure: boolean;
  seed: number;
}

export interface ChaosState {
  /** Global arrival-rate multiplier from chaos. */
  trafficMultiplier: number;
  /** Per-server latency penalties (ms) keyed by server id. */
  latencyPenalties: Record<string, number>;
  /** Per-server error penalties (0..1). */
  errorPenalties: Record<string, number>;
  /** Per-server capacity reduction (0..1 fraction removed). */
  capacityReductions: Record<string, number>;
  /** Servers hard-killed by the operator. */
  killed: Record<string, boolean>;
  /** Random failure injection enabled. */
  randomFailures: boolean;
  /** Probability per second that a healthy server fails. */
  failureRatePerSec: number;
}

// ---------------------------------------------------------------------------
// Battle mode + history
// ---------------------------------------------------------------------------

export interface BattleScenario {
  name: string;
  requests: number;
  serverCount: number;
  pattern: TrafficPattern;
  baseRps: number;
  durationSec: number;
  chaos: {
    killCount: number;
    latencyPenaltyMs: number;
    errorPenalty: number;
    capacityReduction: number;
    trafficMultiplier: number;
  };
  seed: number;
}

export interface BattleResult {
  algorithm: AlgorithmId;
  name: string;
  isAutopilot: boolean;
  requests: number;
  succeeded: number;
  failed: number;
  avgLatencyMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  throughput: number;
  errorRate: number;
  /** Mean CPU across the pool. */
  cpu: number;
  /** Jain's fairness index of the distribution. */
  fairness: number;
  gini: number;
  /** Peak server utilisation. */
  maxUtilization: number;
  /** Composite score 0..100 — higher is better. */
  score: number;
  perServer: { serverId: string; name: string; count: number; share: number; latencyMs: number; errors: number }[];
  latencySeries: { t: number; latency: number; rps: number }[];
  switches?: number;
}

export interface BattleRun {
  id: string;
  createdAt: number;
  scenario: BattleScenario;
  results: BattleResult[];
  winner: AlgorithmId;
  winnerReason: string;
  durationMs: number;
}

export type RunRecordKind = 'live' | 'battle' | 'custom';

export interface RunRecord {
  id: string;
  kind: RunRecordKind;
  createdAt: number;
  label: string;
  algorithm: AlgorithmId;
  algorithmName: string;
  pattern: TrafficPattern;
  baseRps: number;
  serverCount: number;
  requests: number;
  avgLatencyMs: number;
  p95Ms: number;
  p99Ms: number;
  throughput: number;
  errorRate: number;
  fairness: number;
  cpu: number;
  score: number;
  chaosSummary: string;
}

// ---------------------------------------------------------------------------
// Custom algorithms
// ---------------------------------------------------------------------------

export interface CustomAlgorithmRecord {
  id: string;
  name: string;
  code: string;
  createdAt: number;
  updatedAt: number;
  lastResult: {
    avgLatencyMs: number;
    p95Ms: number;
    errorRate: number;
    throughput: number;
    score: number;
  } | null;
}
