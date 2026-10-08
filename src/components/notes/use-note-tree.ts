"use client";

import { useEffect, useRef, useState } from "react";
import { loadNoteTree } from "@/actions/notes";
import type { ActionResult } from "@/lib/actions";
import type { NoteTreeRow } from "@/lib/notes/dto";
import { onNoteEvent } from "./note-events";

export type TreeData = { rows: NoteTreeRow[]; rootTotal: number };

/**
 * The notes shown in a tree, kept current (V2 feature 07 §5). It starts from what the server
 * rendered, applies renames and new notes the moment they happen (here or in another tab), and
 * reads the tree again after notes move or change state. A newer server render replaces all of it.
 */
export function useNoteTree(
  initial: TreeData,
  loader: () => Promise<ActionResult<TreeData>> = loadNoteTree,
): TreeData & { reload: () => void } {
  const [data, setData] = useState<TreeData>(initial);
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setData(initial);
  }

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reloadRef = useRef(() => {});
  useEffect(() => {
    reloadRef.current = () => {
      if (timer.current) clearTimeout(timer.current);
      // Several changes in a row (a drag, then a rename) are one read.
      timer.current = setTimeout(async () => {
        const result = await loader().catch(() => null);
        if (result?.ok) setData(result.data);
      }, 150);
    };
  });

  useEffect(() => {
    const off = onNoteEvent((event) => {
      if (event.type === "title") {
        setData((d) => ({
          ...d,
          rows: d.rows.map((r) => (r.id === event.id ? { ...r, title: event.title } : r)),
        }));
      } else if (event.type === "emoji") {
        setData((d) => ({
          ...d,
          rows: d.rows.map((r) => (r.id === event.id ? { ...r, emoji: event.emoji } : r)),
        }));
      } else if (event.type === "created") {
        setData((d) =>
          d.rows.some((r) => r.id === event.note.id)
            ? d
            : {
                rows: [...d.rows, event.note],
                // A new top-level note is one more, even if the tree only shows the first 50.
                rootTotal: event.note.parentId === null ? d.rootTotal + 1 : d.rootTotal,
              },
        );
      } else {
        reloadRef.current();
      }
    });
    return () => {
      off();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return { ...data, reload: () => reloadRef.current() };
}
