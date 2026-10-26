CREATE TABLE IF NOT EXISTS network_measurements (
  id TEXT PRIMARY KEY,
  operator TEXT NOT NULL CHECK (operator IN ('Jio', 'Airtel', 'Vi', 'BSNL')),
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_m DOUBLE PRECISION NOT NULL CHECK (accuracy_m BETWEEN 0 AND 10000),
  measured_at TIMESTAMPTZ NOT NULL,
  latency_ms DOUBLE PRECISION NOT NULL CHECK (latency_ms BETWEEN 0 AND 600000),
  download_mbps DOUBLE PRECISION NOT NULL CHECK (download_mbps BETWEEN 0 AND 100000),
  upload_mbps DOUBLE PRECISION NOT NULL CHECK (upload_mbps BETWEEN 0 AND 100000),
  jitter_ms DOUBLE PRECISION NOT NULL CHECK (jitter_ms BETWEEN 0 AND 600000),
  probe_failure_percent DOUBLE PRECISION NOT NULL CHECK (probe_failure_percent BETWEEN 0 AND 100),
  nqs SMALLINT NOT NULL CHECK (nqs BETWEEN 0 AND 100),
  signal_dbm DOUBLE PRECISION CHECK (signal_dbm BETWEEN -200 AND 0),
  metric_availability JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS network_measurements_measured_at_idx ON network_measurements (measured_at DESC);
CREATE INDEX IF NOT EXISTS network_measurements_operator_measured_at_idx ON network_measurements (operator, measured_at DESC);
