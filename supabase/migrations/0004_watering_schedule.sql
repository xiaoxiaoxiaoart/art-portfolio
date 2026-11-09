begin;

alter table public.plants add column watering_postponed_until timestamptz;
alter table public.events add column postponed_until timestamptz;
alter table public.events drop constraint events_type_check;
alter table public.events add constraint events_type_check
  check (type in ('water', 'fertilize', 'repot', 'prune', 'pest', 'diary', 'health', 'photo', 'postpone'));
alter table public.events add constraint events_postponed_until_check
  check ((type = 'postpone') = (postponed_until is not null));

-- 旧版会写入固定格式的日记，据此恢复原来的推迟时间。
update public.events
set type = 'postpone',
    postponed_until = date + substring(note from '^推迟浇水 ([0-9]+) 天$')::integer * interval '24 hours'
where type = 'diary' and note ~ '^推迟浇水 [1-9][0-9]{0,8} 天$';

create index events_watering_action_idx
  on public.events (plant_id, created_at desc, date desc, id desc)
  where type in ('water', 'postpone');

create function public.refresh_watering_history(p_plant_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  -- 同一株植物的刷新串行执行，避免并发记录或撤销覆盖较新的结果。
  perform id from public.plants where id = p_plant_id for no key update;
  if not found then
    return;
  end if;

  update public.plants
  set last_watered_at = (
        select max(date) from public.events where plant_id = p_plant_id and type = 'water'
      ),
      watering_postponed_until = (
        select postponed_until from public.events
        where plant_id = p_plant_id and type in ('water', 'postpone')
        order by created_at desc, date desc, id desc limit 1
      )
  where id = p_plant_id;
end;
$$;

create function public.sync_watering_history()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op <> 'INSERT' and old.type in ('water', 'postpone') then
    perform public.refresh_watering_history(old.plant_id);
  end if;
  if tg_op <> 'DELETE' and new.type in ('water', 'postpone')
     and (tg_op = 'INSERT' or old.type not in ('water', 'postpone') or old.plant_id <> new.plant_id) then
    perform public.refresh_watering_history(new.plant_id);
  end if;
  return null;
end;
$$;

create trigger sync_watering_history
after insert or delete or update on public.events
for each row execute function public.sync_watering_history();

select public.refresh_watering_history(id) from public.plants;

-- 页面与微信都从这个视图读取下次检查时间。没有周期时不提醒。
create view public.plants_with_watering_schedule with (security_invoker = true) as
select p.*,
  case when cycle.days > 0 then
    greatest(
      coalesce(p.last_watered_at + cycle.days * interval '24 hours', p.created_at),
      p.watering_postponed_until
    )
  end as watering_check_at
from public.plants p
cross join lateral (
  select case when p.dormant
    then coalesce(p.dormant_water_frequency_days, p.water_frequency_days)
    else p.water_frequency_days
  end as days
) cycle;

grant select on public.plants_with_watering_schedule to anon, authenticated;

commit;
