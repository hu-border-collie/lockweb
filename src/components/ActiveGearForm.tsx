import { useState } from "react";
import { userError, type Vault } from "../lib/db";
import type { Gear, WearSession } from "../lib/models";

export function ActiveGearForm({
  session,
  gears,
  vault,
  revision,
  onSave,
}: {
  session: WearSession;
  gears: Gear[];
  vault: Vault;
  revision: number;
  onSave: (gearId: string, switched: boolean) => Promise<void>;
}) {
  const [baseRevision] = useState(revision);
  const [gearId, setGearId] = useState(session.gearId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const changed = gearId !== (session.gearId ?? "");

  async function save(switched: boolean) {
    setBusy(true);
    setError("");
    try {
      if (switched) {
        await vault.switchSessionGear(session.id, gearId, baseRevision);
      } else {
        await vault.saveSession(
          { ...session, gearId: gearId || undefined },
          baseRevision,
        );
      }
      await onSave(gearId, switched);
    } catch (error) {
      setError(userError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className="form-stack" disabled={busy}>
      <label className="field">
        当前时段装备
        <select value={gearId} onChange={(event) => setGearId(event.target.value)}>
          <option value="">不指定</option>
          {gears.filter((gear) => !gear.archived || gear.id === session.gearId).map((gear) => (
            <option key={gear.id} value={gear.id}>
              {gear.name}{gear.archived ? "（已归档）" : ""}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">保存关联会修正本次时段的装备，原来的开始时间和暂停记录都会保留。已保存的记录可单独编辑装备。</p>
      <button type="button" className="primary wide" disabled={!changed} onClick={() => void save(false)}>
        保存关联
      </button>
      <p className="muted">中途更换装备时，可从现在起为新装备开启一个时段。</p>
      <button type="button" className="secondary wide" disabled={!changed || !gearId} onClick={() => void save(true)}>
        从现在更换装备
      </button>
      {error && <p className="error" role="alert">{error}</p>}
    </fieldset>
  );
}
