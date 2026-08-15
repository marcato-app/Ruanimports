-- Product photos live in D1 rather than R2 (R2 is not enabled on this
-- account). Kept in their own table so the products list query never
-- drags image blobs along with it.
CREATE TABLE IF NOT EXISTS product_images (
  key TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  data BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
