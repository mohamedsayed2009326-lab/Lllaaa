CREATE TABLE IF NOT EXISTS activation_codes (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  expires_at INTEGER NOT NULL,
  device_id TEXT,
  created_at INTEGER NOT NULL,
  activated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_codes_hash ON activation_codes(code_hash);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  code_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY(code_id) REFERENCES activation_codes(id)
);
CREATE INDEX IF NOT EXISTS idx_sessions_device ON sessions(device_id);
CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint TEXT NOT NULL,
  attempted_at INTEGER NOT NULL,
  success INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_fp_time ON login_attempts(fingerprint, attempted_at);
