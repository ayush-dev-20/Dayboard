import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/layout/empty-state";
import { SearchResult } from "@/components/search/search-result";
import { SearchBox, SearchFilters } from "@/components/search/search-controls";
import { searchWorkspace } from "@/db/queries/search";
import { getUserToday } from "@/lib/dates/today";
import type { SearchParams as NextSearchParams } from "@/lib/oauth-providers";
import { getPreferences } from "@/lib/preferences";
import { parseSearchUrl, buildSearchUrl } from "@/lib/search/params";
import { parseQuery } from "@/lib/search/query";
import { SEARCH_TYPES, type SearchParams } from "@/lib/search/types";
import { requireUser } from "@/lib/session";
import { PageHeader } from "@/components/layout/page-header";
import { PageContainer } from "@/components/layout/page-container";

export const metadata: Metadata = { title: "Search" };

const PER_TYPE = 25;

export default async function SearchPage({ searchParams }: { searchParams: NextSearchParams }) {
  const user = await requireUser({ redirect: true });
  const url = parseSearchUrl(await searchParams);
  const prefs = await getPreferences(user.id);
  const dayPrefs = { timezone: prefs.timezone, startOfDay: prefs.startOfDay.slice(0, 5) };
  const today = getUserToday(dayPrefs);

  const parsed = parseQuery(url.q);
  const params: SearchParams = { ...url, q: parsed.ok ? parsed.q : url.q.trim() };
  const results = parsed.ok ? await searchWorkspace(user.id, params, dayPrefs, PER_TYPE) : null;
  const hits = results ? SEARCH_TYPES.flatMap((t) => results[t]) : [];
  const filtered = Boolean(
    params.status || params.projectId || params.tagId || params.from || params.to,
  );

  return (
    <PageContainer>
      <PageHeader
        title="Search"
        description={
          <span role="status">
            {results
              ? `${results.total} ${results.total === 1 ? "result" : "results"}`
              : "Search everything you've written"}
          </span>
        }
      />

      <SearchBox params={params} />
      <SearchFilters params={params} today={today} />

      <div className="mt-4">
        {!results ? (
          <EmptyState
            title={url.q.trim() ? "Keep typing to search." : "Find anything."}
            description={
              url.q.trim()
                ? "Use at least 2 characters."
                : "Type a word to search tasks, todos, notes, projects and tags. Press ⌘K for the quick version."
            }
          />
        ) : hits.length === 0 ? (
          <EmptyState
            illustration="search-empty"
            title={`Nothing matches “${params.q}”.`}
            description={
              filtered ? "Try fewer words, or clear the filters." : "Try fewer or different words."
            }
          >
            {filtered ? (
              <Link
                href={buildSearchUrl({ q: params.q, tab: params.tab })}
                className="type-body-md text-primary underline underline-offset-2"
              >
                Clear filters
              </Link>
            ) : null}
          </EmptyState>
        ) : (
          <ul className="border-t border-border" aria-label="Search results">
            {hits.map((hit) => (
              <SearchResult key={`${hit.type}:${hit.id}`} hit={hit} q={params.q} today={today} />
            ))}
          </ul>
        )}
      </div>
    </PageContainer>
  );
}
