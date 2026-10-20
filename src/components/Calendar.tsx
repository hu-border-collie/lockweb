import { memo, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarDays, Images } from "lucide-react";
import type { Entry } from "../lib/models";
import type { Vault } from "../lib/db";
import { dayKey, parseDay } from "../lib/time";
import { Empty, RecordCard, Photo } from "./Shared";
import { ComparePhotos, type ComparePhoto } from "./ComparePhotos";
function dayLabel(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return `${y} 年 ${m} 月 ${d} 日`;
}
export const Calendar = memo(function Calendar({
  entries,
  vault,
  selected,
  onSelect,
  onEdit,
  onView,
}: {
  entries: Entry[];
  vault: Vault;
  selected: string;
  onSelect: (s: string) => void;
  onEdit: (e: Entry) => void;
  onView: (ids: string[], i: number) => void;
}) {
  const [month, setMonth] = useState(() => parseDay(selected));
  const [mode, setMode] = useState("calendar");
  const [limit, setLimit] = useState(20);
  const [choosing, setChoosing] = useState(false);
  const [chosen, setChosen] = useState<ComparePhoto[]>([]);
  const [compare, setCompare] = useState<ComparePhoto[] | null>(null);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of entries) {
      const k = dayKey(e.timestamp);
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [entries]);
  const { blank, days } = useMemo(() => {
    const start = new Date(month.getFullYear(), month.getMonth(), 1);
    const blank = (start.getDay() + 6) % 7;
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return { blank, days };
  }, [month]);
  const filtered =
    mode === "calendar"
      ? entries.filter((e) => dayKey(e.timestamp) === selected)
      : entries.slice(0, limit);
  const todayKey = dayKey(Date.now());
  const selectedDate = parseDay(selected);
  function change(by: number) {
    setMonth(new Date(month.getFullYear(), month.getMonth() + by, 1));
  }
  return (
    <>
      <div className="segmented calendar-tabs">
        <button
          type="button"
          className={mode === "calendar" ? "selected" : ""}
          aria-pressed={mode === "calendar"}
          onClick={() => setMode("calendar")}
        >
          <CalendarDays size={16} aria-hidden="true" />
          月历
        </button>
        <button
          type="button"
          className={mode === "timeline" ? "selected" : ""}
          aria-pressed={mode === "timeline"}
          onClick={() => setMode("timeline")}
        >
          <Images size={16} aria-hidden="true" />
          时间线
        </button>
      </div>
      {mode === "calendar" && (
        <div className="card calendar-card">
          <div className="month-heading">
            <h2>
              {month.getFullYear()} 年 {month.getMonth() + 1} 月
            </h2>
            <div className="month-nav">
              <button
                type="button"
                className="icon-button"
                aria-label="上个月"
                onClick={() => change(-1)}
              >
                <ChevronLeft size={18} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="下个月"
                onClick={() => change(1)}
              >
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="calendar-grid weekdays" aria-hidden="true">
            {"一二三四五六日".split("").map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="calendar-grid">
            {Array.from({ length: blank }, (_, i) => (
              <span key={"blank" + i} aria-hidden="true" />
            ))}
            {Array.from({ length: days }, (_, i) => {
              const key = dayKey(
                new Date(month.getFullYear(), month.getMonth(), i + 1),
              );
              const count = counts[key] ?? 0;
              const isToday = key === todayKey;
              return (
                <button
                  type="button"
                  key={key}
                  className={`day${key === selected ? " selected" : ""}${isToday ? " today" : ""}`}
                  onClick={() => onSelect(key)}
                  aria-label={`${key}，${count} 笔记录`}
                  aria-pressed={key === selected}
                  aria-current={isToday ? "date" : undefined}
                >
                  <span>{i + 1}</span>
                  <small>{count ? `${count} 笔` : "·"}</small>
                </button>
              );
            })}
          </div>
          <div className="calendar-foot">
            <span>数字是当天的记录笔数</span>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                onSelect(todayKey);
                setMonth(new Date());
              }}
            >
              回到今天
            </button>
          </div>
        </div>
      )}
      <div className="section-line">
        <h2>
          {mode === "calendar"
            ? `${selectedDate.getMonth() + 1} 月 ${selectedDate.getDate()} 日`
            : "全部记录"}
        </h2>
        <span className="muted">
          {mode === "calendar" ? filtered.length : entries.length} 笔记录
        </span>
      </div>
      <button
        type="button"
        className="secondary wide calendar-compare-toggle"
        aria-expanded={choosing}
        onClick={() => {
          setChoosing(!choosing);
          setChosen([]);
        }}
      >
        {choosing ? "取消对比" : "挑两张照片对比"}
      </button>
      {choosing && (
        <div className="card compare-picker">
          <p className="muted">任选两张照片，可以切换日期或加载更多。</p>
          <div className="compare-picks">
            {filtered.flatMap((e) =>
              e.photoIds.map((id) => (
                <label key={id}>
                  <Photo id={id} vault={vault} />
                  <span>
                    <input
                      type="checkbox"
                      aria-label={`选择这张照片 ${id}`}
                      checked={chosen.some((p) => p.id === id)}
                      disabled={
                        chosen.length === 2 && !chosen.some((p) => p.id === id)
                      }
                      onChange={(event) =>
                        setChosen(
                          event.target.checked
                            ? [...chosen, { id, timestamp: e.timestamp }]
                            : chosen.filter((p) => p.id !== id),
                        )
                      }
                    />
                    选这张
                  </span>
                </label>
              )),
            )}
          </div>
          <button
            type="button"
            className="primary wide"
            disabled={chosen.length !== 2}
            onClick={() => setCompare([...chosen])}
          >
            开始对比（{chosen.length}/2）
          </button>
        </div>
      )}
      {filtered.length ? (
        filtered.map((e, i) => (
          <div className="timeline-group" key={e.id}>
            {mode === "timeline" &&
              (i === 0 ||
                dayKey(filtered[i - 1].timestamp) !== dayKey(e.timestamp)) && (
                <h3 className="timeline-date">
                  <span>{dayLabel(dayKey(e.timestamp))}</span>
                  <small>{counts[dayKey(e.timestamp)]} 笔</small>
                </h3>
              )}
            <RecordCard
              entry={e}
              vault={vault}
              onEdit={onEdit}
              onView={onView}
            />
          </div>
        ))
      ) : (
        <div className="card">
          <Empty
            title={mode === "calendar" ? "这一天还是空白" : "时间线还空着"}
            detail="拍下第一张照片，它就会按时间出现在这里。"
            icon={
              mode === "calendar" ? (
                <CalendarDays size={28} aria-hidden="true" />
              ) : (
                <Images size={28} aria-hidden="true" />
              )
            }
          />
        </div>
      )}
      {mode === "timeline" && limit < entries.length && (
        <button
          type="button"
          className="secondary wide"
          onClick={() => setLimit(limit + 20)}
        >
          再看一些
        </button>
      )}
      {compare && (
        <ComparePhotos
          photos={compare}
          vault={vault}
          onClose={() => setCompare(null)}
        />
      )}
    </>
  );
});
