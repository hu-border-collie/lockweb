import { useState } from "react";
import type { Vault } from "../lib/db";
import type { Entry, Gear, WearSession } from "../lib/models";
import { duration, totalWear } from "../lib/time";
import { RecordCard } from "./Shared";
import { SessionRow } from "./SessionForm";

const UNASSIGNED = "@unassigned";
const PAGE_SIZE = 20;

export function GearHistory({
  initialGear,
  gears,
  entries,
  sessions,
  vault,
  now,
  onEditEntry,
  onEditSession,
  onView,
}: {
  initialGear: string;
  gears: Gear[];
  entries: Entry[];
  sessions: WearSession[];
  vault: Vault;
  now: number;
  onEditEntry: (entry: Entry) => void;
  onEditSession: (session: WearSession) => void;
  onView: (ids: string[], index: number) => void;
}) {
  const [filter, setFilter] = useState(initialGear);
  const [mode, setMode] = useState<"sessions" | "records">("sessions");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const names = new Map(gears.map((gear) => [gear.id, gear.name]));
  const selected = filter === UNASSIGNED || names.has(filter) ? filter : "";
  const included = (item: { gearId?: string }) =>
    !selected || (item.gearId ?? UNASSIGNED) === selected;
  const matchingSessions = sessions.filter(included);
  const matchingEntries = entries.filter(included);
  const photos = matchingEntries.reduce((sum, entry) => sum + entry.photoIds.length, 0);
  const count = mode === "sessions" ? matchingSessions.length : matchingEntries.length;
  const nameFor = (gearId?: string) => names.get(gearId ?? "") ?? "未指定";

  return (
    <div className="gear-history">
      <label className="field">
        按装备筛选
        <select
          value={selected}
          onChange={(event) => {
            setFilter(event.target.value);
            setLimit(PAGE_SIZE);
          }}
        >
          <option value="">全部装备</option>
          <option value={UNASSIGNED}>未指定</option>
          {gears.map((gear) => (
            <option key={gear.id} value={gear.id}>
              {gear.name}{gear.archived ? "（已归档）" : ""}
            </option>
          ))}
        </select>
      </label>
      <p className="muted gear-history-summary">
        佩戴 {duration(totalWear(matchingSessions, now))} · {matchingSessions.length} 个时段 · {matchingEntries.length} 条记录 · {photos} 张照片
      </p>
      <div className="segmented" role="group" aria-label="历史类型">
        <button
          type="button"
          className={mode === "sessions" ? "selected" : ""}
          aria-pressed={mode === "sessions"}
          onClick={() => {
            setMode("sessions");
            setLimit(PAGE_SIZE);
          }}
        >
          佩戴时段
        </button>
        <button
          type="button"
          className={mode === "records" ? "selected" : ""}
          aria-pressed={mode === "records"}
          onClick={() => {
            setMode("records");
            setLimit(PAGE_SIZE);
          }}
        >
          记录与照片
        </button>
      </div>
      {mode === "sessions" ? (
        matchingSessions.slice(0, limit).map((session) => (
          <SessionRow
            key={session.id}
            session={session}
            gearName={nameFor(session.gearId)}
            now={now}
            onEdit={onEditSession}
          />
        ))
      ) : (
        matchingEntries.slice(0, limit).map((entry) => (
          <RecordCard
            key={entry.id}
            entry={entry}
            gearName={nameFor(entry.gearId)}
            vault={vault}
            onEdit={onEditEntry}
            onView={onView}
          />
        ))
      )}
      {count === 0 && (
        <p className="muted">{mode === "sessions" ? "暂无相关时段" : "暂无相关记录"}</p>
      )}
      {count > limit && (
        <button type="button" className="secondary wide" onClick={() => setLimit(limit + PAGE_SIZE)}>
          加载更多
        </button>
      )}
    </div>
  );
}
