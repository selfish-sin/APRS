/** 外壳：桌面是左边一列导航，手机是顶上一条 + 抽屉。导航只放用得上的。 */
import { useEffect, useState, type ReactNode } from "react";
import { Toast } from "@/components/ui/Toast";
import { MenuIcon, XIcon } from "@/components/ui/icons";
import { WorldMenu } from "@/components/storage";
import { isAdmin, isReviewer } from "@/domain/commands/core";
import { ROLE_LABEL } from "@/domain/labels";
import { inboxOf, reviewQueue, theWorld } from "@/domain/queries";
import { Link, useRoute } from "@/lib/router";
import { useGuild, useStore } from "@/lib/store";
import { MemberAvatar } from "./bits";

interface NavItem {
  to: string;
  label: string;
  match: (path: string) => boolean;
  badge?: number;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { world, me, logout } = useGuild();
  const route = useRoute();
  const [navOpen, setNavOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const title = theWorld(world)?.title ?? "工会";
  useEffect(() => setNavOpen(false), [route.path]);
  const reviewer = isReviewer(me);
  const inbox = inboxOf(world, me.id).total;
  const items: NavItem[] = [
    { to: "/hall", label: "大厅", match: (p) => p === "/hall", badge: inbox || undefined },
    { to: "/enroll", label: "报到", match: (p) => p.startsWith("/enroll") },
    { to: "/projects", label: "项目", match: (p) => p.startsWith("/projects") || p.startsWith("/project/") || p.startsWith("/cut/") },
    ...(reviewer ? [{ to: "/review", label: "审核台", match: (p: string) => p.startsWith("/review"), badge: reviewQueue(world, me.id).length || undefined }] : []),
    ...(isAdmin(me) ? [{ to: "/admin", label: "管理", match: (p: string) => p.startsWith("/admin") }] : []),
    { to: "/members", label: "成员", match: (p) => p.startsWith("/members") || (p.startsWith("/member/") && !p.endsWith(me.id)) },
    { to: "/me", label: "我的成长", match: (p) => p === "/me" || p === `/member/${me.id}` },
    { to: "/backup", label: "备份", match: (p) => p.startsWith("/backup") },
  ];
  return (
    <div className="shell" data-nav={navOpen ? "open" : "closed"}>
      <header className="topbar">
        <button type="button" className="icon-button" aria-label={navOpen ? "收起导航" : "打开导航"} aria-expanded={navOpen} onClick={() => setNavOpen((v) => !v)}>
          {navOpen ? <XIcon /> : <MenuIcon />}
        </button>
        <span className="topbar-title">{title}</span>
        <Link to="/me" aria-label="我的成长">
          <MemberAvatar member={me} />
        </Link>
      </header>
      <div className="drawer-scrim" onClick={() => setNavOpen(false)} />
      <aside className="sidebar" aria-label="主导航">
        <div className="sidebar-guild">
          <button type="button" className="guild-capsule" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)} data-testid="guild-capsule">
            <span className="guild-mark" aria-hidden="true">
              {title.slice(0, 1)}
            </span>
            <span className="guild-capsule-text">
              <strong>{title}</strong>
              <span className="label">存在这台设备上</span>
            </span>
          </button>
          <WorldMenu open={menuOpen} onClose={() => setMenuOpen(false)} worldTitle={title} />
        </div>
        <nav className="nav" aria-label="去向">
          {items.map((item) => (
            <Link key={item.to} to={item.to} aria-current={item.match(route.path) ? "page" : undefined}>
              {item.label}
              {item.badge ? (
                <span className="nav-badge" aria-label={`${item.badge} 件`}>
                  {item.badge}
                </span>
              ) : null}
            </Link>
          ))}
        </nav>
        <div className="sidebar-me">
          <MemberAvatar member={me} size="40" />
          <div className="sidebar-me-text">
            <Link to="/me">{me.nickname}</Link>
            <span className="label">{ROLE_LABEL[me.role]}</span>
          </div>
          <button type="button" className="inline-link label" onClick={logout} data-testid="logout">
            换人
          </button>
        </div>
      </aside>
      <main className="main">
        <div className="main-inner">{children}</div>
      </main>
    </div>
  );
}

/** 报错和一次性的提示（底部）。 */
export function Toasts() {
  const { lastError, clearError, notice, clearNotice } = useStore();
  if (!lastError && !notice) return null;
  return (
    <div className="toast-stack" aria-live="polite">
      {notice ? <Toast key={notice.id} Message={notice.message} Tone={notice.tone} onClose={clearNotice} /> : null}
      {lastError ? <Toast Message={lastError.message} Tone="Error" onClose={clearError} /> : null}
    </div>
  );
}
