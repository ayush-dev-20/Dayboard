import type { Metadata } from "next";
import { VerifyEmailPanel } from "@/components/auth/verify-email-panel";
import { firstParam, type SearchParams } from "@/lib/oauth-providers";

export const metadata: Metadata = { title: "Check your inbox" };

export default async function VerifyEmailPage({ searchParams }: { searchParams: SearchParams }) {
  const email = firstParam((await searchParams).email);
  return <VerifyEmailPanel email={email} />;
}
