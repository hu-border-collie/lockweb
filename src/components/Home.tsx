import { memo } from "react";
import {
  Timer,
  Plus,
  ArrowUpRight,
  ChevronRight,
  Camera,
  Dices,
} from "lucide-react";
import type { Vault } from "../lib/db";
import type { Entry, WearSession, JournalSettings } from "../lib/models";
import type { FateState } from "../lib/fate";
import { kindNames, ritualStatus } from "../lib/fate";
import { dayKey, duration, dateTime, clock, totalWear } from "../lib/time";
import { Photo, RecordCard, Empty } from "./Shared";
import { useEffect, useState } from "react";

function LiveWearTimer({ session }: { session?: WearSession }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (!session || session.end !== null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [session]);

  if (!session) {
    return <div className="wear-timer">--:--:--</div>;
  }
  return (
    <div className="wear-timer">
      {duration(totalWear([session], now), true)}
    </div>
  );
}

function LivePauseDuration({ pauseStart }: { pauseStart: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <p className="hero-start hero-pause">
      已暂停 {duration(now - pauseStart, true)}，不计入佩戴时长
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
  const recentPhotos = entries
    .flatMap((e) => e.photoIds.map((p) => ({ p, e })))
    .slice(0, 6);
  const activePause = active?.breaks?.at(-1);

  return (
    <>
      <section
        className={`wear-hero${active ? " active" : ""}${active && paused ? " paused" : ""}`}
      >
        <div className="hero-top">
          <span className="state-label">
            <i aria-hidden="true" />
            {active ? (paused ? "已暂停" : "正在佩戴") : "未佩戴"}
          </span>
          <button className="hero-link" onClick={onOpenManage}>
            佩戴时段
            <ArrowUpRight size={15} aria-hidden="true" />
          </button>
        </div>
        {active && <p className="hero-caption">本次时长</p>}
        <LiveWearTimer session={active} />
        <p className="hero-start">
          {active
            ? `${dateTime(active.start)} 开始`
            : "计时和拍照记录互相独立。"}
        </p>
        {active && paused && activePause && (
          <LivePauseDuration pauseStart={activePause.start} />
        )}
        {activeFate && (
          <p className="fate-session-badge">
            轮盘结果 · {kindNames[activeFate.slice.kind]}：
            {activeFate.slice.label}
            {activeFate.slice.kind === "extra"
              ? ` · ${activeFate.slice.extraMinutes} 分钟`
              : ""}
            <small>仅作记录，不影响计时</small>
          </p>
        )}
        <div className={`hero-actions${active ? "" : " is-single"}`}>
          <button
            className="primary wide hero-action"
            disabled={busy || !ready}
            onClick={() => void onToggleWear()}
          >
            {active ? "结束佩戴" : "开始佩戴"}
            {active ? (
              <Timer size={18} aria-hidden="true" />
            ) : (
              <Plus size={19} aria-hidden="true" />
            )}
          </button>
          {active && (
            <button
              className="secondary wide"
              disabled={busy}
              onClick={() => void onTogglePause()}
            >
              {paused ? "继续佩戴" : "暂停"}
            </button>
          )}
        </div>
        {!active && settings.gears.some((g) => !g.archived) && (
          <label className="field hero-gear">
            装备
            <select
              value={gearId}
              onChange={(e) => setGearId(e.target.value)}
            >
              <option value="">不指定</option>
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
      </section>

      <div className="home-metrics">
        <div>
          <span>今日记录</span>
          <strong>
            {today.length}
            <small> 条</small>
          </strong>
        </div>
        <div>
          <span>最近记录</span>
          <strong className="time-metric">
            {entries.length ? clock(entries[0].timestamp) : "—"}
            <small>
              {entries.length
                ? dayKey(entries[0].timestamp) === dayKey(now)
                  ? " 今天"
                  : " " + dayKey(entries[0].timestamp).slice(5)
                : " 无"}
            </small>
          </strong>
        </div>
        <div>
          <span>连续记录</span>
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
        <span className="quick-capture-icon" aria-hidden="true">
          <Camera size={22} strokeWidth={1.6} />
        </span>
        <span className="quick-capture-text">
          <strong>新建记录</strong>
          <small>拍照或从相册选择</small>
        </span>
        <ChevronRight size={18} aria-hidden="true" />
      </button>

      <button className="fate-launch" onClick={onOpenWheel}>
        <span className="fate-launch-icon" aria-hidden="true">
          <Dices size={20} strokeWidth={1.6} />
        </span>
        <span className="fate-launch-text">
          <strong>命运轮盘</strong>
          <small>
            {fate.config.mode === "free"
              ? "不限次数"
              : ritualStatus(fate, entries, now)}
          </small>
        </span>
        <ChevronRight size={18} aria-hidden="true" />
      </button>

      <div className="section-line">
        <h2>最近的照片</h2>
        <button
          className="text-button"
          onClick={() => onNavigate("calendar")}
        >
          全部
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>

      {recentPhotos.length ? (
        <div className="recent-grid">
          {recentPhotos.map(({ p, e }) => (
            <div className="recent-photo" key={p}>
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
        <div className="card recent-empty">
          <Empty
            title="暂无照片"
            detail="保存带照片的记录后显示在这里。"
          />
        </div>
      )}

      <div className="section-line">
        <h2>今日记录</h2>
        <span className="muted">{today.length} 条</span>
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
        <p className="muted empty-line">
          今天还没有记录。
        </p>
      )}
    </>
  );
});
