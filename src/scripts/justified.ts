export interface Photo {
  src: string;
  w: number;
  h: number;
  slug?: string;
}

interface SizedPhoto extends Photo {
  displayW: number;
  displayH: number;
}

interface GalleryRow {
  photos: SizedPhoto[];
  height: number;
}

const TARGET_ROW_HEIGHT = 130;
const GAP = 12;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getImageSize(p: Photo): { w: number; h: number } {
  const ratio = p.w / p.h;
  if (ratio > 1) {
    return { w: TARGET_ROW_HEIGHT, h: Math.round(TARGET_ROW_HEIGHT / ratio) };
  }
  return { w: Math.round(TARGET_ROW_HEIGHT * ratio), h: TARGET_ROW_HEIGHT };
}

export function buildJustifiedGallery(
  photos: Photo[],
  containerWidth: number,
  shufflePhotos: boolean = false
): GalleryRow[] {
  const items = shufflePhotos ? shuffle(photos) : [...photos];
  const maxWidth = containerWidth;
  const rows: GalleryRow[] = [];
  let current: SizedPhoto[] = [];
  let currentW = 0;

  for (const p of items) {
    const sz = getImageSize(p);
    const needed = currentW + sz.w + (current.length > 0 ? GAP : 0);

    if (needed <= maxWidth || current.length === 0) {
      current.push({ ...p, displayW: sz.w, displayH: sz.h });
      currentW = needed;
    } else {
      const totalGap = (current.length - 1) * GAP;
      const scale = (maxWidth - totalGap) / (currentW - totalGap);
      rows.push({
        photos: current.map(s => ({
          ...s,
          displayW: Math.round(s.displayW * scale),
          displayH: Math.round(s.displayH * scale)
        })),
        height: Math.round(TARGET_ROW_HEIGHT * scale)
      });
      current = [{ ...p, displayW: sz.w, displayH: sz.h }];
      currentW = sz.w;
    }
  }

  if (current.length > 0) {
    rows.push({
      photos: current,
      height: TARGET_ROW_HEIGHT
    });
  }

  return rows;
}

export function renderGallery(
  container: HTMLElement,
  photos: Photo[],
  shufflePhotos: boolean = false
): void {
  const containerWidth = container.clientWidth;
  const rows = buildJustifiedGallery(photos, containerWidth, shufflePhotos);

  container.style.opacity = '0';
  container.innerHTML = rows.map(row => {
    const imgs = row.photos.map(p => {
      const imgTag = `<img src="${p.src}" width="${p.displayW}" height="${p.displayH}" alt="" loading="lazy" />`;
      if (p.slug) {
        return `<a href="/artwork/${p.slug}/" style="display:block;flex-shrink:0">${imgTag}</a>`;
      }
      return imgTag;
    }).join('');
    return `<div style="display:flex;gap:${GAP}px;margin-bottom:${GAP}px;align-items:center">${imgs}</div>`;
  }).join('');
  container.style.opacity = '1';
}
