import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/layout/empty-state";
import { SearchResult } from "@/components/search/search-result";
import { SearchBox, SearchFilters } from "@/components/search/search-controls";
import { searchHybrid } from "@/lib/search/semantic/hybrid";
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
  const hybrid = parsed.ok ? await searchHybrid(user.id, params, prefs, dayPrefs, PER_TYPE) : null;
  const results = hybrid?.results ?? null;
  const semantic = hybrid?.semantic ?? "off";
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
      <p className="mt-2 type-body-sm text-muted-foreground">
        Use “quotes” to match an exact phrase.
      </p>
      <SearchFilters params={params} today={today} />
      {semantic === "unavailable" ? (
        <p role="status" className="mt-3 type-body-sm text-muted-foreground">
          Showing keyword results only.
        </p>
      ) : null}
      {semantic === "off" && results && !prefs.semanticSearchEnabled && prefs.aiEnabled ? (
        <p className="mt-3 type-body-sm text-muted-foreground">
          Want to find things by meaning too?{" "}
          <Link href="/settings/ai" className="text-primary underline">
            Turn on search by meaning
          </Link>
          .
        </p>
      ) : null}

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
                className={buttonVariants({ variant: "secondary" })}
              >
                Clear filters
              </Link>
            ) : null}
          </EmptyState>
        ) : (
          <ul className="border-t border-border" aria-label="Search results">
            {hits.map((hit) => (
              <SearchResult
                key={`${hit.type}:${hit.id}`}
                hit={hit}
                q={params.q}
                today={today}
                showWhy={semantic === "used"}
              />
            ))}
          </ul>
        )}
      </div>
    </PageContainer>
  );
}
