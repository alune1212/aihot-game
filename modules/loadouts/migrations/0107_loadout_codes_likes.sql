-- 官方方案列表上的点赞数。没有的来源留空，不回填。
ALTER TABLE loadout_codes ADD COLUMN likes integer;
