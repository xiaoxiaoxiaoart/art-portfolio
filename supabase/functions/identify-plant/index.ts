const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-garden-identification-code',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const maxImageSize = 4 * 1024 * 1024;

type PlantNetMatch = {
  score?: number;
  species?: { scientificNameWithoutAuthor?: string; commonNames?: string[] };
};

function reply(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { ...cors, 'Cache-Control': 'no-store' },
  });
}

async function codeMatches(given: string, expected: string): Promise<boolean> {
  if (!given || given.length > 256) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([given, expected].map(async (code) =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(code))),
  ));
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return reply({ error: 'method' }, 405);

  const key = Deno.env.get('PLANTNET_API_KEY');
  const code = Deno.env.get('GARDEN_IDENTIFICATION_CODE')?.trim();
  if (!key || !code || code.length < 24 || code.length > 256) {
    return reply({ error: 'unconfigured' }, 503);
  }
  if (!await codeMatches(request.headers.get('x-garden-identification-code') ?? '', code)) {
    return reply({ error: 'invalid_code' }, 403);
  }

  if (request.headers.get('content-type') !== 'image/jpeg') {
    return reply({ error: 'image' }, 415);
  }
  if (Number(request.headers.get('content-length')) > maxImageSize) {
    return reply({ error: 'image' }, 413);
  }

  try {
    const image = await request.blob();
    if (image.size > maxImageSize) return reply({ error: 'image' }, 413);
    const signature = new Uint8Array(await image.slice(0, 3).arrayBuffer());
    if (signature[0] !== 0xff || signature[1] !== 0xd8 || signature[2] !== 0xff) {
      return reply({ error: 'image' }, 415);
    }

    const url = new URL('https://my-api.plantnet.org/v2/identify/all');
    url.search = new URLSearchParams({ 'api-key': key, lang: 'zh', 'nb-results': '3' }).toString();
    const photos = new FormData();
    photos.append('images', image, 'plant.jpg');
    const response = await fetch(url, {
      method: 'POST',
      body: photos,
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 404) return reply({ candidates: [] });
    if (response.status === 429) return reply({ error: 'quota' }, 429);
    if (!response.ok) return reply({ error: 'provider' }, 502);

    const { results } = await response.json() as { results?: PlantNetMatch[] };
    if (!Array.isArray(results)) return reply({ error: 'provider' }, 502);
    const candidates = results.slice(0, 3).flatMap(({ score, species }) => {
      const scientificName = species?.scientificNameWithoutAuthor?.trim();
      if (!scientificName || typeof score !== 'number' || score < 0 || score > 1) return [];
      const commonName = species?.commonNames?.find((name) => /\p{Script=Han}/u.test(name))
        ?? species?.commonNames?.[0];
      return [{ scientificName, commonName: commonName?.trim() || null, score }];
    });
    return reply({ candidates });
  } catch {
    return reply({ error: 'provider' }, 502);
  }
});
