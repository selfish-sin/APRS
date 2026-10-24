/**
 * Hash 路由（#/hall、#/project/<id> …）。单文件预览、直接打开文件、装到主屏幕都能用。
 * 自己写的小 hash 路由：页面里用 <Link to="/hall">、navigate("/hall")、useRoute()。
 */
import { useEffect, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";

export interface Route {
  /** 不带 # 的路径，总是以 / 开头，例如 "/project/prj_x"。 */
  path: string;
  /** 路径分段，例如 ["project", "prj_x"]。 */
  segments: string[];
  query: URLSearchParams;
}

/** "#/project/prj_x?tab=grid" → { path: "/project/prj_x", segments, query }。 */
export function parseHash(hash: string): Route {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const [pathPart, queryPart = ""] = raw.split("?");
  const path = "/" + pathPart.split("/").filter(Boolean).map(safeDecode).join("/");
  return { path, segments: path.split("/").filter(Boolean), query: new URLSearchParams(queryPart) };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** 拼一个路径：href("/project", id) → "/project/<id>"。 */
export function pathOf(...parts: (string | number)[]): string {
  return "/" + parts.map((p) => String(p).replace(/^\/+|\/+$/g, "")).filter(Boolean).map(encodeURIComponent).join("/").replace(/%2F/g, "/");
}

function subscribe(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

function snapshot() {
  return typeof window === "undefined" ? "" : window.location.hash;
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, snapshot, () => "");
  return parseHash(hash);
}

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  const target = to.startsWith("#") ? to : `#${to.startsWith("/") ? to : `/${to}`}`;
  if (opts.replace) {
    const url = `${window.location.pathname}${window.location.search}${target}`;
    window.history.replaceState(null, "", url);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else if (window.location.hash !== target) {
    window.location.hash = target;
  }
}

/** 换页时回到顶上。 */
export function useScrollTopOnRoute(path: string) {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);
}

export type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { to: string; children: ReactNode };

/** 页面里的链接。普通点击走 hash；新标签页打开照常。 */
export function Link({ to, children, onClick, ...props }: LinkProps) {
  const href = `#${to.startsWith("/") ? to : `/${to}`}`;
  return (
    <a
      href={href}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
      }}
      {...props}
    >
      {children}
    </a>
  );
}
