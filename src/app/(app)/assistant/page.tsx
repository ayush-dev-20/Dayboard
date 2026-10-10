import type { Metadata } from "next";
import Link from "next/link";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { AssistantPage } from "@/components/assistant/assistant-page";
import { env } from "@/lib/env";
import { getPreferences } from "@/lib/preferences";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Assistant" };

// The workspace assistant (V2 feature 11 §6). With AI off, or no key on the server, there is nothing
// to show here: the page says so and points at Settings instead of a dead chat box.
export default async function Page() {
  const user = await requireUser({ redirect: true });
  const prefs = await getPreferences(user.id);
  const available = env.aiAvailable && prefs.aiEnabled;

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Assistant"
        description="Ask about your notes, tasks and projects. Stored on this device only."
        sticky={false}
      />
      {available ? (
        <AssistantPage />
      ) : (
        <p role="status" className="mt-6 type-body-md text-muted-foreground">
          The assistant is turned off. You can turn AI on in{" "}
          <Link href="/settings/ai" className="text-primary underline">
            Settings
          </Link>
          .
        </p>
      )}
    </PageContainer>
  );
}
