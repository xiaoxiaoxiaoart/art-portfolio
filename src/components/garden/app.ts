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
  fetchLatestPhotos,
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
  type GardenPhoto,
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
let careExpanded = false;
let albumMode = false;
let albumSort: 'added' | 'recent' = 'added';
let latestPhotos: Map<string, GardenPhoto> | null = null;
let latestPhotosRequest: Promise<Map<string, GardenPhoto>> | null = null;
let latestPhotosFailed = false;
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

function plantNames(value: string | null | undefined): { chinese: string; scientific: string } {
  if (!value) return { chinese: '', scientific: '' };
  // 中文名和学名共用原有的品种字段。旧版单行资料继续按原样读取。
  const separator = value.indexOf('\n');
  if (separator >= 0) {
    return { chinese: value.slice(0, separator), scientific: value.slice(separator + 1) };
  }
  if (/\p{Script=Han}/u.test(value) && !/[a-z]/i.test(value)) {
    return { chinese: value, scientific: '' };
  }
  return { chinese: plantCareProfile(value)?.chineseName ?? '', scientific: value };
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

async function loadLatestPhotos(): Promise<void> {
  const request = fetchLatestPhotos();
  latestPhotosRequest = request;
  try {
    const photos = await request;
    if (latestPhotosRequest === request) latestPhotos = photos;
  } catch {
    if (latestPhotosRequest === request) latestPhotosFailed = true;
  } finally {
    if (latestPhotosRequest === request) {
      latestPhotosRequest = null;
      if (view === 'grid' && albumMode && albumSort === 'recent') {
        const sortTab = '[data-album-sort="recent"]';
        const hadFocus = document.activeElement?.matches(sortTab);
        render();
        if (hadFocus) root().querySelector<HTMLButtonElement>(sortTab)?.focus({ preventScroll: true });
      }
    }
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
  const nav = document.getElementById('garden-nav')!;
  const showNavigation = view === 'grid' && !loading && !plantLoadFailed;
  const zones = view === 'grid' ? groupPlants(plants, 'zone') : [];
  nav.hidden = !showNavigation;
  nav.innerHTML = showNavigation ? navigationHtml(zones) : '';
  el.classList.toggle('garden-grid-view', view === 'grid' && !loading && plants.length > 0);
  if (view === 'grid') {
    if (showNavigation && albumMode && albumSort === 'recent' && zones.length && !latestPhotos && !latestPhotosRequest && !latestPhotosFailed) {
      void loadLatestPhotos();
    }
    updateThumbnailLayout(el);
    el.innerHTML = banner + undo + gridHtml(zones);
    bindGrid(el, nav);
  } else if (view === 'detail' && selected) {
    el.innerHTML = banner + undo + detailHtml();
    bindDetail(el);
  } else {
    el.innerHTML = banner + formHtml();
    bindForm(el);
  }
  el.querySelector('[data-action="undo-care"]')?.addEventListener('click', () => void handleUndoCare());
  if (busy) {
    document.querySelectorAll<HTMLButtonElement | HTMLInputElement>('#garden-root :is(button, input), #garden-nav button').forEach((control) => {
      control.disabled = true;
    });
  }
}

type PlantGroup = { key: string; plants: Plant[] };

function groupPlants(list: Plant[], by: 'zone' | 'category'): PlantGroup[] {
  const map = new Map<string, Plant[]>();
  for (const p of list) {
    const key = p[by]?.trim() || '未分类';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }
  const groups: PlantGroup[] = [];
  for (const [key, list] of map) {
    if (key !== '未分类') groups.push({ key, plants: list });
  }
  if (map.has('未分类')) groups.push({ key: '未分类', plants: map.get('未分类')! });
  return groups;
}

function navigationHtml(zones: PlantGroup[]): string {
  return `<button type="button" data-jump="garden-collection">全部植物</button>
    <button type="button" data-jump="garden-care-title">今日养护</button>
    ${zones.length ? `<span class="garden-nav-divider" aria-hidden="true"></span>${zones.map(({ key }, index) =>
      `<button type="button" data-jump="garden-zone-${index}">${escapeHtml(key)}</button>`).join('')}` : ''}`;
}

function careDashboardHtml(): string {
  const due = plants.filter(needsWatering);
  return `<details class="garden-dashboard" ${careExpanded ? 'open' : ''}>
    <summary id="garden-care-title">今日养护 <span class="garden-group-count">${due.length ? `${due.length} 株待检查` : '没有待检查'}</span></summary>
    <div class="garden-care-body">
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
    </div></details>`;
}

function gridHtml(zones: PlantGroup[]): string {
  const tab = (label: string, attribute: string, active: boolean) =>
    `<button type="button" class="garden-tab ${active ? 'active' : ''}" aria-pressed="${active}" ${attribute}>${label}</button>`;
  const tabs = `<div class="garden-tabs">
    ${albumMode
      ? tab('按加入时间', 'data-album-sort="added"', albumSort === 'added') + tab('按最近拍摄', 'data-album-sort="recent"', albumSort === 'recent')
      : tab('按区块', 'data-group="zone"', groupBy === 'zone') + tab('按类型', 'data-group="category"', groupBy === 'category')}
  </div>`;

  let body = '';
  if (loading) {
    body = '<div class="garden-empty">加载中…</div>';
  } else if (!plants.length) {
    if (!plantLoadFailed) body = '<div class="garden-empty">还没有植物，点击右上角「添加植物」开始。</div>';
  } else if (albumMode) {
    body = albumHtml();
  } else {
    const groups = groupBy === 'zone' ? zones : groupPlants(plants, 'category');
    body = groups.map(({ key, plants: group }, index) => `
      <section class="garden-group" ${groupBy === 'zone' ? `id="garden-zone-${index}" tabindex="-1"` : ''}>
        <h3 class="garden-group-title">${escapeHtml(key)} <span class="garden-group-count">${group.length}</span></h3>
        <div class="garden-grid">${group.map((plant) => cardHtml(plant)).join('')}</div>
      </section>`).join('');
  }

  const loadError = plantLoadFailed ? `<div class="garden-care-feedback" role="alert">
    <span class="garden-error">植物列表加载失败，请重试。</span>
    <button type="button" class="garden-btn" data-action="retry-plants">重新加载</button>
  </div>` : '';
  const sizeControl = !loading && plants.length
    ? `<input class="garden-size-control" id="garden-thumbnail-size" aria-label="缩略图大小" type="range" min="${thumbnailMin}" max="${thumbnailMax}" value="${thumbnailSize}" />`
    : '';
  const albumToggle = !loading && !plantLoadFailed && plants.length
    ? `<button type="button" class="garden-tab ${albumMode ? 'active' : ''}" aria-pressed="${albumMode}" data-action="album">画册</button>` : '';
  return `<div class="garden-toolbar"><h2>${albumMode ? '植物画册' : '我的植物'}</h2><div class="garden-toolbar-actions">${albumToggle}<button class="garden-btn primary" data-action="add">+ 添加植物</button></div></div>
    ${loadError}${loading || plantLoadFailed || albumMode ? '' : careDashboardHtml()}
    <div id="garden-collection" tabindex="-1">${tabs}${body}</div>${sizeControl}`;
}

function albumHtml(): string {
  const recent = albumSort === 'recent';
  const photoDate = (p: Plant) => {
    const photo = latestPhotos?.get(p.id);
    return photo ? Date.parse(photo.date) : -Infinity;
  };
  const sorted = [...plants].sort((a, b) =>
    (recent ? photoDate(b) - photoDate(a) : 0) || Date.parse(b.created_at) - Date.parse(a.created_at),
  );
  const hint = !recent ? '' : latestPhotosFailed
    ? '<p class="garden-empty garden-album-note">拍摄日期加载失败，暂按加入时间显示。 <button type="button" class="garden-btn small" data-action="retry-photos">重试</button></p>'
    : `<p class="garden-empty garden-album-note" role="status">${latestPhotosRequest ? '正在加载拍摄日期…' : '未记录拍摄日期的植物排在最后。'}</p>`;
  return `${hint}<div class="garden-grid">${sorted.map((p) => cardHtml(p, recent ? latestPhotos?.get(p.id) : undefined)).join('')}</div>`;
}

function checkLabel(p: Plant): string {
  if (!p.watering_check_at) return '未设浇水周期';
  if (needsWatering(p)) return '今天检查';
  const date = fmtDate(p.watering_check_at);
  const now = Date.now();
  const tomorrow = fmtDate(now + 86_400_000);
  const postponed = p.watering_postponed_until && Date.parse(p.watering_postponed_until) > now;
  if (date === fmtDate(now)) return postponed ? '今天晚些再看' : '今天检查';
  if (date === tomorrow) return postponed ? '明天再看' : '明天检查';
  return `${date.slice(5).replace('-', '/')} ${postponed ? '再看' : '检查'}`;
}

function cardHtml(p: Plant, latest?: GardenPhoto): string {
  const url = latest?.photo_url ?? p.photo_url;
  const img = url
    ? `<img class="garden-card-img" src="${escapeHtml(url)}" alt="" loading="lazy" />`
    : '<span class="garden-card-img" aria-hidden="true"></span>';
  const name = escapeHtml(p.name);
  const content = `${img}<span class="garden-card-name">${name}</span>`;
  if (albumMode) return `<button type="button" class="garden-card" data-open="${p.id}">${content}</button>`;

  const days = daysSince(p.last_watered_at);
  const status = p.status === 'healthy' ? checkLabel(p) : statusLabel[p.status];
  const tone = p.status === 'healthy' && needsWatering(p) ? 'attention' : p.status;
  const nextCheck = p.watering_check_at && !needsWatering(p) ? `下次检查 ${fmtDate(p.watering_check_at)}` : '';
  const tag = groupBy === 'zone' ? p.category : p.zone;
  const tagHtml = tag ? `<span class="garden-card-tag">${escapeHtml(tag)}</span>` : '';
  return `<button type="button" class="garden-card" data-open="${p.id}" aria-label="${name}，${escapeHtml(status)}">
    ${content}<span class="garden-card-meta"><span class="garden-status ${tone}"><span>${escapeHtml(status)}</span></span></span>
    <span class="garden-card-meta garden-card-extra">${tagHtml}<span>${days === null ? '未记录浇水' : days === 0 ? '今天已浇水' : `${days} 天前浇水`}</span>${nextCheck ? `<span>${nextCheck}</span>` : ''}</span>
  </button>`;
}

function detailHtml(): string {
  const p = selected!;
  const days = daysSince(p.last_watered_at);
  const names = plantNames(p.species);
  const waterDays = p.dormant
    ? p.dormant_water_frequency_days ?? p.water_frequency_days
    : p.water_frequency_days;
  const waterLabel = waterDays ? `${p.dormant ? '休眠期 · ' : ''}每 ${waterDays} 天检查盆土` : '未设周期';
  const check = checkLabel(p);
  const checkDate = p.watering_check_at && !needsWatering(p) ? fmtDate(p.watering_check_at) : null;
  const facts = ([
    ['摆放位置', p.location],
    ['区块', p.zone],
    ['类型', p.category],
    ['适宜温度', p.temp_range],
    ['湿度', p.humidity],
    ['购入日期', p.acquired_date],
    ['上次浇水', days !== null ? `${fmtDate(p.last_watered_at!)}（${days} 天前）` : '未记录'],
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
    <section class="garden-profile" aria-labelledby="garden-profile-name">
    <div class="garden-detail-header">
      ${p.photo_url ? photoButton(p.photo_url, `${p.name}的主照片`, true) : '<div class="garden-detail-img"></div>'}
      <div class="garden-detail-title">
        <h2 id="garden-profile-name">${escapeHtml(p.name)}</h2>
        ${names.chinese && names.chinese !== p.name ? `<div class="garden-profile-common">${escapeHtml(names.chinese)}</div>` : ''}
        ${names.scientific && names.scientific !== p.name ? `<div class="species">${escapeHtml(names.scientific)}</div>` : ''}
        <span class="garden-status ${p.status}">${statusLabel[p.status]}</span>
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
    <dl class="garden-profile-summary">
      <div><dt>下次检查</dt><dd class="${needsWatering(p) ? 'garden-due' : ''}">${escapeHtml(check)}${checkDate ? `<time datetime="${checkDate}">${checkDate}</time>` : ''}</dd></div>
      <div><dt>光照</dt><dd>${escapeHtml(p.light?.trim() || '未记录')}</dd></div>
      <div><dt>浇水</dt><dd>${escapeHtml(waterLabel)}</dd></div>
    </dl>
    </section>
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
    <div class="garden-detail-section"><h3>养护记录</h3>${timelineHtml(timelineEvents)}</div>
    <dialog class="garden-photo-viewer" aria-label="查看植物照片">
      <form method="dialog" class="garden-photo-viewer-bar">
        <button type="submit" class="garden-btn small" autofocus>关闭</button>
      </form>
      <img class="garden-photo-full" alt="" />
    </dialog>`;
}

function photoButton(url: string, description: string, cover = false): string {
  const alt = escapeHtml(description);
  return `<button type="button" class="garden-photo-trigger${cover ? ' garden-cover-trigger' : ''}" aria-label="放大查看${alt}" aria-haspopup="dialog">
    <img class="${cover ? 'garden-detail-img' : 'garden-photo'}" src="${escapeHtml(url)}" alt="${alt}"${cover ? '' : ' loading="lazy"'} />
    <span class="garden-photo-zoom" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25"><path d="M2 6V2h4m4 0h4v4m0 4v4h-4m-4 0H2v-4" /></svg></span>
  </button>`;
}

function photoFigure(photo: PlantEvent): string {
  const date = fmtDate(photo.date);
  return `<figure>
    ${photo.photo_url ? photoButton(photo.photo_url, photo.note || `${date} 的植物照片`) : '<div class="garden-photo"></div>'}
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
  const names = plantNames(p?.species);
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
      <div class="garden-field"><label for="garden-plant-name">昵称 / 名称 *</label><input id="garden-plant-name" name="name" value="${p ? escapeHtml(p.name) : ''}" required /></div>
      <div class="garden-field"><label for="garden-plant-common-name">中文名</label><input id="garden-plant-common-name" name="chinese_name" value="${escapeHtml(names.chinese)}" /></div>
      <div class="garden-field"><label for="garden-plant-species">品种 / 学名</label><input id="garden-plant-species" name="species" value="${escapeHtml(names.scientific)}" /></div>
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

function updateThumbnailLayout(el: HTMLElement): void {
  el.style.setProperty('--garden-thumbnail-size', `${thumbnailSize}px`);
  el.dataset.density = thumbnailSize < 128 ? 'compact' : thumbnailSize < 184 ? 'standard' : 'detailed';
}

function bindGrid(el: HTMLElement, nav: HTMLElement): void {
  const dashboard = el.querySelector<HTMLDetailsElement>('.garden-dashboard');
  dashboard?.addEventListener('toggle', () => {
    if (dashboard.isConnected) careExpanded = dashboard.open;
  });
  nav.querySelectorAll<HTMLButtonElement>('[data-jump]').forEach((button) => {
    button.addEventListener('click', () => {
      const destination = button.dataset.jump!;
      if (destination === 'garden-care-title') {
        careExpanded = true;
        if (albumMode) {
          albumMode = false;
          render();
        } else if (dashboard) {
          dashboard.open = true;
        }
      } else if (destination.startsWith('garden-zone-') && (albumMode || groupBy !== 'zone')) {
        albumMode = false;
        groupBy = 'zone';
        render();
      }
      const target = document.getElementById(destination);
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'start' });
    });
  });

  const sizeSlider = el.querySelector<HTMLInputElement>('#garden-thumbnail-size');
  sizeSlider?.addEventListener('input', () => {
    thumbnailSize = sizeSlider.valueAsNumber;
    updateThumbnailLayout(el);
  });
  sizeSlider?.addEventListener('change', () => {
    try {
      window.localStorage.setItem(thumbnailStorageKey, String(thumbnailSize));
    } catch {
      // 此次调整仍保留在当前页面。
    }
  });
  el.querySelector('[data-action="retry-plants"]')?.addEventListener('click', () => void refreshGrid());
  el.querySelector('[data-action="retry-photos"]')?.addEventListener('click', () => {
    latestPhotosFailed = false;
    render();
  });
  el.querySelector('[data-action="album"]')?.addEventListener('click', () => {
    albumMode = !albumMode;
    render();
    el.querySelector<HTMLButtonElement>('[data-action="album"]')?.focus({ preventScroll: true });
  });
  el.querySelectorAll<HTMLButtonElement>('[data-album-sort]').forEach((tab) => {
    tab.addEventListener('click', () => {
      albumSort = tab.dataset.albumSort === 'recent' ? 'recent' : 'added';
      render();
      el.querySelector<HTMLButtonElement>(`[data-album-sort="${albumSort}"]`)?.focus({ preventScroll: true });
    });
  });

  el.querySelectorAll<HTMLElement>('[data-group]').forEach((tab) => {
    tab.addEventListener('click', () => {
      groupBy = tab.dataset.group as 'zone' | 'category';
      render();
      el.querySelector<HTMLButtonElement>(`[data-group="${groupBy}"]`)?.focus({ preventScroll: true });
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
      if (dashboard) careExpanded = dashboard.open;
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
  bindPhotoViewer(el);
}

function bindPhotoViewer(el: HTMLElement): void {
  const dialog = el.querySelector<HTMLDialogElement>('.garden-photo-viewer')!;
  const full = dialog.querySelector<HTMLImageElement>('.garden-photo-full')!;
  let opener: HTMLButtonElement | null = null;
  // 对照区会随复选框更新，事件绑定在保留的容器上。
  el.querySelectorAll('.garden-detail-header, .garden-photos, #garden-photo-comparison').forEach((section) => {
    section.addEventListener('click', (event) => {
      if (!(event.target instanceof Element) || dialog.open) return;
      const button = event.target.closest<HTMLButtonElement>('.garden-photo-trigger');
      const thumb = button?.querySelector('img');
      if (!button || button.disabled || !thumb) return;
      full.src = thumb.currentSrc || thumb.src;
      full.alt = thumb.alt;
      opener = button;
      dialog.showModal();
    });
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    full.removeAttribute('src');
    opener?.focus({ preventScroll: true });
    opener = null;
  });
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
      latestPhotos = null;
      latestPhotosRequest = null;
      latestPhotosFailed = false;
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
  const commonName = form.elements.namedItem('chinese_name') as HTMLInputElement;
  const species = form.elements.namedItem('species') as HTMLInputElement;
  const careFields = [
    'category', 'light', 'water_frequency_days', 'dormant_water_frequency_days',
    'temp_range', 'humidity', 'fertilizer_notes',
  ] as const;
  const autoFilled = new Map<string, string>();
  function fillName(field: HTMLInputElement, value: string): void {
    if (field.value.trim() && field.value !== autoFilled.get(field.name)) return;
    field.value = value;
    autoFilled.set(field.name, value);
  }
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
          fillName(name, chineseName || fallbackName);
          fillName(commonName, chineseName ?? '');
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
          if (suggestedName) {
            fillName(name, suggestedName);
            fillName(commonName, suggestedName);
          }
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
    const chineseName = str('chinese_name');
    const scientificName = str('species');
    const input: PlantInput = {
      name: str('name') ?? '',
      species: chineseName || scientificName ? `${chineseName ?? ''}\n${scientificName ?? ''}` : null,
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
