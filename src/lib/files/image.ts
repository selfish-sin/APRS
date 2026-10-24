/**
 * 图片的宽高和一张 ≤ 20KB 的小缩略图（只在浏览器里跑：用 <img> 和 canvas）。
 * 读不出来的（HEIC 之类）当成普通文件。
 */
const THUMB_MAX = 27_000;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("not an image"));
    img.src = url;
  });
}

export async function imageInfo(blob: Blob): Promise<{ width: number; height: number; thumb: string | null } | null> {
  if (typeof document === "undefined") return null;
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const width = img.naturalWidth || 1000;
    const height = img.naturalHeight || 1000;
    let thumb: string | null = null;
    for (const [side, quality] of [
      [160, 0.72],
      [120, 0.6],
      [80, 0.5],
    ] as const) {
      const scale = Math.min(1, side / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) break;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL("image/jpeg", quality);
      if (data.length <= THUMB_MAX) {
        thumb = data;
        break;
      }
    }
    return { width, height, thumb };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
