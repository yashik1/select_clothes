/**
 * Calendar arithmetic.
 *
 * Pulled out of the component because none of it is about React and all of it
 * is easy to get subtly wrong: local days versus UTC instants, a month grid
 * whose first cell depends on which weekday the 1st lands on, and the merge of
 * what the server says you wore with what you have just told it.
 *
 * Every function here works in **local** days. That is the whole point. The
 * wear log stores UTC instants, so a shirt worn at 9pm in Los Angeles is
 * recorded at 04:00 the next day in UTC — and binning it by the first ten
 * characters of that string would file it under Wednesday on a Tuesday night.
 */

/** A `Date` as the local calendar day it falls on. Never `toISOString`. */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The local day a stored date belongs to.
 *
 * Plans are already plain `YYYY-MM-DD` and are taken at face value — parsing
 * one would reintroduce exactly the timezone shift this exists to avoid, since
 * `new Date("2026-09-20")` is UTC midnight and therefore the 19th anywhere west
 * of Greenwich. Wear logs are full instants and do have to be converted.
 */
export function dayOf(stored: string): string {
  if (stored.length === 10) return stored;
  const d = new Date(stored);
  return Number.isNaN(d.getTime()) ? stored.slice(0, 10) : ymd(d);
}

/** Today, as a local day. */
export function todayYmd(now = new Date()): string {
  return ymd(now);
}

/** A local day `offset` days from `from`, as `YYYY-MM-DD`. */
export function dayFrom(offset: number, from = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
  return ymd(d);
}

export interface Cell {
  date: string;
  dayNumber: number;
  inMonth: boolean;
}

/**
 * Whole weeks, Monday first, covering the given month.
 *
 * Built from local Y/M/D component arithmetic rather than by adding
 * milliseconds, which is what makes it survive a daylight-saving boundary: the
 * `Date` constructor resolves "the 31st day after the 1st" in local time, where
 * adding 31 × 86,400,000 would land an hour out and occasionally on the wrong
 * date entirely.
 */
export function monthGrid(year: number, month: number): Cell[] {
  const first = new Date(year, month, 1);
  // getDay() is Sunday-first; shift so Monday is 0. A month beginning on a
  // Sunday therefore gets a six-day lead-in rather than none.
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - lead);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const total = Math.ceil((lead + daysInMonth) / 7) * 7;

  return Array.from({ length: total }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    return { date: ymd(d), dayNumber: d.getDate(), inMonth: d.getMonth() === month };
  });
}

/**
 * What was worn on a day: the server's record, plus anything confirmed in this
 * session that the server has not sent back yet.
 *
 * **Deduplicated, and that is the entire reason this is a named function.**
 * The override exists to bridge the moment between confirming a wear and the
 * refreshed page arriving — but a refresh re-fetches the server's data while
 * the override lives in component state and survives it. From that point both
 * halves hold the same ids, and a plain concatenation rendered every piece of
 * that day's outfit twice, permanently, for the rest of the session.
 *
 * Keeping the override rather than clearing it on refresh is deliberate: if the
 * refresh never lands, the day still shows what was logged.
 *
 * A Set also collapses one garment appearing in two wear logs on the same day,
 * which is right for a list headed "Worn" — it answers what you wore, not how
 * many times each piece was entered.
 */
export function mergeWorn(
  fromServer: Record<string, string[]>,
  overrides: Record<string, string[]>,
  date: string,
): string[] {
  return [...new Set([...(fromServer[date] ?? []), ...(overrides[date] ?? [])])];
}

/** Wear logs binned by the local day they happened on. */
export function wornByDay(logs: { date: string; garmentIds: string[] }[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const log of logs) {
    const key = dayOf(log.date);
    map[key] = [...(map[key] ?? []), ...log.garmentIds];
  }
  return map;
}

/**
 * How a day reads relative to today, which is what people navigate by.
 *
 * Both operands are anchored to local noon on purpose. Midnight is the one
 * instant a daylight-saving shift can move across a date boundary, and noon is
 * eleven hours clear of it in both directions; `Math.round` then absorbs the
 * remaining hour of wobble so a 23-hour or 25-hour day still counts as one.
 */
export function relativeDay(date: string, today: string): string {
  if (date === today) return "Today";
  const diff = Math.round(
    (new Date(`${date}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86400000,
  );
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return diff > 0 ? `In ${diff} days` : `${-diff} days ago`;
}
