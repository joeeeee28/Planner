import type { DateStr, ID } from '../types';

export type WeightUnit = 'kg' | 'lb';
export type MeasurementUnit = 'cm' | 'in';
export type WaterUnit = 'litres' | 'glasses';
export type HealthMood = 'very-low' | 'low' | 'steady' | 'good' | 'great';
export type PhotoCategory = 'front' | 'side' | 'back' | 'other';
export const HEALTH_SCHEMA_VERSION = 30;
export const LOCAL_OWNER = 'local';
export const GLASS_LITRES = 0.25;
export const KG_PER_LB = 0.45359237;
export const CM_PER_IN = 2.54;
export const HEALTH_MOODS: { value: HealthMood; label: string }[] = [
  { value: 'very-low', label: 'Very low' }, { value: 'low', label: 'Low' },
  { value: 'steady', label: 'Steady' }, { value: 'good', label: 'Good' }, { value: 'great', label: 'Great' },
];
export const MEASUREMENT_TYPES = ['waist', 'hips', 'chest', 'arms', 'thighs', 'neck', 'custom'] as const;
export const PHOTO_CATEGORIES: PhotoCategory[] = ['front', 'side', 'back', 'other'];
export const SUGGESTED_HEALTH_HABITS = ['Drink enough water', 'Exercise', 'Walk', 'Sleep routine', 'Stretching', 'Mindfulness'];

export interface HealthProfile {
  id: ID;
  userId: ID;
  preferredWeightUnit: WeightUnit;
  preferredMeasurementUnit: MeasurementUnit;
  preferredWaterUnit: WaterUnit;
  createdAt: string;
  updatedAt: string;
}
export interface HealthDailyEntry {
  id: ID;
  userId: ID;
  entryDate: DateStr;
  weightKg?: number;
  sleepMinutes?: number;
  waterLitres?: number;
  exerciseMinutes?: number;
  steps?: number;
  mood?: HealthMood;
  energy?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
export interface HealthMeasurement {
  id: ID;
  userId: ID;
  measurementType: string;
  customName?: string;
  /** Canonical value. Never mix units in calculations. */
  value: number;
  unit: 'cm';
  recordedAt: DateStr;
  createdAt: string;
  updatedAt: string;
}
export interface HealthHabit {
  id: ID;
  userId: ID;
  name: string;
  description?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  deactivatedAt?: string;
}
export interface HealthHabitLog {
  id: ID;
  userId: ID;
  habitId: ID;
  entryDate: DateStr;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface HealthNote {
  id: ID;
  userId: ID;
  entryDate: DateStr;
  text: string;
  createdAt: string;
  updatedAt: string;
}
export interface HealthData {
  schemaVersion: number;
  profile: HealthProfile | null;
  dailyEntries: HealthDailyEntry[];
  measurements: HealthMeasurement[];
  habits: HealthHabit[];
  habitLogs: HealthHabitLog[];
  notes: HealthNote[];
  /** Deletion markers prevent an older offline device from resurrecting records. */
  tombstones: Record<ID, string>;
  resetAt?: string;
}
/** Server-only metadata. Never put this entity or image bytes in the app document. */
export interface HealthPhoto {
  id: ID;
  userId: ID;
  entryDate: DateStr;
  category: PhotoCategory;
  privateObjectKey: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  fileSize: number;
  createdAt: string;
  deletionPending: boolean;
}
export type HealthPhotoStatus =
  | { state: 'local-only' | 'signed-out' | 'checking' }
  | { state: 'ready'; photoCount: number }
  | { state: 'unavailable'; message: string };

export function emptyHealthData(): HealthData {
  return { schemaVersion: HEALTH_SCHEMA_VERSION, profile: null, dailyEntries: [], measurements: [], habits: [], habitLogs: [], notes: [], tombstones: {} };
}
