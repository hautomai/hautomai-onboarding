CREATE TABLE IF NOT EXISTS clients (
  id           TEXT PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  config_enc   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customers (
  id              TEXT PRIMARY KEY,
  client_slug     TEXT NOT NULL,
  email           TEXT NOT NULL,
  payload         JSONB NOT NULL,
  status          TEXT NOT NULL,
  completed_steps JSONB NOT NULL DEFAULT '{}'::jsonb,
  failed          BOOLEAN NOT NULL DEFAULT false,
  signup_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_slug, email)
);

CREATE TABLE IF NOT EXISTS step_runs (
  id              TEXT PRIMARY KEY,
  client_slug     TEXT NOT NULL,
  customer_email  TEXT NOT NULL,
  step            TEXT NOT NULL,
  status          TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  next_attempt_at TIMESTAMPTZ,
  run_at          TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customers_client ON customers (client_slug);
CREATE INDEX IF NOT EXISTS idx_runs_client_customer ON step_runs (client_slug, customer_email);
CREATE INDEX IF NOT EXISTS idx_runs_status_due ON step_runs (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_runs_step ON step_runs (client_slug, customer_email, step);