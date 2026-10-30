import { addDays, diffDays, todayStr } from '../dates';
import { uid } from '../uid';
import {
  emptyHealthData, HEALTH_SCHEMA_VERSION, HEALTH_MOODS, MEASUREMENT_TYPES,
  type HealthData, type HealthDailyEntry, type HealthMeasurement, type HealthHabit,
  type HealthHabitLog, type HealthNote, type HealthProfile, type HealthMood,
} from './types';

export type DailyInput = {
  entryDate: string; weightKg?: string; sleepHours?: string; sleepMinutes?: string;
  waterLitres?: string; exerciseMinutes?: string; steps?: string; mood?: string; energy?: string; notes?: string;
};
export type Validation = { ok: true; value: DailyInput } | { ok: false; errors: Record<string, string> };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 4000): string | undefined => typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;
const stamp = (v: unknown): string => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : new Date().toISOString();
const number = (v: unknown, min: number, max: number, integer = false): number | undefined => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) return undefined;
  return v;
};
export function isHealthDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return y >= 1900 && y <= 2100 && date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}
const entryDateValid = (v: unknown, today: string): v is string => isHealthDate(v) && v <= today;
const byDate = <T extends { entryDate?: string; recordedAt?: string }>(a: T, b: T) => (a.entryDate ?? a.recordedAt ?? '').localeCompare(b.entryDate ?? b.recordedAt ?? '');

/** Blank is missing, never zero. Explicit zero is retained for water/exercise/steps. */
export function validateDailyInput(input: DailyInput, today = todayStr()): Validation {
  const errors: Record<string, string> = {};
  if (!entryDateValid(input.entryDate, today)) errors.entryDate = 'Choose a valid date, today or in the past.';
  const rules: [keyof DailyInput, number, number, boolean, string][] = [
    ['weightKg', 0.1, 700, false, 'Weight must be between 0.1 and 700 kg.'],
    ['sleepHours', 0, 24, true, 'Sleep hours must be a whole number from 0 to 24.'],
    ['sleepMinutes', 0, 59, true, 'Sleep minutes must be a whole number from 0 to 59.'],
    ['waterLitres', 0, 30, false, 'Water must be between 0 and 30 litres.'],
    ['exerciseMinutes', 0, 1440, true, 'Exercise must be between 0 and 1,440 minutes.'],
    ['steps', 0, 200000, true, 'Steps must be a whole number from 0 to 200,000.'],
    ['energy', 1, 5, true, 'Energy must be a whole number from 1 to 5.'],
  ];
  for (const [key, min, max, integer, message] of rules) {
    const raw = input[key]?.trim();
    if (raw && number(Number(raw), min, max, integer) === undefined) errors[key] = message;
  }
  const hours = Number(input.sleepHours || 0), minutes = Number(input.sleepMinutes || 0);
  if (!errors.sleepHours && !errors.sleepMinutes && hours * 60 + minutes > 1440) errors.sleepHours = 'Total sleep cannot exceed 24 hours.';
  if (input.mood?.trim() && !HEALTH_MOODS.some((m) => m.value === input.mood)) errors.mood = 'Choose a listed mood or leave it blank.';
  if ((input.notes?.length ?? 0) > 4000) errors.notes = 'Keep notes under 4,000 characters.';
  if (Object.keys(errors).length) return { ok: false, errors };
  const hasMetric = rules.some(([key]) => !!input[key]?.trim()) || !!input.mood?.trim() || !!input.notes?.trim();
  if (!hasMetric) return { ok: false, errors: { form: 'Add at least one observation. Blank fields will stay unrecorded.' } };
  return { ok: true, value: input };
}
export function dailyValues(input: DailyInput): Omit<HealthDailyEntry, 'id' | 'userId' | 'createdAt' | 'updatedAt'> {
  const n = (key: keyof DailyInput) => input[key]?.trim() ? Number(input[key]) : undefined;
  const sleep = input.sleepHours?.trim() || input.sleepMinutes?.trim() ? Number(input.sleepHours || 0) * 60 + Number(input.sleepMinutes || 0) : undefined;
  return { entryDate: input.entryDate, weightKg: n('weightKg'), sleepMinutes: sleep, waterLitres: n('waterLitres'), exerciseMinutes: n('exerciseMinutes'), steps: n('steps'), mood: input.mood?.trim() as HealthMood | undefined, energy: n('energy'), notes: text(input.notes) };
}
export function upsertDaily(data: HealthData, userId: string, input: DailyInput, now = new Date().toISOString(), today = todayStr()): HealthData {
  const result = validateDailyInput(input, today);
  if (!result.ok) throw new Error(Object.values(result.errors)[0]);
  const existing = data.dailyEntries.find((e) => e.userId === userId && e.entryDate === input.entryDate);
  const entry: HealthDailyEntry = { ...dailyValues(input), id: existing?.id ?? uid('health-day'), userId, createdAt: existing?.createdAt ?? now, updatedAt: now };
  return { ...data, dailyEntries: [...data.dailyEntries.filter((e) => e.id !== entry.id), entry].sort(byDate) };
}
export function deleteDaily(data: HealthData, id: string, now = new Date().toISOString()): HealthData {
  return { ...data, dailyEntries: data.dailyEntries.filter((e) => e.id !== id), tombstones: { ...data.tombstones, [id]: now } };
}
export function measurementLabel(m: Pick<HealthMeasurement, 'measurementType' | 'customName'>): string {
  return m.measurementType === 'custom' ? m.customName || 'Custom' : m.measurementType.charAt(0).toUpperCase() + m.measurementType.slice(1);
}
export function validateMeasurement(input: { recordedAt: string; measurementType: string; customName?: string; value: number }, today = todayStr()): string | null {
  if (!entryDateValid(input.recordedAt, today)) return 'Choose a valid date, today or in the past.';
  if (![...MEASUREMENT_TYPES].includes(input.measurementType as typeof MEASUREMENT_TYPES[number])) return 'Choose a measurement type.';
  if (input.measurementType === 'custom' && !text(input.customName, 60)) return 'Name your custom measurement (up to 60 characters).';
  if (number(input.value, 1, 500) === undefined) return 'Measurement must be between 1 and 500 cm.';
  return null;
}
export function upsertMeasurement(data: HealthData, userId: string, input: { id?: string; recordedAt: string; measurementType: string; customName?: string; value: number }, now = new Date().toISOString(), today = todayStr()): HealthData {
  const error = validateMeasurement(input, today); if (error) throw new Error(error);
  const label = input.measurementType === 'custom' ? text(input.customName, 60)?.toLowerCase() : input.measurementType;
  const existing = data.measurements.find((m) => m.userId === userId && (input.id ? m.id === input.id : m.recordedAt === input.recordedAt && m.measurementType === input.measurementType && (m.measurementType !== 'custom' || m.customName?.toLowerCase() === label)));
  const m: HealthMeasurement = { id: existing?.id ?? uid('health-measure'), userId, recordedAt: input.recordedAt, measurementType: input.measurementType, customName: input.measurementType === 'custom' ? text(input.customName, 60) : undefined, value: input.value, unit: 'cm', createdAt: existing?.createdAt ?? now, updatedAt: now };
  return { ...data, measurements: [...data.measurements.filter((x) => x.id !== m.id), m].sort(byDate) };
}
export function deleteMeasurement(data: HealthData, id: string, now = new Date().toISOString()): HealthData {
  return { ...data, measurements: data.measurements.filter((m) => m.id !== id), tombstones: { ...data.tombstones, [id]: now } };
}
export function saveHabit(data: HealthData, userId: string, input: { id?: string; name: string; description?: string; active?: boolean }, now = new Date().toISOString()): HealthData {
  const name = text(input.name, 80); if (!name) throw new Error('Give your habit a name (up to 80 characters).');
  const existing = data.habits.find((h) => h.id === input.id && h.userId === userId);
  if (data.habits.some((h) => h.userId === userId && h.id !== existing?.id && h.name.toLowerCase() === name.toLowerCase())) throw new Error('A habit with this name already exists.');
  const active = input.active ?? existing?.active ?? true;
  const h: HealthHabit = { id: existing?.id ?? uid('health-habit'), userId, name, description: text(input.description, 500), active, createdAt: existing?.createdAt ?? now, updatedAt: now, deactivatedAt: active ? undefined : existing?.deactivatedAt ?? now };
  return { ...data, habits: [...data.habits.filter((x) => x.id !== h.id), h] };
}
export function setHabitCompletion(data: HealthData, userId: string, habitId: string, date: string, completed: boolean, now = new Date().toISOString(), today = todayStr()): HealthData {
  if (!entryDateValid(date, today)) throw new Error('Choose a valid date, today or in the past.');
  const habit = data.habits.find((h) => h.id === habitId && h.userId === userId);
  if (!habit) throw new Error('Habit not found.');
  if (date < habit.createdAt.slice(0, 10)) throw new Error('This habit did not exist on that date.');
  const existing = data.habitLogs.find((l) => l.habitId === habitId && l.entryDate === date && l.userId === userId);
  const log: HealthHabitLog = { id: existing?.id ?? uid('health-log'), userId, habitId, entryDate: date, completed, createdAt: existing?.createdAt ?? now, updatedAt: now };
  return { ...data, habitLogs: [...data.habitLogs.filter((l) => l.id !== log.id), log] };
}
export function addHealthNote(data: HealthData, userId: string, date: string, value: string, now = new Date().toISOString(), today = todayStr()): HealthData {
  const note = text(value); if (!note) throw new Error('Write a note before saving.');
  if (!entryDateValid(date, today)) throw new Error('Choose a valid date, today or in the past.');
  const n: HealthNote = { id: uid('health-note'), userId, entryDate: date, text: note, createdAt: now, updatedAt: now };
  return { ...data, notes: [...data.notes, n] };
}
export function saveHealthProfile(data: HealthData, userId: string, patch: Partial<Pick<HealthProfile, 'preferredWeightUnit' | 'preferredMeasurementUnit' | 'preferredWaterUnit'>>, now = new Date().toISOString()): HealthData {
  const previous = data.profile;
  const profile: HealthProfile = { id: previous?.id ?? uid('health-profile'), userId, preferredWeightUnit: patch.preferredWeightUnit ?? previous?.preferredWeightUnit ?? 'kg', preferredMeasurementUnit: patch.preferredMeasurementUnit ?? previous?.preferredMeasurementUnit ?? 'cm', preferredWaterUnit: patch.preferredWaterUnit ?? previous?.preferredWaterUnit ?? 'litres', createdAt: previous?.createdAt ?? now, updatedAt: now };
  return { ...data, profile };
}
export function clearHealthData(userId: string, now = new Date().toISOString()): HealthData {
  return { ...emptyHealthData(), profile: null, resetAt: now, tombstones: { [`${userId}:reset`]: now } };
}

/** Validate persisted/imported records without turning missing observations into zero. */
export function normalizeHealthData(input: unknown, userId?: string): HealthData {
  const out = emptyHealthData();
  if (!object(input)) return out;
  const owned = (v: Record<string, unknown>) => typeof v.id === 'string' && !!v.id && typeof v.userId === 'string' && !!v.userId && (!userId || v.userId === userId);
  if (object(input.profile) && owned(input.profile)) {
    const p = input.profile;
    out.profile = { id: p.id as string, userId: p.userId as string, preferredWeightUnit: p.preferredWeightUnit === 'lb' ? 'lb' : 'kg', preferredMeasurementUnit: p.preferredMeasurementUnit === 'in' ? 'in' : 'cm', preferredWaterUnit: p.preferredWaterUnit === 'glasses' ? 'glasses' : 'litres', createdAt: stamp(p.createdAt), updatedAt: stamp(p.updatedAt) };
  }
  if (Array.isArray(input.dailyEntries)) {
    const dates = new Set<string>();
    out.dailyEntries = input.dailyEntries.filter(object).filter(owned).filter((e) => entryDateValid(e.entryDate, '2100-12-31')).sort((a,b) => stamp(b.updatedAt).localeCompare(stamp(a.updatedAt))).filter((e) => { const key = `${e.userId}:${e.entryDate}`; if (dates.has(key)) return false; dates.add(key); return true; }).map((e) => ({ id: e.id as string, userId: e.userId as string, entryDate: e.entryDate as string, weightKg: number(e.weightKg, 0.1, 700), sleepMinutes: number(e.sleepMinutes, 0, 1440, true), waterLitres: number(e.waterLitres, 0, 30), exerciseMinutes: number(e.exerciseMinutes, 0, 1440, true), steps: number(e.steps, 0, 200000, true), mood: HEALTH_MOODS.some((m) => m.value === e.mood) ? e.mood as HealthMood : undefined, energy: number(e.energy, 1, 5, true), notes: text(e.notes), createdAt: stamp(e.createdAt), updatedAt: stamp(e.updatedAt) })).sort(byDate);
  }
  if (Array.isArray(input.measurements)) out.measurements = input.measurements.filter(object).filter(owned).filter((m) => !validateMeasurement({ recordedAt: String(m.recordedAt), measurementType: String(m.measurementType), customName: typeof m.customName === 'string' ? m.customName : undefined, value: Number(m.value) }, '2100-12-31')).map((m) => ({ id: m.id as string, userId: m.userId as string, recordedAt: m.recordedAt as string, measurementType: m.measurementType as string, customName: text(m.customName, 60), value: Number(m.value), unit: 'cm' as const, createdAt: stamp(m.createdAt), updatedAt: stamp(m.updatedAt) })).sort(byDate);
  if (Array.isArray(input.habits)) out.habits = input.habits.filter(object).filter(owned).filter((h) => !!text(h.name, 80)).map((h) => ({ id: h.id as string, userId: h.userId as string, name: text(h.name, 80)!, description: text(h.description, 500), active: h.active !== false, createdAt: stamp(h.createdAt), updatedAt: stamp(h.updatedAt), deactivatedAt: typeof h.deactivatedAt === 'string' ? h.deactivatedAt : undefined }));
  const habitIds = new Set(out.habits.map((h) => h.id));
  if (Array.isArray(input.habitLogs)) {
    const logs = new Map<string, Record<string, unknown>>();
    for (const l of input.habitLogs.filter(object).filter(owned).filter((l) => typeof l.habitId === 'string' && habitIds.has(l.habitId) && entryDateValid(l.entryDate, '2100-12-31')).sort((a,b) => stamp(b.updatedAt).localeCompare(stamp(a.updatedAt)))) {
      const key = `${l.userId}:${l.habitId}:${l.entryDate}`; if (!logs.has(key)) logs.set(key, l);
    }
    out.habitLogs = [...logs.values()].map((l) => ({ id: l.id as string, userId: l.userId as string, habitId: l.habitId as string, entryDate: l.entryDate as string, completed: l.completed === true, createdAt: stamp(l.createdAt), updatedAt: stamp(l.updatedAt) }));
  }
  if (Array.isArray(input.notes)) out.notes = input.notes.filter(object).filter(owned).filter((n) => entryDateValid(n.entryDate, '2100-12-31') && !!text(n.text)).map((n) => ({ id: n.id as string, userId: n.userId as string, entryDate: n.entryDate as string, text: text(n.text)!, createdAt: stamp(n.createdAt), updatedAt: stamp(n.updatedAt) }));
  if (object(input.tombstones)) for (const [id, at] of Object.entries(input.tombstones)) if (typeof at === 'string' && Number.isFinite(Date.parse(at))) out.tombstones[id] = at;
  if (typeof input.resetAt === 'string' && Number.isFinite(Date.parse(input.resetAt))) out.resetAt = input.resetAt;
  out.schemaVersion = HEALTH_SCHEMA_VERSION;
  return out;
}
export function healthForOwner(data: HealthData | undefined, userId: string): HealthData {
  if (!data) return emptyHealthData();
  const owners = [data.profile?.userId, ...data.dailyEntries.map((x) => x.userId), ...data.measurements.map((x) => x.userId), ...data.habits.map((x) => x.userId)];
  if (owners.some((owner) => owner && owner !== userId)) return emptyHealthData();
  return normalizeHealthData(data, userId);
}
function mergeRecords<T extends { id: string; updatedAt: string }>(a: T[], b: T[], tombstones: Record<string, string>, resetAt?: string): T[] {
  const map = new Map<string, T>();
  for (const record of [...a, ...b]) {
    if (tombstones[record.id] >= record.updatedAt || (resetAt && resetAt >= record.updatedAt)) continue;
    const previous = map.get(record.id);
    if (!previous || record.updatedAt > previous.updatedAt) map.set(record.id, record);
  }
  return [...map.values()];
}
/** Record-level LWW + tombstones, inside the existing single document store. */
export function mergeHealthData(a: HealthData, b: HealthData, userId: string): HealthData {
  const local = healthForOwner(a, userId), remote = healthForOwner(b, userId);
  const tombstones = { ...local.tombstones };
  for (const [id, at] of Object.entries(remote.tombstones)) if (!tombstones[id] || at > tombstones[id]) tombstones[id] = at;
  const resetAt = [local.resetAt, remote.resetAt].filter((x): x is string => !!x).sort().at(-1);
  if (resetAt && resetAt >= (local.tombstones[`${userId}:reset`] ?? '')) tombstones[`${userId}:reset`] = resetAt;
  const profile = [local.profile, remote.profile].filter((p): p is HealthProfile => !!p && (!resetAt || p.updatedAt > resetAt)).sort((x,y) => y.updatedAt.localeCompare(x.updatedAt))[0] ?? null;
  const merged: HealthData = { schemaVersion: HEALTH_SCHEMA_VERSION, profile, dailyEntries: mergeRecords(local.dailyEntries, remote.dailyEntries, tombstones, resetAt).sort(byDate), measurements: mergeRecords(local.measurements, remote.measurements, tombstones, resetAt).sort(byDate), habits: mergeRecords(local.habits, remote.habits, tombstones, resetAt), habitLogs: mergeRecords(local.habitLogs, remote.habitLogs, tombstones, resetAt), notes: mergeRecords(local.notes, remote.notes, tombstones, resetAt), tombstones, resetAt };
  return normalizeHealthData(merged, userId);
}

export type WeightRange = '7d' | '30d' | '90d' | '6m' | '1y' | 'all';
export const WEIGHT_RANGES: { value: WeightRange; label: string }[] = [{ value: '7d', label: '7 days' }, { value: '30d', label: '30 days' }, { value: '90d', label: '90 days' }, { value: '6m', label: '6 months' }, { value: '1y', label: '1 year' }, { value: 'all', label: 'All time' }];
export function rangeStart(range: WeightRange, today = todayStr()): string | undefined {
  if (range === 'all') return undefined;
  return addDays(today, -(({ '7d': 7, '30d': 30, '90d': 90, '6m': 183, '1y': 365 }[range]) - 1));
}
export function weightEntries(data: HealthData, from?: string, to = todayStr()): HealthDailyEntry[] {
  return data.dailyEntries.filter((e) => e.weightKg !== undefined && (!from || e.entryDate >= from) && e.entryDate <= to).sort(byDate);
}
export function average(values: number[]): number | null {
  return values.length ? values.reduce((a,b) => a + b, 0) / values.length : null;
}
export function weightStats(data: HealthData, today = todayStr()) {
  const all = weightEntries(data, undefined, today), latest = all.at(-1), previous = all.at(-2);
  const weekly = average(weightEntries(data, addDays(today, -6), today).map((e) => e.weightKg!));
  const monthly = average(weightEntries(data, addDays(today, -29), today).map((e) => e.weightKg!));
  return { latest, previous, count: all.length, previousChange: latest?.weightKg !== undefined && previous?.weightKg !== undefined ? latest.weightKg - previous.weightKg : null, totalChange: latest?.weightKg !== undefined && all[0]?.weightKg !== undefined ? latest.weightKg - all[0].weightKg : null, weekly, monthly };
}
/** Null break prevents a line implying observations across a gap >7 days. */
export function weightChartSeries(entries: HealthDailyEntry[], maxGapDays = 7) {
  const sorted = [...entries].filter((e) => e.weightKg !== undefined).sort(byDate);
  const rows: Record<string, number | string | null>[] = [];
  let segment = 0;
  sorted.forEach((entry, i) => {
    if (i && diffDays(sorted[i - 1].entryDate, entry.entryDate) > maxGapDays) segment++;
    const row: Record<string, number | string | null> = { date: entry.entryDate, time: Date.parse(`${entry.entryDate}T00:00:00Z`), recorded: null };
    row[`segment${segment}`] = entry.weightKg!;
    rows.push(row);
  });
  return { rows, segments: sorted.length ? segment + 1 : 0 };
}
export function measurementsOn(data: HealthData, date: string): HealthMeasurement[] {
  const map = new Map<string, HealthMeasurement>();
  for (const m of data.measurements.filter((m) => m.recordedAt === date)) map.set(measurementLabel(m).toLowerCase(), m);
  return [...map.values()];
}
export function measurementDifferences(data: HealthData, from: string, to: string) {
  const a = measurementsOn(data, from), b = measurementsOn(data, to);
  return [...new Set([...a, ...b].map((m) => measurementLabel(m).toLowerCase()))].map((key) => {
    const before = a.find((m) => measurementLabel(m).toLowerCase() === key), after = b.find((m) => measurementLabel(m).toLowerCase() === key);
    return { label: measurementLabel(before ?? after!), before: before?.value ?? null, after: after?.value ?? null, difference: before && after ? after.value - before.value : null };
  });
}
export function habitConsistency(data: HealthData, habit: HealthHabit, from: string, to = todayStr()) {
  const start = [from, habit.createdAt.slice(0, 10)].sort().at(-1)!;
  const end = habit.active ? to : [to, (habit.deactivatedAt ?? habit.updatedAt).slice(0, 10)].sort()[0];
  const possible = Math.max(0, diffDays(start, end) + 1);
  const completed = data.habitLogs.filter((l) => l.habitId === habit.id && l.completed && l.entryDate >= start && l.entryDate <= end).length;
  return { completed, possible, percent: possible ? Math.round(completed / possible * 100) : null };
}
export function healthSummary(data: HealthData, from: string, to: string, photoCount: number | null) {
  const entries = data.dailyEntries.filter((e) => e.entryDate >= from && e.entryDate <= to);
  const weights = weightEntries(data, from, to);
  const activeHabits = data.habits.filter((h) => h.active || (h.deactivatedAt ?? h.updatedAt).slice(0,10) >= from);
  const consistency = activeHabits.map((h) => habitConsistency(data, h, from, to));
  const possible = consistency.reduce((a,c) => a + c.possible, 0), completed = consistency.reduce((a,c) => a + c.completed, 0);
  return { checkInDays: entries.length, weightChange: weights.length > 1 ? weights.at(-1)!.weightKg! - weights[0].weightKg! : null, weightRecords: weights.length, habitCompleted: completed, habitPossible: possible, habitPercent: possible ? Math.round(completed / possible * 100) : null, photoCount, measurementCount: data.measurements.filter((m) => m.recordedAt >= from && m.recordedAt <= to).length, noteCount: data.notes.filter((n) => n.entryDate >= from && n.entryDate <= to).length };
}
export function healthExport(data: HealthData, userId: string) {
  return { schemaVersion: HEALTH_SCHEMA_VERSION, exportedAt: new Date().toISOString(), app: 'growth-os-health', userId, records: healthForOwner(data, userId), photos: 'Metadata and original files are available separately through the private photo service; no image bytes or signed URLs are included.' };
}
