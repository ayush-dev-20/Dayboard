import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthHeading } from "@/components/auth/auth-shell";
import { SignInForm } from "@/components/auth/sign-in-form";
import { enabledOAuthProviders, firstParam, type SearchParams } from "@/lib/oauth-providers";
import { safeNextPath } from "@/lib/redirects";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Sign in" };

// Better Auth redirects here with `?error=<CODE>`. These codes mean a one-time link was bad.
const LINK_ERROR_CODES = new Set(["link", "INVALID_TOKEN", "EXPIRED_TOKEN", "ATTEMPTS_EXCEEDED"]);

function noticeFor(params: Record<string, string | string[] | undefined>) {
  if (firstParam(params.reset) === "1") {
    return { tone: "info" as const, message: "Password updated. Sign in with your new password." };
  }
  if (firstParam(params.deleted) === "1") {
    return { tone: "info" as const, message: "Your account has been deleted." };
  }
  const error = firstParam(params.error);
  if (error && LINK_ERROR_CODES.has(error)) {
    return {
      tone: "error" as const,
      message: "That sign-in link has expired or was already used. Request a new one.",
    };
  }
  if (error === "account_not_linked") {
    // Better Auth refuses to link a provider to an account whose email was never confirmed.
    return {
      tone: "error" as const,
      message:
        "That email has an account that isn't confirmed yet. Confirm it from the email we sent, or use “Email me a sign-in link”.",
    };
  }
  if (error) {
    return {
      tone: "error" as const,
      message: "We couldn't sign you in with that provider. Try again or use another method.",
    };
  }
  return null;
}

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = safeNextPath(firstParam(params.next));

  if (await getSession()) redirect(next);

  return (
    <>
      <AuthHeading title="Sign in" description="Welcome back." />
      <SignInForm next={next} providers={enabledOAuthProviders()} notice={noticeFor(params)} />
    </>
  );
}
