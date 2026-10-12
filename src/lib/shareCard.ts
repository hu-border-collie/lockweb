import type { Entry, WearSession } from "./models";
import { dayKey, shiftDay, summary } from "./time";
export interface ShareSummary {
  current: number;
  longest: number;
  hours: number;
  heat: number[];
}
export function shareSummary(
  entries: Entry[],
  sessions: WearSession[],
  now: number,
): ShareSummary {
  const stats = summary(entries, sessions, now);
  const counts = new Map<string, number>();
  for (const e of entries) {
    const day = dayKey(e.timestamp);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return {
    current: stats.current,
    longest: stats.longest,
    hours: Math.floor(stats.total / 3600000),
    heat: Array.from({ length: 84 }, (_, i) =>
      Math.min(4, counts.get(shiftDay(dayKey(now), i - 83)) ?? 0),
    ),
  };
}
export async function renderShareCard(
  data: ShareSummary,
  includeHeat: boolean,
): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = 1080;
  c.height = includeHeat ? 1280 : 1000;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("无法生成战报");
  ctx.fillStyle = "#f6f7f9";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#5268d9";
  ctx.fillRect(80, 100, 70, 10);
  ctx.fillStyle = "#202b3e";
  ctx.font = "bold 64px sans-serif";
  ctx.fillText("日常，慢慢积累。", 80, 240);
  ctx.font = "30px sans-serif";
  ctx.fillStyle = "#647087";
  ctx.fillText("私记 · 我的记录成果", 80, 310);
  for (const [label, value, y] of [
    ["连续打卡", `${data.current} 天`, 470],
    ["历史最长连续", `${data.longest} 天`, 650],
    ["累计佩戴", `${data.hours} 小时`, 830],
  ] as const) {
    ctx.font = "28px sans-serif";
    ctx.fillStyle = "#647087";
    ctx.fillText(label, 80, y - 65);
    ctx.font = "bold 72px sans-serif";
    ctx.fillStyle = "#5268d9";
    ctx.fillText(value, 80, y);
  }
  const badges = [
    data.longest >= 30 ? "30 天记录里程碑" : "",
    data.hours >= 500 ? "500 小时记录里程碑" : "",
  ].filter(Boolean);
  ctx.font = "26px sans-serif";
  ctx.fillStyle = "#328d80";
  ctx.fillText(badges.join(" · "), 80, 915);
  if (includeHeat) {
    ctx.fillStyle = "#647087";
    ctx.font = "26px sans-serif";
    ctx.fillText("最近 12 周记录剪影", 80, 1005);
    data.heat.forEach((count, i) => {
      ctx.fillStyle = ["#e1e5ef", "#c0c8ef", "#9aa9e5", "#7387df", "#5268d9"][
        count
      ];
      ctx.fillRect(80 + Math.floor(i / 7) * 75, 1040 + (i % 7) * 24, 65, 16);
    });
  }
  return new Promise((resolve, reject) =>
    c.toBlob((b) => {
      c.width = c.height = 1;
      b ? resolve(b) : reject(new Error("战报生成失败"));
    }, "image/png"),
  );
}
