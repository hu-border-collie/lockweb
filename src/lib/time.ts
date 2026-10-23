import type { Entry, WearSession } from "./models";
export function dayKey(time: number | Date) {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function parseDay(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function shiftDay(day: string, by: number) {
  const d = parseDay(day);
  d.setDate(d.getDate() + by);
  return dayKey(d);
}
export const localInput = (time: number) => {
  const d = new Date(time);
  return `${dayKey(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
export const fromInput = (value: string) => new Date(value).getTime();
export function intervals(
  sessions: WearSession[],
  now = Date.now(),
): [number, number][] {
  const sorted = sessions
    .flatMap((s) => sessionIntervals(s, now))
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
    .sort((a, b) => a[0] - b[0]);
  const result: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = result.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else result.push([a, b]);
  }
  return result;
}
export function sessionIntervals(
  s: WearSession,
  now = Date.now(),
): [number, number][] {
  const stop = Math.min(s.end ?? now, now);
  let cursor = s.start;
  const result: [number, number][] = [];
  for (const b of s.breaks ?? []) {
    const start = Math.min(b.start, stop),
      end = Math.min(b.end ?? now, stop);
    if (start > cursor) result.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < stop) result.push([cursor, stop]);
  return result;
}
export function longestContinuous(
  s: WearSession,
  now: number,
  thresholdMinutes: number,
) {
  // Short breaks preserve the cycle, but never contribute to actual worn time.
  const stop = Math.min(s.end ?? now, now);
  let cursor = s.start,
    run = 0,
    longest = 0;
  for (const b of s.breaks ?? []) {
    if (b.start >= stop) break;
    run += Math.max(0, b.start - cursor);
    longest = Math.max(longest, run);
    if (Math.min(b.end ?? now, stop) - b.start > thresholdMinutes * 60000)
      run = 0;
    cursor = Math.min(b.end ?? now, stop);
  }
  return Math.max(longest, run + Math.max(0, stop - cursor));
}
export const totalWear = (sessions: WearSession[], now = Date.now()) =>
  intervals(sessions, now).reduce((n, [a, b]) => n + b - a, 0);
export function dailyWear(sessions: WearSession[], now = Date.now()) {
  const result: Record<string, number> = {};
  for (const [start, end] of intervals(sessions, now)) {
    let cursor = start;
    while (cursor < end) {
      const next = new Date(cursor);
      next.setHours(24, 0, 0, 0);
      const stop = Math.min(end, next.getTime());
      const key = dayKey(cursor);
      result[key] = (result[key] ?? 0) + stop - cursor;
      cursor = stop;
    }
  }
  return result;
}
export function streaks(entries: Entry[], now = Date.now()) {
  const days = [
    ...new Set(
      entries.map((e) => dayKey(e.timestamp)).filter((d) => d <= dayKey(now)),
    ),
  ].sort();
  let longest = 0,
    run = 0,
    previous = "";
  for (const d of days) {
    run = previous && shiftDay(previous, 1) === d ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = d;
  }
  const set = new Set(days);
  let d = dayKey(now);
  if (!set.has(d)) d = shiftDay(d, -1);
  let current = 0;
  while (set.has(d)) {
    current++;
    d = shiftDay(d, -1);
  }
  return { current, longest };
}
export function summary(
  entries: Entry[],
  sessions: WearSession[],
  now = Date.now(),
  thresholdMinutes = 30,
) {
  const today = dayKey(now);
  const date = new Date(now);
  const weekStart = shiftDay(today, -((date.getDay() + 6) % 7));
  const monthStart = today.slice(0, 7) + "-01";
  return {
    today: entries.filter((e) => dayKey(e.timestamp) === today).length,
    week: entries.filter(
      (e) => dayKey(e.timestamp) >= weekStart && e.timestamp <= now,
    ).length,
    month: entries.filter(
      (e) => dayKey(e.timestamp) >= monthStart && e.timestamp <= now,
    ).length,
    photos: entries.reduce((n, e) => n + e.photoIds.length, 0),
    total: totalWear(sessions, now),
    longestWear: Math.max(
      0,
      ...sessions.map((s) => longestContinuous(s, now, thresholdMinutes)),
    ),
    ...streaks(entries, now),
  };
}
export function duration(ms: number, seconds = false) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  return seconds
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
    : `${hours} 小时 ${minutes} 分钟`;
}
export const dateTime = (ts: number) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(ts);
export const clock = (ts: number) =>
  new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(ts);
export function validateSession(session: WearSession, now = Date.now()) {
  if (
    !Number.isFinite(session.start) ||
    session.start > now ||
    session.start < 0
  )
    throw new Error("开始时间必须是有效的过去时间");
  if (
    session.end !== null &&
    (!Number.isFinite(session.end) ||
      session.end <= session.start ||
      session.end > now)
  )
    throw new Error("结束时间应晚于开始时间，且不能在未来");
  if (
    session.breaks !== undefined &&
    (!Array.isArray(session.breaks) || session.breaks.length > 10000)
  )
    throw new Error("暂停记录格式无效");
  let previous = session.start;
  for (const [i, b] of (session.breaks ?? []).entries()) {
    if (
      !b ||
      !Number.isFinite(b.start) ||
      b.start < previous ||
      b.start > (session.end ?? now) ||
      (b.note !== undefined &&
        (typeof b.note !== "string" || b.note.length > 10000)) ||
      (b.end === null
        ? session.end !== null || i !== session.breaks!.length - 1
        : !Number.isFinite(b.end) ||
          b.end <= b.start ||
          b.end > (session.end ?? now))
    )
      throw new Error("暂停必须位于时段内，不能重叠，进行中的暂停只能在末尾");
    previous = b.end ?? now;
  }
}
