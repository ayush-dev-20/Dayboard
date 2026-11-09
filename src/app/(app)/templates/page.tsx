import type { Metadata } from "next";
import { EmptyState } from "@/components/layout/empty-state";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { NewTemplateButton } from "@/components/templates/new-template-button";
import { StarterDialog } from "@/components/templates/starter-dialog";
import { TemplatesList } from "@/components/templates/templates-list";
import { listTemplates } from "@/db/queries/templates";
import { getDayPrefs } from "@/lib/preferences";
import { requireUser } from "@/lib/session";
import type { StarterKey } from "@/lib/templates/starters";

export const metadata: Metadata = { title: "Templates" };

// The Templates page (V3 feature 03 §6): a hairline list with a filter, the starters dialog, and New template.
export default async function TemplatesPage() {
  const user = await requireUser({ redirect: true });
  const [items, prefs] = await Promise.all([listTemplates(user.id), getDayPrefs(user.id)]);
  const now = new Date();
  const have = items.flatMap((t) => (t.starterKey ? [t.starterKey as StarterKey] : []));

  return (
    <PageContainer>
      <PageHeader title="Templates" description={items.length > 0 ? `${items.length}` : undefined}>
        <StarterDialog have={have} />
        <NewTemplateButton />
      </PageHeader>
      {items.length === 0 ? (
        <EmptyState
          title="Templates are starting points for your notes."
          description="Keep a layout you use again and again, and start a note or a journal entry from it."
        >
          <StarterDialog have={have} variant="primary" />
          <NewTemplateButton variant="secondary" />
        </EmptyState>
      ) : (
        <TemplatesList items={items} nowMs={now.getTime()} timeZone={prefs.timezone} />
      )}
    </PageContainer>
  );
}
