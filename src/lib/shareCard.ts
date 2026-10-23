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
/* 纸本调色：只在此处写十六进制（canvas 绘图）。 */
const PAPER = "#F4EFE6";
const INK = "#241F1A";
const SOFT = "#6F675A";
const SEAL = "#A83A28";
const MOSS = "#4F6B57";
const HEAT = ["#E8E0D1", "#DFC0B4", "#D9A492", "#C67A62", "#A83A28"];

function paperFrame(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const r = 18;
  const x = 34,
    y = 34,
    right = w - 34,
    bottom = h - 34;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(right, y, right, bottom, r);
  ctx.arcTo(right, bottom, x, bottom, r);
  ctx.arcTo(x, bottom, x, y, r);
  ctx.arcTo(x, y, right, y, r);
  ctx.closePath();
  ctx.strokeStyle = HEAT[0];
  ctx.lineWidth = 2;
  ctx.stroke();
}
export async function renderShareCard(
  data: ShareSummary,
  includeHeat: boolean,
): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = 1080;
  c.height = includeHeat ? 1280 : 1000;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("分享图生成失败");

  const w = c.width;
  const pad = 84;
  const right = w - pad;

  /* 纸底与细线纸框 */
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, w, c.height);
  paperFrame(ctx, w, c.height);

  /* 朱砂短横（印章式眉线） */
  ctx.fillStyle = SEAL;
  ctx.fillRect(pad, 112, 64, 9);

  /* 宋体大标题 */
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = INK;
  ctx.font = '600 64px "Songti SC","STSong",serif';
  ctx.fillText("我的统计", pad, 246);

  /* 落款小字 */
  ctx.fillStyle = SOFT;
  ctx.font = '30px "PingFang SC",sans-serif';
  ctx.fillText("私记 · 匿名统计", pad, 312);

  /* 细线分隔 */
  ctx.strokeStyle = HEAT[0];
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pad, 372);
  ctx.lineTo(right, 372);
  ctx.stroke();

  /* 三行小结：左标签 + 右侧宋体数字 */
  const rows: [string, string][] = [
    ["连续记录", `${data.current} 天`],
    ["最长连续", `${data.longest} 天`],
    ["佩戴总时长", `${data.hours} 小时`],
  ];
  const bases = [470, 660, 850];
  rows.forEach(([label, value], i) => {
    const base = bases[i];
    ctx.textAlign = "left";
    ctx.fillStyle = SOFT;
    ctx.font = '30px "PingFang SC",sans-serif';
    ctx.fillText(label, pad, base - 70);
    ctx.textAlign = "right";
    ctx.fillStyle = SEAL;
    ctx.font = '700 76px "Songti SC","STSong",serif';
    ctx.fillText(value, right, base);
    ctx.textAlign = "left";
    if (i < rows.length - 1) {
      ctx.strokeStyle = HEAT[0];
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pad, base + 46);
      ctx.lineTo(right, base + 46);
      ctx.stroke();
    }
  });

  /* 里程碑：苔绿小字 + 朱砂小点 */
  const badges = [
    data.longest >= 30 ? "连续 30 天" : "",
    data.hours >= 500 ? "累计 500 小时" : "",
  ].filter(Boolean);
  if (badges.length) {
    ctx.fillStyle = SEAL;
    ctx.beginPath();
    ctx.arc(pad + 8, 936, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = MOSS;
    ctx.font = '30px "PingFang SC",sans-serif';
    ctx.fillText(badges.join(" · "), pad + 30, 946);
  }

  /* 最近 12 周记录剪影 */
  if (includeHeat) {
    ctx.strokeStyle = HEAT[0];
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pad, 992);
    ctx.lineTo(right, 992);
    ctx.stroke();
    ctx.fillStyle = SOFT;
    ctx.font = '30px "PingFang SC",sans-serif';
    ctx.fillText("最近 12 周记录剪影", pad, 1044);
    data.heat.forEach((count, i) => {
      ctx.fillStyle = HEAT[count] ?? HEAT[0];
      ctx.fillRect(
        pad + Math.floor(i / 7) * 74,
        1074 + (i % 7) * 24,
        64,
        16,
      );
    });
  }

  return new Promise((resolve, reject) =>
    c.toBlob((b) => {
      c.width = c.height = 1;
      b ? resolve(b) : reject(new Error("分享图生成失败"));
    }, "image/png"),
  );
}
