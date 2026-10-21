"use client";

import Link from "next/link";
import { CheckButton } from "@/components/ui/check-button";
import type { StickyInfoDTO } from "@/lib/canvas/dto";
import { STICKY_COLOR_NAMES, readStickies } from "@/lib/canvas/sticky";
import { formatDay } from "@/lib/dates/calendar";
import { STATUS_LABELS } from "@/lib/tasks/status";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  buildOutline,
  describeBox,
  describeConnection,
  isEmptyOutline,
  type OutlineBox,
} from "@/lib/canvas/outline";
import type { Scene } from "@/lib/canvas/types";

const CARD_LABEL = { note: "Note", task: "Task", project: "Project" } as const;
const CARD_HREF = {
  note: (id: string) => `/notes/${id}`,
  task: (id: string) => `/tasks?task=${id}`,
  project: (id: string) => `/projects/${id}`,
} as const;

function Box({ box }: { box: OutlineBox }) {
  if (!box.card) return <li>{describeBox(box)}</li>;
  return (
    <li>
      <span className="text-muted-foreground">{CARD_LABEL[box.card.type]}: </span>
      <Link href={CARD_HREF[box.card.type](box.card.id)} className="text-primary hover:underline">
        {box.label}
      </Link>
    </li>
  );
}

/**
 * The Outline (V3 feature 01 §7): the drawing as a plain list of sections, boxes with their technology, connections and
 * free text. A real list in the page, reachable by keyboard: the accessible route to a diagram, since Excalidraw's own
 * keyboard and screen-reader support is limited.
 */
export function OutlinePanel({
  open,
  onOpenChange,
  scene,
  infos,
  today,
  onComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scene: Scene | null;
  /** The tasks of the sticky notes, for their status and due date. */
  infos?: ReadonlyMap<string, StickyInfoDTO>;
  today?: string;
  onComplete?: (id: string, done: boolean) => void;
}) {
  const outline = scene ? buildOutline(scene) : null;
  const notes = scene ? readStickies(scene.elements) : [];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        aria-describedby="outline-description"
        className="overflow-y-auto p-6"
      >
        <SheetTitle className="type-headline-sm">Outline</SheetTitle>
        <SheetDescription
          id="outline-description"
          className="mt-1 type-body-sm text-muted-foreground"
        >
          The same boxes and connections as the drawing, as a list.
        </SheetDescription>

        {!outline || (isEmptyOutline(outline) && notes.length === 0) ? (
          <p className="mt-6 type-body-md text-muted-foreground">
            Nothing to list yet. Boxes with text, cards and arrows between them show up here.
          </p>
        ) : (
          <div className="mt-6 flex flex-col gap-6">
            {notes.length > 0 ? (
              <section aria-label="Sticky notes">
                <h3 className="type-label-caps text-muted-foreground">Sticky notes</h3>
                <ul className="mt-2 space-y-1 type-body-md text-foreground">
                  {notes.map((note) => {
                    const info = infos?.get(note.id);
                    const words = note.text.split("\n")[0] || "Empty sticky note";
                    const closed = info?.status === "DONE" || info?.status === "CANCELLED";
                    return (
                      <li key={note.elementId} className="flex items-center gap-1">
                        {info && onComplete ? (
                          <CheckButton
                            checked={info.status === "DONE"}
                            label={`Complete ${words}`}
                            onCheckedChange={(next) => onComplete(note.id, next)}
                          />
                        ) : null}
                        <span className={closed ? "text-muted-foreground line-through" : undefined}>
                          {words}
                        </span>
                        <span className="type-body-sm text-muted-foreground">
                          {[
                            STICKY_COLOR_NAMES[note.tone],
                            info ? STATUS_LABELS[info.status] : null,
                            info?.dueDate && today ? `due ${formatDay(info.dueDate, today)}` : null,
                          ]
                            .filter(Boolean)
                            .join(", ")}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}
            {outline.sections.map((section) => (
              <section key={section.id} aria-label={section.name}>
                <h3 className="type-label-caps text-muted-foreground">{section.name}</h3>
                {section.boxes.length > 0 ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 type-body-md text-foreground">
                    {section.boxes.map((box) => (
                      <Box key={box.id} box={box} />
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 type-body-sm text-muted-foreground">
                    No boxes in this section.
                  </p>
                )}
              </section>
            ))}
            {outline.boxes.length > 0 ? (
              <section aria-label="Boxes">
                <h3 className="type-label-caps text-muted-foreground">
                  {outline.sections.length > 0 ? "Other boxes" : "Boxes"}
                </h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 type-body-md text-foreground">
                  {outline.boxes.map((box) => (
                    <Box key={box.id} box={box} />
                  ))}
                </ul>
              </section>
            ) : null}
            {outline.connections.length > 0 ? (
              <section aria-label="Connections">
                <h3 className="type-label-caps text-muted-foreground">Connections</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 type-body-md text-foreground">
                  {outline.connections.map((c, i) => (
                    <li key={i}>{describeConnection(c)}</li>
                  ))}
                </ul>
              </section>
            ) : null}
            {outline.texts.length > 0 ? (
              <section aria-label="Text">
                <h3 className="type-label-caps text-muted-foreground">Text</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 type-body-md text-foreground">
                  {outline.texts.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
