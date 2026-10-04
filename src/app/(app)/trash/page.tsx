import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/layout/empty-state";
import { TrashList } from "@/components/trash/trash-list";
import { listTrash, parseCursor, trashCounts } from "@/db/queries/trash";
import { formatDayWord } from "@/lib/dates/relative";
import type { SearchParams } from "@/lib/oauth-providers";
import { getPreferences } from "@/lib/preferences";
import { requireUser } from "@/lib/session";
import { TRASH_TYPES, type TrashType } from "@/lib/trash";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/page-header";
import { PageContainer } from "@/components/layout/page-container";

export const metadata: Metadata = { title: "Trash" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const PLURAL: Record<TrashType, string> = {
  task: "Tasks",
  todo: "Todos",
  note: "Notes",
  project: "Projects",
  inbox: "Inbox",
};

export default async function TrashPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser({ redirect: true });
  const raw = await searchParams;
  const typeParam = first(raw.type);
  const type = (TRASH_TYPES as readonly string[]).includes(typeParam ?? "")
    ? (typeParam as TrashType)
    : null;
  const cursor = parseCursor(first(raw.before));

  const [{ timezone }, { items, next }, counts] = await Promise.all([
    getPreferences(user.id),
    listTrash(user.id, { type, cursor }),
    trashCounts(user.id),
  ]);
  const now = new Date();
  const rows = items.map((item) => ({
    ...item,
    when: formatDayWord(new Date(item.deletedAt), now, timezone),
  }));
  const href = (t: TrashType | null) => (t ? `/trash?type=${t}` : "/trash");

  return (
    <PageContainer>
      <PageHeader
        title="Trash"
        description={`${counts.total} ${counts.total === 1 ? "item" : "items"}`}
      />

      {counts.total === 0 ? (
        <EmptyState
          illustration="trash-empty"
          title="Trash is empty."
          description="Things you delete wait here until you delete them for good."
        />
      ) : (
        <>
          <nav aria-label="Item type" className="mb-4 border-b border-border">
            <ul className="-mb-px flex gap-5 overflow-x-auto">
              {([null, ...TRASH_TYPES] as (TrashType | null)[]).map((t) => (
                <li key={t ?? "all"}>
                  <Link
                    href={href(t)}
                    aria-current={type === t ? "page" : undefined}
                    className={cn(
                      "flex h-11 items-center border-b-2 type-body-md whitespace-nowrap md:h-9",
                      type === t
                        ? "border-primary font-semibold text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t ? PLURAL[t] : "All"}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {rows.length === 0 ? (
            <p className="py-4 type-body-md text-muted-foreground">
              Nothing in Trash of this type.{" "}
              <Link href="/trash" className="text-primary underline underline-offset-2">
                Show all
              </Link>
            </p>
          ) : (
            <TrashList items={rows} counts={counts} type={type} />
          )}

          {next ? (
            <Link
              href={`${href(type)}${type ? "&" : "?"}before=${encodeURIComponent(`${next.at}_${next.id}`)}`}
              className={`${buttonVariants({ variant: "secondary" })} mt-4`}
            >
              Show older items
            </Link>
          ) : null}
          <p className="mt-6 type-body-md text-muted-foreground">
            Nothing is deleted automatically.
          </p>
        </>
      )}
    </PageContainer>
  );
}
