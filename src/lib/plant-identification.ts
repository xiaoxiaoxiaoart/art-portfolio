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
