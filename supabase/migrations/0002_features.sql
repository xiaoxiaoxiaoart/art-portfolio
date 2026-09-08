-- 新增功能：休眠、推迟浇水、照片时间线
-- 在 Supabase SQL Editor 执行本文件（在 0001 之后）

-- plants 加休眠字段
alter table public.plants
  add column if not exists dormant boolean not null default false,
  add column if not exists dormant_water_frequency_days integer;

-- events.type 加 photo（照片时间线）
alter table public.events drop constraint if exists events_type_check;
alter table public.events add constraint events_type_check
  check (type in ('water', 'fertilize', 'repot', 'prune', 'pest', 'diary', 'health', 'photo'));
