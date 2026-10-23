import { beginSystemDialog, endSystemDialog } from "../lib/privacy";
import { memo, useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, X, ChevronDown, Check } from "lucide-react";
import { Photo } from "./Shared";
import {
  id,
  type Entry,
  type PhotoInput,
  type JournalSettings,
  type WearSession,
} from "../lib/models";
import { PrivacyBrush } from "./PrivacyBrush";
import { dateTime } from "../lib/time";
import type { Vault } from "../lib/db";
import { userError } from "../lib/db";
import { localInput, fromInput } from "../lib/time";
import { processImage } from "../lib/images";
export const EntryForm = memo(function EntryForm({
  entry,
  vault,
  revision,
  wearing,
  onSave,
  onDelete,
  onCancel,
  settings,
  sessions,
  active,
}: {
  entry?: Entry;
  vault: Vault;
  revision: number;
  wearing: boolean;
  onSave: () => Promise<void>;
  onDelete?: (entry: Entry) => void;
  onCancel: () => void;
  settings: JournalSettings;
  sessions: WearSession[];
  active?: WearSession;
}) {
  const [initialTimestamp] = useState(() => entry?.timestamp ?? Date.now());
  const [recordId] = useState(() => entry?.id ?? id());
  const [photos, setPhotos] = useState<PhotoInput[]>([]);
  const [baseRevision] = useState(revision);
  const [gearId, setGearId] = useState(
    entry ? (entry.gearId ?? "") : (active?.gearId ?? ""),
  );
  const [sessionId, setSessionId] = useState(
    entry ? (entry.sessionId ?? "") : (active?.id ?? ""),
  );
  const [brush, setBrush] = useState<{
    id: string;
    blob: Blob;
    existing: boolean;
  } | null>(null);
  const [kept, setKept] = useState(entry?.photoIds ?? []);
  const [time, setTime] = useState(localInput(initialTimestamp));
  const [note, setNote] = useState(entry?.note ?? "");
  const [tags, setTags] = useState(entry?.tags.join("，") ?? "");
  const [state, setState] = useState<Entry["wearing"]>(
    entry?.wearing ?? (wearing ? "on" : "unspecified"),
  );
  const [comfort, setComfort] = useState(entry?.comfort ?? null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [details, setDetails] = useState(!!entry);
  const camera = useRef<HTMLInputElement>(null),
    album = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const inputs = [camera.current, album.current];
    inputs.forEach((input) =>
      input?.addEventListener("cancel", endSystemDialog),
    );
    return () =>
      inputs.forEach((input) =>
        input?.removeEventListener("cancel", endSystemDialog),
      );
  }, []);
  async function add(files: FileList | null) {
    if (!files?.length) return;
    setBusy("正在处理照片…");
    setError("");
    const results: PhotoInput[] = [];
    let failed = "";
    try {
      for (const file of Array.from(files)) {
        if (!alive.current) return;
        results.push(await processImage(file));
      }
    } catch (e) {
      failed = userError(e);
    } finally {
      if (alive.current) {
        setPhotos((previous) => [...previous, ...results]);
        setBusy("");
        setError(failed);
      }
    }
  }
  async function save() {
    setBusy("正在加密保存…");
    setError("");
    try {
      const timestamp =
        time === localInput(initialTimestamp)
          ? initialTimestamp
          : fromInput(time);
      await vault.saveEntry(
        {
          id: recordId,
          timestamp,
          note: note.trim(),
          tags: [
            ...new Set(
              tags
                .split(/[,，]/)
                .map((t) => t.trim())
                .filter(Boolean),
            ),
          ],
          wearing: state,
          comfort,
          photoIds: [...kept, ...photos.map((p) => p.id)],
          createdAt: entry?.createdAt ?? Date.now(),
          updatedAt: Date.now(),
          ...(gearId ? { gearId } : {}),
          ...(sessionId ? { sessionId } : {}),
        },
        photos,
        baseRevision,
      );
      await onSave();
    } catch (e) {
      if (alive.current) setError(userError(e));
    } finally {
      if (alive.current) setBusy("");
    }
  }
  return (
    <fieldset className="entry-form" disabled={!!busy}>
      <input
        ref={camera}
        className="sr-only"
        aria-label="使用相机拍照"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => {
          endSystemDialog();
          void add(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={album}
        className="sr-only"
        aria-label="从相册选择照片"
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        onChange={(e) => {
          endSystemDialog();
          void add(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="capture-zone">
        <div className="camera-symbol" aria-hidden="true">
          <Camera size={56} strokeWidth={1} />
        </div>
        <div className="capture-copy">
          <h3>{entry ? "照片" : "添加照片"}</h3>
        </div>
        <div className="capture-buttons">
          <button
            className="primary"
            disabled={!!busy}
            onClick={() => {
              beginSystemDialog();
              camera.current?.click();
            }}
          >
            <Camera size={19} strokeWidth={1.6} />
            拍照
          </button>
          <button
            className="secondary"
            disabled={!!busy}
            onClick={() => {
              beginSystemDialog();
              album.current?.click();
            }}
          >
            <ImagePlus size={19} strokeWidth={1.6} />
            从相册选
          </button>
        </div>
      </div>
      {kept.length + photos.length > 0 && (
        <section className="entry-photos">
          <div className="section-line">
            <h2>已选照片</h2>
            <span className="muted">{kept.length + photos.length} 张</span>
          </div>
          <div className="draft-photos">
            {kept.map((p) => (
              <div className="draft-photo" key={p}>
                <Photo id={p} vault={vault} />
                <button
                  className="photo-edit"
                  disabled={!!busy}
                  onClick={async () => {
                    setBusy("正在读取照片…");
                    setError("");
                    try {
                      const blob = await vault.photo(p);
                      if (alive.current)
                        setBrush({ id: p, blob, existing: true });
                    } catch (e) {
                      if (alive.current) setError(userError(e));
                    } finally {
                      if (alive.current) setBusy("");
                    }
                  }}
                >
                  <span>打码</span>
                </button>
                <button
                  disabled={!!busy}
                  className="remove-photo"
                  aria-label="移除照片"
                  onClick={() => setKept(kept.filter((i) => i !== p))}
                >
                  <X size={14} strokeWidth={2} />
                </button>
              </div>
            ))}
            {photos.map((p) => (
              <div className="draft-photo" key={p.id}>
                <Photo id={p.id} vault={vault} blob={p.thumb} />
                <button
                  className="photo-edit"
                  disabled={!!busy}
                  onClick={() =>
                    setBrush({ id: p.id, blob: p.full, existing: false })
                  }
                >
                  <span>打码</span>
                </button>
                <button
                  disabled={!!busy}
                  className="remove-photo"
                  aria-label="移除新照片"
                  onClick={() => setPhotos(photos.filter((i) => i.id !== p.id))}
                >
                  <X size={14} strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      <label className="field">
        记录时间
        <input
          type="datetime-local"
          value={time}
          max={localInput(Date.now())}
          onChange={(e) => setTime(e.target.value)}
          required
        />
      </label>
      {settings.templates.length > 0 && (
        <label className="field">
          套用模板
          <select
            value=""
            onChange={(e) => {
              const t = settings.templates.find((t) => t.id === e.target.value);
              if (t) {
                if (note && !confirm("套用模板会替换当前备注。继续？"))
                  return;
                setNote(t.text);
                setDetails(true);
              }
            }}
          >
            <option value="">选择模板</option>
            {settings.templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="fast-tags" aria-label="常用标签">
        {settings.fastTags.map((t) => {
          const selected = tags
            .split(/[,，]/)
            .map((t) => t.trim())
            .filter(Boolean);
          return (
            <button
              key={t}
              type="button"
              aria-pressed={selected.includes(t)}
              onClick={() =>
                setTags(
                  (selected.includes(t)
                    ? selected.filter((x) => x !== t)
                    : [...selected, t]
                  ).join("，"),
                )
              }
            >
              {t}
            </button>
          );
        })}
      </div>
      {(settings.gears.length > 0 || gearId) && (
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
      {sessions.length > 0 && (
        <label className="field">
          关联时段
          <select
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
          >
            <option value="">不关联</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {dateTime(s.start)}
                {s.end === null ? "（进行中）" : ""}
              </option>
            ))}
          </select>
          <small>只有关联了时段、且处于佩戴中的记录会计入时长和舒适度统计。</small>
        </label>
      )}
      <button
        className="details-toggle"
        onClick={() => setDetails(!details)}
        aria-expanded={details}
      >
        <span>
          备注、标签和状态 <small>可选</small>
        </span>
        <ChevronDown size={18} strokeWidth={1.6} />
      </button>
      {details && (
        <div className="details">
          <label className="field">
            备注
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={10000}
              rows={3}
            />
          </label>
          <label className="field">
            标签
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              maxLength={500}
              placeholder="用逗号分隔，例如：日常，清洁"
            />
          </label>
          <label className="field">
            佩戴状态
            <select
              value={state}
              onChange={(e) => setState(e.target.value as Entry["wearing"])}
            >
              <option value="unspecified">不记录</option>
              <option value="on">佩戴中</option>
              <option value="off">未佩戴</option>
            </select>
          </label>
          <div className="field">
            舒适度
            <div className="comfort-options">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  className={comfort === n ? "selected" : ""}
                  onClick={() => setComfort(comfort === n ? null : n)}
                  aria-pressed={comfort === n}
                >
                  {n}
                </button>
              ))}
            </div>
            <small>1 很不舒服，5 很舒服。再点一次取消。</small>
          </div>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {busy && (
        <p className="muted entry-busy" role="status">
          {busy}
        </p>
      )}
      <button
        className="primary wide"
        disabled={!!busy || !(kept.length + photos.length)}
        onClick={() => void save()}
      >
        <Check size={20} strokeWidth={1.8} />
        {busy || (entry ? "保存修改" : "保存记录")}
      </button>
      <p className="privacy-caption">
        仅保存在本机 · 不会开始佩戴计时
      </p>
      {entry && onDelete && (
        <button
          className="danger-text wide"
          disabled={!!busy}
          onClick={() => onDelete(entry)}
        >
          删除记录
        </button>
      )}
      <button className="text-button wide" disabled={!!busy} onClick={onCancel}>
        取消
      </button>
      {brush && (
        <PrivacyBrush
          blob={brush.blob}
          onClose={() => setBrush(null)}
          onApply={(p) => {
            if (brush.existing) {
              setKept((ids) => ids.filter((id) => id !== brush.id));
              setPhotos((previous) => [...previous, p]);
            } else
              setPhotos((previous) =>
                previous.map((x) => (x.id === brush.id ? p : x)),
              );
            setBrush(null);
          }}
        />
      )}
    </fieldset>
  );
});
