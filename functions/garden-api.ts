interface GardenEnv {
  PUBLIC_SUPABASE_URL?: string;
}

const noCache = { 'Cache-Control': 'no-store' };

function isPublicKey(key: string): boolean {
  if (key.length > 2048) return false;
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;

  // 这里只限制可转发的密钥类型。JWT 签名与项目归属仍由 Supabase 验证。
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(payload).role === 'anon';
  } catch {
    return false;
  }
}

export async function onRequest({ request, env }: { request: Request; env: GardenEnv }): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response(null, { status: 405, headers: { ...noCache, Allow: 'GET' } });
  }
  if (!env.PUBLIC_SUPABASE_URL) return new Response(null, { status: 503, headers: noCache });
  const key = request.headers.get('apikey') ?? '';
  if (!isPublicKey(key)) return new Response(null, { status: 403, headers: noCache });

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
