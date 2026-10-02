import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { ThemeSync } from "@/components/layout/theme-sync";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { listProjectRefs } from "@/db/queries/projects";
import { listTags } from "@/db/queries/tags";
import { getPreferences } from "@/lib/preferences";
import { safeNextPath } from "@/lib/redirects";
import { requireUser } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser({ redirect: true });
  const preferences = await getPreferences(user.id);

  if (!preferences.onboardedAt) {
    const next = safeNextPath((await headers()).get("x-next-path"));
    redirect(next === "/today" ? "/onboarding" : `/onboarding?next=${encodeURIComponent(next)}`);
  }

  const [projects, tags] = await Promise.all([listProjectRefs(user.id), listTags(user.id)]);

  return (
    <AppShell name={user.name} email={user.email}>
      <ThemeSync theme={preferences.theme} />
      <WorkspaceProvider value={{ projects, tags }}>{children}</WorkspaceProvider>
    </AppShell>
  );
}
