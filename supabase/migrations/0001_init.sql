-- 植物养护：建表 + RLS + Storage 桶
-- 在 Supabase SQL Editor 中执行，或通过 supabase db push 应用

-- 植物档案表
create table if not exists public.plants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  species text,
  photo_url text,
  location text,
  status text not null default 'healthy' check (status in ('healthy', 'attention', 'sick')),
  light text,
  water_frequency_days integer,
  temp_range text,
  humidity text,
  fertilizer_notes text,
  notes text,
  acquired_date date,
  last_watered_at timestamptz,
  last_fertilized_at timestamptz,
  created_at timestamptz not null default now()
);

-- 养护事件表（浇水/施肥/换盆/修剪/病虫害/日记/健康变化 统一用 type 区分）
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  plant_id uuid not null references public.plants(id) on delete cascade,
  type text not null check (type in ('water', 'fertilize', 'repot', 'prune', 'pest', 'diary', 'health')),
  date timestamptz not null default now(),
  note text,
  photo_url text,
  created_at timestamptz not null default now()
);

create index if not exists events_plant_id_date_idx on public.events(plant_id, date desc);

-- RLS：anon 角色可读写（等价公开，保护靠私密 URL）
alter table public.plants enable row level security;
alter table public.events enable row level security;

create policy "anon_read_plants"  on public.plants  for select using (true);
create policy "anon_insert_plants" on public.plants  for insert with check (true);
create policy "anon_update_plants" on public.plants  for update using (true);
create policy "anon_delete_plants" on public.plants  for delete using (true);

create policy "anon_read_events"   on public.events for select using (true);
create policy "anon_insert_events" on public.events for insert with check (true);
create policy "anon_update_events" on public.events for update using (true);
create policy "anon_delete_events" on public.events for delete using (true);

-- 图片存储桶（公开读，便于 <img> 直接加载）
insert into storage.buckets (id, name, public)
values ('plant-photos', 'plant-photos', true)
on conflict (id) do nothing;

-- Storage 桶的公开读写策略（匿名上传/读取照片）
create policy "anon_read_photos" on storage.objects
  for select using (bucket_id = 'plant-photos');
create policy "anon_insert_photos" on storage.objects
  for insert with check (bucket_id = 'plant-photos');
