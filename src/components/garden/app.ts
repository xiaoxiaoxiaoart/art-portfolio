import type {
  Plant,
  PlantEvent,
  PlantStatus,
  EventType,
} from '../../lib/supabase';
import { isConfigured } from '../../lib/supabase';
import {
  fetchPlants,
  fetchEvents,
  createPlant,
  updatePlant,
  deletePlant,
  recordEvent,
  uploadPhoto,
  needsWatering,
  daysSince,
  type PlantInput,
} from '../../lib/garden';

const statusLabel: Record<PlantStatus, string> = {
  healthy: '健康',
  attention: '关注',
  sick: '生病',
};

const eventTypeLabel: Record<EventType, string> = {
  water: '浇水',
  fertilize: '施肥',
  repot: '换盆',
  prune: '修剪',
  pest: '病虫害',
  diary: '日记',
  health: '健康',
};

let plants: Plant[] = [];
let view: 'grid' | 'detail' | 'form' = 'grid';
let selected: Plant | null = null;
let editing: Plant | null = null;
let events: PlantEvent[] = [];
let loading = true;
let busy = false;
let errorMsg: string | null = null;

function root(): HTMLElement {
  return document.getElementById('garden-root')!;
}

function escapeHtml(s: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return s.replace(/[&<>"']/g, (c) => map[c] ?? c);
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// ---- 数据操作 ----

async function loadPlants(): Promise<void> {
  loading = true;
  errorMsg = null;
  try {
    plants = await fetchPlants();
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : '加载失败';
  } finally {
    loading = false;
  }
}

async function openDetail(plant: Plant): Promise<void> {
  selected = plant;
  view = 'detail';
  errorMsg = null;
  render();
  try {
    events = await fetchEvents(plant.id);
  } catch {
    events = [];
  }
  render();
}

function openForm(plant: Plant | null): void {
  editing = plant;
  view = 'form';
  errorMsg = null;
  render();
}

async function handleWater(): Promise<void> {
  if (!selected || busy) return;
  busy = true;
  errorMsg = null;
  try {
    await recordEvent({ plant_id: selected.id, type: 'water' });
    const [freshPlants, freshEvents] = await Promise.all([
      fetchPlants(),
      fetchEvents(selected.id),
    ]);
    plants = freshPlants;
    events = freshEvents;
    selected = freshPlants.find((p) => p.id === selected!.id) ?? null;
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : '记录失败';
  } finally {
    busy = false;
    render();
  }
}

async function handleDelete(): Promise<void> {
  if (!selected) return;
  if (!window.confirm(`确定删除「${selected.name}」？`)) return;
  busy = true;
  try {
    await deletePlant(selected.id);
    await loadPlants();
    view = 'grid';
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : '删除失败';
  } finally {
    busy = false;
    render();
  }
}

async function handleStatusChange(status: PlantStatus): Promise<void> {
  if (!selected || busy) return;
  busy = true;
  errorMsg = null;
  try {
    await updatePlant(selected.id, { status });
    await recordEvent({
      plant_id: selected.id,
      type: 'health',
      note: `状态 → ${status}`,
    });
    plants = await fetchPlants();
    selected = plants.find((p) => p.id === selected!.id) ?? null;
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : '更新失败';
  } finally {
    busy = false;
    render();
  }
}

// ---- 渲染 ----

function render(): void {
  const el = root();
  if (!isConfigured) {
    el.innerHTML =
      '<div class="garden-error">尚未配置 Supabase。请在 .env 设置 PUBLIC_SUPABASE_URL 和 PUBLIC_SUPABASE_ANON_KEY。</div>';
    return;
  }
  const banner = errorMsg
    ? `<div class="garden-error" style="margin-bottom:20px">${escapeHtml(errorMsg)}</div>`
    : '';
  if (view === 'grid') {
    el.innerHTML = banner + gridHtml();
    bindGrid(el);
  } else if (view === 'detail' && selected) {
    el.innerHTML = banner + detailHtml();
    bindDetail(el);
  } else {
    el.innerHTML = banner + formHtml();
    bindForm(el);
  }
}

function gridHtml(): string {
  const due = plants.filter(needsWatering);
  const dueHtml = due.length
    ? `<div class="garden-dashboard"><h3>该浇水的植物</h3><div class="due-list">${due
        .map((p) => `<span class="due-plant" data-open="${p.id}">${escapeHtml(p.name)}</span>`)
        .join('')}</div></div>`
    : '';

  const body = loading
    ? '<div class="garden-empty">加载中…</div>'
    : plants.length === 0
      ? '<div class="garden-empty">还没有植物，点击右上角「添加植物」开始。</div>'
      : `<div class="garden-grid">${plants.map(cardHtml).join('')}</div>`;

  return `<div class="garden-toolbar"><h2>我的植物</h2><button class="garden-btn primary" data-action="add">+ 添加植物</button></div>${dueHtml}${body}`;
}

function cardHtml(p: Plant): string {
  const days = daysSince(p.last_watered_at);
  const img = p.photo_url
    ? `<img class="garden-card-img" src="${escapeHtml(p.photo_url)}" alt="${escapeHtml(p.name)}" loading="lazy" />`
    : '<div class="garden-card-img"></div>';
  const due = needsWatering(p) ? '<span class="garden-due">需浇水</span>' : '';
  return `<div class="garden-card" data-open="${p.id}">${img}<div class="garden-card-name">${escapeHtml(p.name)}</div><div class="garden-card-meta"><span class="garden-status ${p.status}">${statusLabel[p.status]}</span>${due}<span>${days !== null ? `${days} 天前浇水` : '未浇水'}</span></div></div>`;
}

function detailHtml(): string {
  const p = selected!;
  const days = daysSince(p.last_watered_at);
  const facts = [
    ['摆放位置', p.location],
    ['光照', p.light],
    ['浇水周期', p.water_frequency_days ? `${p.water_frequency_days} 天` : ''],
    ['适宜温度', p.temp_range],
    ['湿度', p.humidity],
    ['购入日期', p.acquired_date],
    ['上次浇水', days !== null ? `${days} 天前` : '未记录'],
    ['上次施肥', p.last_fertilized_at ? fmtDate(p.last_fertilized_at) : '未记录'],
  ]
    .filter(([, v]) => v)
    .map(
      ([label, value]) =>
        `<div class="garden-fact"><span class="label">${escapeHtml(label)}</span>${escapeHtml(value!)}</div>`,
    )
    .join('');

  const timeline =
    events.length === 0
      ? '<div class="garden-empty">暂无记录</div>'
      : `<div class="garden-timeline">${events
          .map(
            (ev) =>
              `<div class="garden-event"><span class="ev-type">${eventTypeLabel[ev.type]}</span><span class="ev-date">${fmtDate(ev.date)}</span><span class="ev-note">${escapeHtml(ev.note ?? '')}</span></div>`,
          )
          .join('')}</div>`;

  const statusBtns = (Object.keys(statusLabel) as PlantStatus[])
    .map(
      (s) =>
        `<button class="garden-btn small ${p.status === s ? 'primary' : ''}" data-status="${s}">${statusLabel[s]}</button>`,
    )
    .join('');

  return `<button class="garden-back" data-action="back">← 返回</button>
    <div class="garden-detail-header">
      ${p.photo_url ? `<img class="garden-detail-img" src="${escapeHtml(p.photo_url)}" alt="${escapeHtml(p.name)}" />` : '<div class="garden-detail-img"></div>'}
      <div class="garden-detail-title">
        <h2>${escapeHtml(p.name)}</h2>
        ${p.species ? `<div class="species">${escapeHtml(p.species)}</div>` : ''}
        <span class="garden-status ${p.status}">${statusLabel[p.status]}</span>
        ${needsWatering(p) ? '<span class="garden-due">需要浇水</span>' : ''}
        <div class="garden-detail-actions">
          <button class="garden-btn primary" data-action="water">记录浇水</button>
          <button class="garden-btn" data-action="edit">编辑</button>
          <button class="garden-btn danger" data-action="delete">删除</button>
        </div>
        <div class="garden-detail-actions">${statusBtns}</div>
      </div>
    </div>
    <div class="garden-detail-section"><h3>习性</h3><div class="garden-facts">${facts}</div></div>
    ${p.fertilizer_notes ? `<div class="garden-detail-section"><h3>施肥</h3><div class="garden-fact">${escapeHtml(p.fertilizer_notes)}</div></div>` : ''}
    ${p.notes ? `<div class="garden-detail-section"><h3>备注</h3><div class="garden-fact">${escapeHtml(p.notes)}</div></div>` : ''}
    <div class="garden-detail-section"><h3>养护记录</h3>${timeline}</div>`;
}

function formHtml(): string {
  const p = editing;
  const field = (label: string, inner: string) =>
    `<div class="garden-field"><label>${label}</label>${inner}</div>`;
  const statusOptions = (Object.keys(statusLabel) as PlantStatus[])
    .map(
      (s) =>
        `<option value="${s}" ${p?.status === s ? 'selected' : ''}>${statusLabel[s]}</option>`,
    )
    .join('');
  const photoPreview = p?.photo_url
    ? `<img class="garden-form-photo" id="form-photo-preview" src="${escapeHtml(p.photo_url)}" alt="" />`
    : '<img class="garden-form-photo" id="form-photo-preview" style="display:none" alt="" />';

  return `<button class="garden-back" data-action="back">← 返回</button>
    <form class="garden-form" id="garden-form">
      ${field('名称 *', `<input name="name" value="${p ? escapeHtml(p.name) : ''}" required />`)}
      ${field('品种 / 学名', `<input name="species" value="${p?.species ? escapeHtml(p.species) : ''}" />`)}
      <div class="garden-field"><label>照片</label>${photoPreview}<input type="file" id="form-photo-input" accept="image/*" /><span class="garden-empty" id="form-photo-status"></span></div>
      ${field('健康状态', `<select name="status">${statusOptions}</select>`)}
      ${field('摆放位置', `<input name="location" value="${p?.location ? escapeHtml(p.location) : ''}" />`)}
      ${field('光照需求', `<input name="light" value="${p?.light ? escapeHtml(p.light) : ''}" />`)}
      ${field('浇水周期（天）', `<input name="water_frequency_days" type="number" min="1" value="${p?.water_frequency_days ?? ''}" />`)}
      ${field('适宜温度', `<input name="temp_range" value="${p?.temp_range ? escapeHtml(p.temp_range) : ''}" />`)}
      ${field('湿度需求', `<input name="humidity" value="${p?.humidity ? escapeHtml(p.humidity) : ''}" />`)}
      ${field('施肥说明', `<textarea name="fertilizer_notes" rows="2">${p?.fertilizer_notes ? escapeHtml(p.fertilizer_notes) : ''}</textarea>`)}
      ${field('购入日期', `<input name="acquired_date" type="date" value="${p?.acquired_date ?? ''}" />`)}
      ${field('备注 / 习性', `<textarea name="notes" rows="3">${p?.notes ? escapeHtml(p.notes) : ''}</textarea>`)}
      <div class="garden-error" id="form-error" style="display:none"></div>
      <div class="garden-form-actions"><button type="submit" class="garden-btn primary">保存</button><button type="button" class="garden-btn" data-action="back">取消</button></div>
    </form>`;
}

// ---- 事件绑定 ----

function bindGrid(el: HTMLElement): void {
  el.querySelectorAll<HTMLElement>('[data-open]').forEach((node) => {
    node.addEventListener('click', () => {
      const plant = plants.find((p) => p.id === node.dataset.open);
      if (plant) void openDetail(plant);
    });
  });
  el.querySelector('[data-action="add"]')?.addEventListener('click', () =>
    openForm(null),
  );
}

function bindDetail(el: HTMLElement): void {
  el.querySelector('[data-action="back"]')?.addEventListener('click', () => {
    view = 'grid';
    render();
  });
  el.querySelector('[data-action="water"]')?.addEventListener('click', () =>
    void handleWater(),
  );
  el.querySelector('[data-action="edit"]')?.addEventListener('click', () =>
    openForm(selected),
  );
  el.querySelector('[data-action="delete"]')?.addEventListener('click', () =>
    void handleDelete(),
  );
  el.querySelectorAll<HTMLElement>('[data-status]').forEach((btn) => {
    btn.addEventListener('click', () =>
      void handleStatusChange(btn.dataset.status as PlantStatus),
    );
  });
}

function bindForm(el: HTMLElement): void {
  el.querySelectorAll('[data-action="back"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      view = 'grid';
      render();
    });
  });

  const form = el.querySelector('#garden-form') as HTMLFormElement;
  const photoInput = el.querySelector('#form-photo-input') as HTMLInputElement;
  const photoStatus = el.querySelector('#form-photo-status') as HTMLElement;
  const photoPreview = el.querySelector('#form-photo-preview') as HTMLImageElement | null;
  const formError = el.querySelector('#form-error') as HTMLElement;
  let photoUrl = editing?.photo_url ?? null;

  photoInput.addEventListener('change', () => {
    const file = photoInput.files?.[0];
    if (!file) return;
    photoStatus.textContent = '上传中…';
    void uploadPhoto(file)
      .then((url) => {
        photoUrl = url;
        if (photoPreview) {
          photoPreview.src = url;
          photoPreview.style.display = '';
        }
        photoStatus.textContent = '';
      })
      .catch((err: unknown) => {
        photoStatus.textContent = err instanceof Error ? err.message : '上传失败';
      });
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const str = (k: string): string | null => {
      const v = fd.get(k);
      return typeof v === 'string' && v.trim() ? v.trim() : null;
    };
    const waterDays = str('water_frequency_days');
    const input: PlantInput = {
      name: (fd.get('name') as string) || '',
      species: str('species'),
      location: str('location'),
      status: (fd.get('status') as PlantStatus) || 'healthy',
      light: str('light'),
      water_frequency_days: waterDays ? Number(waterDays) : null,
      temp_range: str('temp_range'),
      humidity: str('humidity'),
      fertilizer_notes: str('fertilizer_notes'),
      notes: str('notes'),
      acquired_date: str('acquired_date'),
      photo_url: photoUrl,
    };
    if (!input.name) {
      formError.textContent = '请填写植物名称';
      formError.style.display = '';
      return;
    }
    formError.style.display = 'none';

    void (async () => {
      try {
        if (editing) await updatePlant(editing.id, input);
        else await createPlant(input);
        await loadPlants();
        view = 'grid';
        render();
      } catch (err) {
        formError.textContent = err instanceof Error ? err.message : '保存失败';
        formError.style.display = '';
      }
    })();
  });
}

// ---- 入口 ----

export function init(): void {
  render();
  if (isConfigured) {
    void loadPlants().finally(() => render());
  }
}
