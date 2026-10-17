import { useEffect, useRef, useState } from "react";
import type { Vault } from "../lib/db";
import { userError } from "../lib/db";
import { duration } from "../lib/time";
import { Modal } from "./Shared";
export interface ComparePhoto {
  id: string;
  timestamp: number;
}
export function ComparePhotos({
  photos,
  vault,
  onClose,
}: {
  photos: ComparePhoto[];
  vault: Vault;
  onClose: () => void;
}) {
  const [urls, setUrls] = useState<string[]>([]),
    [error, setError] = useState("");
  const [mode, setMode] = useState("side"),
    [split, setSplit] = useState(50),
    [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const points = useRef(new Map<number, { x: number; y: number }>());
  const dividerPointer = useRef<number | null>(null);
  useEffect(() => {
    if (zoom === 1) setOffset({ x: 0, y: 0 });
  }, [zoom]);
  useEffect(() => {
    let alive = true;
    const objects: string[] = [];
    setUrls([]);
    setError("");
    void Promise.all(photos.map((p) => vault.photo(p.id)))
      .then((blobs) => {
        if (!alive) return;
        objects.push(...blobs.map((b) => URL.createObjectURL(b)));
        setUrls(objects);
      })
      .catch((e) => {
        if (alive) setError(userError(e));
      });
    return () => {
      alive = false;
      objects.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [photos, vault]);
  const transform = `translate(${offset.x}px,${offset.y}px) scale(${zoom})`;
  const gestures = {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      points.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      const previous = points.current.get(e.pointerId);
      if (!previous) return;
      const other = [...points.current.entries()].find(
        ([id]) => id !== e.pointerId,
      )?.[1];
      if (other) {
        const before = Math.hypot(previous.x - other.x, previous.y - other.y),
          after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
        if (before > 0)
          setZoom((z) => Math.max(1, Math.min(4, (z * after) / before)));
      } else if (zoom > 1)
        setOffset((p) => ({
          x: Math.max(-300, Math.min(300, p.x + e.clientX - previous.x)),
          y: Math.max(-300, Math.min(300, p.y + e.clientY - previous.y)),
        }));
      points.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    },
    onPointerUp: (e: React.PointerEvent) => {
      points.current.delete(e.pointerId);
    },
    onPointerCancel: () => points.current.clear(),
    onLostPointerCapture: (e: React.PointerEvent) => {
      points.current.delete(e.pointerId);
    },
  };
  const image = (i: number) => (
    <img
      src={urls[i]}
      alt={i === 0 ? "对比照片一" : "对比照片二"}
      draggable={false}
      style={{ transform }}
    />
  );
  return (
    <Modal title="照片对比" onClose={onClose}>
      <p className="muted">
        相隔 {duration(Math.abs(photos[0].timestamp - photos[1].timestamp))} ·
        两张照片一起看
      </p>
      <div className="segmented compare-modes">
        <button
          type="button"
          className={mode === "side" ? "selected" : ""}
          aria-pressed={mode === "side"}
          onClick={() => setMode("side")}
        >
          并排看
        </button>
        <button
          type="button"
          className={mode === "split" ? "selected" : ""}
          aria-pressed={mode === "split"}
          onClick={() => setMode("split")}
        >
          卷帘看
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {urls.length === 2 ? (
        <>
          {mode === "side" ? (
            <div className="compare-side">
              {[0, 1].map((i) => (
                <div className="compare-stage" key={i} {...gestures}>
                  {image(i)}
                </div>
              ))}
            </div>
          ) : (
            <div className="compare-stage" {...gestures}>
              {image(0)}
              <div
                className="compare-overlay"
                style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
              >
                {image(1)}
              </div>
              <button
                type="button"
                role="slider"
                aria-label="照片卷帘分界线"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={split}
                className="compare-divider"
                style={{ left: `${split}%` }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  dividerPointer.current = e.pointerId;
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  if (dividerPointer.current !== e.pointerId) return;
                  e.stopPropagation();
                  const r =
                    e.currentTarget.parentElement!.getBoundingClientRect();
                  setSplit(
                    Math.max(
                      0,
                      Math.min(
                        100,
                        Math.round(((e.clientX - r.left) / r.width) * 100),
                      ),
                    ),
                  );
                }}
                onPointerUp={() => {
                  dividerPointer.current = null;
                }}
                onPointerCancel={() => {
                  dividerPointer.current = null;
                }}
                onLostPointerCapture={() => {
                  dividerPointer.current = null;
                }}
                onKeyDown={(e) => {
                  if (
                    ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
                  ) {
                    e.preventDefault();
                    setSplit(
                      e.key === "Home"
                        ? 0
                        : e.key === "End"
                          ? 100
                          : Math.max(
                              0,
                              Math.min(
                                100,
                                split + (e.key === "ArrowLeft" ? -5 : 5),
                              ),
                            ),
                    );
                  }
                }}
              >
                <span aria-hidden="true">↔</span>
              </button>
            </div>
          )}
          {mode === "split" && (
            <label className="field compare-range">
              对比线
              <input
                type="range"
                min={0}
                max={100}
                value={split}
                onChange={(e) => setSplit(Number(e.target.value))}
              />
            </label>
          )}
          <label className="field compare-range">
            同步缩放
            <input
              type="range"
              min={1}
              max={4}
              step={0.1}
              value={zoom}
              onChange={(e) => {
                setZoom(Number(e.target.value));
                if (Number(e.target.value) === 1) setOffset({ x: 0, y: 0 });
              }}
            />
          </label>
          <button
            type="button"
            className="secondary wide compare-reset"
            onClick={() => {
              setZoom(1);
              setOffset({ x: 0, y: 0 });
            }}
          >
            重置视图
          </button>
        </>
      ) : (
        !error && <p className="muted">正在解开两张照片…</p>
      )}
    </Modal>
  );
}
