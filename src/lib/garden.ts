import {
  supabase,
  type Plant,
  type PlantEvent,
  type PlantStatus,
  type EventType,
} from './supabase';

export interface PlantInput {
  name: string;
  species?: string | null;
  photo_url?: string | null;
  location?: string | null;
  zone?: string | null;
  category?: string | null;
  status?: PlantStatus;
  light?: string | null;
  water_frequency_days?: number | null;
  dormant?: boolean;
  dormant_water_frequency_days?: number | null;
  temp_range?: string | null;
  humidity?: string | null;
  fertilizer_notes?: string | null;
  notes?: string | null;
  acquired_date?: string | null;
}

export async function fetchPlants(): Promise<Plant[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('plants_with_watering_schedule')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function fetchEvents(plantId: string): Promise<PlantEvent[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('plant_id', plantId)
    .order('date', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createPlant(input: PlantInput): Promise<Plant> {
  if (!supabase) throw new Error('未配置 Supabase');
  const { data, error } = await supabase
    .from('plants')
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updatePlant(
  id: string,
  input: Partial<PlantInput>,
): Promise<void> {
  if (!supabase) throw new Error('未配置 Supabase');
  const { error } = await supabase.from('plants').update(input).eq('id', id);
  if (error) throw error;
}

export async function deletePlant(id: string): Promise<void> {
  if (!supabase) throw new Error('未配置 Supabase');
  const { error } = await supabase.from('plants').delete().eq('id', id);
  if (error) throw error;
}

// 浇水与推迟由数据库同步更新。施肥沿用现有记录方式。
export async function recordEvent(input: {
  plant_id: string;
  type: EventType;
  note?: string;
  date?: string;
  postponed_until?: string;
  photo_url?: string;
}): Promise<string> {
  if (!supabase) throw new Error('未配置 Supabase');
  const { data, error } = await supabase.from('events').insert(input).select('id, date').single();
  if (error) throw error;

  if (input.type === 'fertilize') {
    const { error: updateError } = await supabase
      .from('plants')
      .update({ last_fertilized_at: data.date })
      .eq('id', input.plant_id);
    if (updateError) throw updateError;
  }
  return data.id;
}

export async function undoWateringEvent(eventId: string): Promise<void> {
  if (!supabase) throw new Error('未配置 Supabase');
  const { error } = await supabase.from('events').delete().eq('id', eventId).in('type', ['water', 'postpone']);
  if (error) throw error;
}

export async function uploadPhoto(file: File): Promise<string> {
  if (!supabase) throw new Error('未配置 Supabase');
  const ext = file.name.split('.').pop() ?? 'jpg';
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from('plant-photos').upload(path, file);
  if (error) throw error;
  const { data } = supabase.storage.from('plant-photos').getPublicUrl(path);
  return data.publicUrl;
}

const dayMs = 86_400_000;
const shanghaiDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' });

export function fmtDate(date: string | number): string {
  return shanghaiDate.format(new Date(date));
}

export function needsWatering(plant: Plant): boolean {
  return plant.watering_check_at != null && Date.parse(plant.watering_check_at) <= Date.now();
}

// 距真实浇水时间经过的整天数。
export function daysSince(date: string | null): number | null {
  if (!date) return null;
  return Math.floor((Date.now() - Date.parse(date)) / dayMs);
}

export function postponeWatering(plant: Plant, days: number): Promise<string> {
  if (!plant.watering_check_at) throw new Error('未设置浇水周期，无法推迟');
  const today = Date.parse(`${fmtDate(Date.now())}T00:00:00+08:00`);
  return recordEvent({
    plant_id: plant.id,
    type: 'postpone',
    note: `推迟浇水 ${days} 天`,
    postponed_until: new Date(Math.max(today + days * dayMs, Date.parse(plant.watering_check_at))).toISOString(),
  });
}
