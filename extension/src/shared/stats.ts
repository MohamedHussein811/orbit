// Privacy statistics. Only daily counters are kept: no URLs, hostnames or
// timestamps of individual events, so the stats cannot reveal browsing history.

export const CATEGORIES = ["ads", "trackers", "threats"] as const;
export type Category = (typeof CATEGORIES)[number];
export type Counts = Record<Category, number>;

export const PERIODS = ["today", "7d", "30d", "all"] as const;
export type Period = (typeof PERIODS)[number];

export interface StatsState {
  version: 1;
  since: number;
  days: Record<string, Counts>;
  archived: Counts;
}

export const RETENTION_DAYS = 400;
const DAY_MS = 86_400_000;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function emptyCounts(): Counts {
  return { ads: 0, trackers: 0, threats: 0 };
}

export function emptyStats(now: number = Date.now()): StatsState {
  return { version: 1, since: now, days: {}, archived: emptyCounts() };
}

export function dayKey(time: number): string {
  const d = new Date(time);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

function saneCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function saneCounts(raw: unknown): Counts {
  const source = (raw ?? {}) as Partial<Record<Category, unknown>>;
  const out = emptyCounts();
  for (const category of CATEGORIES) out[category] = saneCount(source[category]);
  return out;
}

/** Rebuilds stats from stored data, dropping anything malformed. */
export function sanitizeStats(raw: unknown, now: number = Date.now()): StatsState {
  if (typeof raw !== "object" || raw === null) return emptyStats(now);
  const source = raw as Partial<StatsState>;
  const days: Record<string, Counts> = {};
  if (typeof source.days === "object" && source.days !== null) {
    for (const [key, value] of Object.entries(source.days)) {
      if (DAY_KEY.test(key)) days[key] = saneCounts(value);
    }
  }
  const since = typeof source.since === "number" && Number.isFinite(source.since) ? source.since : now;
  return { version: 1, since, days, archived: saneCounts(source.archived) };
}

export function addCount(state: StatsState, category: Category, amount: number, time: number): void {
  const key = dayKey(time);
  const bucket = (state.days[key] ??= emptyCounts());
  bucket[category] += amount;
}

/** Moves days older than the retention window into the all-time total. */
export function pruneStats(state: StatsState, now: number): void {
  const cutoff = dayKey(now - RETENTION_DAYS * DAY_MS);
  for (const [key, counts] of Object.entries(state.days)) {
    if (key < cutoff) {
      for (const category of CATEGORIES) state.archived[category] += counts[category];
      delete state.days[key];
    }
  }
}

export function summarize(state: StatsState, period: Period, now: number): Counts {
  const total = emptyCounts();
  const include = (counts: Counts) => {
    for (const category of CATEGORIES) total[category] += counts[category];
  };
  if (period === "all") {
    include(state.archived);
    for (const counts of Object.values(state.days)) include(counts);
    return total;
  }
  const span = period === "today" ? 1 : period === "7d" ? 7 : 30;
  for (let i = 0; i < span; i++) {
    const counts = state.days[dayKey(now - i * DAY_MS)];
    if (counts) include(counts);
  }
  return total;
}

/** Daily series for a chart, oldest first, with empty days filled in. */
export function series(state: StatsState, days: number, now: number): Array<{ day: string; counts: Counts }> {
  const out: Array<{ day: string; counts: Counts }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = dayKey(now - i * DAY_MS);
    out.push({ day, counts: state.days[day] ?? emptyCounts() });
  }
  return out;
}
