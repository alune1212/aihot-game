-- 改枪码：从已采集文章里抽出的方案，按游戏、枪种和枪名浏览。
CREATE TABLE IF NOT EXISTS loadout_codes (
  id bigserial PRIMARY KEY,
  game_id text NOT NULL,
  category_key text NOT NULL,
  weapon text NOT NULL,
  code text NOT NULL,
  mode text,
  price_text text,
  author text,
  source_url text,
  article_id text,
  noted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, code)
);
