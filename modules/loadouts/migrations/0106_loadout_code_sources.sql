-- 同一条改枪码可以出现在多个站。主行仍是一条，这里记下每一个来过的来源。
CREATE TABLE IF NOT EXISTS loadout_code_sources (
  loadout_id bigint NOT NULL REFERENCES loadout_codes (id) ON DELETE CASCADE,
  source text NOT NULL,
  source_url text,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (loadout_id, source)
);
