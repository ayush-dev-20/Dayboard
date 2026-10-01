import type { Metadata } from "next";
import { MagicLinkSentPanel } from "@/components/auth/magic-link-sent-panel";
import { firstParam, type SearchParams } from "@/lib/oauth-providers";
import { safeNextPath } from "@/lib/redirects";

export const metadata: Metadata = { title: "Check your inbox" };

export default async function MagicLinkSentPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  return (
    <MagicLinkSentPanel
      email={firstParam(params.email)}
      next={safeNextPath(firstParam(params.next))}
    />
  );
}
