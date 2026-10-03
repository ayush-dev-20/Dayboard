import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/layout/empty-state";
import { InboxCapture } from "@/components/inbox/inbox-capture";
import { ConvertedLinks } from "@/components/inbox/convert-dialog";
import { InboxItem } from "@/components/inbox/inbox-item";
import { getInbox } from "@/db/queries/inbox";
import { formatAgo } from "@/lib/dates/relative";
import { describeConversion } from "@/lib/inbox/dto";
import { getPreferences } from "@/lib/preferences";
import { requireUser } from "@/lib/session";
import { PageHeader } from "@/components/layout/page-header";
import { PageContainer } from "@/components/layout/page-container";

export const metadata: Metadata = { title: "Inbox" };

function Disclosure({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <details className="group mt-8">
      <summary className="flex cursor-pointer list-none items-center gap-2 pb-2 type-label-caps text-muted-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-4 transition-transform duration-[120ms] group-open:rotate-90"
          strokeWidth={1.5}
          aria-hidden
        />
        {label}
        <span className="type-data-sm">{count}</span>
      </summary>
      {children}
    </details>
  );
}

export default async function InboxPage() {
  const user = await requireUser({ redirect: true });
  const [{ timezone }, inbox] = await Promise.all([getPreferences(user.id), getInbox(user.id)]);
  const now = new Date();
  const ago = (iso: string) => formatAgo(new Date(iso), now, timezone);

  return (
    <PageContainer>
      <PageHeader title="Inbox" description={`${inbox.open.length} open`} />

      <InboxCapture />

      <div className="mt-6">
        {inbox.open.length === 0 ? (
          <EmptyState
            illustration="inbox-zero"
            title="Your inbox is empty."
            description="Capture a thought here, or press C from anywhere. Convert it into a task, todo, note or project when you're ready."
          />
        ) : (
          <ul className="border-t border-border" aria-label="Open inbox items">
            {inbox.open.map((item) => (
              <InboxItem key={item.id} item={item} ago={ago(item.createdAt)} />
            ))}
          </ul>
        )}
      </div>

      {inbox.converted.length > 0 ? (
        <Disclosure label="Recently converted" count={inbox.converted.length}>
          <ul className="border-t border-border">
            {inbox.converted.map((item) => (
              <li key={item.id} className="border-b border-border py-3">
                <p className="break-words whitespace-pre-wrap text-muted-foreground line-through">
                  {item.text}
                </p>
                <p className="mt-1 type-body-sm text-foreground">
                  Converted to {describeConversion(item.converted)}
                  {item.converted.length > 0 ? ": " : ""}
                  <span className="inline-flex flex-wrap gap-x-3">
                    <ConvertedLinks links={item.converted} />
                  </span>
                </p>
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}

      {inbox.archived.length > 0 ? (
        <Disclosure label="Archived" count={inbox.archived.length}>
          <ul className="border-t border-border">
            {inbox.archived.map((item) => (
              <InboxItem key={item.id} item={item} ago={ago(item.createdAt)} archived />
            ))}
          </ul>
        </Disclosure>
      ) : null}
    </PageContainer>
  );
}
