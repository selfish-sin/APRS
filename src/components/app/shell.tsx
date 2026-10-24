/**
 * 外壳：桌面是左边一列导航（项目下面列出每个项目，资料库带件数）；
 * 手机是顶上一条 + 底部标签栏（大厅 · 项目 · 资料库 · 审核台 / 我的 · 更多），「更多」打开侧栏抽屉放其余页面。
 */
import { useEffect, useState, type ReactNode } from "react";
import { Toast } from "@/components/ui/Toast";
import { ArtworkIcon, EyeIcon, HomeIcon, MoreIcon, PeopleIcon, WorkflowIcon } from "@/components/ui/icons";
import { WorldMenu } from "@/components/storage";
import { isAdmin, isReviewer } from "@/domain/commands/core";
import { LangSwitch, U, useI18n } from "@/i18n/I18n";
import { cutsOf, inboxOf, projects as projectsOf, reviewQueue, theWorld } from "@/domain/queries";
import type { Id } from "@/domain/model";
import { Link, navigate, useRoute } from "@/lib/router";
import { useGuild, useStore } from "@/lib/store";
import { DEMO_TITLE } from "@/lib/worlds";
import { MemberAvatar } from "./bits";

interface NavItem {
  to: string;
  label: string;
  match: (path: string) => boolean;
  badge?: number;
  count?: string;
  testId?: string;
}

const isHall = (p: string) => p === "/hall";
const isProjects = (p: string) => p.startsWith("/projects") || p.startsWith("/project/") || p.startsWith("/cut/");
const isLibrary = (p: string) => p.startsWith("/library") || p.startsWith("/page/");
const isReview = (p: string) => p.startsWith("/review");

export function AppShell({ children }: { children: ReactNode }) {
  const { world, me, logout, base } = useGuild();
  const { L, f } = useI18n();
  const route = useRoute();
  const [navOpen, setNavOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const rawTitle = theWorld(world)?.title;
  // 示范工会的名字跟着界面语言（自己起的名字照原样）。
  const title = base === "demo" && rawTitle === DEMO_TITLE ? L.entry.kindDemo : rawTitle ?? L.nav.guild;
  useEffect(() => setNavOpen(false), [route.path, route.query.toString()]);
  const reviewer = isReviewer(me);
  const inbox = inboxOf(world, me.id).total;
  const queue = reviewer ? reviewQueue(world, me.id).length : 0;
  const isMine = (p: string) => p === "/me" || p === `/member/${me.id}`;
  const fileCount = Object.values(world.files).filter((x) => !x.archivedAt).length;
  // 现在在哪个项目里（项目总览 · 改项目 · 卡详情）。
  const seg = route.path.split("/");
  const currentProject: Id | null = seg[1] === "project" ? seg[2] ?? null : seg[1] === "cut" ? world.cuts[seg[2]]?.projectId ?? null : null;
  const list = projectsOf(world);
  const items: NavItem[] = [
    { to: "/hall", label: L.nav.hall, match: isHall, badge: inbox || undefined },
    { to: "/enroll", label: L.nav.enroll, match: (p) => p.startsWith("/enroll") },
    { to: "/projects", label: L.nav.projects, match: (p) => p.startsWith("/projects") || (isProjects(p) && !currentProject) },
    { to: "/library", label: L.nav.library, match: isLibrary, count: fileCount ? String(fileCount) : undefined, testId: "nav-library" },
    ...(reviewer ? [{ to: "/review", label: L.nav.review, match: isReview, badge: queue || undefined }] : []),
    ...(isAdmin(me) ? [{ to: "/admin", label: L.nav.admin, match: (p: string) => p.startsWith("/admin") }] : []),
    { to: "/members", label: L.nav.members, match: (p) => p.startsWith("/members") || (p.startsWith("/member/") && !p.endsWith(me.id)) },
    { to: "/me", label: L.nav.me, match: isMine },
    { to: "/backup", label: L.nav.backup, match: (p) => p.startsWith("/backup") },
  ];
  const onTabPage = isHall(route.path) || isProjects(route.path) || isLibrary(route.path) || (reviewer ? isReview(route.path) : isMine(route.path));
  return (
    <div className="shell" data-nav={navOpen ? "open" : "closed"}>
      <header className="topbar">
        <span className="guild-mark topbar-mark" aria-hidden="true" data-uc="">
          {title.slice(0, 1)}
        </span>
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
            <div key={item.to} className="nav-group">
              <Link to={item.to} aria-current={item.match(route.path) ? "page" : undefined} data-testid={item.testId}>
                {item.label}
                {item.badge ? (
                  <span className="nav-badge" aria-label={f(L.nav.badge, { n: item.badge })}>
                    {item.badge}
                  </span>
                ) : item.count ? (
                  <span className="nav-count" aria-label={f(L.nav.libraryCount, { n: fileCount })}>
                    {item.count}
                  </span>
                ) : null}
              </Link>
              {item.to === "/projects" && list.length ? (
                <div className="nav-sub" role="group" aria-label={L.nav.projectList} data-testid="nav-projects">
                  {list.map((p) => (
                    <Link key={p.id} to={`/project/${p.id}`} aria-current={currentProject === p.id ? "page" : undefined} data-testid="nav-project">
                      <span className="nav-sub-name">
                        <U>{p.name}</U>
                      </span>
                      <span className="nav-count">{p.status === "zero" ? L.nav.zero : f(L.nav.cuts[p.group], { n: cutsOf(world, p.id).filter((c) => !c.disabled).length })}</span>
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
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
      <nav className="tabbar" aria-label={L.nav.tabs}>
        <Tab to="/hall" label={L.nav.hall} icon={<HomeIcon />} current={!navOpen && isHall(route.path)} badge={inbox} testId="tab-hall" />
        <Tab to="/projects" label={L.nav.projects} icon={<WorkflowIcon />} current={!navOpen && isProjects(route.path)} testId="tab-projects" />
        <Tab to="/library" label={L.nav.library} icon={<ArtworkIcon />} current={!navOpen && isLibrary(route.path)} testId="tab-library" />
        {reviewer ? (
          <Tab to="/review" label={L.nav.review} icon={<EyeIcon />} current={!navOpen && isReview(route.path)} badge={queue} testId="tab-review" />
        ) : (
          <Tab to="/me" label={L.nav.tabMine} icon={<PeopleIcon />} current={!navOpen && isMine(route.path)} testId="tab-me" />
        )}
        <button type="button" className="tab" aria-expanded={navOpen} aria-current={navOpen || !onTabPage ? "page" : undefined} onClick={() => setNavOpen((v) => !v)} data-testid="tab-more">
          <MoreIcon />
          <span>{L.nav.tabMore}</span>
        </button>
      </nav>
    </div>
  );
}

function Tab({ to, label, icon, current, badge, testId }: { to: string; label: string; icon: ReactNode; current: boolean; badge?: number; testId: string }) {
  const { L, f } = useI18n();
  return (
    <Link to={to} className="tab" aria-current={current ? "page" : undefined} data-testid={testId}>
      {icon}
      <span>{label}</span>
      {badge ? (
        <span className="tab-badge" aria-label={f(L.nav.badge, { n: badge })}>
          {badge}
        </span>
      ) : null}
    </Link>
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
