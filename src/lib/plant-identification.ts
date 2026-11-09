import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase';

export interface PlantCandidate {
  scientificName: string;
  commonName: string | null;
  score: number;
}

export async function prepareIdentificationPhoto(url: string): Promise<Blob> {
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch {
    throw new Error('这张照片无法读取。请换一张 JPG 或 PNG，也可以手动填写。');
  }

  // 在浏览器生成缩小后的 JPEG，识别服务只收到像素，不包含原照片的定位等元数据。
  const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const photo = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
  if (!photo || photo.type !== 'image/jpeg') throw new Error('无法处理照片，请换一张再试。');
  return photo;
}

export async function identifyPlant(photo: Blob, code: string, signal: AbortSignal) {
  if (!supabase) return { error: 'unconfigured' } as const;
  const { data, error } = await supabase.functions.invoke<{ candidates: PlantCandidate[] }>('identify-plant', {
    body: photo,
    headers: { 'Content-Type': 'image/jpeg', 'x-garden-identification-code': code },
    signal,
    timeout: 20_000,
  });
  if (error instanceof FunctionsHttpError) {
    const body = await error.context.json().catch(() => ({}));
    return { error: typeof body?.error === 'string' ? body.error : 'provider' };
  }
  if (error || !Array.isArray(data?.candidates)) return { error: 'provider' } as const;
  return { candidates: data.candidates };
}

// GBIF 只收到已选候选的学名，用于补齐 Pl@ntNet 未返回的中文名。
export async function findChinesePlantName(scientificName: string, signal: AbortSignal): Promise<string | undefined> {
  if (signal.aborted) return;
  const request = new AbortController();
  const abort = () => request.abort();
  signal.addEventListener('abort', abort, { once: true });
  const timeout = window.setTimeout(abort, 5_000);
  try {
    const query = new URLSearchParams({ name: scientificName, kingdom: 'Plantae', strict: 'true' });
    const match = await fetch(`https://api.gbif.org/v1/species/match?${query}`, { signal: request.signal });
    if (!match.ok) return;
    const { matchType, rank, usageKey, acceptedUsageKey } = await match.json();
    if (matchType !== 'EXACT' || !['SPECIES', 'SUBSPECIES', 'VARIETY', 'FORM'].includes(rank)) return;
    const id = acceptedUsageKey ?? usageKey;
    if (!Number.isSafeInteger(id)) return;

    const names = await fetch(`https://api.gbif.org/v1/species/${id}/vernacularNames?limit=100`, { signal: request.signal });
    if (!names.ok) return;
    const { results } = await names.json() as { results: { language?: string; vernacularName: string }[] };
    return results.find(({ language, vernacularName }) =>
      /^(zh(?:-[a-z]+)?|zho|chi)$/i.test(language ?? '') && /\p{Script=Han}/u.test(vernacularName),
    )?.vernacularName.trim();
  } catch {
    return undefined;
  } finally {
    window.clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
  }
}
