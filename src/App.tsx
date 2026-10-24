/** 页面路由（hash）：没打开工会 → 进门；没登录 → 登录；登录了 → 外壳 + 各页。 */
import { useEffect } from "react";
import { FilesNotice, StorageNotices, StorageUiProvider } from "@/components/storage";
import { AppShell, Toasts } from "@/components/app/shell";
import { navigate, useRoute, useScrollTopOnRoute } from "@/lib/router";
import { FilesProvider } from "@/lib/files/FilesProvider";
import { I18nProvider } from "@/i18n/I18n";
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
import { ProjectSettingsPage } from "@/pages/ProjectSetup";
import { ProjectsPage } from "@/pages/Projects";
import { ReviewPage } from "@/pages/Review";

const TITLES: Record<string, string> = {
  hall: "大厅",
  enroll: "报到",
  projects: "项目",
  project: "项目总览",
  cut: "卡详情",
  review: "审核台",
  admin: "管理",
  members: "成员",
  member: "成员",
  me: "我的成长",
  backup: "备份",
  library: "资料库",
  page: "资料页",
  login: "登录",
};

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
      return route.segments[2] === "settings" ? <ProjectSettingsPage /> : <ProjectPage />;
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

function Routes() {
  const { ready, world, session } = useStore();
  const route = useRoute();
  useScrollTopOnRoute(route.path);
  const loggedIn = !!world && !!session?.memberId;
  const first = route.segments[0] ?? "";

  useEffect(() => {
    document.title = `${TITLES[first] ? `${TITLES[first]} · ` : ""}ARPS制作工会`;
  }, [first]);

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
