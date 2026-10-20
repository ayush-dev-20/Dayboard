import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import { CanvasRow } from "@/components/canvases/canvas-row";
import { DrawWithAiButton } from "@/components/canvases/draw-with-ai-button";
import { NewCanvasButton } from "@/components/canvases/new-canvas-button";
import { EmptyState } from "@/components/layout/empty-state";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { listArchivedCanvases, listCanvases } from "@/db/queries/canvases";
import { env } from "@/lib/env";
import { getPreferences } from "@/lib/preferences";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Canvases" };

// The list of canvases (V3 feature 01 §7): a hairline list, newest first, archived ones folded below.
export default async function CanvasesPage() {
  const user = await requireUser({ redirect: true });
  const [canvases, archived, prefs] = await Promise.all([
    listCanvases(user.id),
    listArchivedCanvases(user.id),
    getPreferences(user.id),
  ]);
  const now = new Date();
  const aiOn = env.aiAvailable && prefs.aiEnabled;

  return (
    <PageContainer>
      <PageHeader
        title="Canvases"
        description={canvases.length > 0 ? `${canvases.length}` : undefined}
      >
        <DrawWithAiButton />
        <NewCanvasButton />
      </PageHeader>

      {canvases.length === 0 && archived.length === 0 ? (
        <EmptyState
          title="No canvases yet."
          description={
            aiOn
              ? "Sketch an idea, or describe a system and let AI draw it."
              : "Sketch an idea on an open canvas."
          }
        >
          <NewCanvasButton />
          <DrawWithAiButton />
        </EmptyState>
      ) : (
        <>
          {canvases.length > 0 ? (
            <ul className="border-t border-border" aria-label="Canvases">
              {canvases.map((canvas) => (
                <CanvasRow key={canvas.id} canvas={canvas} now={now} timeZone={prefs.timezone} />
              ))}
            </ul>
          ) : (
            <p className="type-body-md text-muted-foreground">Everything is archived.</p>
          )}

          {archived.length > 0 ? (
            <details className="group mt-8">
              <summary className="flex cursor-pointer list-none items-center gap-2 pb-2 type-label-caps text-muted-foreground [&::-webkit-details-marker]:hidden">
                <ChevronRight
                  className="size-4 transition-transform duration-[120ms] group-open:rotate-90"
                  strokeWidth={1.5}
                  aria-hidden
                />
                Archived
                <span className="type-data-sm">{archived.length}</span>
              </summary>
              <ul className="border-t border-border" aria-label="Archived canvases">
                {archived.map((canvas) => (
                  <CanvasRow key={canvas.id} canvas={canvas} now={now} timeZone={prefs.timezone} />
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </PageContainer>
  );
}
