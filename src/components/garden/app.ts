import type {
  Plant,
  PlantEvent,
  PlantStatus,
  EventType,
} from '../../lib/supabase';
import { isConfigured } from '../../lib/supabase';
import { fetchPlantCare, findChinesePlantName, identifyPlant, prepareIdentificationPhoto } from '../../lib/plant-identification';
import { plantCareProfile, type PlantCareSuggestions } from '../../lib/plant-care';
import {
  fetchPlants,
  fetchEvents,
  createPlant,
  updatePlant,
  deletePlant,
  recordEvent,
  uploadPhoto,
  undoWateringEvent,
  fmtDate,
  postponeWatering,
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
  postpone: '推迟浇水',
  fertilize: '施肥',
  repot: '换盆',
  prune: '修剪',
  pest: '病虫害',
  diary: '日记',
  health: '健康',
  photo: '照片',
};

let plants: Plant[] = [];
let view: 'grid' | 'detail' | 'form' = 'grid';
let selected: Plant | null = null;
let editing: Plant | null = null;
let events: PlantEvent[] = [];
let loading = true;
let plantLoadFailed = false;
let busy = false;
let errorMsg: string | null = null;
let groupBy: 'zone' | 'category' = 'zone';
let recentCare: { eventId: string; message: string } | null = null;
let comparedPhotoIds: string[] = [];
const thumbnailStorageKey = 'garden.thumbnailSize';
const thumbnailMin = 104;
const thumbnailMax = 252;
const thumbnailDefault = 132;
let thumbnailSize = thumbnailDefault;
try {
  const storedSize = Number(window.localStorage.getItem(thumbnailStorageKey));
  if (Number.isInteger(storedSize) && storedSize >= thumbnailMin && storedSize <= thumbnailMax) {
    thumbnailSize = storedSize;
  }
} catch {
  // 浏览器禁止本地存储时，仍可在本页调节缩略图。
}

const identificationStorageKey = 'garden.identificationCode';
let identificationCode = readRememberedIdentificationCode();

function readRememberedIdentificationCode(): string {
  try {
    return window.localStorage.getItem(identificationStorageKey) ?? '';
  } catch {
    return '';
  }
}

function rememberIdentificationCode(code: string): void {
  try {
    if (code) window.localStorage.setItem(identificationStorageKey, code);
    else window.localStorage.removeItem(identificationStorageKey);
  } catch {
    // 浏览器禁止本地存储时，仍可在本页使用已验证的识别码。
  }
}

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

// ---- 数据操作 ----

async function loadPlants(): Promise<void> {
  loading = true;
  plantLoadFailed = false;
  errorMsg = null;
  try {
    plants = await fetchPlants();
  } catch {
    plantLoadFailed = true;
  } finally {
    loading = false;
  }
}

async function openDetail(plant: Plant): Promise<void> {
  selected = plant;
  view = 'detail';
  errorMsg = null;
  events = [];
  comparedPhotoIds = [];
  busy = true;
  render();
  try {
    events = await fetchEvents(plant.id);
  } catch {
    errorMsg = '养护记录加载失败，请返回后重试';
  } finally {
    busy = false;
    render();
  }
}

function openForm(plant: Plant | null): void {
  editing = plant;
  view = 'form';
  errorMsg = null;
  render();
}

async function handleCare(plant: Plant, days?: number): Promise<void> {
  if (busy) return;
  busy = true;
  errorMsg = null;
  render();
  try {
    const eventId = days === undefined
      ? await recordEvent({ plant_id: plant.id, type: 'water' })
      : await postponeWatering(plant, days);
    recentCare = {
      eventId,
      message: days === undefined ? `已记录「${plant.name}」浇水` : `已推迟「${plant.name}」的检查时间`,
    };
    await refreshCare();
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : '养护操作失败，请重试';
  } finally {
    busy = false;
    render();
  }
}

async function handleUndoCare(): Promise<void> {
  if (!recentCare || busy) return;
  busy = true;
  errorMsg = null;
  render();
  try {
    await undoWateringEvent(recentCare.eventId);
    recentCare = null;
    await refreshCare();
  } catch {
    errorMsg = '撤销失败，请重试';
  } finally {
    busy = false;
    render();
  }
}

async function refreshCare(): Promise<void> {
  try {
    plants = await fetchPlants();
    if (view === 'detail' && selected) {
      const fresh = plants.find((p) => p.id === selected!.id);
      if (!fresh) {
        selected = null;
        view = 'grid';
        return;
      }
      selected = fresh;
      events = await fetchEvents(fresh.id);
    }
  } catch {
    errorMsg = '操作已保存，列表刷新失败，请重新加载页面';
  }
}

async function handleDelete(): Promise<void> {
  if (!selected || busy) return;
  if (!window.confirm(`确定删除「${selected.name}」？`)) return;
  busy = true;
  render();
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
  render();
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

async function handlePostpone(): Promise<void> {
  if (!selected || busy) return;
  const input = window.prompt('推迟几天浇水？', '3');
  if (input === null) return;
  const days = Number(input);
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    errorMsg = '请输入 1 至 3650 之间的整数天数';
    render();
    return;
  }
  await handleCare(selected, days);
}

async function handleDormantToggle(dormant: boolean): Promise<void> {
  if (!selected || busy) return;
  busy = true;
  errorMsg = null;
  render();
  try {
    await updatePlant(selected.id, { dormant });
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
  const undo = recentCare && view !== 'form'
    ? `<div class="garden-care-feedback"><span role="status">${escapeHtml(recentCare.message)}</span><button type="button" class="garden-btn" data-action="undo-care">撤销</button></div>`
    : '';
  el.classList.toggle('garden-grid-view', view === 'grid' && !loading && plants.length > 0);
  if (view === 'grid') {
    el.style.setProperty('--garden-thumbnail-size', `${thumbnailSize}px`);
    el.innerHTML = banner + undo + gridHtml();
    bindGrid(el);
  } else if (view === 'detail' && selected) {
    el.innerHTML = banner + undo + detailHtml();
    bindDetail(el);
  } else {
    el.innerHTML = banner + formHtml();
    bindForm(el);
  }
  el.querySelector('[data-action="undo-care"]')?.addEventListener('click', () => void handleUndoCare());
  if (busy) {
    el.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input').forEach((control) => {
      control.disabled = true;
    });
  }
}

function groupPlants(list: Plant[], by: 'zone' | 'category'): { key: string; plants: Plant[] }[] {
  const map = new Map<string, Plant[]>();
  for (const p of list) {
    const key = p[by]?.trim() || '未分类';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }
  const groups: { key: string; plants: Plant[] }[] = [];
  for (const [key, list] of map) {
    if (key !== '未分类') groups.push({ key, plants: list });
  }
  if (map.has('未分类')) groups.push({ key: '未分类', plants: map.get('未分类')! });
  return groups;
}

function gridHtml(): string {
  const due = plants.filter(needsWatering);
  const dueHtml = loading || plantLoadFailed ? '' : `<section class="garden-dashboard" aria-labelledby="garden-care-title">
    <h3 id="garden-care-title">今日养护 <span class="garden-group-count">${due.length} 株待检查</span></h3>
    ${due.length ? groupPlants(due, 'zone').map(({ key, plants: group }) => `
      <section class="garden-care-zone">
        <h4>${escapeHtml(key)}</h4>
        <ul>${group.map((plant) => `<li class="garden-care-row">
          <button type="button" class="garden-care-name" data-open="${plant.id}">${escapeHtml(plant.name)}</button>
          <div class="garden-care-actions">
            <button type="button" class="garden-btn primary" data-care="water" data-plant="${plant.id}">已浇水</button>
            <button type="button" class="garden-btn" data-care="postpone" data-plant="${plant.id}">明天再看</button>
          </div>
        </li>`).join('')}</ul>
      </section>`).join('') : '<p class="garden-empty">今天没有待检查的植物。</p>'}
  </section>`;

  const tabs = `<div class="garden-tabs">
    <button class="garden-tab ${groupBy === 'zone' ? 'active' : ''}" data-group="zone">按区块</button>
    <button class="garden-tab ${groupBy === 'category' ? 'active' : ''}" data-group="category">按类型</button>
  </div>`;

  const body = loading
    ? '<div class="garden-empty">加载中…</div>'
    : plants.length === 0
      ? '<div class="garden-empty">还没有植物，点击右上角「添加植物」开始。</div>'
      : groupPlants(plants, groupBy)
          .map(
            (g) =>
              `<div class="garden-group"><h3 class="garden-group-title">${escapeHtml(g.key)} <span class="garden-group-count">${g.plants.length}</span></h3><div class="garden-grid">${g.plants.map(cardHtml).join('')}</div></div>`,
          )
          .join('');

  const loadError = plantLoadFailed ? `<div class="garden-care-feedback" role="alert">
    <span class="garden-error">植物列表加载失败，请重试。</span>
    <button type="button" class="garden-btn" data-action="retry-plants">重新加载</button>
  </div>` : '';
  const sizeControl = !loading && plants.length ? `<div class="garden-size-control">
    <label for="garden-thumbnail-size">缩略图大小</label>
    <span aria-hidden="true">小</span>
    <input id="garden-thumbnail-size" type="range" min="${thumbnailMin}" max="${thumbnailMax}" value="${thumbnailSize}" />
    <span aria-hidden="true">大</span>
  </div>` : '';
  return `<div class="garden-toolbar"><h2>我的植物</h2><button class="garden-btn primary" data-action="add">+ 添加植物</button></div>${loadError}${dueHtml}${tabs}${plantLoadFailed && !plants.length ? '' : body}${sizeControl}`;
}

function cardHtml(p: Plant): string {
  const days = daysSince(p.last_watered_at);
  const img = p.photo_url
    ? `<img class="garden-card-img" src="${escapeHtml(p.photo_url)}" alt="${escapeHtml(p.name)}" loading="lazy" />`
    : '<div class="garden-card-img"></div>';
  const due = needsWatering(p) ? '<span class="garden-due">需浇水</span>' : '';
  const nextCheck = !due && p.watering_postponed_until && p.watering_check_at
    && Date.parse(p.watering_postponed_until) > Date.now()
    ? `<span>下次检查 ${fmtDate(p.watering_check_at)}</span>`
    : '';
  const tag = groupBy === 'zone' ? p.category : p.zone;
  const tagHtml = tag ? `<span class="garden-card-tag">${escapeHtml(tag)}</span>` : '';
  return `<div class="garden-card" data-open="${p.id}">${img}<div class="garden-card-name">${escapeHtml(p.name)}</div><div class="garden-card-meta">${tagHtml}<span class="garden-status ${p.status}">${statusLabel[p.status]}</span>${due}<span>${days !== null ? `${days} 天前浇水` : '未记录浇水'}</span>${nextCheck}</div></div>`;
}

function detailHtml(): string {
  const p = selected!;
  const days = daysSince(p.last_watered_at);
  const waterDays = p.dormant
    ? p.dormant_water_frequency_days ?? p.water_frequency_days
    : p.water_frequency_days;
  const waterLabel = waterDays ? `${p.dormant ? '休眠期 ' : ''}${waterDays} 天` : '';
  const facts = ([
    ['摆放位置', p.location],
    ['区块', p.zone],
    ['类型', p.category],
    ['光照', p.light],
    ['浇水周期', waterLabel],
    ['适宜温度', p.temp_range],
    ['湿度', p.humidity],
    ['购入日期', p.acquired_date],
    ['上次浇水', days !== null ? `${fmtDate(p.last_watered_at!)}（${days} 天前）` : '未记录'],
    ['下次检查', p.watering_check_at && !needsWatering(p) ? fmtDate(p.watering_check_at) : null],
    ['上次施肥', p.last_fertilized_at ? fmtDate(p.last_fertilized_at) : '未记录'],
  ] satisfies [string, string | null][])
    .filter(([, v]) => v)
    .map(
      ([label, value]) =>
        `<div class="garden-fact"><span class="label">${escapeHtml(label)}</span>${escapeHtml(value!)}</div>`,
    )
    .join('');

  const photos = events.filter((ev) => ev.type === 'photo');
  const timelineEvents = events.filter((ev) => ev.type !== 'photo');
  const photoGrid = photos.length
    ? `<div class="garden-photos">${photos.map((photo) => `
      <div class="garden-photo-choice">
        ${photoFigure(photo)}
        ${photos.length > 1 ? `<label><input type="checkbox" data-compare-photo="${photo.id}" aria-label="对照 ${fmtDate(photo.date)} 的照片" ${comparedPhotoIds.includes(photo.id) ? 'checked' : ''} /> 对照</label>` : ''}
      </div>`).join('')}</div>`
    : '<p class="garden-empty">还没有照片，点「上传照片」记录生长变化。</p>';

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
        <label class="garden-dormant"><input type="checkbox" id="dormant-toggle" ${p.dormant ? 'checked' : ''} /> 休眠中</label>
        <div class="garden-detail-actions">
          <button class="garden-btn primary" data-action="water">记录浇水</button>
          ${p.watering_check_at ? '<button class="garden-btn" data-action="postpone">推迟浇水</button>' : ''}
          <button class="garden-btn" data-action="photo">上传照片</button>
          <button class="garden-btn" data-action="edit">编辑</button>
          <button class="garden-btn danger" data-action="delete">删除</button>
        </div>
        <div class="garden-detail-actions">${statusBtns}</div>
      </div>
    </div>
    <form class="garden-photo-form" id="detail-photo-form" hidden>
      <label>照片 <input type="file" name="photo" accept="image/*" required /></label>
      <label>拍摄日期 <input type="date" name="taken-on" value="${fmtDate(Date.now())}" required /></label>
      <label>短注 <input type="text" name="note" maxlength="200" placeholder="例如：换盆后的第一片新叶" /></label>
      <button type="submit" class="garden-btn primary">保存照片</button>
      <p class="garden-error" role="alert"></p>
    </form>
    <div class="garden-detail-section"><h3>习性</h3><div class="garden-facts">${facts}</div></div>
    ${p.fertilizer_notes ? `<div class="garden-detail-section"><h3>施肥</h3><div class="garden-fact">${escapeHtml(p.fertilizer_notes)}</div></div>` : ''}
    ${p.notes ? `<div class="garden-detail-section"><h3>备注</h3><div class="garden-fact">${escapeHtml(p.notes)}</div></div>` : ''}
    <div class="garden-detail-section">
      <h3>生长档案</h3>
      ${photos.length > 1 ? '<p class="garden-empty garden-compare-hint">选两张照片，查看生长变化和期间的养护记录。</p>' : ''}
      ${photoGrid}
      <div id="garden-photo-comparison">${comparisonHtml()}</div>
    </div>
    <div class="garden-detail-section"><h3>养护记录</h3>${timelineHtml(timelineEvents)}</div>`;
}

function photoFigure(photo: PlantEvent): string {
  const date = fmtDate(photo.date);
  return `<figure>
    <img class="garden-photo" src="${escapeHtml(photo.photo_url ?? '')}" alt="${escapeHtml(photo.note || `${date} 的植物照片`)}" loading="lazy" />
    <figcaption><time datetime="${date}">${date}</time>${photo.note ? `<span>${escapeHtml(photo.note)}</span>` : ''}</figcaption>
  </figure>`;
}

function timelineHtml(items: PlantEvent[], empty = '暂无记录'): string {
  if (!items.length) return `<p class="garden-empty">${empty}</p>`;
  return `<div class="garden-timeline">${items.map((ev) =>
    `<div class="garden-event"><span class="ev-type">${eventTypeLabel[ev.type]}</span><span class="ev-date">${fmtDate(ev.date)}</span><span class="ev-note">${escapeHtml(ev.note ?? '')}</span></div>`,
  ).join('')}</div>`;
}

function comparisonHtml(): string {
  const photos = events.filter((ev) => ev.type === 'photo' && comparedPhotoIds.includes(ev.id)).reverse();
  if (photos.length !== 2) return '';
  const [before, after] = photos;
  const from = fmtDate(before.date);
  const to = fmtDate(after.date);
  const care = events.filter((ev) => {
    const date = fmtDate(ev.date);
    return ev.type !== 'photo' && date >= from && date <= to;
  });
  return `<section class="garden-comparison">
    <h4>照片对照</h4>
    <div class="garden-compare-pair">${photos.map(photoFigure).join('')}</div>
    <h4>这段时间的养护</h4>
    ${timelineHtml(care, '这段时间暂无养护记录。')}
  </section>`;
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
    : '<img class="garden-form-photo" id="form-photo-preview" hidden alt="" />';
  const zoneOptions = [...new Set(plants.map((pl) => pl.zone).filter((v): v is string => Boolean(v)))].map((z) => `<option value="${escapeHtml(z)}"></option>`).join('');
  const categoryOptions = [...new Set(plants.map((pl) => pl.category).filter((v): v is string => Boolean(v)))].map((c) => `<option value="${escapeHtml(c)}"></option>`).join('');

  return `<button class="garden-back" data-action="back">← 返回</button>
    <form class="garden-form" id="garden-form">
      <div class="garden-field">
        <label for="form-photo-input">植物照片</label>
        ${photoPreview}
        ${p ? '<input type="file" id="form-photo-input" accept="image/*" />' : `
          <div class="garden-photo-sources">
            <button type="button" class="garden-btn" data-photo-source="camera">拍照识别</button>
            <button type="button" class="garden-btn" data-photo-source="library">选择照片</button>
          </div>
          <input type="file" id="form-photo-camera" accept="image/*" capture="environment" hidden />
          <input type="file" id="form-photo-input" accept="image/*" hidden />
          <p class="garden-empty">选图后会把缩小的照片发送给 Pl@ntNet 识别，也可以直接手填。</p>
          <a class="garden-identification-credit" href="https://my.plantnet.org/" target="_blank" rel="noopener noreferrer">
            <img src="/powered-by-plantnet.svg" width="110" height="30" alt="Powered by Pl@ntNet" />
          </a>
          <div id="garden-identification-access" class="garden-identification-access" hidden>
            <label for="garden-identification-code">识别码</label>
            <input id="garden-identification-code" type="password" autocomplete="off" maxlength="256" />
            <label class="garden-remember-code"><input id="garden-identification-remember" type="checkbox" checked /> 记住这台设备</label>
          </div>
          <button type="button" class="garden-btn small" id="garden-identification-forget" hidden>清除识别码</button>
          <p id="garden-identification-status" class="garden-empty" role="status"></p>
          <button type="button" class="garden-btn" id="garden-identification-retry" hidden>开始识别</button>
          <div id="garden-identification-results" class="garden-identification-results"></div>`}
      </div>
      <div class="garden-field"><label for="garden-plant-name">名称 *</label><input id="garden-plant-name" name="name" value="${p ? escapeHtml(p.name) : ''}" required /></div>
      <div class="garden-field"><label for="garden-plant-species">品种 / 学名</label><input id="garden-plant-species" name="species" value="${p?.species ? escapeHtml(p.species) : ''}" /></div>
      ${field('健康状态', `<select name="status">${statusOptions}</select>`)}
      ${field('摆放位置', `<input name="location" value="${p?.location ? escapeHtml(p.location) : ''}" />`)}
      ${field('区块', `<input name="zone" list="zone-list" value="${p?.zone ? escapeHtml(p.zone) : ''}" /><datalist id="zone-list">${zoneOptions}</datalist>`)}
      ${field('类型', `<input name="category" list="category-list" value="${p?.category ? escapeHtml(p.category) : ''}" /><datalist id="category-list">${categoryOptions}</datalist>`)}
      ${field('光照需求', `<input name="light" value="${p?.light ? escapeHtml(p.light) : ''}" />`)}
      ${field('浇水周期（天）', `<input name="water_frequency_days" type="number" min="1" value="${p?.water_frequency_days ?? ''}" />`)}
      ${field('休眠期浇水周期（天）', `<input name="dormant_water_frequency_days" type="number" min="1" value="${p?.dormant_water_frequency_days ?? ''}" />`)}
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
  const sizeSlider = el.querySelector<HTMLInputElement>('#garden-thumbnail-size');
  sizeSlider?.addEventListener('input', () => {
    thumbnailSize = sizeSlider.valueAsNumber;
    el.style.setProperty('--garden-thumbnail-size', `${thumbnailSize}px`);
  });
  sizeSlider?.addEventListener('change', () => {
    try {
      window.localStorage.setItem(thumbnailStorageKey, String(thumbnailSize));
    } catch {
      // 此次调整仍保留在当前页面。
    }
  });
  el.querySelector('[data-action="retry-plants"]')?.addEventListener('click', () => void refreshGrid());

  el.querySelectorAll<HTMLElement>('[data-group]').forEach((tab) => {
    tab.addEventListener('click', () => {
      groupBy = tab.dataset.group as 'zone' | 'category';
      render();
    });
  });
  el.querySelectorAll<HTMLElement>('[data-open]').forEach((node) => {
    node.addEventListener('click', () => {
      if (busy) return;
      const plant = plants.find((p) => p.id === node.dataset.open);
      if (plant) void openDetail(plant);
    });
  });
  el.querySelectorAll<HTMLButtonElement>('[data-care]').forEach((button) => {
    button.addEventListener('click', () => {
      const plant = plants.find((p) => p.id === button.dataset.plant);
      if (plant) void handleCare(plant, button.dataset.care === 'postpone' ? 1 : undefined);
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
    selected && void handleCare(selected),
  );
  el.querySelector('[data-action="postpone"]')?.addEventListener('click', () =>
    void handlePostpone(),
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

  const dormantToggle = el.querySelector('#dormant-toggle') as HTMLInputElement | null;
  dormantToggle?.addEventListener('change', () => {
    void handleDormantToggle(dormantToggle.checked);
  });

  bindPhotoArchive(el);
}

function bindPhotoArchive(el: HTMLElement): void {
  const plantId = selected!.id;
  const form = el.querySelector<HTMLFormElement>('#detail-photo-form')!;
  const fileInput = form.elements.namedItem('photo') as HTMLInputElement;
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const photoButton = el.querySelector<HTMLButtonElement>('[data-action="photo"]')!;
  const photoError = form.querySelector<HTMLElement>('.garden-error')!;
  let uploadedUrl: string | null = null;

  photoButton.setAttribute('aria-expanded', 'false');
  photoButton.setAttribute('aria-controls', form.id);
  photoButton.addEventListener('click', () => {
    form.hidden = !form.hidden;
    photoButton.setAttribute('aria-expanded', String(!form.hidden));
    if (!form.hidden) fileInput.focus();
  });
  fileInput.addEventListener('change', () => {
    uploadedUrl = null;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = fileInput.files?.[0];
    if (busy || !file) return;

    const fields = new FormData(form);
    busy = true;
    const controls = Array.from(el.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>(
      'button:enabled, input:enabled, select:enabled',
    ));
    controls.forEach((control) => { control.disabled = true; });
    submit.textContent = '保存中…';
    photoError.textContent = '';
    let saved = false;
    try {
      uploadedUrl ??= await uploadPhoto(file);
      await recordEvent({
        plant_id: plantId,
        type: 'photo',
        date: new Date(`${fields.get('taken-on')}T12:00:00+08:00`).toISOString(),
        note: String(fields.get('note') ?? '').trim() || undefined,
        photo_url: uploadedUrl,
      });
      saved = true;
      events = await fetchEvents(plantId);
      errorMsg = null;
    } catch (err) {
      if (saved) errorMsg = '照片已保存，列表刷新失败，请重新打开植物详情';
      else photoError.textContent = err instanceof Error ? err.message : '保存照片失败，请重试';
    } finally {
      busy = false;
      if (saved) render();
      else {
        controls.forEach((control) => { control.disabled = false; });
        submit.textContent = '保存照片';
      }
    }
  });

  const choices = Array.from(el.querySelectorAll<HTMLInputElement>('[data-compare-photo]'));
  const syncChoices = () => {
    for (const choice of choices) {
      choice.disabled = comparedPhotoIds.length === 2 && !choice.checked;
    }
  };
  for (const choice of choices) {
    choice.addEventListener('change', () => {
      comparedPhotoIds = choices.filter((c) => c.checked).map((c) => c.dataset.comparePhoto!);
      syncChoices();
      el.querySelector('#garden-photo-comparison')!.innerHTML = comparisonHtml();
    });
  }
  syncChoices();
}

function bindPlantIdentification(form: HTMLFormElement) {
  const code = form.querySelector<HTMLInputElement>('#garden-identification-code')!;
  const access = form.querySelector<HTMLElement>('#garden-identification-access')!;
  const remember = form.querySelector<HTMLInputElement>('#garden-identification-remember')!;
  const forget = form.querySelector<HTMLButtonElement>('#garden-identification-forget')!;
  remember.checked = !identificationCode || Boolean(readRememberedIdentificationCode());
  forget.hidden = !identificationCode;
  const status = form.querySelector<HTMLElement>('#garden-identification-status')!;
  const retry = form.querySelector<HTMLButtonElement>('#garden-identification-retry')!;
  const results = form.querySelector<HTMLElement>('#garden-identification-results')!;
  const name = form.elements.namedItem('name') as HTMLInputElement;
  const species = form.elements.namedItem('species') as HTMLInputElement;
  const careFields = [
    'category', 'light', 'water_frequency_days', 'dormant_water_frequency_days',
    'temp_range', 'humidity', 'fertilizer_notes',
  ] as const;
  const autoFilled = new Map<string, string>();
  function applyCare(profile?: PlantCareSuggestions): number {
    let filled = 0;
    for (const key of careFields) {
      const field = form.elements.namedItem(key) as HTMLInputElement | HTMLTextAreaElement;
      if (field.value.trim() && field.value !== autoFilled.get(key)) {
        autoFilled.delete(key);
        continue;
      }
      const value = profile?.[key];
      field.value = value === undefined ? '' : String(value);
      autoFilled.set(key, field.value);
      if (field.value) filled++;
    }
    return filled;
  }

  let photoUrl = '';
  let request: AbortController | undefined;

  async function identify(): Promise<void> {
    if (!photoUrl) return;
    const enteredCode = code.value.trim() || identificationCode;
    if (!enteredCode) {
      access.hidden = false;
      retry.hidden = false;
      retry.textContent = '开始识别';
      status.textContent = '首次识别需要输入识别码。';
      return;
    }

    request?.abort();
    const current = new AbortController();
    request = current;
    access.hidden = true;
    retry.hidden = true;
    results.replaceChildren();
    status.textContent = '正在识别植物…';
    try {
      const photo = await prepareIdentificationPhoto(photoUrl);
      if (current.signal.aborted) return;
      const response = await identifyPlant(photo, enteredCode, current.signal);
      if (current.signal.aborted) return;
      if (response.error === 'invalid_code') {
        identificationCode = '';
        rememberIdentificationCode('');
        forget.hidden = true;
        code.value = '';
        access.hidden = false;
        retry.hidden = false;
        retry.textContent = '开始识别';
        status.textContent = '识别码不正确，请重新输入。';
        return;
      }
      if (!response.candidates) {
        const messages: Record<string, string> = {
          unconfigured: '拍照识别尚未配置，可以手动填写。',
          quota: '识别次数暂时用完，可以手动填写。',
          image: '识别服务无法读取这张照片，请换一张。',
          provider: '暂时无法识别，请重试或手动填写。',
        };
        status.textContent = messages[response.error] ?? messages.provider;
        if (response.error !== 'unconfigured' && response.error !== 'quota') {
          access.hidden = Boolean(identificationCode);
          retry.hidden = false;
          retry.textContent = '重试识别';
        }
        return;
      }

      identificationCode = enteredCode;
      rememberIdentificationCode(remember.checked ? enteredCode : '');
      forget.hidden = false;
      code.value = '';
      if (!response.candidates.length) {
        status.textContent = '没有找到匹配的植物。可以换一张叶片或花朵的清晰照片，也可以手填。';
        return;
      }
      status.textContent = '请选择最像的一项，填入名称及可用的养护建议。';
      for (const candidate of response.candidates) {
        const profile = plantCareProfile(candidate.scientificName);
        const chineseName = profile?.chineseName
          ?? (candidate.commonName?.match(/\p{Script=Han}/u) ? candidate.commonName : undefined);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'garden-btn';
        button.textContent = [
          chineseName || candidate.commonName,
          candidate.scientificName,
          `匹配分 ${Math.round(candidate.score * 100)}%`,
        ].filter(Boolean).join(' · ');
        button.addEventListener('click', async () => {
          const fallbackName = candidate.commonName || candidate.scientificName;
          name.value = chineseName || fallbackName;
          species.value = candidate.scientificName;
          applyCare(profile);
          results.replaceChildren();
          name.focus();
          if (profile) {
            status.textContent = '已填入养护建议。浇水天数是检查提醒，保存前可按盆土和环境调整。';
            return;
          }

          status.textContent = '正在按学名生成养护建议…';
          const [referenceName, generated] = await Promise.all([
            chineseName ? Promise.resolve(undefined) : findChinesePlantName(candidate.scientificName, current.signal),
            fetchPlantCare(candidate.scientificName, enteredCode, current.signal),
          ]);
          if (current.signal.aborted || species.value !== candidate.scientificName) return;
          const suggestedName = chineseName || referenceName || generated.care?.chineseName;
          if (suggestedName && name.value === fallbackName) name.value = suggestedName;
          if (applyCare(generated.care)) {
            status.textContent = '已填入 DeepSeek 养护建议，请按实际光照和盆土干湿核对后保存。';
          } else {
            status.textContent = generated.error === 'care_quota'
              ? '养护建议服务额度暂不可用，可以手动填写。'
              : '暂未获取养护建议，可以手动填写。';
          }
        });
        results.append(button);
      }
    } catch (err) {
      if (!current.signal.aborted) {
        status.textContent = err instanceof Error ? err.message : '暂时无法识别，请换一张照片。';
      }
    }
  }

  retry.addEventListener('click', () => void identify());
  forget.addEventListener('click', () => {
    request?.abort();
    identificationCode = '';
    rememberIdentificationCode('');
    forget.hidden = true;
    code.value = '';
    results.replaceChildren();
    if (photoUrl) void identify();
    else status.textContent = '识别码已清除。';
  });
  code.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void identify();
    }
  });
  return {
    select(url: string) {
      request?.abort();
      photoUrl = url;
      results.replaceChildren();
      void identify();
    },
    abort() { request?.abort(); },
  };
}

function bindForm(el: HTMLElement): void {
  const plant = editing;
  const form = el.querySelector<HTMLFormElement>('#garden-form')!;
  const photoInput = el.querySelector<HTMLInputElement>('#form-photo-input')!;
  const camera = el.querySelector<HTMLInputElement>('#form-photo-camera');
  const photoPreview = el.querySelector<HTMLImageElement>('#form-photo-preview')!;
  const formError = el.querySelector<HTMLElement>('#form-error')!;
  const save = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const recognition = plant ? null : bindPlantIdentification(form);
  let photo: File | undefined;
  let previewUrl: string | undefined;
  let photoUrl = plant?.photo_url ?? null;
  let saving = false;

  const releasePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  };
  el.querySelectorAll<HTMLButtonElement>('[data-action="back"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (saving) return;
      recognition?.abort();
      releasePreview();
      view = 'grid';
      render();
    });
  });

  el.querySelector('[data-photo-source="camera"]')?.addEventListener('click', () => camera?.click());
  el.querySelector('[data-photo-source="library"]')?.addEventListener('click', () => photoInput.click());
  function selectPhoto(input: HTMLInputElement): void {
    const file = input.files?.[0];
    if (!file || saving) return;
    input.value = '';
    photo = file;
    photoUrl = null;
    releasePreview();
    previewUrl = URL.createObjectURL(file);
    photoPreview.src = previewUrl;
    photoPreview.hidden = false;
    recognition?.select(previewUrl);
  }
  photoInput.addEventListener('change', () => selectPhoto(photoInput));
  camera?.addEventListener('change', () => selectPhoto(camera));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (saving) return;
    const fd = new FormData(form);
    const str = (k: string): string | null => {
      const v = fd.get(k);
      return typeof v === 'string' && v.trim() ? v.trim() : null;
    };
    const waterDays = str('water_frequency_days');
    const dormantDays = str('dormant_water_frequency_days');
    const input: PlantInput = {
      name: str('name') ?? '',
      species: str('species'),
      location: str('location'),
      zone: str('zone'),
      category: str('category'),
      status: (fd.get('status') as PlantStatus) || 'healthy',
      light: str('light'),
      water_frequency_days: waterDays ? Number(waterDays) : null,
      dormant_water_frequency_days: dormantDays ? Number(dormantDays) : null,
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

    saving = true;
    form.inert = true;
    save.disabled = true;
    save.textContent = '保存中…';
    void (async () => {
      try {
        if (photo && !photoUrl) photoUrl = await uploadPhoto(photo);
        input.photo_url = photoUrl;
        if (plant) await updatePlant(plant.id, input);
        else await createPlant(input);
        recognition?.abort();
        releasePreview();
        await loadPlants();
        view = 'grid';
        render();
      } catch (err) {
        formError.textContent = err instanceof Error ? err.message : '保存失败';
        formError.style.display = '';
      } finally {
        saving = false;
        form.inert = false;
        save.disabled = false;
        save.textContent = '保存';
      }
    })();
  });
}

// ---- 入口 ----

async function refreshGrid(): Promise<void> {
  const pending = loadPlants();
  render();
  await pending;
  if (view === 'grid') render();
}

export function init(): void {
  if (isConfigured) void refreshGrid();
  else render();
}
