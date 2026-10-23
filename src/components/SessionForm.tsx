import { useState } from "react";
import type { Vault } from "../lib/db";
import { userError } from "../lib/db";
import { id, type WearSession, type JournalSettings } from "../lib/models";
import { fromInput, localInput } from "../lib/time";
export function SessionForm({
  session,
  vault,
  revision,
  onSave,
  onDelete,
  settings,
}: {
  session?: WearSession;
  vault: Vault;
  revision: number;
  onSave: () => Promise<void>;
  onDelete?: (s: WearSession) => void;
  settings: JournalSettings;
}) {
  const [start, setStart] = useState(localInput(session?.start ?? Date.now()));
  const [end, setEnd] = useState(session?.end ? localInput(session.end) : "");
  const [ongoing, setOngoing] = useState(session ? session.end === null : true);
  const [note, setNote] = useState(session?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [baseRevision] = useState(revision);
  const [gearId, setGearId] = useState(session?.gearId ?? "");
  const [breaks, setBreaks] = useState(session?.breaks ?? []);
  async function save() {
    setBusy(true);
    setError("");
    try {
      await vault.saveSession(
        {
          id: session?.id ?? id(),
          start:
            session && start === localInput(session.start)
              ? session.start
              : fromInput(start),
          end: ongoing
            ? null
            : session?.end && end === localInput(session.end)
              ? session.end
              : fromInput(end),
          note,
          breaks,
          ...(gearId ? { gearId } : {}),
        },
        baseRevision,
      );
      await onSave();
    } catch (e) {
      setError(userError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset className="form-stack session-form" disabled={busy}>
      <p className="muted session-intro">时段与拍照记录分开保存。重叠部分只计一次。</p>
      <label className="field">
        开始时间
        <input
          type="datetime-local"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          max={localInput(Date.now())}
        />
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={ongoing}
          onChange={(e) => {
            setOngoing(e.target.checked);
            if (!end) setEnd(localInput(Date.now()));
          }}
        />
        仍在佩戴
      </label>
      {!ongoing && (
        <label className="field">
          结束时间
          <input
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            max={localInput(Date.now())}
          />
        </label>
      )}
      <label className="field">
        备注（可选）
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={10000}
          rows={2}
        />
      </label>
      {settings.gears.length > 0 && (
        <label className="field">
          装备
          <select value={gearId} onChange={(e) => setGearId(e.target.value)}>
            <option value="">不指定</option>
            {settings.gears
              .filter((g) => !g.archived || g.id === gearId)
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                  {g.archived ? "（已归档）" : ""}
                </option>
              ))}
          </select>
        </label>
      )}
      <div className="section-line session-breaks-heading">
        <h3>暂停</h3>
      </div>
      <p className="muted break-hint">
        按开始时间填写。暂停必须在时段内，且不能互相重叠。
      </p>
      {breaks.map((b, i) => (
        <div className="break-block" key={i}>
          <label className="field">
            暂停 {i + 1} · 开始
            <input
              type="datetime-local"
              value={localInput(b.start)}
              max={localInput(Date.now())}
              onChange={(e) =>
                setBreaks(
                  breaks.map((x, j) =>
                    i === j ? { ...x, start: fromInput(e.target.value) } : x,
                  ),
                )
              }
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={b.end === null}
              disabled={!ongoing}
              onChange={(e) =>
                setBreaks(
                  breaks.map((x, j) =>
                    i === j
                      ? { ...x, end: e.target.checked ? null : Date.now() }
                      : x,
                  ),
                )
              }
            />
            暂停 {i + 1} · 进行中
          </label>
          {b.end !== null && (
            <label className="field">
              暂停 {i + 1} · 结束
              <input
                type="datetime-local"
                value={localInput(b.end)}
                max={localInput(Date.now())}
                onChange={(e) =>
                  setBreaks(
                    breaks.map((x, j) =>
                      i === j ? { ...x, end: fromInput(e.target.value) } : x,
                    ),
                  )
                }
              />
            </label>
          )}
          <label className="field">
            暂停 {i + 1} · 备注
            <input
              maxLength={10000}
              value={b.note ?? ""}
              onChange={(e) =>
                setBreaks(
                  breaks.map((x, j) =>
                    i === j ? { ...x, note: e.target.value } : x,
                  ),
                )
              }
            />
          </label>
          <button
            className="danger-text break-remove"
            onClick={() => setBreaks(breaks.filter((_, j) => i !== j))}
          >
            移除暂停 {i + 1}
          </button>
        </div>
      ))}
      <button
        className="secondary wide break-add"
        onClick={() => {
          const stop = ongoing ? Date.now() : fromInput(end);
          setBreaks([
            ...breaks,
            { start: Math.max(fromInput(start), stop - 30 * 60000), end: stop },
          ]);
        }}
      >
        补录暂停
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button
        className="primary wide"
        disabled={busy}
        onClick={() => void save()}
      >
        {busy ? "正在保存…" : "保存时段"}
      </button>
      {session && onDelete && (
        <button
          className="danger-text wide"
          disabled={busy}
          onClick={() => onDelete(session)}
        >
          删除时段
        </button>
      )}
    </fieldset>
  );
}
