/** 外壳：桌面是左边一列导航，手机是顶上一条 + 抽屉。导航只放用得上的。 */
import { useEffect, useState, type ReactNode } from "react";
import { Toast } from "@/components/ui/Toast";
import { MenuIcon, XIcon } from "@/components/ui/icons";
import { WorldMenu } from "@/components/storage";
import { isAdmin, isReviewer } from "@/domain/commands/core";
import { LangSwitch, U, useI18n } from "@/i18n/I18n";
import { inboxOf, reviewQueue, theWorld } from "@/domain/queries";
import { Link, navigate, useRoute } from "@/lib/router";
import { useGuild, useStore } from "@/lib/store";
import { DEMO_TITLE } from "@/lib/worlds";
import { MemberAvatar } from "./bits";

interface NavItem {
  to: string;
  label: string;
  match: (path: string) => boolean;
  badge?: number;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { world, me, logout, base } = useGuild();
  const { L, f } = useI18n();
  const route = useRoute();
  const [navOpen, setNavOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const rawTitle = theWorld(world)?.title;
  // 示范工会的名字跟着界面语言（自己起的名字照原样）。
  const title = base === "demo" && rawTitle === DEMO_TITLE ? L.entry.kindDemo : rawTitle ?? L.nav.guild;
  useEffect(() => setNavOpen(false), [route.path]);
  const reviewer = isReviewer(me);
  const inbox = inboxOf(world, me.id).total;
  const items: NavItem[] = [
    { to: "/hall", label: L.nav.hall, match: (p) => p === "/hall", badge: inbox || undefined },
    { to: "/enroll", label: L.nav.enroll, match: (p) => p.startsWith("/enroll") },
    { to: "/projects", label: L.nav.projects, match: (p) => p.startsWith("/projects") || p.startsWith("/project/") || p.startsWith("/cut/") },
    { to: "/library", label: L.nav.library, match: (p) => p.startsWith("/library") || p.startsWith("/page/") },
    ...(reviewer ? [{ to: "/review", label: L.nav.review, match: (p: string) => p.startsWith("/review"), badge: reviewQueue(world, me.id).length || undefined }] : []),
    ...(isAdmin(me) ? [{ to: "/admin", label: L.nav.admin, match: (p: string) => p.startsWith("/admin") }] : []),
    { to: "/members", label: L.nav.members, match: (p) => p.startsWith("/members") || (p.startsWith("/member/") && !p.endsWith(me.id)) },
    { to: "/me", label: L.nav.me, match: (p) => p === "/me" || p === `/member/${me.id}` },
    { to: "/backup", label: L.nav.backup, match: (p) => p.startsWith("/backup") },
  ];
  return (
    <div className="shell" data-nav={navOpen ? "open" : "closed"}>
      <header className="topbar">
        <button type="button" className="icon-button" aria-label={navOpen ? L.nav.closeNav : L.nav.openNav} aria-expanded={navOpen} onClick={() => setNavOpen((v) => !v)}>
          {navOpen ? <XIcon /> : <MenuIcon />}
        </button>
        <span className="topbar-title">
          <U>{title}</U>
        </span>
        <LangSwitch className="topbar-lang" />
        <Link to="/me" aria-label={L.nav.me}>
          <MemberAvatar member={me} />
        </Link>
      </header>
      <div className="drawer-scrim" onClick={() => setNavOpen(false)} />
      <aside className="sidebar" aria-label={L.nav.mainNav}>
        <div className="sidebar-guild">
          <button type="button" className="guild-capsule" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)} data-testid="guild-capsule">
            <span className="guild-mark" aria-hidden="true" data-uc="">
              {title.slice(0, 1)}
            </span>
            <span className="guild-capsule-text">
              <strong>
                <U>{title}</U>
              </strong>
              <span className="label">{L.nav.onThisDevice}</span>
            </span>
          </button>
          <WorldMenu open={menuOpen} onClose={() => setMenuOpen(false)} worldTitle={title} />
        </div>
        <nav className="nav" aria-label={L.nav.where}>
          {items.map((item) => (
            <Link key={item.to} to={item.to} aria-current={item.match(route.path) ? "page" : undefined}>
              {item.label}
              {item.badge ? (
                <span className="nav-badge" aria-label={f(L.nav.badge, { n: item.badge })}>
                  {item.badge}
                </span>
              ) : null}
            </Link>
          ))}
        </nav>
        <div className="sidebar-me">
          <MemberAvatar member={me} size="40" />
          <div className="sidebar-me-text">
            <Link to="/me">
              <U>{me.nickname}</U>
            </Link>
            <span className="label">{L.labels.role[me.role]}</span>
          </div>
          <button
            type="button"
            className="inline-link label"
            onClick={() => {
              logout();
              navigate("/login", { replace: true });
            }}
            data-testid="logout"
          >
            {L.nav.switchUser}
          </button>
        </div>
        <LangSwitch className="sidebar-lang" />
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
  const { ph, err } = useI18n();
  if (!lastError && !notice) return null;
  return (
    <div className="toast-stack" aria-live="polite">
      {notice ? <Toast key={notice.id} Message={ph(notice.message)} Tone={notice.tone} onClose={clearNotice} /> : null}
      {lastError ? <Toast Message={err(lastError)} Tone="Error" onClose={clearError} /> : null}
    </div>
  );
}
