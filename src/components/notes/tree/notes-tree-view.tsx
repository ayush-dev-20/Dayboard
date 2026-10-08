"use client";

import { useMemo, useState } from "react";
import { loadNoteOutline } from "@/actions/notes";
import { EmptyState } from "@/components/layout/empty-state";
import type { NoteTreeRow } from "@/lib/notes/dto";
import { NotesTree, type Branches } from "./notes-tree";

// The Tree view on the Notes page (V2 feature 07 §5): every note in its place as an outline, open
// to begin with, with the same dragging, keyboard and menus as the sidebar tree.

/** Open branches kept in the page (the sidebar remembers its own on the device). */
function useLocalBranches(rows: readonly NoteTreeRow[]): Branches {
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const open = useMemo(() => {
    const parents = new Set(rows.map((r) => r.parentId).filter((id): id is string => id !== null));
    return new Set([...parents].filter((id) => !closed.has(id)));
  }, [rows, closed]);
  return {
    open,
    setOpen: (id, isOpen) =>
      setClosed((current) => {
        const next = new Set(current);
        if (isOpen) next.delete(id);
        else next.add(id);
        return next;
      }),
    expand: (ids) =>
      setClosed((current) => {
        if (!ids.some((id) => current.has(id))) return current;
        const next = new Set(current);
        for (const id of ids) next.delete(id);
        return next;
      }),
  };
}

const loader = async () => {
  const result = await loadNoteOutline();
  return result.ok
    ? {
        ok: true as const,
        data: {
          rows: result.data,
          rootTotal: result.data.filter((r) => r.parentId === null).length,
        },
      }
    : result;
};

export function NotesTreeView({ rows }: { rows: NoteTreeRow[] }) {
  const branches = useLocalBranches(rows);
  const initial = useMemo(
    () => ({ rows, rootTotal: rows.filter((r) => r.parentId === null).length }),
    [rows],
  );
  if (rows.length === 0) {
    return (
      <div className="mt-4">
        <EmptyState
          illustration="notes-empty"
          title="No notes yet."
          description="Notes and their sub-notes show here as an outline."
        />
      </div>
    );
  }
  return (
    <div className="mt-4">
      <NotesTree initial={initial} branches={branches} variant="page" loader={loader} />
    </div>
  );
}
