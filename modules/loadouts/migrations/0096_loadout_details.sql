-- 一条改枪码的方案缓存：配件槽、属性 origin/change、枪图。价格不放这里，单独刷新。
CREATE TABLE IF NOT EXISTS loadout_details (
  loadout_id bigint PRIMARY KEY REFERENCES loadout_codes (id) ON DELETE CASCADE,
  source text NOT NULL,
  gun_object_id bigint,
  payload jsonb NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now()
);
