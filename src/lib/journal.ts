import {
  defaultSettings,
  type JournalSettings,
  type Entry,
  type WearSession,
} from "./models";
import { sessionIntervals, totalWear, dayKey, parseDay } from "./time";

export const validId = (v: unknown): v is string =>
  typeof v === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(v);
const text = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length <= max;
export function validateSettings(value: unknown): JournalSettings {
  const s = value as JournalSettings;
  if (
    !s ||
    !Array.isArray(s.templates) ||
    s.templates.length > 100 ||
    !Array.isArray(s.fastTags) ||
    s.fastTags.length > 50 ||
    s.fastTags.some((t) => !text(t, 100) || !t.trim()) ||
    !Array.isArray(s.gears) ||
    s.gears.length > 500 ||
    !Number.isInteger(s.breakThresholdMinutes) ||
    s.breakThresholdMinutes < 0 ||
    s.breakThresholdMinutes > 1440
  )
    throw new Error("记录设置格式无效");
  const ids = new Set<string>();
  for (const t of s.templates) {
    if (
      !t ||
      !validId(t.id) ||
      ids.has(t.id) ||
      !text(t.name, 100) ||
      !t.name.trim() ||
      !text(t.text, 10000)
    )
      throw new Error("模板格式无效或重复");
    ids.add(t.id);
  }
  ids.clear();
  for (const g of s.gears) {
    if (
      !g ||
      !validId(g.id) ||
      ids.has(g.id) ||
      !text(g.name, 100) ||
      !g.name.trim() ||
      !text(g.material, 200) ||
      !text(g.size, 200) ||
      !text(g.note, 10000) ||
      typeof g.archived !== "boolean" ||
      ![g.acquired, g.started].every(
        (d) =>
          typeof d === "string" &&
          (d === "" ||
            (/^\d{4}-\d{2}-\d{2}$/.test(d) && dayKey(parseDay(d)) === d)),
      )
    )
      throw new Error("装备档案格式无效或重复");
    ids.add(g.id);
  }
  return s;
}
export function validateLinks(
  entries: Entry[],
  sessions: WearSession[],
  settings = defaultSettings(),
) {
  const gears = new Set(settings.gears.map((g) => g.id));
  const sessionIds = new Set(sessions.map((s) => s.id));
  for (const item of [...entries, ...sessions])
    if (
      item.gearId !== undefined &&
      (!validId(item.gearId) || !gears.has(item.gearId))
    )
      throw new Error("装备关联不存在");
  for (const e of entries)
    if (
      e.sessionId !== undefined &&
      (!validId(e.sessionId) || !sessionIds.has(e.sessionId))
    )
      throw new Error("关联的佩戴时段不存在");
}
export function insights(
  entries: Entry[],
  sessions: WearSession[],
  settings: JournalSettings,
  now: number,
) {
  const mean = (es: Entry[]) => {
    const scored = es.filter((e) => e.comfort !== null);
    return {
      count: scored.length,
      average: scored.length
        ? scored.reduce((n, e) => n + e.comfort!, 0) / scored.length
        : null,
    };
  };
  const elapsed = (e: Entry) => {
    // Never guess historical attribution; only an explicit session link qualifies.
    const s = sessions.find((s) => s.id === e.sessionId);
    if (
      !s ||
      e.wearing !== "on" ||
      e.timestamp < s.start ||
      e.timestamp > (s.end ?? now)
    )
      return null;
    if (
      s.breaks?.some(
        (b) => e.timestamp >= b.start && e.timestamp < (b.end ?? now),
      )
    )
      return null;
    return (
      sessionIntervals(s, e.timestamp).reduce((n, [a, b]) => n + b - a, 0) /
      3600000
    );
  };
  const bands = [
    [0, 12],
    [12, 24],
    [24, 48],
    [48, 72],
    [72, Infinity],
  ];
  return {
    comfort: bands.map(([a, b]) => ({
      name: b === Infinity ? "72h+" : `${a}–${b}h`,
      ...mean(
        entries.filter((e) => {
          const h = elapsed(e);
          return h !== null && h >= a && h < b;
        }),
      ),
    })),
    tags: [...new Set(entries.flatMap((e) => e.tags))].sort().map((name) => ({
      name,
      ...mean(entries.filter((e) => e.tags.includes(name))),
    })),
    hours: Array.from({ length: 24 }, (_, hour) => ({
      name: `${hour}时`,
      count: entries.filter((e) => new Date(e.timestamp).getHours() === hour)
        .length,
      on: entries.filter(
        (e) => new Date(e.timestamp).getHours() === hour && e.wearing === "on",
      ).length,
      off: entries.filter(
        (e) => new Date(e.timestamp).getHours() === hour && e.wearing === "off",
      ).length,
      unspecified: entries.filter(
        (e) =>
          new Date(e.timestamp).getHours() === hour &&
          e.wearing === "unspecified",
      ).length,
    })),
    gears: settings.gears.map((g) => ({
      name: g.name,
      hours:
        totalWear(
          sessions.filter((s) => s.gearId === g.id),
          now,
        ) / 3600000,
      ...mean(entries.filter((e) => e.gearId === g.id)),
    })),
  };
}
