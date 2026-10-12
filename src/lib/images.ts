import { id, type PhotoInput } from "./models";
function load(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("无法解码照片"));
    };
    img.src = url;
  });
}
async function jpeg(img: HTMLImageElement, max: number, quality: number) {
  const ratio = Math.min(
    1,
    max / Math.max(img.naturalWidth, img.naturalHeight),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("图片处理不可用");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const result = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("照片转换失败"))),
      "image/jpeg",
      quality,
    ),
  );
  canvas.width = canvas.height = 1;
  return result;
}
export async function processImage(file: File): Promise<PhotoInput> {
  if (file.size > 40 * 1024 * 1024)
    throw new Error("单张照片超过 40 MB，请先缩小照片");
  if (
    !file.type.startsWith("image/") &&
    !/\.(heic|heif|jpg|jpeg|png|webp)$/i.test(file.name)
  )
    throw new Error("请选择照片文件");
  let img: HTMLImageElement;
  try {
    img = await load(file);
  } catch {
    if (/hei[cf]/i.test(file.type + " " + file.name)) {
      try {
        const { heicTo } = await import("heic-to/csp");
        const result = await heicTo({
          blob: file,
          type: "image/jpeg",
          quality: 0.9,
        });
        img = await load(result);
      } catch {
        throw new Error(
          "此 HEIC 照片无法转换，请在相册中导出 JPEG 后重试。相机可设置为“兼容性最佳”。",
        );
      }
    } else throw new Error("无法读取此照片，请换用 JPEG、PNG 或 WebP");
  }
  if (img.naturalWidth * img.naturalHeight > 100_000_000)
    throw new Error("照片像素过大，请先缩小");
  return {
    id: id(),
    full: await jpeg(img, 2560, 0.88),
    thumb: await jpeg(img, 360, 0.72),
  };
}
