-- 枪名到官方物品的对照。同步任务按官方方案列表写入，列表页用它显示枪图和品质。
CREATE TABLE IF NOT EXISTS loadout_guns (
  weapon text PRIMARY KEY,
  category_key text NOT NULL,
  object_id bigint,
  pic text,
  grade integer,
  synced_at timestamptz NOT NULL DEFAULT now()
);
