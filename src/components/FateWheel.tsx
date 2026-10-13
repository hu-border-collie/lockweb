import { useEffect, useRef, useState } from "react";
import { Dices, Settings2, Sparkles } from "lucide-react";
import { userError, type Vault } from "../lib/db";
import type { Entry } from "../lib/models";
import { dayKey, dateTime } from "../lib/time";
import { FATE_COLORS, fatePreset, fateSectors, kindNames, ritualStatus, validateFateConfig, type FateConfig, type FateDraw, type FateKind, type FateSlice, type FateState } from "../lib/fate";
import { Modal } from "./Shared";
function vibrate(length: number) {
    try {
        navigator.vibrate?.(length);
    }
    catch { /* Optional device capability. */ }
}
const point = (angle: number, radius = 140) => {
    const radians = (angle - 90) * Math.PI / 180;
    return [160 + Math.cos(radians) * radius, 160 + Math.sin(radians) * radius];
};
function arc(start: number, end: number) {
    const [x1, y1] = point(start), [x2, y2] = point(end);
    return `M160 160 L${x1} ${y1} A140 140 0 ${end - start > 180 ? 1 : 0} 1 ${x2} ${y2} Z`;
}
export function FateWheel({ vault, state, entries, revision, now, refresh }: {
    vault: Vault;
    state: FateState;
    entries: Entry[];
    revision: number;
    now: number;
    refresh: () => Promise<void>;
}) {
    const [phase, setPhase] = useState<"idle" | "saving" | "spinning">("idle");
    const [rotation, setRotation] = useState(0);
    const [visual, setVisual] = useState<FateSlice[] | null>(null);
    const [committed, setCommitted] = useState<FateDraw | null>(null);
    const [error, setError] = useState("");
    const [attachmentBusy, setAttachmentBusy] = useState(false);
    const [entryId, setEntryId] = useState("");
    const [editing, setEditing] = useState(false);
    const mounted = useRef(true), running = useRef(false), frame = useRef(0), finish = useRef<(() => void) | null>(null);
    useEffect(() => {
        mounted.current = true;
        const hide = () => { if (document.hidden)
            finish.current?.(); };
        document.addEventListener("visibilitychange", hide);
        return () => {
            mounted.current = false;
            cancelAnimationFrame(frame.current);
            finish.current = null;
            document.removeEventListener("visibilitychange", hide);
        };
    }, []);
    const last = committed ? state.draws.find((d) => d.id === committed.id) ?? committed : state.draws.at(-1);
    const slices = visual ?? state.config.slices, sectors = fateSectors(slices);
    const ritual = ritualStatus(state, entries, now);
    const canDraw = state.config.mode === "free" || ritual === "今日仪式已点亮";
    const todayEntries = entries.filter((e) => dayKey(e.timestamp) === dayKey(now));
    const chosenEntry = todayEntries.find((e) => e.id === entryId)?.id ?? todayEntries[0]?.id ?? "";
    async function spin() {
        if (running.current || attachmentBusy)
            return;
        running.current = true;
        setPhase("saving");
        setError("");
        const frozen = structuredClone(state.config.slices);
        try {
            const draw = await vault.drawFate(revision);
            if (!mounted.current)
                return;
            setCommitted(draw);
            setVisual(frozen);
            setPhase("spinning");
            void refresh().catch((e) => { if (mounted.current)
                setError(userError(e)); });
            const target = fateSectors(frozen).find((s) => s.slice.id === draw.slice.id);
            if (!target)
                throw new Error("判定已保存，请重新打开轮盘查看结果");
            const start = rotation, normalized = ((start % 360) + 360) % 360;
            const wanted = (360 - target.center) % 360;
            const end = start + 5 * 360 + ((wanted - normalized + 360) % 360);
            const started = performance.now(), reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
            const settle = () => {
                cancelAnimationFrame(frame.current);
                if (!mounted.current)
                    return;
                setRotation(end);
                setPhase("idle");
                running.current = false;
                finish.current = null;
                if (!document.hidden)
                    vibrate(25);
            };
            finish.current = settle;
            if (reduced || document.hidden)
                return settle();
            let previous = -1;
            const step = (time: number) => {
                const progress = Math.min(1, (time - started) / 4200);
                const angle = start + (end - start) * (1 - Math.pow(1 - progress, 4));
                setRotation(angle);
                const pointer = ((-angle % 360) + 360) % 360;
                const index = fateSectors(frozen).findIndex((s) => pointer >= s.start && pointer < s.end);
                if (index !== previous) {
                    vibrate(5);
                    previous = index;
                }
                if (progress === 1)
                    settle();
                else
                    frame.current = requestAnimationFrame(step);
            };
            frame.current = requestAnimationFrame(step);
        }
        catch (e) {
            if (mounted.current) {
                setError(userError(e));
                setPhase("idle");
                running.current = false;
            }
        }
    }
    return <>
    <div className="fate-heading">
      <div><span className="eyebrow">WHEEL OF FATE</span><h3>{state.config.name}</h3></div>
      <button className="icon-button" aria-label="配置轮盘" disabled={phase !== "idle" || attachmentBusy} onClick={() => { setEditing(true); setVisual(null); setRotation(0); }}><Settings2 size={21}/></button>
    </div>
    <div className="fate-wheel-wrap">
      <span className="fate-pointer" aria-hidden="true"/>
      <svg className="fate-wheel" viewBox="0 0 320 320" role="img" aria-label="命运轮盘，扇区面积按权重分配" style={{ transform: `rotate(${rotation}deg)` }}>
        {sectors.map(({ slice, start, end, center }, i) => <g key={slice.id}>
          <path d={arc(start, end)} fill={slice.color} stroke="var(--card)" strokeWidth="2"/>
          {end - start >= 12 && <text x={point(center, 102)[0]} y={point(center, 102)[1]} fill="#fff" textAnchor="middle" dominantBaseline="middle" fontSize="16" fontWeight="700">{i + 1}</text>}
        </g>)}
        <circle cx="160" cy="160" r="31" fill="var(--card)"/><circle cx="160" cy="160" r="14" fill="var(--accent)"/>
      </svg>
    </div>
    <p className="fate-rule" role="status">{phase === "saving" ? "正在保存判定…" : phase === "spinning" ? "正在转动 · 判定已保存在本机" : state.config.mode === "free" ? "自由沙盒 · 每次抽取都保留记录" : ritual}</p>
    <button className="primary wide fate-spin" disabled={!canDraw || phase !== "idle" || attachmentBusy} onClick={() => void spin()}><Dices size={19}/>{phase === "idle" ? "转动轮盘" : phase === "saving" ? "正在保存…" : "命运转动中…"}</button>
    {error && <p className="error" role="alert">{error}</p>}
    {last && phase === "idle" && <div className="fate-result" aria-live="polite">
      <span className="eyebrow">{last.day === dayKey(now) ? "最近判定" : "历史判定"} · {kindNames[last.slice.kind]}</span>
      <h3><Sparkles size={18}/>{last.slice.label}</h3>
      <p className="muted">{dateTime(last.timestamp)} · {last.mode === "ritual" ? "每日仪式" : "自由沙盒"}{last.slice.kind === "extra" ? ` · 追加 ${last.slice.extraMinutes} 分钟` : ""}</p>
      {last.attachedEntryId ? <p className="muted">已写入打卡备注</p> : last.day === dayKey(now) && todayEntries.length > 0 && <>
        <label className="field">写入今日打卡<select aria-label="写入今日打卡" value={chosenEntry} onChange={(e) => setEntryId(e.target.value)}>{todayEntries.map((e) => <option key={e.id} value={e.id}>{dateTime(e.timestamp)} · {e.photoIds.length} 张照片</option>)}</select></label>
        <button className="secondary wide" disabled={attachmentBusy} onClick={async () => {
                    setAttachmentBusy(true);
                    setError("");
                    try {
                        await vault.attachFateNote(last.id, chosenEntry, revision);
                        await refresh();
                    }
                    catch (e) {
                        if (mounted.current)
                            setError(userError(e));
                    }
                    finally {
                        if (mounted.current)
                            setAttachmentBusy(false);
                    }
                }}>追加到打卡备注</button>
      </>}
    </div>}
    <ol className="fate-legend">{slices.map((s) => <li key={s.id}><span className="fate-swatch" style={{ background: s.color }}/><span>{s.label}<small>{kindNames[s.kind]}{s.kind === "extra" ? ` · ${s.extraMinutes} 分钟` : ""}</small></span><strong>{(s.weight / slices.reduce((n, x) => n + x.weight, 0) * 100).toFixed(1)}%</strong></li>)}</ol>
    <p className="muted fate-footnote">结果在动画开始前加密保存。判定仅供记录，可自行决定是否执行；加时不会改动实际计时。</p>
    {editing && <FateOptions vault={vault} config={state.config} revision={revision} refresh={refresh} onClose={() => setEditing(false)}/>}
  </>;
}
function FateOptions({ vault, config, revision, refresh, onClose }: {
    vault: Vault;
    config: FateConfig;
    revision: number;
    refresh: () => Promise<void>;
    onClose: () => void;
}) {
    const [draft, setDraft] = useState(() => structuredClone(config));
    const [error, setError] = useState(""), [busy, setBusy] = useState(false);
    const base = useRef(revision);
    const [dirty, setDirty] = useState(false);
    function update(value: FateConfig) { setDraft(value); setDirty(true); }
    function slice(id: string, change: Partial<FateSlice>) {
        update({ ...draft, slices: draft.slices.map((s) => s.id === id ? { ...s, ...change } : s) });
    }
    function preset(hard: boolean) {
        if (dirty && !confirm("载入预设将替换未保存的轮盘配置，继续？"))
            return;
        update(fatePreset(hard, draft.mode));
    }
    return <Modal title="配置命运轮盘" onClose={() => { if (!busy && (!dirty || confirm("放弃未保存的轮盘配置？")))
        onClose(); }}>
    <fieldset className="form-stack" disabled={busy}>
      <label className="field">轮盘名称<input maxLength={100} value={draft.name} onChange={(e) => update({ ...draft, name: e.target.value })}/></label>
      <label className="field">抽取模式<select aria-label="抽取模式" aria-describedby="fate-mode-help" value={draft.mode} onChange={(e) => update({ ...draft, mode: e.target.value as FateConfig["mode"] })}><option value="ritual">每日打卡仪式</option><option value="free">自由沙盒</option></select><small id="fate-mode-help">每日仪式需要今天新建的拍照打卡，每个本地日期最多一次。切换模式或预设不会重置次数。</small></label>
      <div className="fate-preset-buttons"><button className="secondary" onClick={() => preset(false)}>温和日常预设</button><button className="secondary" onClick={() => preset(true)}>硬核加时预设</button></div>
      <p className="muted">权重决定概率和扇区面积；1 与 9 分别为 10% 和 90%。历史判定保留抽取时的内容。</p>
      {draft.slices.map((s, i) => <div className="fate-slice-editor" key={s.id}>
        <div className="section-line"><h3>扇区 {i + 1}</h3><button className="text-button" aria-label={`删除扇区 ${i + 1}`} disabled={draft.slices.length <= 2} onClick={() => update({ ...draft, slices: draft.slices.filter((x) => x.id !== s.id) })}>删除</button></div>
        <label className="field">扇区 {i + 1} 名称<input maxLength={100} value={s.label} onChange={(e) => slice(s.id, { label: e.target.value })}/></label>
        <div className="fate-editor-grid">
          <label className="field">扇区 {i + 1} 类型<select aria-label={`扇区 ${i + 1} 类型`} value={s.kind} onChange={(e) => { const kind = e.target.value as FateKind; slice(s.id, { kind, extraMinutes: kind === "extra" ? 60 : 0 }); }}>{Object.entries(kindNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
          <label className="field">扇区 {i + 1} 权重<input type="number" min={1} max={10000} step={1} value={s.weight || ""} onChange={(e) => slice(s.id, { weight: Number(e.target.value) })}/></label>
          <label className="field">扇区 {i + 1} 颜色<input type="color" value={s.color} onChange={(e) => slice(s.id, { color: e.target.value })}/></label>
          {s.kind === "extra" && <label className="field">扇区 {i + 1} 加时分钟<input type="number" min={1} max={10080} step={1} value={s.extraMinutes || ""} onChange={(e) => slice(s.id, { extraMinutes: Number(e.target.value) })}/></label>}
        </div>
      </div>)}
      <button className="secondary wide" disabled={draft.slices.length >= 24} onClick={() => update({ ...draft, slices: [...draft.slices, { id: crypto.randomUUID(), label: "新扇区", kind: "neutral", weight: 10, color: FATE_COLORS[draft.slices.length % FATE_COLORS.length], extraMinutes: 0 }] })}>新增扇区</button>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary wide" onClick={async () => {
            setBusy(true);
            setError("");
            try {
                validateFateConfig(draft);
                await vault.saveFateConfig(draft, base.current);
                await refresh();
                onClose();
            }
            catch (e) {
                setError(userError(e));
            }
            finally {
                setBusy(false);
            }
        }}>{busy ? "正在保存…" : "保存轮盘配置"}</button>
    </fieldset>
  </Modal>;
}
export function FateHistory({ state }: {
    state: FateState;
}) {
    const [limit, setLimit] = useState(20);
    const draws = [...state.draws].reverse();
    const counts = Object.entries(kindNames).map(([kind, name]) => ({ name, count: draws.filter((d) => d.slice.kind === kind).length }));
    return <div className="card fate-history"><h2>命运历史</h2>
    <p className="muted">共 {draws.length} 次 · 每日仪式 {draws.filter((d) => d.mode === "ritual").length} 次 · 自由沙盒 {draws.filter((d) => d.mode === "free").length} 次</p>
    <div className="fate-counts">{counts.map((c) => <span key={c.name}>{c.name}<strong>{c.count}</strong></span>)}</div>
    {draws.length ? <ol className="fate-timeline">{draws.slice(0, limit).map((d) => <li key={d.id}><span className="fate-swatch" style={{ background: d.slice.color }}/><div><strong>{d.slice.label}</strong><small>{dateTime(d.timestamp)} · {d.mode === "ritual" ? "仪式" : "沙盒"} · {kindNames[d.slice.kind]}{d.slice.kind === "extra" ? ` · ${d.slice.extraMinutes} 分钟` : ""}</small><small>{d.wheelName} · 概率 {(d.slice.weight / d.totalWeight * 100).toFixed(1)}%{d.attachedEntryId ? " · 已写入打卡" : ""}</small></div></li>)}</ol> : <p className="muted empty-line">每一次判定，都会留在这里。</p>}
    {draws.length > limit && <button className="secondary wide" onClick={() => setLimit((n) => n + 20)}>加载更多判定</button>}
  </div>;
}
