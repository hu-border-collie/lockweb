import type { Entry } from "./models";
import { dayKey } from "./time";
export type FateKind = "reward" | "neutral" | "extra" | "task";
export type FateMode = "ritual" | "free";
export interface FateSlice {
    id: string;
    label: string;
    kind: FateKind;
    weight: number;
    color: string;
    extraMinutes: number;
}
export interface FateConfig {
    name: string;
    mode: FateMode;
    slices: FateSlice[];
}
export interface FateDraw {
    id: string;
    timestamp: number;
    day: string;
    timezoneOffset: number;
    mode: FateMode;
    wheelName: string;
    slice: FateSlice;
    totalWeight: number;
    sessionId?: string;
    attachedEntryId?: string;
}
export interface FateState {
    version: 1;
    config: FateConfig;
    draws: FateDraw[];
}
export const FATE_META = "fate-state";
export const MAX_FATE_DRAWS = 20000;
export const kindNames: Record<FateKind, string> = {
    reward: "奖励", neutral: "中性", extra: "加时", task: "任务",
};
export const FATE_COLORS = ["#A83A28", "#4F6B57", "#B07C3F", "#5B6480", "#7E5A6B", "#7A6A3F"];
/** 今日仪式可转动时 ritualStatus 的唯一返回值，db 层与界面共用。 */
export const RITUAL_READY = "今天的仪式已经点亮";
export function fatePreset(hard = false, mode: FateMode = "ritual"): FateConfig {
    const items: [
        string,
        FateKind,
        number,
        number
    ][] = hard
        ? [["准假小憩", "reward", 20, 0], ["追加 6 小时", "extra", 35, 360], ["追加 12 小时", "extra", 25, 720], ["追加 24 小时", "extra", 19, 1440], ["提前结束", "reward", 1, 0]]
        : [["平安度过", "neutral", 50, 0], ["清洁小憩 30 分钟", "reward", 20, 0], ["补拍一张细节", "task", 20, 0], ["慢慢护理一下", "task", 10, 0]];
    return { name: hard ? "硬核加时博弈" : "温和日常", mode, slices: items.map(([label, kind, weight, extraMinutes], i) => ({
            id: `preset-${hard ? "hard" : "gentle"}-${i}`, label, kind, weight, extraMinutes, color: FATE_COLORS[i],
        })) };
}
export const defaultFate = (): FateState => ({ version: 1, config: fatePreset(), draws: [] });
const validId = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(v);
const label = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v.length <= 100;
const mode = (v: unknown) => v === "ritual" || v === "free";
function validateSlice(s: FateSlice) {
    if (!s || !validId(s.id) || !label(s.label) || !Object.hasOwn(kindNames, s.kind) ||
        !Number.isInteger(s.weight) || s.weight < 1 || s.weight > 10000 ||
        typeof s.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(s.color) ||
        !Number.isInteger(s.extraMinutes) || s.extraMinutes < 0 || s.extraMinutes > 10080 ||
        (s.kind === "extra" ? s.extraMinutes < 1 : s.extraMinutes !== 0))
        throw new Error("扇区无效：名称最多 100 字，权重须为 1–10000 的整数，加时须为 1–10080 分钟");
}
export function validateFateConfig(value: unknown): FateConfig {
    const c = value as FateConfig;
    if (!c || !label(c.name) || !mode(c.mode) || !Array.isArray(c.slices) || c.slices.length < 2 || c.slices.length > 24)
        throw new Error("轮盘配置无效：需要 2–24 个扇区");
    const ids = new Set<string>();
    for (const s of c.slices) {
        validateSlice(s);
        if (ids.has(s.id))
            throw new Error("轮盘扇区 ID 重复");
        ids.add(s.id);
    }
    return c;
}
export function validateFateState(value: unknown): FateState {
    const s = value as FateState;
    if (!s || s.version !== 1 || !Array.isArray(s.draws) || s.draws.length > MAX_FATE_DRAWS)
        throw new Error("轮盘记录格式无效");
    validateFateConfig(s.config);
    const ids = new Set<string>(), days = new Set<string>();
    for (const d of s.draws) {
        if (!d || !validId(d.id) || ids.has(d.id) || !Number.isFinite(d.timestamp) || d.timestamp < 0 ||
            !Number.isInteger(d.timezoneOffset) || Math.abs(d.timezoneOffset) > 840 ||
            typeof d.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d.day) ||
            !mode(d.mode) || !label(d.wheelName) ||
            !Number.isInteger(d.totalWeight) || d.totalWeight < 1 || d.totalWeight > 240000 ||
            (d.sessionId !== undefined && !validId(d.sessionId)) ||
            (d.attachedEntryId !== undefined && !validId(d.attachedEntryId)))
            throw new Error("轮盘判定记录无效或重复");
        validateSlice(d.slice);
        const date = new Date(d.timestamp - d.timezoneOffset * 60000);
        if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== d.day || d.totalWeight < d.slice.weight)
            throw new Error("轮盘判定日期或权重无效");
        if (d.mode === "ritual") {
            if (days.has(d.day))
                throw new Error("同一天存在重复的仪式判定");
            days.add(d.day);
        }
        ids.add(d.id);
    }
    return s;
}
// Rejection sampling avoids modulo bias. Neither outcome nor probability uses Math.random.
export function randomBelow(limit: number): number {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 0x100000000)
        throw new Error("随机范围无效");
    const ceiling = Math.floor(0x100000000 / limit) * limit;
    const sample = new Uint32Array(1);
    do {
        crypto.getRandomValues(sample);
    } while (sample[0] >= ceiling);
    return sample[0] % limit;
}
export function pickFate(config: FateConfig): FateSlice {
    validateFateConfig(config);
    let ticket = randomBelow(config.slices.reduce((n, s) => n + s.weight, 0));
    for (const s of config.slices) {
        if (ticket < s.weight)
            return { ...s };
        ticket -= s.weight;
    }
    throw new Error("轮盘权重无效");
}
export function ritualStatus(state: FateState, entries: Entry[], now: number) {
    const day = dayKey(now);
    if (state.draws.some((d) => d.mode === "ritual" && d.day === day))
        return "今天的仪式已经做过了";
    if (!entries.some((e) => e.photoIds.length > 0 && dayKey(e.timestamp) === day && dayKey(e.createdAt) === day))
        return "今天先拍一张，再来转";
    return RITUAL_READY;
}
export function fateNote(draw: FateDraw) {
    const extra = draw.slice.kind === "extra" ? `（追加 ${draw.slice.extraMinutes} 分钟）` : "";
    return `[🎲 命运判定] ${draw.slice.label}${extra}`;
}
// Weighted visual sectors and the target angle share the same boundaries.
export function fateSectors(slices: FateSlice[]) {
    const total = slices.reduce((n, s) => n + s.weight, 0);
    let start = 0;
    return slices.map((slice) => {
        const end = start + slice.weight / total * 360;
        const sector = { slice, start, end, center: (start + end) / 2 };
        start = end;
        return sector;
    });
}
