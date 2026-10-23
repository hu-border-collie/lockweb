import { useEffect, useRef, useState } from "react";
import { processImage } from "../lib/images";
import type { PhotoInput } from "../lib/models";
import { userError } from "../lib/db";
import { Modal } from "./Shared";
type Stroke = {
  mode: "black" | "mosaic";
  width: number;
  points: { x: number; y: number }[];
};
export function PrivacyBrush({
  blob,
  onApply,
  onClose,
}: {
  blob: Blob;
  onApply: (p: PhotoInput) => void;
  onClose: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    source = useRef<HTMLImageElement | null>(null);
  const strokes = useRef<Stroke[]>([]),
    drawing = useRef<number | null>(null);
  const alive = useRef(true);
  const [mode, setMode] = useState<Stroke["mode"]>("black"),
    [width, setWidth] = useState(60);
  const [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [count, setCount] = useState(0);
  function render() {
    const c = canvas.current,
      img = source.current;
    if (!c || !img) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const paint = (target: CanvasRenderingContext2D, s: Stroke) => {
      target.lineWidth = s.width;
      target.lineCap = "round";
      target.lineJoin = "round";
      target.strokeStyle = "#000";
      target.beginPath();
      target.moveTo(s.points[0].x, s.points[0].y);
      for (const p of s.points) target.lineTo(p.x, p.y);
      target.lineTo(s.points.at(-1)!.x + 0.01, s.points.at(-1)!.y);
      target.stroke();
    };
    for (const s of strokes.current) {
      if (s.mode === "black") paint(ctx, s);
      else {
        const pixels = document.createElement("canvas");
        pixels.width = Math.max(1, Math.ceil(c.width / 32));
        pixels.height = Math.max(1, Math.ceil(c.height / 32));
        pixels
          .getContext("2d")!
          .drawImage(img, 0, 0, pixels.width, pixels.height);
        const layer = document.createElement("canvas");
        layer.width = c.width;
        layer.height = c.height;
        const l = layer.getContext("2d")!;
        l.imageSmoothingEnabled = false;
        l.drawImage(pixels, 0, 0, c.width, c.height);
        l.globalCompositeOperation = "destination-in";
        const mask = document.createElement("canvas");
        mask.width = c.width;
        mask.height = c.height;
        paint(mask.getContext("2d")!, s);
        l.drawImage(mask, 0, 0);
        ctx.drawImage(layer, 0, 0);
        pixels.width = layer.width = mask.width = 1;
      }
    }
    // Black redactions dominate subsequent mosaic strokes. A mosaic sampled
    // from the source must never restore pixels under a surviving black mask.
    for (const s of strokes.current) if (s.mode === "black") paint(ctx, s);
  }
  useEffect(() => {
    alive.current = true;
    const url = URL.createObjectURL(blob),
      img = new Image();
    img.onload = () => {
      if (!alive.current) return;
      source.current = img;
      const c = canvas.current;
      if (c) {
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        render();
        setLoaded(true);
      }
    };
    img.onerror = () => {
      if (alive.current) setError("照片读取失败");
    };
    img.src = url;
    return () => {
      alive.current = false;
      URL.revokeObjectURL(url);
      img.onload = null;
      img.onerror = null;
      img.src = "";
      source.current = null;
      strokes.current = [];
    };
  }, [blob]);
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget,
      r = c.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(c.width, ((e.clientX - r.left) * c.width) / r.width),
      ),
      y: Math.max(
        0,
        Math.min(c.height, ((e.clientY - r.top) * c.height) / r.height),
      ),
    };
  };
  return (
    <Modal
      title="照片打码"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="muted brush-intro">
        黑笔完全遮挡，马赛克降低清晰度。打码后需保存记录才会替换本机照片。
      </p>
      <div className="segmented brush-modes">
        <button
          className={mode === "black" ? "selected" : ""}
          onClick={() => setMode("black")}
        >
          黑笔
        </button>
        <button
          className={mode === "mosaic" ? "selected" : ""}
          onClick={() => setMode("mosaic")}
        >
          马赛克
        </button>
      </div>
      <label className="field brush-width">
        笔刷粗细
        <input
          type="range"
          min={10}
          max={240}
          value={width}
          onChange={(e) => setWidth(Number(e.target.value))}
        />
      </label>
      <div className="brush-stage">
        <canvas
          ref={canvas}
          className="brush-canvas"
          aria-label="照片打码画布"
          onPointerDown={(e) => {
            if (!loaded || busy || drawing.current !== null) return;
            drawing.current = e.pointerId;
            e.currentTarget.setPointerCapture(e.pointerId);
            strokes.current.push({ mode, width, points: [point(e)] });
            setCount(strokes.current.length);
            render();
          }}
          onPointerMove={(e) => {
            if (drawing.current !== e.pointerId) return;
            strokes.current.at(-1)!.points.push(point(e));
            render();
          }}
          onPointerUp={() => {
            drawing.current = null;
          }}
          onPointerCancel={() => {
            drawing.current = null;
          }}
          onLostPointerCapture={() => {
            drawing.current = null;
          }}
        />
      </div>
      <div className="option-row brush-actions">
        <button
          className="secondary"
          disabled={!count || busy}
          onClick={() => {
            strokes.current.pop();
            setCount(strokes.current.length);
            render();
          }}
        >
          撤销
        </button>
        <button
          className="secondary"
          disabled={!count || busy}
          onClick={() => {
            strokes.current = [];
            setCount(0);
            render();
          }}
        >
          清除打码
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button
        className="primary wide"
        disabled={!loaded || busy || !count}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const b = await new Promise<Blob>((resolve, reject) =>
              canvas.current!.toBlob(
                (b) => (b ? resolve(b) : reject(new Error("打码照片生成失败"))),
                "image/jpeg",
                0.95,
              ),
            );
            const p = await processImage(
              new File([b], "redacted.jpg", { type: "image/jpeg" }),
            );
            if (alive.current) onApply(p);
          } catch (e) {
            if (alive.current) {
              setError(userError(e));
              setBusy(false);
            }
          }
        }}
      >
        {busy ? "正在生成…" : "应用打码"}
      </button>
    </Modal>
  );
}
