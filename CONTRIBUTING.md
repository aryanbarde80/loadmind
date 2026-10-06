# Contributing to LoadMind

Thanks for helping improve LoadMind. Keep changes focused, reproducible, and backed by the same real simulation the UI uses.

## Get started

- Node.js 22 or newer and npm
- `npm ci`
- `npm run dev` to launch the application

## Validate a change

Before opening a pull request, run:

```bash
npm run validate      # TypeScript, simulation/AI/render tests, production build
npm run test:browser  # Starts an isolated Vite server; runs Puppeteer E2E + visual checks
```

`npm run test:browser` saves its screenshots under `test-results/`. That directory is generated and ignored by Git; the curated portfolio images in `screenshots/` should not be overwritten by test runs. For debugging against an already-running app, `npm run e2e` and `npm run visual` use `BASE_URL` (default `http://localhost:5173`).

## Engineering guidelines

- Keep the simulation and algorithm engine independent of React, the DOM, and browser storage.
- Use the seeded random source for simulation behavior so experiments and tests remain reproducible.
- Derive telemetry from simulation state; do not replace live metrics with presentation-only constants.
- When changing algorithms, AI decisions, or simulation behavior, update the focused tests and explain the user-visible impact in the docs.
- Avoid adding credentials or requiring a backend for features that can work locally.
- Keep a commit focused on one intent. Use a short conventional prefix, for example `fix: stabilize overload routing`, `test: cover autopilot hysteresis`, or `docs: explain the queueing model`.

## Pull requests

Describe the behavior changed, note any trade-offs, and include screenshots for visible UI changes. The repository's GitHub Actions workflow runs the typecheck, smoke/render tests, production build, browser E2E suite, and visual assertions on pull requests to `main`. Dependabot proposes weekly dependency updates; those updates go through the same checks and are not auto-merged.
