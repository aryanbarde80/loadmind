# LoadMind

**A load balancer that learns how your traffic behaves.**

LoadMind is a request-level load-balancing simulator and algorithm experimentation platform. Eight real
routing strategies, an explainable AI autopilot that switches between them as conditions change, a battle
mode that replays identical traffic through every algorithm, a chaos lab for breaking things on purpose, and
a playground where you can write your own scheduler in JavaScript and benchmark it against the built-ins.

LoadMind has two intentionally separate modes:

- **Simulation lab:** deterministic, request-level traffic simulation, experiments, and local history. It does not need a backend, API keys, or external telemetry.
- **Live HTTP proxy:** an optional Node.js reverse proxy that routes real requests to three local demo upstream services by default. It reports measured latency, health, and routing decisions; it does not replace the simulator.

Requires Node.js 22.12+ (Vite 8 and Puppeteer 25). The single dev command starts Vite, the proxy API, and the three demo upstreams together:

```bash
npm ci
npm run dev      # UI: http://localhost:5173 · API: http://localhost:8787
```

Choose **Live HTTP Proxy** on the welcome screen (or its globe icon in the navigation) to send an actual request. Choose **Start Simulation** to use the original browser-only lab.

---

## What is actually simulated

LoadMind does not animate random numbers. There is a discrete-time simulation engine
(`src/simulation/engine.ts`) that runs on a fixed 50 ms timestep, up to 24 steps per animation frame:

1. **Arrivals** — a Poisson process at `baseRps × patternMultiplier × chaosMultiplier`. Six traffic
   patterns (normal, steady, spike, wave, random, flash crowd) modulate the rate, plus manual bursts.
2. **Routing** — every request is handed to the active algorithm, which returns an upstream index.
3. **Service** — each server estimates a service time from an offered-load queueing model
   (`W = S / (1 − ρ)`, `L = λW`), rolls success/failure, and holds the request in flight.
4. **Completion** — latency, outcome and per-server telemetry are recorded.
5. **Telemetry** — CPU, memory, EWMA latency, error rate, utilisation and health status are recomputed
   from actual load, not from a script.
6. **AI cycle** — if the autopilot is on, features are extracted and all eight algorithms are re-scored.

Every number on screen — throughput, p95, error rate, fairness, CPU — is derived from that loop.

### The queueing model matters

Utilisation is driven by **offered load** (`λ × serviceTime ÷ slots`), not by instantaneous connection
count. Deriving ρ from concurrency instead creates a feedback loop with no fixed point above ~25 % load,
which makes healthy pools collapse for no physical reason. With the offered-load formulation the fixed
point exists whenever `λS < capacity`, so you get the real behaviour:

| Offered load | What you see |
|---|---|
| 200–600 rps (5 servers) | ~120 ms average, everything healthy |
| 1,200 rps | the smallest upstream saturates, p95 triples, load-aware algorithms pull ahead |
| 2,000+ rps | latency cliff, error rate spikes, throughput plateaus below arrivals, load shedding kicks in |

---

## The eight algorithms

All of them implement one interface — `select(servers, request, state) → index | null` — so adding a ninth
is one file plus one registry entry.

| Algorithm | Family | Selects on | Blind to |
|---|---|---|---|
| Round Robin | static | a rotating cursor | load, capacity, health |
| Weighted Round Robin | static | smooth (LVS-style) weighted credit | live conditions |
| Least Connections | dynamic | fewest active connections | latency |
| Weighted Least Connections | dynamic | fewest connections ÷ weight | latency |
| IP Hash | affinity | `fnv1a(clientIp) % N` | load; remaps on pool change |
| Random | static | weighted lottery, health-scaled | everything except health |
| Least Response Time | dynamic | `ewmaLatency × (connections + 1)` | error rate |
| Consistent Hashing | affinity | hash ring, 64 virtual nodes per weight | load |

The pool is deliberately heterogeneous (mixed instance shapes, different capacities, baseline latencies,
CPU efficiency and error floors) — with identical servers every static algorithm would perform the same and
there would be nothing to compare.

---

## AI Autopilot

`src/ai/` is a deterministic, explainable decision engine — not a black box.

1. **Feature extraction** (`ai/features.ts`) turns telemetry into ~18 signals: traffic trend, spike factor,
   latency spread, error rate, pool CPU/memory, connection imbalance, distribution Gini, weight
   heterogeneity, busiest-client share, topology churn, capacity headroom…
2. **Rule scoring** (`ai/decisionEngine.ts`) scores every algorithm from a neutral 50 using 12 weighted
   rules. Each rule contributes points *with a human-readable justification* and a 0–1 strength.
3. **Hysteresis** — the incumbent gets a +7 point bonus and a challenger must win by ≥ 6.5 points before a
   switch is committed. Without that the engine oscillates every few seconds.
4. **Explanation** — every decision carries its full scorecard: the signals that fired, the evidence string,
   the per-algorithm breakdown and the feature vector. That is what the "Why did AI choose this?" modal and
   the assistant answers are built from.

Example output:

> Traffic has increased by 42% and upstream latency differs by 180ms. Switching from Round Robin to Least
> Response Time.
>
> Evaluated 8 algorithms against 7 active signals. Least Response Time scored 98.9 versus 82.3 for Weighted
> Least Connections — a 16.6-point margin, above the 6.5-point switching threshold. Primary driver: latency
> divergence — upstreams disagree on latency, 184ms spread between the fastest and slowest.

---

## Features

| Area | What it does |
|---|---|
| **Live HTTP proxy** | Optional real Node HTTP reverse-proxy data plane, three independently listening demo upstreams, selectable routing strategy, active health checks, timeout handling, measured p50/p95 latency, and a bounded request log that omits bodies and query strings. |
| **Live traffic map** | Canvas-rendered simulated request flow: users → internet → LoadMind → pool. Every dispatched request becomes an animated packet; successful packets are cyan, failed ones red. Up to 300 particles at 60 fps; the stream is sampled above that so the canvas stays legible. |
| **Server cards** | Live CPU, memory, connections, latency, error rate, share of traffic, latency sparkline and chaos badges. Click to inspect; the canvas nodes are clickable too. |
| **Algorithm control centre** | Eight cards showing what each algorithm *would do with the next request*, using the real selection code path. A decision matrix runs all eight against the same request so you can see them disagree. |
| **Battle mode** | Replays a seeded scenario (2 000–40 000 requests) through 2–4 algorithms in a web worker. Identical traffic for everyone: same seed, same arrivals, same pool, same chaos. Winner is decided by a composite score (latency 30 %, p95 22 %, errors 24 %, throughput 12 %, fairness 6 %, efficiency 6 %). |
| **Chaos mode** | Kill/revive nodes, inject latency and errors, remove capacity, run a chaos monkey with auto-recovery, multiply traffic. Then run a "reaction test" that replays your exact damage against four algorithms. |
| **Playground** | Write `selectServer(servers, request, state)` in a syntax-highlighted editor with line numbers and tab handling. Compiled with `new Function`, smoke-tested against a synthetic pool (so errors surface at compile time), then benchmarked against Round Robin and Least Response Time, saved to localStorage and deployable to the live pool. |
| **Performance lab** | Every battle, saved live session and playground benchmark is persisted locally. Leaderboard, latency trend, side-by-side comparison of up to 4 runs, and CSV export with spreadsheet-formula protection. |
| **LoadMind AI** | A floating assistant that answers from live state: distribution skew, autopilot reasoning, capacity projections with queueing math, experiment comparison. If it has no data it says so instead of inventing an answer. |
| **Architecture view** | The full request lifecycle as clickable components, each with live stats, responsibilities and the module that implements it. |

---

## Live HTTP proxy mode

The live data plane is optional and intentionally separate from `src/simulation/`. `npm run dev` starts a Node API/reverse proxy plus three independent local HTTP upstream services; the browser sends requests to `/proxy/*` through Vite's same-origin proxy. The Live Proxy view can send GET, slow, intentional-503, and POST-echo requests and displays the selected upstream, health, actual latency, and bounded request history.

The Node routing registry implements the eight routing strategies plus deterministic, explainable Autopilot. `/api/live-proxy/status` returns live counters and p50/p95 from the most recent 500 requests; the event list retains at most 40 entries and omits request bodies and query strings. Health checks run every five seconds by default, and upstream failures are not automatically retried.

Use `LOADMIND_UPSTREAMS` to provide a JSON array of `{ "id", "url", "name?", "weight?", "healthPath?" }` services; the URL must be HTTP(S) and reachable from the Node process. See [docs/live-proxy.md](docs/live-proxy.md) for demo routes, API, authentication, configuration, and the proxy's operational limits. An OpenAPI 3.1 description is in [docs/openapi.yaml](docs/openapi.yaml).

For production controls, set a long random `LOADMIND_ADMIN_TOKEN`; algorithm changes and metric resets require `Authorization: Bearer <token>`. Without a token, these controls are loopback-only in production. The proxy is a portfolio/learning implementation, not a hardened public edge: terminate TLS at a trusted ingress and add network-level protection before exposing it.

---

## Project structure

```
src/
├── algorithms/          # one file per strategy + registry + custom sandbox
│   ├── roundRobin.ts    weightedRoundRobin.ts   leastConnections.ts
│   ├── weightedLeastConnections.ts              ipHash.ts
│   ├── random.ts        leastResponseTime.ts    consistentHash.ts
│   ├── registry.ts      # add an algorithm here and it appears everywhere
│   ├── custom.ts        # compiles + validates user code
│   └── explain.ts       # runs explain() against the live pool
├── simulation/          # framework-free engine (no React, no DOM)
│   ├── engine.ts        # fixed-timestep loop: arrivals → routing → completion
│   ├── serverModel.ts   # pool shapes, queueing model, telemetry, chaos hooks
│   ├── trafficModel.ts  # Poisson arrivals, 6 patterns, client population
│   ├── headless.ts      # battle / benchmark runner
│   ├── scenarios.ts     # battle presets
│   └── battle.worker.ts # runs battles off the main thread
├── ai/                  # decision engine
│   ├── features.ts      # signal extraction
│   ├── decisionEngine.ts# rule scoring, hysteresis, narrative
├── metrics/             # rolling percentiles, fairness, composite scoring
├── analytics/           # run history, aggregation, comparison, chat intents
├── storage/             # versioned, defensive localStorage layer
├── state/               # zustand store + engine clock
├── components/          # ui primitives, traffic map, panels, chat, landing
└── views/               # one view per navigation entry
server/                   # real-HTTP proxy, demo upstreams, routing registry, integration tests
scripts/                  # unified dev/start runners, simulation/render/browser checks
Dockerfile                # multi-stage production image
```

The simulation core has **no React, DOM or storage dependencies** — the same `SimulationEngine` powers the
live UI, the headless battle runner and the web worker.

---

## Determinism

Every run is driven by a seeded PRNG (mulberry32). Two algorithms in a battle see byte-identical arrival
streams, request costs and client IPs. That is what makes "same traffic, different scheduler" a real
experiment rather than an anecdote. Reseeding from the traffic panel generates a new pool and traffic.

---

## Tests and continuous checks

```bash
npm run validate      # typecheck, simulation/AI/SSR tests, proxy integration tests, production build
npm run test:server   # real HTTP routing, health, timeout, metrics, and operator-auth tests
npm run test:browser  # starts Vite + proxy API + 3 demo upstreams; runs Puppeteer E2E + visual checks
npm test              # simulation + AI + assistant/CSV checks and SSR render check for every view
npm run e2e           # browser flow against a running full stack (default: http://localhost:5173)
npm run visual        # DOM/canvas/proxy assertions against a running full stack
npm run build         # typecheck + production UI build
npm start             # serve built UI + API + demo upstreams on port 4173
```

`npm run test:browser` uses ports 5174 (Vite) and 8788 (API) by default; `LOADMIND_TEST_PORT` and
`LOADMIND_TEST_API_PORT` can override them. Its disposable demo upstreams bind to ports 9101–9103. Generated
screenshots go to the ignored `test-results/` directory, leaving the curated portfolio screenshots in
`screenshots/` untouched. Direct `e2e` and `visual` commands accept `BASE_URL` when testing another running
full stack. Browser tests need Puppeteer's downloaded Chrome; set `PUPPETEER_SKIP_DOWNLOAD=1` only when you
do not plan to run them.

`npm test` covers simulation dispatch/completion, all eight simulated strategies, routing distributions,
chaos degradation, Autopilot scoring and switching, battle determinism, custom-algorithm compilation,
traffic patterns, assistant answers, SSR rendering, and CSV escaping/formula protection. `npm run test:server`
exercises actual HTTP forwarding, all proxy strategies, health exclusion, timeout handling, bounded/privacy-
conscious telemetry, production operator authentication, and metric reset. Browser assertions drive real demo
requests, verify the returned 503 path and strategy change, sample the traffic-map canvas, and check responsive
overflow in both modes.

GitHub Actions audits production dependencies, runs `npm run validate` and both browser suites on pushes,
pull requests to `main`, and a weekly schedule, then uploads browser screenshots as a short-lived workflow
artifact. Dependabot proposes weekly npm and GitHub Actions updates; the updates are tested but are **not**
auto-merged.

---

## Keyboard

| Key | Action |
|---|---|
| `Space` | Run / pause the simulation |
| `⌘/Ctrl + K` | Open LoadMind AI |
| `Esc` | Close a modal |

---

## Design notes

- **Canvas for the traffic map, DOM for everything else.** At 3 000 rps the DOM would need thousands of
  animated elements per second; the canvas holds 60 fps with a few hundred draw calls.
- **React updates at ~12 Hz, the canvas at 60 fps.** The engine publishes snapshots on a throttle, and the
  canvas reads a cheap `liteStats()` (no percentiles) instead of a full snapshot each frame.
- **Bounded memory.** Percentiles come from a 1 500-sample reservoir, per-server windows hold 400 samples,
  packet and feed buffers are capped. Run it for an hour and memory stays flat.
- **Graceful degradation.** If `localStorage` is unavailable (sandboxed iframes, private mode) the app falls
  back to in-memory state; if a module worker is unavailable, battles run on the main thread.

---

## Stack

React 18 · TypeScript (strict) · Tailwind CSS 4 · Recharts 3 · Zustand · Vite 8 · Canvas 2D · Web Worker ·
localStorage. Optional service layer: Node.js 22 built-in HTTP/HTTPS modules, native Fetch health checks, a separate routing registry, and three local demo upstreams. No Express or external AI/API dependency.
