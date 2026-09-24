-- 区块分类：给植物加「位置区块」和「类型」两个维度
-- 在 Supabase SQL Editor 执行本文件（在 0002 之后）

alter table public.plants
  add column if not exists zone text,
  add column if not exists category text;
