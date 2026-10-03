import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthHeading } from "@/components/auth/auth-shell";
import { OnboardingForm } from "@/components/auth/onboarding-form";
import { firstParam, type SearchParams } from "@/lib/oauth-providers";
import { getPreferences } from "@/lib/preferences";
import { safeNextPath } from "@/lib/redirects";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Welcome" };

export default async function OnboardingPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser({ redirect: true });
  const next = safeNextPath(firstParam((await searchParams).next));
  const preferences = await getPreferences(user.id);

  if (preferences.onboardedAt) redirect(next);

  return (
    <>
      <AuthHeading
        title="Welcome to Dayboard"
        description="Confirm a few things. You can change them later in Settings."
      />
      <OnboardingForm
        initialName={user.name}
        initialTheme={preferences.theme}
        initialStartOfDay={preferences.startOfDay.slice(0, 5)}
        next={next}
      />
    </>
  );
}
