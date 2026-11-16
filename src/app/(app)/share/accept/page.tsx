import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageContainer } from "@/components/layout/page-container";
import { AcceptInvitation } from "@/components/sharing/accept-invitation";
import { env } from "@/lib/env";
import type { SearchParams } from "@/lib/oauth-providers";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Invitation" };

// The link in the invitation email. Signing in is required (the (app) layout sends the person to sign in and back). The
// page says nothing about the item until the person answers; a wrong or old link looks like any other missing page.
export default async function AcceptPage({ searchParams }: { searchParams: SearchParams }) {
  await requireUser({ redirect: true });
  if (!env.sharingEnabled) notFound();
  const { token } = await searchParams;
  if (typeof token !== "string" || token.length < 20) notFound();
  return (
    <PageContainer>
      <AcceptInvitation token={token} />
    </PageContainer>
  );
}
