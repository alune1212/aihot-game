-- 一把枪每个槽位上，官方方案里配件的使用次数和加权份额。任务重算，页面只读。
CREATE TABLE IF NOT EXISTS loadout_attachment_stats (
  weapon text NOT NULL,
  mode text NOT NULL,
  slot_id text NOT NULL,
  object_id bigint NOT NULL,
  name text NOT NULL,
  pic text,
  grade integer,
  uses integer NOT NULL,
  weight double precision NOT NULL,
  share double precision NOT NULL,
  filled integer NOT NULL,
  samples integer NOT NULL,
  computed_at timestamptz NOT NULL,
  PRIMARY KEY (weapon, mode, slot_id, object_id)
);
