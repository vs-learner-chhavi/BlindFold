CREATE TABLE IF NOT EXISTS websites (
  id SERIAL PRIMARY KEY,
  domain TEXT UNIQUE NOT NULL,
  contact JSONB,
  first_seen TIMESTAMPTZ DEFAULT now(),
  last_seen TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS problems (
  id SERIAL PRIMARY KEY,
  fingerprint TEXT UNIQUE NOT NULL,
  website_id INT REFERENCES websites(id),
  barrier_type TEXT NOT NULL,
  title TEXT NOT NULL,
  element_role TEXT,
  element_name TEXT,
  wcag TEXT[],
  severity TEXT NOT NULL,
  fix TEXT,
  status TEXT NOT NULL DEFAULT 'reported'
    CHECK (status IN ('reported','acknowledged','fixed','verified')),
  first_reported_at TIMESTAMPTZ DEFAULT now(),
  last_reported_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS problem_users (
  problem_id INT REFERENCES problems(id) ON DELETE CASCADE,
  user_hash TEXT NOT NULL,
  first_seen TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (problem_id, user_hash)
);

CREATE TABLE IF NOT EXISTS status_history (
  id SERIAL PRIMARY KEY,
  problem_id INT REFERENCES problems(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT,
  changed_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY,
  website_id INT REFERENCES websites(id),
  verdict TEXT,
  rescued BOOLEAN,
  report JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  host TEXT,
  status TEXT,
  completed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS rescue_usage (
  user_hash TEXT NOT NULL,
  month TEXT NOT NULL,
  count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_hash, month)
);