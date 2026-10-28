-- 每个改枪码聚合站最近一次抓取是否成功。和信源的 health / last_error 同一类记账，不进信源表。
CREATE TABLE IF NOT EXISTS loadout_feeds (
  id text PRIMARY KEY,
  name text NOT NULL,
  health text NOT NULL DEFAULT 'unknown',
  fail_count integer NOT NULL DEFAULT 0,
  last_ok_at timestamptz,
  last_fetch_at timestamptz,
  last_error text,
  note text
);
