import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarDays, Images } from "lucide-react";
import type { Entry } from "../lib/models";
import type { Vault } from "../lib/db";
import { dayKey, parseDay } from "../lib/time";
import { Empty, RecordCard } from "./Shared";
export function Calendar({
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
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of entries) {
      const k = dayKey(e.timestamp);
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [entries]);
  const start = new Date(month.getFullYear(), month.getMonth(), 1);
  const blank = (start.getDay() + 6) % 7;
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const filtered =
    mode === "calendar"
      ? entries.filter((e) => dayKey(e.timestamp) === selected)
      : entries.slice(0, limit);
  function change(by: number) {
    setMonth(new Date(month.getFullYear(), month.getMonth() + by, 1));
  }
  return (
    <>
      <div className="segmented">
        <button
          className={mode === "calendar" ? "selected" : ""}
          onClick={() => setMode("calendar")}
        >
          <CalendarDays size={16} />
          月历
        </button>
        <button
          className={mode === "timeline" ? "selected" : ""}
          onClick={() => setMode("timeline")}
        >
          <Images size={16} />
          照片时间线
        </button>
      </div>
      {mode === "calendar" && (
        <div className="card calendar-card">
          <div className="month-heading">
            <h2>
              {month.getFullYear()} 年 {month.getMonth() + 1} 月
            </h2>
            <div>
              <button
                className="icon-button"
                aria-label="上个月"
                onClick={() => change(-1)}
              >
                <ChevronLeft size={20} />
              </button>
              <button
                className="icon-button"
                aria-label="下个月"
                onClick={() => change(1)}
              >
                <ChevronRight size={20} />
              </button>
            </div>
          </div>
          <div className="calendar-grid weekdays">
            {"一二三四五六日".split("").map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="calendar-grid">
            {Array.from({ length: blank }, (_, i) => (
              <span key={"blank" + i} />
            ))}
            {Array.from({ length: days }, (_, i) => {
              const key = dayKey(
                new Date(month.getFullYear(), month.getMonth(), i + 1),
              );
              return (
                <button
                  key={key}
                  className={`day ${key === selected ? "selected" : ""} ${key === dayKey(Date.now()) ? "today" : ""}`}
                  onClick={() => onSelect(key)}
                  aria-label={`${key}，${counts[key] ?? 0} 次打卡`}
                  aria-pressed={key === selected}
                >
                  <span>{i + 1}</span>
                  <small>{counts[key] ? `${counts[key]} 次` : "·"}</small>
                </button>
              );
            })}
          </div>
          <div className="calendar-foot">
            <span>数字表示当日打卡次数</span>
            <button
              className="text-button"
              onClick={() => {
                onSelect(dayKey(Date.now()));
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
            ? `${parseDay(selected).getMonth() + 1} 月 ${parseDay(selected).getDate()} 日`
            : "全部记录"}
        </h2>
        <span className="muted">
          {mode === "calendar" ? filtered.length : entries.length} 次打卡
        </span>
      </div>
      {filtered.length ? (
        filtered.map((e, i) => (
          <div key={e.id}>
            {mode === "timeline" &&
              (i === 0 ||
                dayKey(filtered[i - 1].timestamp) !== dayKey(e.timestamp)) && (
                <h3 className="timeline-date">{dayKey(e.timestamp)}</h3>
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
            title={
              mode === "calendar" ? "这一天还没有记录" : "时间线等你写下第一笔"
            }
            detail="保存照片后，它们会按时间出现在这里。"
            icon={<CalendarDays size={28} />}
          />
        </div>
      )}
      {mode === "timeline" && limit < entries.length && (
        <button className="secondary wide" onClick={() => setLimit(limit + 20)}>
          加载更多记录
        </button>
      )}
    </>
  );
}
