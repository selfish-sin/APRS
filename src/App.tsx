/** 页面路由（hash）：没打开工会 → 进门；没登录 → 登录；登录了 → 外壳 + 各页。 */
import { useEffect } from "react";
import { FilesNotice, StorageNotices, StorageUiProvider } from "@/components/storage";
import { AppShell, Toasts } from "@/components/app/shell";
import { navigate, useRoute, useScrollTopOnRoute } from "@/lib/router";
import { FilesProvider } from "@/lib/files/FilesProvider";
import { I18nProvider, useI18n } from "@/i18n/I18n";
import { StoreProvider, useStore } from "@/lib/store";
import { AdminPage } from "@/pages/Admin";
import { BackupPage } from "@/pages/Backup";
import { CutPage } from "@/pages/Cut";
import { EnrollPage } from "@/pages/Enroll";
import { EntryPage } from "@/pages/Entry";
import { HallPage } from "@/pages/Hall";
import { LoginPage } from "@/pages/Login";
import { DocPage } from "@/pages/DocPage";
import { LibraryIndexPage, LibraryPage } from "@/pages/Library";
import { MemberPage, MembersPage } from "@/pages/Member";
import { NotFound } from "@/pages/NotFound";
import { ProjectPage } from "@/pages/Project";
import { ProjectsPage } from "@/pages/Projects";
import { StagePage } from "@/pages/StagePage";
import { ReviewPage } from "@/pages/Review";

const TITLE_KEYS = ["hall", "enroll", "projects", "project", "cut", "review", "admin", "members", "member", "me", "backup", "library", "page", "login"] as const;
type TitleKey = (typeof TITLE_KEYS)[number];

function Page() {
  const route = useRoute();
  switch (route.segments[0]) {
    case "hall":
      return <HallPage />;
    case "enroll":
      return <EnrollPage />;
    case "projects":
      return <ProjectsPage />;
    case "project":
      if (route.segments[2] === "stage" && route.segments[3]) return <StagePage />;
      if (route.segments[2] === "settings") return <SettingsRedirect id={route.segments[1]} />;
      return <ProjectPage />;
    case "cut":
      return <CutPage />;
    case "review":
      return <ReviewPage />;
    case "admin":
      return <AdminPage />;
    case "members":
      return <MembersPage />;
    case "member":
    case "me":
      return <MemberPage />;
    case "backup":
      return <BackupPage />;
    case "library":
      return route.segments[1] ? <LibraryPage /> : <LibraryIndexPage />;
    case "page":
      return <DocPage />;
    default:
      return <NotFound />;
  }
}

/** 原来的「改项目」页（§17 去掉了）：旧链接转到项目档案。 */
function SettingsRedirect({ id }: { id: string }) {
  useEffect(() => {
    navigate(`/project/${id}?tab=profile`, { replace: true });
  }, [id]);
  return null;
}

function Routes() {
  const { ready, world, session } = useStore();
  const { L } = useI18n();
  const route = useRoute();
  useScrollTopOnRoute(route.path);
  const loggedIn = !!world && !!session?.memberId;
  const first = route.segments[0] ?? "";

  const key = (route.segments[0] === "project" && route.segments[2] === "stage" ? "stage" : TITLE_KEYS.find((k) => k === first)) as TitleKey | "stage" | undefined;
  const pageTitle = key ? L.nav[key] : null;
  useEffect(() => {
    document.title = `${pageTitle ? `${pageTitle} · ` : ""}${L.nav.appName}`;
  }, [pageTitle, L]);

  useEffect(() => {
    if (!ready) return;
    if (loggedIn && (first === "" || first === "login")) navigate("/hall", { replace: true });
    if (world && !loggedIn && first !== "login") navigate(first ? `/login?back=${encodeURIComponent(route.path)}` : "/login", { replace: true });
  }, [ready, loggedIn, world, first, route.path]);

  if (!ready) return null;
  if (!world) return <EntryPage />;
  if (!loggedIn) return <LoginPage />;
  return (
    <AppShell>
      <Page />
    </AppShell>
  );
}

export function App() {
  return (
    <StoreProvider>
      <I18nProvider>
      <FilesProvider>
        <StorageUiProvider>
          <Routes />
          <StorageNotices />
          <FilesNotice />
          <Toasts />
        </StorageUiProvider>
      </FilesProvider>
      </I18nProvider>
    </StoreProvider>
  );
}
