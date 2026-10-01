import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { ThemeSync } from "@/components/layout/theme-sync";
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

  return (
    <AppShell name={user.name} email={user.email}>
      <ThemeSync theme={preferences.theme} />
      {children}
    </AppShell>
  );
}
