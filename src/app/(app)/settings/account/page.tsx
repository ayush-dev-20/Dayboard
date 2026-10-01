import type { Metadata } from "next";
import { headers } from "next/headers";
import { listUserSessions } from "@/db/queries/sessions";
import { DeleteAccount } from "@/components/settings/delete-account";
import { ProfileSection } from "@/components/settings/profile-section";
import { SessionsSection, type SessionRow } from "@/components/settings/sessions-section";
import { SettingsSection } from "@/components/settings/settings-ui";
import { SignInMethods } from "@/components/settings/sign-in-methods";
import { auth } from "@/lib/auth";
import { describeActivity, formatShortDate } from "@/lib/dates/relative";
import { enabledOAuthProviders, firstParam, type SearchParams } from "@/lib/oauth-providers";
import { requireUser } from "@/lib/session";
import { describeUserAgent } from "@/lib/user-agent";

export const metadata: Metadata = { title: "Account" };

export default async function AccountSettingsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await requireUser({ redirect: true });
  const requestHeaders = await headers();
  const reopenDelete = firstParam((await searchParams).delete) === "1";

  const [accounts, rawSessions] = await Promise.all([
    auth.api.listUserAccounts({ headers: requestHeaders }),
    listUserSessions(user.id),
  ]);

  const now = new Date();
  const providerDate = (providerId: string) => {
    const account = accounts.find((a) => a.providerId === providerId);
    return account ? formatShortDate(new Date(account.createdAt), now) : null;
  };

  const linked = {
    ...(providerDate("google") && { google: providerDate("google")! }),
    ...(providerDate("github") && { github: providerDate("github")! }),
  };

  // Session tokens stay on the server: only id, device label and a preformatted time go out.
  const sessions: SessionRow[] = rawSessions
    .map((s) => {
      const { device, browser } = describeUserAgent(s.userAgent);
      return {
        id: s.id,
        device,
        detail: `${browser} · ${describeActivity(new Date(s.updatedAt), now)}`,
        current: s.id === user.sessionId,
        updatedAt: new Date(s.updatedAt).getTime(),
      };
    })
    .sort((a, b) => Number(b.current) - Number(a.current) || b.updatedAt - a.updatedAt)
    .map(({ id, device, detail, current }) => ({ id, device, detail, current }));

  const hasPassword = accounts.some((a) => a.providerId === "credential");
  const linkedProviders = (["google", "github"] as const).filter((p) => p in linked);

  return (
    <>
      <SettingsSection title="Profile">
        <ProfileSection name={user.name} email={user.email} emailVerified={user.emailVerified} />
      </SettingsSection>

      <SettingsSection title="Sign-in methods">
        <SignInMethods
          email={user.email}
          passwordSetOn={hasPassword ? providerDate("credential") : null}
          linked={linked}
          available={enabledOAuthProviders()}
        />
      </SettingsSection>

      <SettingsSection title="Sessions">
        <SessionsSection sessions={sessions} />
      </SettingsSection>

      <SettingsSection title="Danger zone">
        <DeleteAccount
          email={user.email}
          hasPassword={hasPassword}
          linkedProviders={[...linkedProviders]}
          defaultOpen={reopenDelete}
        />
      </SettingsSection>
    </>
  );
}
