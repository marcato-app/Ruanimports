CREATE TABLE IF NOT EXISTS login_attempts (
  username TEXT PRIMARY KEY,
  fail_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT
);

ALTER TABLE newsletter_subscribers ADD COLUMN consent INTEGER NOT NULL DEFAULT 0;
