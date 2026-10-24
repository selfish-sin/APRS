/**
 * 保存到这台设备（SPEC §11.6）。只在用户点按钮时调用。
 *   1. 先试 claude.ai 预览页面给的 downloads（`window.claude.use("downloads")`；拿到 null 或 10 秒没回 = 没有）
 *      有的话 `dl.save({ filename, data })`；扩展名只认下面这些，别的（.clip、.rar …）在预览页面里存不了；被拒不重试。
 *   2. 没有就用普通的 `<a download>`。
 */
export const PREVIEW_SAVE_TYPES = ["json", "png", "jpg", "jpeg", "webp", "gif", "pdf", "zip", "txt", "md", "csv", "svg", "mp4", "webm"] as const;

export type SaveResult = { ok: true; via: "downloads" | "link" } | { ok: false; reason: "declined" | "unsupported_type" | "failed"; message: string };

interface Downloads {
  save: (input: { filename: string; data: Blob | string }) => Promise<unknown>;
}

interface HostWindow {
  claude?: { use?: (name: string) => unknown };
  document?: Document;
  URL?: typeof URL;
  setTimeout: typeof setTimeout;
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

function isDeclined(x: unknown): boolean {
  if (!x) return false;
  if (x === "declined") return true;
  const o = x as { declined?: unknown; status?: unknown; code?: unknown; reason?: unknown; message?: unknown; name?: unknown };
  return o.declined === true || [o.status, o.code, o.reason, o.name].includes("declined") || (typeof o.message === "string" && /declined/i.test(o.message));
}

export async function getDownloads(host: HostWindow, timeoutMs = 10_000): Promise<Downloads | null> {
  const use = host.claude?.use;
  if (typeof use !== "function") return null;
  try {
    const got = await Promise.race([
      Promise.resolve(use.call(host.claude, "downloads")),
      new Promise<null>((resolve) => host.setTimeout(() => resolve(null), timeoutMs)),
    ]);
    const dl = got as Downloads | null | undefined;
    return dl && typeof dl.save === "function" ? dl : null;
  } catch {
    return null;
  }
}

function linkDownload(host: HostWindow, filename: string, data: Blob): SaveResult {
  const doc = host.document;
  const u = host.URL;
  if (!doc || !u) return { ok: false, reason: "failed", message: "只能在浏览器里保存" };
  try {
    const url = u.createObjectURL(data);
    const a = doc.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    doc.body.appendChild(a);
    a.click();
    a.remove();
    host.setTimeout(() => u.revokeObjectURL(url), 2000);
    return { ok: true, via: "link" };
  } catch (e) {
    return { ok: false, reason: "failed", message: e instanceof Error ? e.message : "没能保存" };
  }
}

export async function saveToDevice(filename: string, data: Blob, host: HostWindow = window as unknown as HostWindow): Promise<SaveResult> {
  const dl = await getDownloads(host);
  if (dl) {
    if (!(PREVIEW_SAVE_TYPES as readonly string[]).includes(extOf(filename))) {
      return { ok: false, reason: "unsupported_type", message: "在这里存不了这种文件，请在装好的版本里下载" };
    }
    try {
      const r = await dl.save({ filename, data });
      if (isDeclined(r)) return { ok: false, reason: "declined", message: "没有保存（你选了不保存）" };
      return { ok: true, via: "downloads" };
    } catch (e) {
      if (isDeclined(e)) return { ok: false, reason: "declined", message: "没有保存（你选了不保存）" };
      return { ok: false, reason: "failed", message: "没能保存，换个地方再试" };
    }
  }
  return linkDownload(host, filename, data);
}
