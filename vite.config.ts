/**
 * 构建：
 *   pnpm build         → dist/（静态站，Vercel 能直接托管；带 manifest + service worker，断网能打开）
 *   pnpm build:single  → dist-single/index.html（一个文件，JS / CSS 全部内联，用来发预览）
 *
 * 路由用 hash（#/hall），所以 base = "./"，放在任何路径下、甚至直接打开文件都能用。
 */
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

function buildId(): string {
  if (process.env.BUILD_SHA) return process.env.BUILD_SHA.slice(0, 12);
  try {
    return execSync("git rev-parse --short=12 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "local";
  }
}

/**
 * 生成 sw.js：把这次构建出来的每个文件列进预缓存清单（文件名带 hash，清单一变 = 新版本）。
 * 只在 dist 构建里用；单文件预览没有 service worker。
 */
function serviceWorker(build: string): Plugin {
  return {
    name: "arps-service-worker",
    apply: "build",
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith(".map"));
      const precache = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png", ...files.map((f) => `./${f}`)];
      const unique = Array.from(new Set(precache));
      const source = `/* ARPS制作工会 · 离线缓存（构建 ${build}，自动生成） */
const CACHE = "arps-static-${build}-${unique.length}";
const PRECACHE = ${JSON.stringify(unique)};
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => undefined)))).then(() => self.skipWaiting())
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("arps-static-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  // 只管自己的文件（字体断网时用系统字体）。
  if (!sameOrigin) return;
  if (req.mode === "navigate") {
    // 页面：先上网拿新的，断网用缓存里的那一份。
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("./index.html", copy)).catch(() => undefined);
          return res;
        })
        .catch(() => caches.match("./index.html").then((hit) => hit || caches.match("./")))
    );
    return;
  }
  // 静态文件：缓存里有就用，没有就上网拿一份存下。
  // ignoreVary：字体是 CORS 请求（带 Origin），服务器回 Vary: Origin 时也要认得预缓存的那一份（文件名带 hash，不会错）。
  event.respondWith(
    caches.match(req, { ignoreVary: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
          }
          return res;
        })
    )
  );
});
`;
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

/** 单文件预览：去掉 manifest，图标换成内联的 SVG。 */
function singleHtml(): Plugin {
  const icon =
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#0d0d0d"/><path d="M32 14 50 46H14Z" fill="none" stroke="#f4f0e8" stroke-width="5" stroke-linejoin="round"/><circle cx="32" cy="36" r="4" fill="#8fa38a"/></svg>'
    );
  return {
    name: "arps-single-html",
    transformIndexHtml(html) {
      return html
        .replace(/\s*<link rel="manifest"[^>]*>/, "")
        .replace(/\s*<link rel="apple-touch-icon"[^>]*>/, "")
        .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="${icon}" />`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const single = mode === "single";
  const build = buildId();
  return {
    base: "./",
    plugins: [
      react(),
      { name: "arps-build-meta", transformIndexHtml: (html: string) => html.replace("%ARPS_BUILD%", build) },
      ...(single ? [singleHtml(), viteSingleFile({ removeViteModuleLoader: true })] : [serviceWorker(build)]),
    ],
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    define: {
      __SINGLE__: JSON.stringify(single),
      __BUILD__: JSON.stringify(build),
    },
    build: {
      outDir: single ? "dist-single" : "dist",
      emptyOutDir: true,
      copyPublicDir: !single,
      sourcemap: false,
      chunkSizeWarningLimit: 1200,
    },
    preview: { port: 4173, strictPort: true },
  };
});
