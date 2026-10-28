# Agent guidance — Hautomai onboarding

Monorepo (`npm` workspaces) for client onboarding automation. Read `README.md` first.

## Commands
- `npm install` — install everything (workspaces link `@hautomai/core`, `@hautomai/adapters`,
  `@hautomai/server`, `@hautomai/web`).
- `npm run build` — build order matters: core → adapters → server → web.
- `npm run typecheck` — builds core/adapters first (their `dist` is what `typecheck`-ed
  packages import), then `tsc --noEmit` across packages.
- `npm run lint`, `npm test` — ESLint (`eslint .`) and Vitest.

## Critical invariants
- `packages/*/src` is the source of truth, but **runtime and tests import the built `dist`
  of core/adapters** (workspace `main` → `dist/index.js`). After editing core/adapters you
  must rebuild them before tests/typecheck see the change: `npm run build -w @hautomai/*` or
  the root `build`/`typecheck`. Server tests import from `../src/app.js` (TS source).
- Tests use `MemoryRepository` + `memory` providers (`memoryControllables.failNext('crm'|... ,
  n)`, `resetMemorySink()`). All providers default to `memory`; the memory providers push to
  `memorySink` and the host app is never touched.
- Client config is a single encrypted blob in Postgres (`PgRepository.encryptJson/decryptJson`
  need `ENC_KEY`). `ClientConfigSchema` in `packages/core/src/config.ts` is the config axiom —
  every config route validates against it. Step ids are the literal union `StepIdEnum`.
- `StepEngine.handleEvent` refetches the client by slug and returns the post-run customer, so
  callers always see fresh `completedSteps`/`failed`. Don't let steps depend on a stale
  `client` object captured before a config update.
- Retry semantics: `retry.maxAttempts` (default 3), `retry.baseDelayMs` (1000), exponential
  via `addBackoffDelay`. A skipped step still marks the run `success` so the scheduler never
  re-fires it; only `failed` (exhausted) or `pending` runs are re-runnable.
- Schedule maths lives in `packages/core/src/timing.ts` (`computeDueAt`); business-hours mode
  rolls due dates forward to business days but does not clamp later times to 9:00.
- Webhooks use `fastify-raw-body` for a signing body; verify against `request.rawBody`.

## Conventions
- No comments in code unless asked. Named exports, TS strict, `.js` extensions in relative
  imports (ESM). ESLint: no unused vars (prefix `_`), no `any`.
- Route shapes: `buildApp(deps)` returns `{ app, system }`; add routes via
  `registerPublicRoutes` / `registerAdminRoutes` in `packages/server/src/routes/`.
- Alerts config shape is `{ provider, events: ('signup'|'failed')[] }`; the `send_team_alert`
  step only runs when a `signup` channel exists (skip otherwise).

## When done
Run the full gate and report: `npm run typecheck && npm run lint && npm run build && npm test`.