-- Supplier images waiting to be downloaded, processed and stored locally.
CREATE TABLE IF NOT EXISTS image_queue (
  id          SERIAL PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  variant_ids INTEGER[] NOT NULL DEFAULT '{}',
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, url)
);
