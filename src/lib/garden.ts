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
  status?: PlantStatus;
  light?: string | null;
  water_frequency_days?: number | null;
  temp_range?: string | null;
  humidity?: string | null;
  fertilizer_notes?: string | null;
  notes?: string | null;
  acquired_date?: string | null;
}

export async function fetchPlants(): Promise<Plant[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('plants')
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

// 记录一次养护事件；浇水/施肥会同步更新植物的冗余时间字段
export async function recordEvent(input: {
  plant_id: string;
  type: EventType;
  note?: string;
  date?: string;
}): Promise<void> {
  if (!supabase) throw new Error('未配置 Supabase');
  const date = input.date ?? new Date().toISOString();
  const { error } = await supabase.from('events').insert({
    plant_id: input.plant_id,
    type: input.type,
    note: input.note ?? null,
    date,
  });
  if (error) throw error;

  if (input.type === 'water') {
    const { error: e } = await supabase
      .from('plants')
      .update({ last_watered_at: date })
      .eq('id', input.plant_id);
    if (e) throw e;
  } else if (input.type === 'fertilize') {
    const { error: e } = await supabase
      .from('plants')
      .update({ last_fertilized_at: date })
      .eq('id', input.plant_id);
    if (e) throw e;
  }
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

// 是否"该浇水"：距上次浇水已超过浇水周期
export function needsWatering(plant: Plant): boolean {
  if (!plant.last_watered_at || !plant.water_frequency_days) return false;
  const due =
    new Date(plant.last_watered_at).getTime() +
    plant.water_frequency_days * 24 * 60 * 60 * 1000;
  return Date.now() >= due;
}

// 距上次浇水多少天（向下取整，用于展示"X 天前"）
export function daysSince(date: string | null): number | null {
  if (!date) return null;
  return Math.floor((Date.now() - new Date(date).getTime()) / (24 * 60 * 60 * 1000));
}
