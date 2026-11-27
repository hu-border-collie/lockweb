import { useEffect, useRef, useState } from "react";
import {
  id,
  type Gear,
  type JournalSettings,
  type CheckinTemplate,
} from "../lib/models";
import type { Vault } from "../lib/db";
import { userError } from "../lib/db";
import { Modal } from "./Shared";
import { ChevronRight, LockKeyhole, SlidersHorizontal } from "lucide-react";
import { processGearAvatar } from "../lib/images";
import { beginSystemDialog, endSystemDialog } from "../lib/privacy";
import { useStealth } from "./Stealth";

function GearAvatar({
  src,
  concealed,
}: {
  src?: string;
  concealed: boolean;
}) {
  return (
    <span className="gear-avatar" aria-hidden="true">
      {src ? (
        <img className={concealed ? "concealed" : undefined} src={src} alt="" />
      ) : (
        <LockKeyhole size={16} strokeWidth={1.5} />
      )}
    </span>
  );
}

export function JournalOptions({
  vault,
  settings,
  revision,
  refresh,
  home,
}: {
  vault: Vault;
  settings: JournalSettings;
  revision: number;
  refresh: () => Promise<void>;
  home?: { gear?: Gear; onOpenHistory: (gearId?: string) => void };
}) {
  const [draft, setDraft] = useState<JournalSettings | null>(null);
  const [base, setBase] = useState(0);
  const [gear, setGear] = useState<Gear | null>(null);
  const [template, setTemplate] = useState<CheckinTemplate | null>(null);
  const [tags, setTags] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [processingAvatar, setProcessingAvatar] = useState(false);
  const avatarInput = useRef<HTMLInputElement>(null);
  const stealth = useStealth();
  const editingGear = gear !== null;
  useEffect(() => {
    if (!editingGear) return;
    const input = avatarInput.current;
    input?.addEventListener("cancel", endSystemDialog);
    return () => input?.removeEventListener("cancel", endSystemDialog);
  }, [editingGear]);

  function open() {
    setDraft(structuredClone(settings));
    setBase(revision);
    setTags(settings.fastTags.join("，"));
    setGear(null);
    setTemplate(null);
    setError("");
  }

  async function selectAvatar(file: File) {
    setError("");
    setProcessingAvatar(true);
    try {
      const avatar = await processGearAvatar(file);
      setGear((current) => current && { ...current, avatar });
    } catch (error) {
      setError(userError(error));
    } finally {
      setProcessingAvatar(false);
    }
  }

  return (
    <>
      {home ? (
        <button type="button" className="hero-gear-manager" onClick={open}>
          <GearAvatar src={home.gear?.avatar} concealed={stealth} />
          <span className="hero-gear-manager-text">
            {home.gear ? (
              <>
                <strong>{home.gear.name}</strong>
                <small>锁具管理</small>
              </>
            ) : settings.gears.length ? (
              "锁具管理"
            ) : (
              "添加锁具"
            )}
          </span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      ) : (
        <>
          <h3 className="group-label">记录偏好与装备</h3>
          <div className="card settings-list">
            <button type="button" onClick={open}>
              <SlidersHorizontal size={18} strokeWidth={1.5} aria-hidden="true" />
              <span>
                <span className="setting-title">模板、快捷标签与装备</span>
                <small>备注模板、常用标签、装备档案</small>
              </span>
              <ChevronRight
                className="settings-arrow"
                size={16}
                strokeWidth={1.5}
                aria-hidden="true"
              />
            </button>
          </div>
        </>
      )}
      {draft && (
        <Modal
          title={home ? "锁具管理" : "记录偏好与装备"}
          onClose={() => {
            if (!busy && !processingAvatar) setDraft(null);
          }}
        >
          <fieldset className="settings-sheet-form" disabled={busy || processingAvatar}>
            {home && (
              <button
                type="button"
                className="secondary wide"
                onClick={() => home.onOpenHistory(home.gear?.id)}
              >
                查看锁具历史
              </button>
            )}
            {!home && (
              <>
                <label className="field">
                  常用快捷标签
                  <input
                    value={tags}
                    maxLength={5000}
                    onChange={(e) => setTags(e.target.value)}
                    placeholder="用逗号分隔"
                  />
                </label>
                <label className="field">
                  暂停时长上限（分钟）
                  <input
                    type="number"
                    min={0}
                    max={1440}
                    value={draft.breakThresholdMinutes}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        breakThresholdMinutes: Number(e.target.value),
                      })
                    }
                  />
                  <small>
                    暂停时间始终从佩戴时长中扣除。单次暂停超过上限时，连续佩戴重新计算。0 表示任何暂停都会中断连续。
                  </small>
                </label>
                <h3>记录模板</h3>
                <div className="settings-option-list">
                  {draft.templates.map((t) => (
                    <div className="option-row settings-option" key={t.id}>
                      <button
                        type="button"
                        className="settings-option-main"
                        onClick={() => setTemplate({ ...t })}
                      >
                        {t.name}
                      </button>
                      <button
                        type="button"
                        className="settings-option-action"
                        aria-label={`删除模板 ${t.name}`}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            templates: draft.templates.filter((x) => x.id !== t.id),
                          })
                        }
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  className="secondary"
                  onClick={() =>
                    setTemplate({
                      id: id(),
                      name: "",
                      text: "是否有压痕：\n松紧度：\n当前活动：",
                    })
                  }
                >
                  新增模板
                </button>
                {template && (
                  <div className="settings-subform">
                    <label className="field">
                      模板名称
                      <input
                        maxLength={100}
                        value={template.name}
                        onChange={(e) =>
                          setTemplate({ ...template, name: e.target.value })
                        }
                      />
                    </label>
                    <label className="field">
                      模板内容
                      <textarea
                        rows={5}
                        maxLength={10000}
                        value={template.text}
                        onChange={(e) =>
                          setTemplate({ ...template, text: e.target.value })
                        }
                      />
                    </label>
                    <button
                      className="secondary"
                      disabled={!template.name.trim()}
                      onClick={() => {
                        setDraft({
                          ...draft,
                          templates: [
                            ...draft.templates.filter((t) => t.id !== template.id),
                            { ...template, name: template.name.trim() },
                          ],
                        });
                        setTemplate(null);
                      }}
                    >
                      保留模板到草稿
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setTemplate(null)}
                    >
                      取消
                    </button>
                  </div>
                )}
              </>
            )}
            {!home && <h3>装备档案</h3>}
            <p className="settings-hint">
              归档后不再出现在新记录的选项中，历史数据和统计保留。
            </p>
            <div className="settings-option-list">
              {draft.gears.map((g) => (
                <div className="option-row settings-option" key={g.id}>
                  <button
                    type="button"
                    className="settings-option-main"
                    onClick={() => setGear({ ...g })}
                  >
                    <GearAvatar src={g.avatar} concealed={stealth} />
                    <span>
                      {g.name}
                      {g.archived ? "（已归档）" : ""}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="settings-option-action"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        gears: draft.gears.map((x) =>
                          x.id === g.id ? { ...x, archived: !x.archived } : x,
                        ),
                      })
                    }
                  >
                    {g.archived ? "启用" : "归档"}
                  </button>
                </div>
              ))}
            </div>
            <button
              className="secondary"
              onClick={() =>
                setGear({
                  id: id(),
                  name: "",
                  material: "",
                  size: "",
                  acquired: "",
                  started: "",
                  note: "",
                  archived: false,
                })
              }
            >
              新增装备
            </button>
            {gear && (
              <div className="settings-subform">
                <div className="gear-avatar-editor">
                  <GearAvatar src={gear.avatar} concealed={false} />
                  <input
                    ref={avatarInput}
                    className="sr-only"
                    aria-label="选择锁具头像"
                    tabIndex={-1}
                    type="file"
                    accept="image/*,.heic,.heif"
                    onChange={(event) => {
                      endSystemDialog();
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = "";
                      if (file) void selectAvatar(file);
                    }}
                  />
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      beginSystemDialog();
                      avatarInput.current?.click();
                    }}
                  >
                    {processingAvatar
                      ? "正在处理头像…"
                      : gear.avatar
                        ? "更换头像"
                        : "添加头像"}
                  </button>
                  {gear.avatar && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setGear({ ...gear, avatar: undefined })}
                    >
                      移除头像
                    </button>
                  )}
                </div>
                {(
                  [
                    ["name", "装备名称"],
                    ["material", "材质"],
                    ["size", "规格尺寸"],
                    ["acquired", "购买日期"],
                    ["started", "启用日期"],
                  ] as const
                ).map(([key, label]) => (
                  <label className="field" key={key}>
                    {label}
                    <input
                      type={
                        key === "acquired" || key === "started"
                          ? "date"
                          : "text"
                      }
                      maxLength={key === "name" ? 100 : 200}
                      value={gear[key]}
                      onChange={(e) =>
                        setGear({ ...gear, [key]: e.target.value })
                      }
                    />
                  </label>
                ))}
                <label className="field">
                  装备备注
                  <textarea
                    maxLength={10000}
                    value={gear.note}
                    onChange={(e) => setGear({ ...gear, note: e.target.value })}
                  />
                </label>
                <button
                  className="secondary"
                  disabled={!gear.name.trim()}
                  onClick={() => {
                    setDraft({
                      ...draft,
                      gears: [
                        ...draft.gears.filter((g) => g.id !== gear.id),
                        { ...gear, name: gear.name.trim() },
                      ],
                    });
                    setGear(null);
                  }}
                >
                  保留装备到草稿
                </button>
                <button className="text-button" onClick={() => setGear(null)}>
                  取消
                </button>
              </div>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button
              className="primary wide"
              disabled={busy || !!gear || !!template}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await vault.saveSettings(
                    {
                      ...draft,
                      fastTags: [
                        ...new Set(
                          tags
                            .split(/[,，]/)
                            .map((t) => t.trim())
                            .filter(Boolean),
                        ),
                      ],
                    },
                    base,
                  );
                  await refresh();
                  setDraft(null);
                } catch (e) {
                  setError(userError(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "正在保存…" : "保存"}
            </button>
          </fieldset>
        </Modal>
      )}
    </>
  );
}
