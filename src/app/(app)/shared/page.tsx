import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/layout/empty-state";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { SharedByMeList } from "@/components/sharing/shared-by-me-list";
import { SharedWithMeList } from "@/components/sharing/shared-with-me-list";
import { Input } from "@/components/ui/input";
import { env } from "@/lib/env";
import type { SearchParams } from "@/lib/oauth-providers";
import { requireUser } from "@/lib/session";
import { listSharedByMe, listSharedWithMe, searchSharedWithMe } from "@/modules/sharing/service";

export const metadata: Metadata = { title: "Shared" };

// Shared with me (V3 feature 04 §7): invitations on top, then what other people have shared, grouped by owner. A title
// search covers everything under it (sub-notes and the tasks of shared projects), each hit labelled with its owner.
export default async function SharedPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser({ redirect: true });
  if (!env.sharingEnabled) notFound();
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.slice(0, 100) : "";
  const [data, mine, hits] = await Promise.all([
    listSharedWithMe(user.id),
    listSharedByMe(user.id),
    searchSharedWithMe(user.id, query),
  ]);
  const empty = data.items.length === 0 && data.invitations.length === 0 && mine.length === 0;

  return (
    <PageContainer>
      <PageHeader title="Shared" />
      {empty ? (
        <EmptyState
          title="Nothing is shared yet."
          description="When someone invites you to a project or a note it shows up here, and what you share with others is listed here too."
        />
      ) : (
        <>
          <form role="search" className="mb-6 max-w-md">
            <label className="sr-only" htmlFor="shared-search">
              Search what is shared with you
            </label>
            <Input
              id="shared-search"
              name="q"
              type="search"
              defaultValue={query}
              placeholder="Search what is shared with you"
              autoComplete="off"
            />
          </form>
          {query.trim().length >= 2 ? (
            <section aria-label="Search results">
              {hits.length === 0 ? (
                <p className="type-body-md text-muted-foreground">
                  Nothing shared with you matches.
                </p>
              ) : (
                <ul className="border-t border-border">
                  {hits.map((hit) => (
                    <li
                      key={`${hit.kind}:${hit.id}`}
                      className="flex items-center gap-3 border-b border-border py-3"
                    >
                      <Link
                        href={hit.href}
                        className="min-w-0 flex-1 truncate type-body-md hover:underline"
                      >
                        {hit.title}
                      </Link>
                      <span className="type-body-sm text-muted-foreground">
                        {hit.kind === "project" ? "Project" : hit.kind === "note" ? "Note" : "Task"}{" "}
                        · Shared by {hit.ownerName}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : (
            <div className="flex flex-col gap-10">
              <SharedWithMeList data={data} />
              {mine.length > 0 ? <SharedByMeList items={mine} /> : null}
            </div>
          )}
        </>
      )}
    </PageContainer>
  );
}
