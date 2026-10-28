# Hautomai client onboarding automation

Onboarding workflow automation for Hautomai clients. Replaces the n8n sticky-note spec
(`onboarding-todo.txt`) with a small npm-workspaces monorepo: a Fastify server backed by
Postgres, a provider/trigger adapter layer, a core engine that runs per-client onboarding
steps with retries, and a vanilla-TS admin UI.

No queue system, no Redis: every step is fired by the trigger that caused it (webhook,
Stripe, admin simulate, or a lightweight per-client scheduler poll over `due_at`).

## Architecture

```
packages/
  core/       StepEngine, Scheduler, config schema, timing (business hours), retries,
              repository + event types, memory repository, field/template helpers
  adapters/   ProviderFactory: crm (memory/hubspot), email (memory/smtp/gmail),
              alerts (memory/slack/email/telegram), storage (memory/disk),
              triggers (webhook parsing, stripe signature + event extraction),
              memory sink + memoryControllables for tests
  server/     Fastify 5 app: public webhook + Stripe routes, admin API, multipart
              document uploads, static admin UI, migrations on boot, scheduler loop
  web/        Vite + vanilla TS single-page admin UI (hash routing, design tokens)
```

### Onboarding steps

| Step | When | Adapters used |
| --- | --- | --- |
| `create_crm_contact` | signup (webhook/Stripe/simulate) | CRM |
| `send_team_alert` | signup | Alerts |
| `send_welcome_email` | signup | Email |
| `send_documents` | 120 min after signup (scheduler) | Storage + Email |
| `send_checkin` | 24 h after signup (scheduler) | Email |
| `send_week1` | 3 days after signup (scheduler) | Email |

Signup steps run concurrently; scheduled steps are fired by a per-client scheduler tick
that honors `delayMinutes`, `businessHoursOnly` (weekends/holidays roll forward), timezone and
per-client step config. Every step retries with exponential backoff (`retry.maxAttempts`,
`retry.baseDelayMs`); a customer that exhausts retries is flagged `failed` and a failure
alert is sent; failed steps stay re-runnable from the admin UI.

A client config can disable/override any step per step, per client — see the admin UI.

## Quick start

Requirements: Node >= 20, Docker (for Postgres).

```bash
npm install
cp .env.example .env            # then edit ENC_KEY and DATABASE_URL if needed
docker compose up -d            # Postgres 16 on localhost:5432
npm run dev                     # server :3000, admin UI :5173 (Vite proxies /admin
```

- Admin UI: http://localhost:5173 (Vite dev) or http://localhost:3000 (built bundle)
- The server runs SQL migrations on boot and then starts the scheduler loop
  (`RUN_SCHEDULER=false` to disable it).

## Usage

1. Open the admin UI and create a client (slug, e.g. `acme`).
2. **Simulate a signup**: Clients → *acme* → *Simulate signup* with a `customerName` and
   `email`. Watch the signup steps run and the row move `registered ▸ ... ▸ welcome_sent`.
3. Send documents: Documents tab → *Upload* (`step: send_documents`). On the next scheduler
   tick (or via *Run tick now*) due customers get the docs email with the attachment.
4. Inbound triggers:
   - `POST /webhook/:slug` with the spec payload
     `{ customerName, email, phone?, package?, signupDate?, source? }` (optionally
     `{ customer: {...}, steps: [...] }` with step overrides).
   - Stripe: `POST /stripe/:slug`; expects `checkout.session.completed` events. Set a
     per-client `trigger.stripe.webhookSecret` or the global `STRIPE_WEBHOOK_SECRET` for
     signature verification.
5. Real providers: put credentials either in the client config (admin UI → Client config)
   or in environment variables; providers switch on `provider`, e.g. `hubspot`, `slack`,
   `gmail`, `disk`/`s3`, with `memory` as the default no-op for evaluation.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | build core+adapters, run server + web in watch mode |
| `npm run build` | build core → adapters → server → web |
| `npm run start` | run the built server (serves `web/dist` + admin API) |
| `npm run migrate` | run DB migrations manually |
| `npm run typecheck` | build core+adapters, then `tsc --noEmit` all packages |
| `npm run lint` | ESLint over the repo |
| `npm test` | Vitest (core engine/scheduler, adapters, server integration) |

## Environment

See `.env.example` for every variable. Key ones:

- `DATABASE_URL` – Postgres connection (migrations auto-run on boot).
- `ENC_KEY` – AES-256-GCM master key used to encrypt client configs (including provider
  credentials) at rest. Required for the runtime server.
- `PORT`, `HOST` – server listen address (default 3000 / 0.0.0.0).
- `ADMIN_TOKEN` – if set, the admin API requires `Authorization: Bearer _token_`. Empty =
  AUTH PLACEHOLDER (admin open) for evaluation.
- `DOCS_DIR` – where uploaded documents are stored (disk adapter).
- `WEB_DIST` – path to the built admin UI served by the server.
- `RUN_SCHEDULER`, `SCHEDULER_INTERVAL_MS` – scheduler loop control.

## Security notes

- `ADMIN_TOKEN`, `WEBHOOK_AUTH`, per-client `webhookToken` and Stripe secrets are the
  authentication/hmac placeholders; live credentials encrypt to the DB with `ENC_KEY`.
- Production must set `ADMIN_TOKEN` and a strong `ENC_KEY`; add HTTPS/LB in front.

## Testing

Core and adapter tests use an in-memory repository and the `memory` providers plus
`memoryControllables.failNext('crm'|'email'|'alert'|'storage', n)` for fault injection.
Server tests use Fastify `inject` with `MemoryRepository`. Run everything with `npm test`.