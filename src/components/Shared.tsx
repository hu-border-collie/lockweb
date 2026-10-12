import { useEffect, useRef, useState, type ReactNode } from "react";
import { X, Plus, Minus, RotateCcw, Image as ImageIcon } from "lucide-react";
import type { Vault } from "../lib/db";
import type { Entry } from "../lib/models";
import { clock, dateTime } from "../lib/time";
export function Empty({
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
}
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
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
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
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", key);
      old?.focus();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop">
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
  const ref = useRef<HTMLButtonElement>(null);
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
  return (
    <button
      ref={ref}
      type="button"
      className="photo-thumb"
      onClick={onClick}
      aria-label="查看照片"
    >
      {url ? (
        <img src={url} alt="私人打卡照片" loading="lazy" />
      ) : (
        <span>{error ? "照片读取失败" : <ImageIcon size={22} />}</span>
      )}
    </button>
  );
}
export function RecordCard({
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
}
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
