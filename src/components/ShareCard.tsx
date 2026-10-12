import { useEffect, useRef, useState } from "react";
import type { Entry, WearSession } from "../lib/models";
import { shareSummary, renderShareCard } from "../lib/shareCard";
import { beginSystemDialog, endSystemDialog } from "../lib/privacy";
import { userError } from "../lib/db";
import { Modal } from "./Shared";
export function ShareCard({
  entries,
  sessions,
  now,
}: {
  entries: Entry[];
  sessions: WearSession[];
  now: number;
}) {
  const [open, setOpen] = useState(false),
    [heat, setHeat] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [card, setCard] = useState<{ url: string; file: File } | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(
    () => () => {
      if (card) URL.revokeObjectURL(card.url);
    },
    [card],
  );
  return (
    <>
      <button
        className="secondary wide"
        onClick={() => {
          setOpen(true);
          setCard(null);
          setError("");
        }}
      >
        生成脱敏战报
      </button>
      {open && (
        <Modal
          title="脱敏战报预览"
          onClose={() => {
            if (!busy) {
              setOpen(false);
              setCard(null);
            }
          }}
        >
          <p className="muted">
            仅显示连续天数、累计时长和里程碑，不包含照片、备注、标签或精确时间。确认预览后再保存或分享。
          </p>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={heat}
              disabled={busy}
              onChange={(e) => {
                setHeat(e.target.checked);
                setCard(null);
              }}
            />
            包含热力图剪影（会透露每日打卡分布）
          </label>
          <button
            className="primary wide"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const b = await renderShareCard(
                  shareSummary(entries, sessions, now),
                  heat,
                );
                if (alive.current)
                  setCard({
                    url: URL.createObjectURL(b),
                    file: new File([b], "private-log-achievement.png", {
                      type: "image/png",
                    }),
                  });
              } catch (e) {
                if (alive.current) setError(userError(e));
              } finally {
                if (alive.current) setBusy(false);
              }
            }}
          >
            {busy ? "正在生成…" : "生成战报预览"}
          </button>
          {card && (
            <>
              <img
                className="share-preview"
                src={card.url}
                alt="脱敏战报预览"
              />
              <button
                className="secondary wide"
                onClick={async () => {
                  if (!navigator.canShare?.({ files: [card.file] })) {
                    setError("此设备不支持文件分享，请使用下方保存图片链接。");
                    return;
                  }
                  beginSystemDialog();
                  try {
                    await navigator.share({
                      files: [card.file],
                      title: "我的记录成果",
                    });
                  } catch (e) {
                    if ((e as Error).name !== "AbortError")
                      setError(userError(e));
                  } finally {
                    endSystemDialog();
                  }
                }}
              >
                系统分享战报
              </button>
              <a
                className="backup-link"
                href={card.url}
                download={card.file.name}
                onClick={() => beginSystemDialog()}
              >
                保存战报图片
              </a>
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </Modal>
      )}
    </>
  );
}
