const upstreamOrigin = 'https://jfkmfpxlqyjxmyuewqlx.supabase.co';
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

export async function onRequest({ request }: { request: Request }): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response(null, { status: 405, headers: { ...noCache, Allow: 'GET' } });
  }
  const key = request.headers.get('apikey') ?? '';
  if (!isPublicKey(key)) return new Response(null, { status: 403, headers: noCache });

  const params = new URL(request.url).searchParams;
  const plant = params.get('plant');
  const latestPhotos = params.get('photos') === 'latest';
  if (plant !== null && !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(plant)) {
    return new Response(null, { status: 400, headers: noCache });
  }

  try {
    // 仅转发固定的花园查询，沿用 Supabase 的公开权限和数据访问策略。
    const url = new URL('/rest/v1/plants_with_watering_schedule', upstreamOrigin);
    if (plant) {
      url.pathname = '/rest/v1/events';
      url.search = new URLSearchParams({ select: '*', plant_id: `eq.${plant}`, order: 'date.desc' }).toString();
    } else if (latestPhotos) {
      url.pathname = '/rest/v1/plants';
      url.search = new URLSearchParams({
        select: 'id,events(date,photo_url)',
        order: 'created_at.asc,id.asc',
        'events.type': 'eq.photo',
        'events.photo_url': 'not.is.null',
        'events.order': 'date.desc,created_at.desc,id.desc',
        'events.limit': '1',
      }).toString();
    } else {
      url.search = 'select=*&order=created_at.asc';
    }
    const upstream = await fetch(url.toString(), {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
      // Workers 使用 manual 禁止自动跟随，避免把公开密钥转发到其他地址。
      redirect: 'manual',
      signal: AbortSignal.timeout(8_000),
    });
    if (!upstream.ok) {
      const status = upstream.status >= 400 ? upstream.status : 502;
      return Response.json({ error: 'garden_upstream_rejected' }, { status, headers: noCache });
    }
    return Response.json(await upstream.json(), { headers: noCache });
  } catch {
    return Response.json({ error: 'garden_upstream_unavailable' }, { status: 502, headers: noCache });
  }
}
