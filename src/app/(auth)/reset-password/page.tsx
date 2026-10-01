import type { Metadata } from "next";
import { ResetLinkExpired } from "@/components/auth/reset-link-expired";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { firstParam, type SearchParams } from "@/lib/oauth-providers";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const token = firstParam(params.token);

  // Better Auth sends people back here with ?error=INVALID_TOKEN when the link is used up or old.
  if (!token || firstParam(params.error)) return <ResetLinkExpired />;
  return <ResetPasswordForm token={token} />;
}
