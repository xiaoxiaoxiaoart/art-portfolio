import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type PlantStatus = 'healthy' | 'attention' | 'sick';
export type EventType =
  | 'water'
  | 'fertilize'
  | 'repot'
  | 'prune'
  | 'pest'
  | 'diary'
  | 'health'
  | 'photo';

export interface Plant {
  id: string;
  name: string;
  species: string | null;
  photo_url: string | null;
  location: string | null;
  status: PlantStatus;
  light: string | null;
  water_frequency_days: number | null;
  dormant: boolean;
  dormant_water_frequency_days: number | null;
  temp_range: string | null;
  humidity: string | null;
  fertilizer_notes: string | null;
  notes: string | null;
  acquired_date: string | null;
  last_watered_at: string | null;
  last_fertilized_at: string | null;
  created_at: string;
}

export interface PlantEvent {
  id: string;
  plant_id: string;
  type: EventType;
  date: string;
  note: string | null;
  photo_url: string | null;
  created_at: string;
}

const url = import.meta.env.PUBLIC_SUPABASE_URL as string | undefined;
const key = import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string | undefined;

export const isConfigured = Boolean(url && key);

export const supabase: SupabaseClient | null = isConfigured
  ? createClient(url!, key!)
  : null;
