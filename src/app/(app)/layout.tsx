import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { ThemeSync } from "@/components/layout/theme-sync";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { listProjectRefs } from "@/db/queries/projects";
import { getNavCounts } from "@/db/queries/nav-counts";
import { getNoteTree } from "@/db/queries/note-tree";
import { listTags } from "@/db/queries/tags";
import { env } from "@/lib/env";
import { getPreferences } from "@/lib/preferences";
import { safeNextPath } from "@/lib/redirects";
import { SIDEBAR_COOKIE } from "@/components/layout/sidebar-state";
import { requireUser } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser({ redirect: true });
  const preferences = await getPreferences(user.id);

  if (!preferences.onboardedAt) {
    const next = safeNextPath((await headers()).get("x-next-path"));
    redirect(next === "/today" ? "/onboarding" : `/onboarding?next=${encodeURIComponent(next)}`);
  }

  const sidebarCollapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "1";
  const [projects, tags, counts, noteTree] = await Promise.all([
    listProjectRefs(user.id),
    listTags(user.id),
    getNavCounts(user.id, {
      timezone: preferences.timezone,
      startOfDay: preferences.startOfDay.slice(0, 5),
    }),
    getNoteTree(user.id),
  ]);

  return (
    <WorkspaceProvider
      value={{
        projects,
        tags,
        counts,
        aiEnabled: env.aiAvailable && preferences.aiEnabled,
        filesEnabled: env.storageAvailable,
        noteTree,
      }}
    >
      <AppShell name={user.name} email={user.email} sidebarCollapsed={sidebarCollapsed}>
        <ThemeSync theme={preferences.theme} />
        {children}
      </AppShell>
    </WorkspaceProvider>
  );
}
