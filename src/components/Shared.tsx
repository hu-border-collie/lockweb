import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { X, Plus, Minus, RotateCcw, Image as ImageIcon } from "lucide-react";
import type { Vault } from "../lib/db";
import type { Entry } from "../lib/models";
import { clock, dateTime } from "../lib/time";
import { useStealth } from "./Stealth";
const modalStack: HTMLDivElement[] = [];
let previousOverflow = "";
export const Empty = memo(function Empty({
  icon,
  title,
  detail,
  action,
}: {
  icon?: ReactNode;
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon || <ImageIcon size={28} />}
      <h3>{title}</h3>
      <p>{detail}</p>
      {action}
    </div>
  );
});
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    const node = ref.current!;
    if (!modalStack.length) previousOverflow = document.body.style.overflow;
    if (ref.current) modalStack.push(ref.current);
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (modalStack.at(-1) !== ref.current) return;
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const els = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            "button,input,select,textarea,a[href]",
          ) ?? [],
        ).filter((e) => !e.hasAttribute("disabled"));
        if (!els.length) {
          e.preventDefault();
          return;
        }
        const first = els[0],
          last = els.at(-1)!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      const index = modalStack.indexOf(node);
      if (index >= 0) modalStack.splice(index, 1);
      if (!modalStack.length) document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", key);
      if (modalStack.length) modalStack.at(-1)?.focus();
      else if (document.contains(old)) old?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <div className="sheet-heading">
          <h2>{title}</h2>
          <button className="icon-button" aria-label="关闭" onClick={onClose}>
            <X />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function Photo({
  id,
  vault,
  onClick,
  blob,
}: {
  id: string;
  vault: Vault;
  onClick?: () => void;
  blob?: Blob;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState(false);
  const stealth = useStealth();
  const [reveal, setReveal] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const held = useRef(false);
  const stop = () => {
    clearTimeout(timer.current);
    setReveal(false);
  };
  useEffect(() => {
    clearTimeout(timer.current);
    setReveal(false);
    held.current = false;
  }, [stealth]);
  useEffect(() => {
    const clear = () => {
      clearTimeout(timer.current);
      setReveal(false);
      held.current = false;
    };
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
    };
  }, []);
  const preview = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (!stealth || e.button !== 0) return;
      held.current = false;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        held.current = true;
        setReveal(true);
      }, 350);
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    onPointerLeave: stop,
    onBlur: stop,
    onContextMenu: (e: React.MouseEvent) => {
      if (stealth) e.preventDefault();
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (stealth && e.key === " ") {
        e.preventDefault();
        held.current = true;
        setReveal(true);
      }
    },
    onKeyUp: (e: React.KeyboardEvent) => {
      if (e.key === " ") {
        e.preventDefault();
        stop();
        held.current = false;
      }
    },
    onClick: () => {
      if (held.current) {
        held.current = false;
        return;
      }
      onClick?.();
    },
  };
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    let alive = true,
      object = "";
    let started = false;
    const load = () => {
      if (started) return;
      started = true;
      (blob ? Promise.resolve(blob) : vault.photo(id, true))
        .then((b) => {
          if (alive) {
            object = URL.createObjectURL(b);
            setUrl(object);
          }
        })
        .catch(() => alive && setError(true));
    };
    const observer = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          load();
          observer.disconnect();
        }
      },
      { rootMargin: "160px" },
    );
    if (ref.current) observer.observe(ref.current);
    return () => {
      alive = false;
      observer.disconnect();
      if (object) URL.revokeObjectURL(object);
    };
  }, [id, vault, blob]);
  const content = url ? (
    <img src={url} alt="私人打卡照片" loading="lazy" draggable={false} />
  ) : (
    <span>{error ? "照片读取失败" : <ImageIcon size={22} />}</span>
  );
  return onClick ? (
    <button
      ref={(node) => {
        ref.current = node;
      }}
      type="button"
      className={`photo-thumb ${stealth && !reveal ? "concealed" : ""}`}
      {...preview}
      aria-label="查看照片"
    >
      {content}
    </button>
  ) : (
    <div
      ref={(node) => {
        ref.current = node;
      }}
      className={`photo-thumb ${stealth && !reveal ? "concealed" : ""}`}
      {...preview}
      tabIndex={stealth ? 0 : undefined}
      aria-label="照片缩略图"
    >
      {content}
    </div>
  );
}
export const RecordCard = memo(function RecordCard({
  entry,
  vault,
  onEdit,
  onView,
}: {
  entry: Entry;
  vault: Vault;
  onEdit: (e: Entry) => void;
  onView: (ids: string[], index: number) => void;
}) {
  return (
    <article className="card record">
      <div className="record-heading">
        <div>
          <strong>{clock(entry.timestamp)}</strong>
          <span className="muted">
            {entry.wearing === "on"
              ? "佩戴中"
              : entry.wearing === "off"
                ? "未佩戴"
                : "状态未记录"}
            {entry.comfort ? " · 舒适度 " + entry.comfort + "/5" : ""}
          </span>
        </div>
        <button
          className="text-button"
          onClick={() => onEdit(entry)}
          aria-label={`编辑 ${dateTime(entry.timestamp)} 打卡`}
        >
          编辑
        </button>
      </div>
      <div className="photo-strip">
        {entry.photoIds.map((id, i) => (
          <Photo
            key={id}
            id={id}
            vault={vault}
            onClick={() => onView(entry.photoIds, i)}
          />
        ))}
      </div>
      {entry.note && <p className="record-note">{entry.note}</p>}
      {entry.tags.length > 0 && (
        <div className="tags">
          {entry.tags.map((t) => (
            <span key={t}>#{t}</span>
          ))}
        </div>
      )}
    </article>
  );
});
export function Viewer({
  ids,
  index,
  vault,
  onClose,
}: {
  ids: string[];
  index: number;
  vault: Vault;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState(index);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ distance: 0, scale: 1, x: 0, y: 0 });
  useEffect(() => {
    let alive = true,
      u = "";
    setUrl("");
    setError("");
    setScale(1);
    setOffset({ x: 0, y: 0 });
    vault
      .photo(ids[current])
      .then((b) => {
        if (alive) {
          u = URL.createObjectURL(b);
          setUrl(u);
        }
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [ids, current, vault]);
  return (
    <div
      className="viewer"
      role="dialog"
      aria-label="照片全屏浏览"
      aria-modal="true"
    >
      <div className="viewer-top">
        <span>
          {current + 1} / {ids.length}
        </span>
        <button
          className="icon-button"
          autoFocus
          onClick={onClose}
          aria-label="关闭照片"
        >
          <X />
        </button>
      </div>
      <div
        className="viewer-image"
        onDoubleClick={() => {
          setScale(scale === 1 ? 2 : 1);
          setOffset({ x: 0, y: 0 });
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const p = [...pointers.current.values()];
          gesture.current = {
            distance:
              p.length === 2 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0,
            scale,
            x: e.clientX - offset.x,
            y: e.clientY - offset.y,
          };
        }}
        onPointerMove={(e) => {
          if (!pointers.current.has(e.pointerId)) return;
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const p = [...pointers.current.values()];
          if (p.length === 2 && gesture.current.distance)
            setScale(
              Math.min(
                5,
                Math.max(
                  1,
                  (gesture.current.scale *
                    Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y)) /
                    gesture.current.distance,
                ),
              ),
            );
          else if (p.length === 1 && scale > 1)
            setOffset({
              x: e.clientX - gesture.current.x,
              y: e.clientY - gesture.current.y,
            });
        }}
        onPointerUp={(e) => pointers.current.delete(e.pointerId)}
        onPointerCancel={() => pointers.current.clear()}
      >
        {url ? (
          <img
            draggable={false}
            src={url}
            style={{
              transform: `translate(${offset.x}px,${offset.y}px) scale(${scale})`,
            }}
            alt="私人打卡照片"
          />
        ) : (
          <p>{error || "解密照片中…"}</p>
        )}
      </div>
      <div className="viewer-controls">
        <button
          disabled={current === 0}
          onClick={() => setCurrent(current - 1)}
        >
          上一张
        </button>
        <button
          className="icon-button"
          aria-label="缩小照片"
          onClick={() => setScale(Math.max(1, scale - 0.5))}
        >
          <Minus />
        </button>
        <button
          className="icon-button"
          aria-label="重置缩放"
          onClick={() => {
            setScale(1);
            setOffset({ x: 0, y: 0 });
          }}
        >
          <RotateCcw />
        </button>
        <button
          className="icon-button"
          aria-label="放大照片"
          onClick={() => setScale(Math.min(5, scale + 0.5))}
        >
          <Plus />
        </button>
        <button
          disabled={current === ids.length - 1}
          onClick={() => setCurrent(current + 1)}
        >
          下一张
        </button>
      </div>
      <p className="viewer-hint">双击缩放 · 双指缩放 · 放大后拖动</p>
    </div>
  );
}
