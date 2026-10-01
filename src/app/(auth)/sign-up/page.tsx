import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthHeading } from "@/components/auth/auth-shell";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { enabledOAuthProviders, firstParam, type SearchParams } from "@/lib/oauth-providers";
import { safeNextPath } from "@/lib/redirects";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Create your account" };

export default async function SignUpPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = safeNextPath(firstParam(params.next));

  if (await getSession()) redirect(next);

  return (
    <>
      <AuthHeading
        title="Create your account"
        description="A calm place for tasks, notes and projects."
      />
      <SignUpForm next={next} providers={enabledOAuthProviders()} />
    </>
  );
}
