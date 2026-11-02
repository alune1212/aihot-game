-- 自动识别到的赛季。一行是一次确认过的赛季，不回填历史码。
CREATE TABLE IF NOT EXISTS loadout_seasons (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  number integer,
  starts_on date NOT NULL,
  source text NOT NULL,
  confidence text NOT NULL,
  evidence text NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now()
);
