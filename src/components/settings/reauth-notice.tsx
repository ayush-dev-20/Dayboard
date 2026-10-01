"use client";

import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { authClient } from "@/lib/auth-client";

/**
 * Shown when an action needs a recent sign-in. Signing in again creates a fresh session, and the
 * person lands back where they were.
 */
export function ReauthNotice({
  message,
  returnTo = "/settings/account",
  className,
}: {
  message: string;
  returnTo?: string;
  className?: string;
}) {
  const router = useRouter();

  async function signInAgain() {
    await authClient.signOut();
    router.replace(`/sign-in?next=${encodeURIComponent(returnTo)}`);
    router.refresh();
  }

  return (
    <Alert className={className}>
      <span>{message} </span>
      <button
        type="button"
        onClick={signInAgain}
        className="underline underline-offset-2 hover:opacity-80"
      >
        Sign in again
      </button>
    </Alert>
  );
}
