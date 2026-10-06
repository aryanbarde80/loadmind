# LoadMind

**A load balancer that learns how your traffic behaves.**

LoadMind is a request-level load-balancing simulator and algorithm experimentation platform. Eight real
routing strategies, an explainable AI autopilot that switches between them as conditions change, a battle
mode that replays identical traffic through every algorithm, a chaos lab for breaking things on purpose, and
a playground where you can write your own scheduler in JavaScript and benchmark it against the built-ins.

Everything runs in the browser. No backend, no API keys, no telemetry — the simulation, the decision engine
and the history store are all local.

```bash
npm install
npm run dev      # http://localhost:5173
```

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
| **Live traffic map** | Canvas-rendered request flow: users → internet → LoadMind → pool. Every dispatched request becomes an animated packet; successful packets are cyan, failed ones red. Up to 300 particles at 60 fps; the stream is sampled above that so the canvas stays legible. |
| **Server cards** | Live CPU, memory, connections, latency, error rate, share of traffic, latency sparkline and chaos badges. Click to inspect; the canvas nodes are clickable too. |
| **Algorithm control centre** | Eight cards showing what each algorithm *would do with the next request*, using the real selection code path. A decision matrix runs all eight against the same request so you can see them disagree. |
| **Battle mode** | Replays a seeded scenario (2 000–40 000 requests) through 2–4 algorithms in a web worker. Identical traffic for everyone: same seed, same arrivals, same pool, same chaos. Winner is decided by a composite score (latency 30 %, p95 22 %, errors 24 %, throughput 12 %, fairness 6 %, efficiency 6 %). |
| **Chaos mode** | Kill/revive nodes, inject latency and errors, remove capacity, run a chaos monkey with auto-recovery, multiply traffic. Then run a "reaction test" that replays your exact damage against four algorithms. |
| **Playground** | Write `selectServer(servers, request, state)` in a syntax-highlighted editor with line numbers and tab handling. Compiled with `new Function`, smoke-tested against a synthetic pool (so errors surface at compile time), then benchmarked against Round Robin and Least Response Time, saved to localStorage and deployable to the live pool. |
| **Performance lab** | Every battle, saved live session and playground benchmark is persisted locally. Leaderboard, latency trend, side-by-side comparison of up to 4 runs, CSV export. |
| **LoadMind AI** | A floating assistant that answers from live state: distribution skew, autopilot reasoning, capacity projections with queueing math, experiment comparison. If it has no data it says so instead of inventing an answer. |
| **Architecture view** | The full request lifecycle as clickable components, each with live stats, responsibilities and the module that implements it. |

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
```

The simulation core has **no React, DOM or storage dependencies** — the same `SimulationEngine` powers the
live UI, the headless battle runner and the web worker.

---

## Determinism

Every run is driven by a seeded PRNG (mulberry32). Two algorithms in a battle see byte-identical arrival
streams, request costs and client IPs. That is what makes "same traffic, different scheduler" a real
experiment rather than an anecdote. Reseeding from the traffic panel generates a new pool and traffic.

---

## Tests

```bash
npm test        # simulation + AI + assistant logic, and SSR render check for every view
npm run e2e     # Puppeteer: boots the app, exercises every view, runs a battle, screenshots
npm run visual  # DOM/canvas assertions: canvas paints, no layout overflow, numbers update
npm run build   # typecheck + production build
```

`npm test` and `npm run build` need no browser. The two Puppeteer suites download Chrome on install — skip it
with `PUPPETEER_SKIP_DOWNLOAD=1 npm install` if you only want the app.

`npm test` covers: request dispatch and completion, all eight algorithms routing, algorithms producing
measurably different distributions, chaos degrading the pool, the autopilot scoring and switching, battle
determinism, custom-algorithm compilation (including rejection of broken code), traffic-pattern behaviour,
and the assistant's answers. `npm run visual` reads canvas pixels to confirm the traffic map is actually
drawing, and checks four viewport widths for horizontal overflow.

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

React 18 · TypeScript (strict) · Tailwind CSS · Recharts · Zustand · Vite · Canvas 2D · Web Worker ·
localStorage. No backend.
