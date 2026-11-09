interface GardenEnv {
  PUBLIC_SUPABASE_URL?: string;
  PUBLIC_SUPABASE_ANON_KEY?: string;
}

const noCache = { 'Cache-Control': 'no-store' };

export async function onRequest({ request, env }: { request: Request; env: GardenEnv }): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response(null, { status: 405, headers: { ...noCache, Allow: 'GET' } });
  }
  const key = env.PUBLIC_SUPABASE_ANON_KEY;
  if (!env.PUBLIC_SUPABASE_URL || !key) return new Response(null, { status: 503, headers: noCache });
  if (request.headers.get('apikey') !== key) return new Response(null, { status: 403, headers: noCache });

  const plant = new URL(request.url).searchParams.get('plant');
  if (plant !== null && !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(plant)) {
    return new Response(null, { status: 400, headers: noCache });
  }

  try {
    // 只代理花园的列表和详情查询，沿用 Supabase 的公开权限和数据访问策略。
    const url = new URL(plant ? '/rest/v1/events' : '/rest/v1/plants_with_watering_schedule', env.PUBLIC_SUPABASE_URL);
    url.search = plant
      ? new URLSearchParams({ select: '*', plant_id: `eq.${plant}`, order: 'date.desc' }).toString()
      : 'select=*&order=created_at.asc';
    const upstream = await fetch(url, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...noCache, 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch {
    return new Response(null, { status: 502, headers: noCache });
  }
}
