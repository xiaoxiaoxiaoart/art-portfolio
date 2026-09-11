// 浇水提醒：定时汇总"该浇水的植物"，通过 Server 酱推送到微信
// 环境变量：SUPABASE_URL / SUPABASE_ANON_KEY 由 Supabase 自动注入；SENDKEY 需手动设置
import { createClient } from 'npm:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_ANON_KEY') ?? '',
);

interface PlantRow {
  id: string;
  name: string;
  last_watered_at: string | null;
  water_frequency_days: number | null;
  dormant: boolean;
  dormant_water_frequency_days: number | null;
}

function needsWatering(p: PlantRow): boolean {
  const freq = p.dormant
    ? p.dormant_water_frequency_days ?? p.water_frequency_days
    : p.water_frequency_days;
  if (!freq) return false;
  // 设置了周期但从未浇水，视为"该浇水"
  if (!p.last_watered_at) return true;
  const due =
    new Date(p.last_watered_at).getTime() + freq * 86400000;
  return Date.now() >= due;
}

Deno.serve(async () => {
  const sendKey = Deno.env.get('SENDKEY');
  if (!sendKey) {
    return new Response(JSON.stringify({ error: 'SENDKEY 未设置' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { data: plants, error } = await supabase
    .from('plants')
    .select('id, name, last_watered_at, water_frequency_days, dormant, dormant_water_frequency_days');

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const due = (plants ?? []).filter(needsWatering);

  // 没有需要浇水的植物就不推送，避免每天打扰
  if (due.length === 0) {
    return new Response(
      JSON.stringify({ skipped: true, message: '没有需要浇水的植物' }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  }

  const title = `🌱 ${due.length} 株植物该浇水了`;
  const desp = due.map((p) => `- ${p.name}`).join('\n');

  const resp = await fetch(`https://sctapi.ftqq.com/${sendKey}.send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, desp }),
  });

  return new Response(JSON.stringify(await resp.json()), {
    headers: { 'Content-Type': 'application/json' },
  });
});
