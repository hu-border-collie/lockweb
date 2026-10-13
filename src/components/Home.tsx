import { memo } from "react";
import {
  Timer,
  Plus,
  ArrowUpRight,
  ChevronRight,
  Camera,
} from "lucide-react";
import type { Vault } from "../lib/db";
import type { Entry, WearSession, JournalSettings } from "../lib/models";
import type { FateState } from "../lib/fate";
import { kindNames, ritualStatus } from "../lib/fate";
import { dayKey, duration, dateTime, clock, totalWear } from "../lib/time";
import { Photo, RecordCard, Empty } from "./Shared";
import { useEffect, useState } from "react";

function LiveWearTimer({ session }: { session?: WearSession }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!session || session.end !== null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [session]);

  if (!session) {
    return <div className="wear-timer">自由时刻</div>;
  }
  return (
    <div className="wear-timer">
      {duration(totalWear([session], now), true)}
    </div>
  );
}

function LivePauseDuration({ pauseStart }: { pauseStart: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <p className="hero-start">
      小憩已持续 {duration(now - pauseStart, true)} · 此段时间不计入佩戴
    </p>
  );
}

export interface HomeProps {
  vault: Vault;
  entries: Entry[];
  settings: JournalSettings;
  fate: FateState;
  active?: WearSession;
  paused: boolean;
  gearId: string;
  setGearId: (id: string) => void;
  busy: boolean;
  ready: boolean;
  onToggleWear: () => Promise<void>;
  onTogglePause: () => Promise<void>;
  onOpenManage: () => void;
  onOpenWheel: () => void;
  onNavigate: (tab: string) => void;
  onEdit: (entry: Entry) => void;
  onView: (ids: string[], index: number) => void;
  totals: { current: number };
  now: number;
}

export const Home = memo(function Home({
  vault,
  entries,
  settings,
  fate,
  active,
  paused,
  gearId,
  setGearId,
  busy,
  ready,
  onToggleWear,
  onTogglePause,
  onOpenManage,
  onOpenWheel,
  onNavigate,
  onEdit,
  onView,
  totals,
  now,
}: HomeProps) {
  const activeFate = active
    ? [...fate.draws]
        .reverse()
        .find(
          (d) =>
            d.sessionId === active.id &&
            ["extra", "reward"].includes(d.slice.kind),
        )
    : undefined;

  const today = entries.filter((e) => dayKey(e.timestamp) === dayKey(now));
  const activePause = active?.breaks?.at(-1);

  return (
    <>
      <section className={`wear-hero ${active ? "active" : ""}`}>
        <div className="hero-top">
          <span className="state-label">
            <i />
            {active ? (paused ? "清洁小憩中" : "正在佩戴") : "当前未佩戴"}
          </span>
          <button className="hero-link" onClick={onOpenManage}>
            时段管理
            <ArrowUpRight size={16} />
          </button>
        </div>
        <p className="hero-caption">
          {active ? "本次已持续" : "按自己的节奏记录"}
        </p>
        <LiveWearTimer session={active} />
        <p className="hero-start">
          {active
            ? `${dateTime(active.start)} 开始`
            : "佩戴时段和拍照打卡独立保存"}
        </p>
        {activeFate && (
          <p className="fate-session-badge">
            🎲 {kindNames[activeFate.slice.kind]}判定：
            {activeFate.slice.label}
            {activeFate.slice.kind === "extra"
              ? ` · ${activeFate.slice.extraMinutes} 分钟`
              : ""}
            <small>仅记录判定，实际计时照常</small>
          </p>
        )}
        <button
          className="hero-action"
          disabled={busy || !ready}
          onClick={() => void onToggleWear()}
        >
          {active ? "结束本次佩戴" : "开始佩戴"}
          {active ? <Timer size={18} /> : <Plus size={19} />}
        </button>
        {!active && settings.gears.some((g) => !g.archived) && (
          <label className="field">
            本次佩戴装备
            <select
              value={gearId}
              onChange={(e) => setGearId(e.target.value)}
            >
              <option value="">不选择装备</option>
              {settings.gears
                .filter((g) => !g.archived)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        {active && (
          <>
            <button
              className="secondary wide"
              disabled={busy}
              onClick={() => void onTogglePause()}
            >
              {paused ? "恢复佩戴" : "清洁小憩"}
            </button>
            {paused && activePause && (
              <LivePauseDuration pauseStart={activePause.start} />
            )}
          </>
        )}
      </section>

      <div className="home-metrics">
        <div>
          <span>今日打卡</span>
          <strong>
            {today.length}
            <small> 次</small>
          </strong>
        </div>
        <div>
          <span>最近一次</span>
          <strong className="time-metric">
            {entries.length ? clock(entries[0].timestamp) : "—"}
            <small>
              {entries.length
                ? dayKey(entries[0].timestamp) === dayKey(now)
                  ? " 今天"
                  : " " + dayKey(entries[0].timestamp).slice(5)
                : " 尚未打卡"}
            </small>
          </strong>
        </div>
        <div>
          <span>连续打卡</span>
          <strong>
            {totals.current}
            <small> 天</small>
          </strong>
        </div>
      </div>

      <button
        className="quick-capture"
        onClick={() => onNavigate("checkin")}
      >
        <span>
          <Camera size={25} />
        </span>
        <div>
          <strong>拍照打卡</strong>
          <small>拍一张，或选几张。保存就好。</small>
        </div>
        <ChevronRight size={19} />
      </button>

      <button className="fate-launch card" onClick={onOpenWheel}>
        <span className="fate-launch-icon" aria-hidden="true">
          🎲
        </span>
        <span>
          <strong>命运轮盘</strong>
          <small>
            {fate.config.mode === "free"
              ? "自由沙盒 · 随时开启"
              : ritualStatus(fate, entries, now)}
          </small>
        </span>
        <ChevronRight size={19} />
      </button>

      <div className="section-line">
        <h2>最近的照片</h2>
        <button
          className="text-button"
          onClick={() => onNavigate("calendar")}
        >
          查看全部
          <ChevronRight size={14} />
        </button>
      </div>

      {entries.length ? (
        <div className="recent-grid">
          {entries
            .flatMap((e) => e.photoIds.map((p) => ({ p, e })))
            .slice(0, 6)
            .map(({ p, e }) => (
              <div key={p}>
                <Photo
                  id={p}
                  vault={vault}
                  onClick={() => onView(e.photoIds, e.photoIds.indexOf(p))}
                />
                <span>{dateTime(e.timestamp)}</span>
              </div>
            ))}
        </div>
      ) : (
        <div className="card">
          <Empty
            title="从第一张照片开始"
            detail="日常的每一个瞬间，都值得被自己记住。"
          />
        </div>
      )}

      <div className="section-line">
        <h2>今日记录</h2>
        <span className="muted">{today.length} 次</span>
      </div>

      {today.length ? (
        today.map((e) => (
          <RecordCard
            key={e.id}
            entry={e}
            vault={vault}
            onEdit={onEdit}
            onView={onView}
          />
        ))
      ) : (
        <p className="muted empty-line">今天的记录会出现在这里。</p>
      )}
    </>
  );
});
