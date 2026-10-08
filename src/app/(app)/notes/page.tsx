import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { Plus, Sparkles } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { NotesTreeSheet } from "@/components/notes/tree/notes-tree-sheet";
import { TaskContextProvider } from "@/components/tasks/task-context";
import { buttonVariants } from "@/components/ui/button";
import { NotesCollection } from "@/components/views/collections";
import { ensureGalleryView } from "@/db/mutations/views";
import { getOutline } from "@/db/queries/note-tree";
import { countNotes, listNotes } from "@/db/queries/notes";
import { getViews, loadViewItems } from "@/db/queries/views";
import { env } from "@/lib/env";
import { hasNoteFilters, parseNotesParams } from "@/lib/notes/params";
import type { SearchParams } from "@/lib/oauth-providers";
import { requireUser } from "@/lib/session";
import { loadTaskContext } from "@/lib/tasks/context";
import type { ViewNote } from "@/lib/views/items";
import { lastViewCookie, parseViewParam, pickView } from "@/lib/views/legacy";
import { quickFilters } from "@/lib/views/quick";

export const metadata: Metadata = { title: "Notes" };

export default async function NotesPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser({ redirect: true });
  const raw = await searchParams;
  const params = parseNotesParams(raw);
  const { dayPrefs, now, weekStart, aiEnabled, context } = await loadTaskContext(user.id);

  let views = await getViews(user.id, "NOTES");
  const jar = await cookies();
  const param = parseViewParam(raw.view);
  let picked = pickView(views, param, jar.get(lastViewCookie("NOTES"))?.value ?? null);
  if (picked.needs === "gallery") {
    // The old `?view=grid`: there is no Gallery view yet, so make one (feature doc §5).
    const gallery = await ensureGalleryView(user.id);
    views = await getViews(user.id, "NOTES");
    picked = { view: views.find((v) => v.id === gallery.id) ?? gallery, needs: null };
  }
  const view = picked.view;

  const quick = quickFilters({ projectId: params.projectId, tagId: params.tagId });
  const scope = { projectId: params.projectId ?? undefined, tagId: params.tagId ?? undefined };
  const showsArchivedSection = view.type === "LIST" || view.type === "GALLERY";
  const isTree = view.type === "TREE";
  const [items, archived, counts, tree] = await Promise.all([
    isTree ? Promise.resolve([]) : loadViewItems(user.id, "NOTES", view, quick, null),
    showsArchivedSection
      ? listNotes(user.id, { ...scope, archived: true, limit: 200, topLevelOnly: true })
      : Promise.resolve([]),
    countNotes(user.id, scope),
    isTree ? getOutline(user.id) : Promise.resolve(null),
  ]);
  const filtered = hasNoteFilters(params) || view.config.filters.length > 0;
  const nothingAtAll = counts.active + counts.archived === 0 && !filtered;

  return (
    <TaskContextProvider value={context}>
      <PageContainer width={view.type === "LIST" || isTree ? "content" : "wide"}>
        <PageHeader
          title="Notes"
          description={`${counts.active} ${counts.active === 1 ? "note" : "notes"}`}
        >
          <NotesTreeSheet />
          {env.aiAvailable && aiEnabled ? (
            <Link href="/notes/new?ai=1" className={buttonVariants({ variant: "secondary" })}>
              <Sparkles strokeWidth={1.5} aria-hidden /> Write with AI
            </Link>
          ) : null}
          <Link href="/notes/new" className={buttonVariants()}>
            <Plus strokeWidth={1.5} aria-hidden /> New note
          </Link>
        </PageHeader>

        <NotesCollection
          views={views}
          activeViewId={view.id}
          items={items as ViewNote[]}
          params={params}
          quick={quick}
          archived={archived}
          tree={tree}
          archivedCount={counts.archived}
          nothingAtAll={nothingAtAll}
          nowMs={now.getTime()}
          engine={{ nowMs: now.getTime(), weekStart, prefs: dayPrefs }}
          basePath="/notes"
        />
      </PageContainer>
    </TaskContextProvider>
  );
}
