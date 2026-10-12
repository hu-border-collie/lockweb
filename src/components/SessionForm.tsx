import { useState } from "react";
import type { Vault } from "../lib/db";
import { userError } from "../lib/db";
import { id, type WearSession } from "../lib/models";
import { fromInput, localInput } from "../lib/time";
export function SessionForm({
  session,
  vault,
  revision,
  onSave,
  onDelete,
}: {
  session?: WearSession;
  vault: Vault;
  revision: number;
  onSave: () => Promise<void>;
  onDelete?: (s: WearSession) => void;
}) {
  const [start, setStart] = useState(localInput(session?.start ?? Date.now()));
  const [end, setEnd] = useState(session?.end ? localInput(session.end) : "");
  const [ongoing, setOngoing] = useState(session ? session.end === null : true);
  const [note, setNote] = useState(session?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
        },
        revision,
      );
      await onSave();
    } catch (e) {
      setError(userError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="form-stack">
      <p className="muted">佩戴时段独立于拍照打卡。重叠部分只统计一次。</p>
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
        {busy ? "正在保存…" : "保存佩戴时段"}
      </button>
      {session && onDelete && (
        <button
          className="danger-text wide"
          disabled={busy}
          onClick={() => onDelete(session)}
        >
          删除这个佩戴时段
        </button>
      )}
    </div>
  );
}
