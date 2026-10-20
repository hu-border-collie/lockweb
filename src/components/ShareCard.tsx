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
        className="stat-entry"
        type="button"
        onClick={() => {
          setOpen(true);
          setCard(null);
          setError("");
        }}
      >
        <span className="stat-entry-mark" aria-hidden="true" />
        <span className="stat-entry-title">做一张匿名小结</span>
        <span className="stat-entry-arrow" aria-hidden="true">
          →
        </span>
      </button>
      {open && (
        <Modal
          title="匿名小结预览"
          onClose={() => {
            if (!busy) {
              setOpen(false);
              setCard(null);
            }
          }}
        >
          <p className="muted">
            只会出现连续天数、累计时长和小里程碑，不会带上照片、备注、标签或具体时间。预览满意后再保存或分享。
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
            带上热力剪影（会透露每天有没有记录）
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
            {busy ? "正在生成…" : "生成小结"}
          </button>
          {card && (
            <div className="share-result">
              <img
                className="share-preview"
                src={card.url}
                alt="匿名小结预览"
              />
              <button
                className="secondary wide"
                type="button"
                onClick={async () => {
                  if (!navigator.canShare?.({ files: [card.file] })) {
                    setError("这台设备没法直接分享，请用下面的保存链接。");
                    return;
                  }
                  beginSystemDialog();
                  try {
                    await navigator.share({
                      files: [card.file],
                      title: "我的手记小结",
                    });
                  } catch (e) {
                    if ((e as Error).name !== "AbortError")
                      setError(userError(e));
                  } finally {
                    endSystemDialog();
                  }
                }}
              >
                分享这张小结
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
