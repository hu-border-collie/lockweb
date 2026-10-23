import { useEffect, useRef, useState } from "react";
import { Share2 } from "lucide-react";
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
        className="stat-entry"
        type="button"
        onClick={() => {
          setOpen(true);
          setCard(null);
          setError("");
        }}
      >
        <span className="stat-entry-mark" aria-hidden="true">
          <Share2 size={16} strokeWidth={1.6} />
        </span>
        <span className="stat-entry-title">生成匿名分享图</span>
        <span className="stat-entry-arrow" aria-hidden="true">
          →
        </span>
      </button>
      {open && (
        <Modal
          title="匿名分享图"
          onClose={() => {
            if (!busy) {
              setOpen(false);
              setCard(null);
            }
          }}
        >
          <p className="muted">
            只包含连续天数、累计时长和里程碑，不含照片、备注、标签和具体时间。
          </p>
          <label className="checkbox share-heat">
            <input
              type="checkbox"
              checked={heat}
              disabled={busy}
              onChange={(e) => {
                setHeat(e.target.checked);
                setCard(null);
              }}
            />
            包含热力图（会显示每天是否有记录）
          </label>
          <button
            className="primary wide"
            type="button"
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
            {busy ? "正在生成…" : "生成"}
          </button>
          {card && (
            <div className="share-result">
              <img
                className="share-preview"
                src={card.url}
                alt="匿名分享图"
              />
              <button
                className="secondary wide"
                type="button"
                onClick={async () => {
                  if (!navigator.canShare?.({ files: [card.file] })) {
                    setError("此设备不支持直接分享，请使用下方的保存图片。");
                    return;
                  }
                  beginSystemDialog();
                  try {
                    await navigator.share({
                      files: [card.file],
                      title: "私记统计",
                    });
                  } catch (e) {
                    if ((e as Error).name !== "AbortError")
                      setError(userError(e));
                  } finally {
                    endSystemDialog();
                  }
                }}
              >
                分享
              </button>
              <a
                className="share-save-link"
                href={card.url}
                download={card.file.name}
                onClick={() => beginSystemDialog()}
              >
                保存图片
              </a>
            </div>
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
