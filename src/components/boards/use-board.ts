"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { saveCanvas } from "@/actions/canvases";
import {
  changeColumnStatus,
  createSticky,
  deleteBoardColumn,
  deleteSticky,
  duplicateSticky,
  loadBoard,
  makeStickyRegularTask,
  moveSticky,
  restoreSticky,
  updateSticky,
} from "@/actions/stickies";
import {
  BOARD_LIMITS,
  newColumnId,
  sanitizeBoard,
  type Board,
  type Column,
  type ColumnStatus,
} from "@/lib/canvas/board";
import type { BoardDTO, StickyDTO } from "@/lib/canvas/dto";
import type { ColorToken } from "@/lib/colors";
import { orderBetween } from "@/lib/tasks/ordering";

// The state of one sticky board in the browser (V3 feature 01 §13.5). The server is the truth: a sticky move is optimistic
// and goes back if the server refuses it; the columns autosave like a drawing (a change saves 1.5 s after the last one,
// with the version the page started from, a device draft when a save fails, and a conflict banner that never blocks).

export type BoardSaveState = "saved" | "pending" | "saving" | "failed" | "conflict";

const DEBOUNCE_MS = 1500;
const RETRY_MS = [2_000, 5_000, 10_000, 30_000];

type Draft = { baseVersion: number; at: number; board: Board };
const draftKey = (id: string) => `board-draft:${id}`;

function readDraft(id: string): Draft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(id));
    if (!raw) return null;
    const draft = JSON.parse(raw) as Draft;
    return { ...draft, board: sanitizeBoard(draft.board) };
  } catch {
    return null;
  }
}
function writeDraft(id: string, draft: Draft) {
  try {
    window.localStorage.setItem(draftKey(id), JSON.stringify(draft));
  } catch {
    // Storage full or off: the edit stays in the page.
  }
}
function clearDraft(id: string) {
  try {
    window.localStorage.removeItem(draftKey(id));
  } catch {
    // Nothing to clear.
  }
}

/** Stickies in their order on the board: by `sortOrder`, ties by arrival. */
export const sortStickies = (list: StickyDTO[]) =>
  [...list].sort((a, b) => a.sortOrder - b.sortOrder);

const inColumn = (list: StickyDTO[], columnId: string) =>
  sortStickies(list.filter((s) => s.columnId === columnId));

export function useBoard(initial: BoardDTO) {
  const canvasId = initial.id;
  const [board, setBoard] = useState<Board>(initial.board);
  const [stickies, setStickies] = useState<StickyDTO[]>(() => sortStickies(initial.stickies));
  const [state, setState] = useState<BoardSaveState>("saved");
  const [message, setMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const versionRef = useRef(initial.version);
  const serverVersion = useRef(initial.version);
  const dirty = useRef<Board | null>(null);
  const latest = useRef(board);
  const running = useRef(false);
  const conflict = useRef(false);
  const failures = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const runRef = useRef<() => Promise<void>>(async () => undefined);
  const stickiesRef = useRef(stickies);

  useEffect(() => {
    stickiesRef.current = stickies;
  }, [stickies]);

  // A draft from an earlier visit that never saved: offered once, when it is newer than the saved board.
  useEffect(() => {
    const found = readDraft(canvasId);
    // Reads the device, which the server cannot: it runs once the page is on it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (found && found.at > Date.parse(initial.updatedAt)) setDraft(found);
  }, [canvasId, initial.updatedAt]);

  const run = useCallback(async () => {
    if (running.current || conflict.current || !dirty.current) return;
    running.current = true;
    const sending = dirty.current;
    setState("saving");
    try {
      const result = await saveCanvas({
        id: canvasId,
        version: versionRef.current,
        board: sending,
      });
      if (!result.ok) {
        writeDraft(canvasId, { baseVersion: versionRef.current, at: Date.now(), board: sending });
        setMessage(result.error.message);
        setState("failed");
        // A refusal that retrying cannot fix: said once, tried again with the next change.
        if (result.error.code === "VALIDATION_ERROR" || result.error.code === "NOT_FOUND") return;
        throw new Error("save failed");
      }
      if (result.data.outcome === "conflict") {
        conflict.current = true;
        serverVersion.current = result.data.version;
        setState("conflict");
        return;
      }
      versionRef.current = result.data.version;
      failures.current = 0;
      setMessage(null);
      if (dirty.current === sending) {
        dirty.current = null;
        clearDraft(canvasId);
        setState("saved");
      } else {
        setState("pending");
        timer.current = setTimeout(() => void runRef.current(), DEBOUNCE_MS);
      }
    } catch {
      const wait = RETRY_MS[Math.min(failures.current, RETRY_MS.length - 1)]!;
      failures.current += 1;
      setState("failed");
      timer.current = setTimeout(() => void runRef.current(), wait);
    } finally {
      running.current = false;
    }
  }, [canvasId]);

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  const scheduleColumns = useCallback(
    (next: Board) => {
      latest.current = next;
      setBoard(next);
      dirty.current = next;
      setState((s) => (s === "saving" || s === "failed" || s === "conflict" ? s : "pending"));
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void run(), DEBOUNCE_MS);
    },
    [run],
  );

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    await run();
  }, [run]);

  // Leaving with something unsaved: keep it on the device, so the next visit can offer it back.
  useEffect(() => {
    const keep = () => {
      if (dirty.current) {
        writeDraft(canvasId, {
          baseVersion: versionRef.current,
          at: Date.now(),
          board: dirty.current,
        });
      }
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") keep();
    };
    window.addEventListener("pagehide", keep);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", keep);
      document.removeEventListener("visibilitychange", onHide);
      clearTimeout(timer.current);
    };
  }, [canvasId]);

  /** Replaces everything with what the server has (after a conflict, a column change, or a closed task panel). */
  const reload = useCallback(async () => {
    const result = await loadBoard({ id: canvasId });
    if (!result.ok) {
      toast.error(result.error.message);
      return false;
    }
    versionRef.current = result.data.version;
    serverVersion.current = result.data.version;
    latest.current = result.data.board;
    setBoard(result.data.board);
    setStickies(sortStickies(result.data.stickies));
    return true;
  }, [canvasId]);

  const loadLatest = useCallback(async () => {
    if (await reload()) {
      conflict.current = false;
      dirty.current = null;
      failures.current = 0;
      clearDraft(canvasId);
      setMessage(null);
      setState("saved");
    }
  }, [reload, canvasId]);

  const keepMine = useCallback(() => {
    versionRef.current = serverVersion.current;
    conflict.current = false;
    dirty.current = latest.current;
    void run();
  }, [run]);

  const recoverDraft = useCallback(() => {
    if (!draft) return;
    setDraft(null);
    scheduleColumns(draft.board);
  }, [draft, scheduleColumns]);

  const discardDraft = useCallback(() => {
    clearDraft(canvasId);
    setDraft(null);
  }, [canvasId]);

  // ---- Columns ---------------------------------------------------------------------------------------------------------

  const updateColumn = (id: string, patch: Partial<Column>) =>
    scheduleColumns({
      ...latest.current,
      columns: latest.current.columns.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });

  const renameColumn = (id: string, name: string) => {
    const clean = name.replace(/\s+/g, " ").trim();
    if (!clean) return false;
    if ([...clean].length > BOARD_LIMITS.columnName) {
      toast.error(`Column names can have ${BOARD_LIMITS.columnName} characters at most.`);
      return false;
    }
    updateColumn(id, { name: clean });
    return true;
  };
  const setColumnTone = (id: string, tone: ColorToken | null) => updateColumn(id, { tone });
  const toggleCollapsed = (id: string) => {
    const column = latest.current.columns.find((c) => c.id === id);
    if (column) updateColumn(id, { collapsed: !column.collapsed });
  };
  const moveColumn = (id: string, direction: -1 | 1) => {
    const columns = [...latest.current.columns];
    const at = columns.findIndex((c) => c.id === id);
    const to = at + direction;
    if (at < 0 || to < 0 || to >= columns.length) return;
    [columns[at], columns[to]] = [columns[to]!, columns[at]!];
    scheduleColumns({ v: 1, columns });
  };
  const addColumn = (name: string, status: ColumnStatus) => {
    const clean = name.replace(/\s+/g, " ").trim();
    if (!clean) return false;
    if (latest.current.columns.length >= BOARD_LIMITS.columns) {
      toast.error(`A board can have ${BOARD_LIMITS.columns} columns at most.`);
      return false;
    }
    scheduleColumns({
      v: 1,
      columns: [
        ...latest.current.columns,
        { id: newColumnId(), name: clean.slice(0, BOARD_LIMITS.columnName), status, tone: null },
      ],
    });
    return true;
  };

  /** Changes what a column stands for (after the person confirmed), moving its stickies' status with it. */
  const setColumnStatus = async (id: string, status: ColumnStatus) => {
    await flush();
    const result = await changeColumnStatus({
      canvasId,
      version: versionRef.current,
      columnId: id,
      status,
    });
    if (!result.ok) {
      toast.error(result.error.message);
      return false;
    }
    if (result.data.outcome === "conflict") {
      conflict.current = true;
      serverVersion.current = result.data.version;
      setState("conflict");
      return false;
    }
    versionRef.current = result.data.version;
    await reload();
    return true;
  };

  /** Deletes a column (after the person chose where its stickies go: another column, or Trash). */
  const removeColumn = async (id: string, moveTo: string | null) => {
    await flush();
    const result = await deleteBoardColumn({
      canvasId,
      version: versionRef.current,
      columnId: id,
      moveTo,
    });
    if (!result.ok) {
      toast.error(result.error.message);
      return false;
    }
    if (result.data.outcome === "conflict") {
      conflict.current = true;
      serverVersion.current = result.data.version;
      setState("conflict");
      return false;
    }
    versionRef.current = result.data.version;
    await reload();
    return true;
  };

  // ---- Sticky notes ------------------------------------------------------------------------------------------------------

  const replaceSticky = (next: StickyDTO) =>
    setStickies((list) => sortStickies(list.map((s) => (s.id === next.id ? next : s))));

  const add = async (columnId: string, text: string) => {
    const result = await createSticky({ canvasId, columnId, text });
    if (!result.ok) {
      toast.error(result.error.message);
      return false;
    }
    setStickies((list) => sortStickies([...list, result.data]));
    return true;
  };

  const editText = async (id: string, text: string) => {
    const before = stickiesRef.current.find((s) => s.id === id);
    if (!before || before.text === text) return true;
    const result = await updateSticky({ id, text });
    if (!result.ok) {
      toast.error(result.error.message);
      return false;
    }
    replaceSticky(result.data);
    return true;
  };

  const setTone = async (id: string, tone: ColorToken | null) => {
    const before = stickiesRef.current.find((s) => s.id === id);
    if (!before) return;
    replaceSticky({ ...before, tone });
    const result = await updateSticky({ id, tone });
    if (!result.ok) {
      replaceSticky(before);
      toast.error(result.error.message);
    } else replaceSticky(result.data);
  };

  /** Puts a sticky in a column before another one (or at the end). Shown at once; put back if the server refuses. */
  const move = async (id: string, columnId: string, beforeId: string | null) => {
    const before = stickiesRef.current;
    const sticky = before.find((s) => s.id === id);
    const column = latest.current.columns.find((c) => c.id === columnId);
    if (!sticky || !column) return false;
    const siblings = inColumn(before, columnId).filter((s) => s.id !== id);
    const at = beforeId ? siblings.findIndex((s) => s.id === beforeId) : -1;
    const below = at >= 0 ? siblings[at]! : null;
    const above = (at >= 0 ? siblings[at - 1] : siblings.at(-1)) ?? null;
    const order = orderBetween(above?.sortOrder ?? null, below?.sortOrder ?? null).order;
    const statusChanges = sticky.columnId !== columnId && sticky.status !== column.status;
    setStickies(
      sortStickies(
        before.map((s) =>
          s.id === id
            ? {
                ...s,
                columnId,
                sortOrder: order,
                ...(statusChanges
                  ? {
                      status: column.status,
                      completedAt: column.status === "DONE" ? new Date().toISOString() : null,
                    }
                  : {}),
              }
            : s,
        ),
      ),
    );
    const result = await moveSticky({ id, columnId, beforeId });
    if (!result.ok) {
      setStickies(before);
      toast.error(result.error.message);
      return false;
    }
    // The server may have renumbered the column: take its numbers for everything we know of.
    setStickies((list) => sortStickies(list.map((s) => (s.id === id ? result.data : s))));
    return true;
  };

  const duplicate = async (id: string) => {
    const result = await duplicateSticky({ id });
    if (!result.ok) return void toast.error(result.error.message);
    setStickies((list) => sortStickies([...list, result.data]));
  };

  const remove = async (id: string) => {
    const before = stickiesRef.current;
    setStickies(before.filter((s) => s.id !== id));
    const result = await deleteSticky({ id });
    if (!result.ok) {
      setStickies(before);
      return void toast.error(result.error.message);
    }
    toast("Sticky note moved to Trash.", {
      duration: 5000,
      action: {
        label: "Undo",
        onClick: async () => {
          const undo = await restoreSticky({ id });
          if (!undo.ok) return void toast.error("Couldn't restore that. Try Trash.");
          setStickies((list) => sortStickies([...list.filter((s) => s.id !== id), undo.data]));
        },
      },
    });
  };

  const makeTask = async (id: string) => {
    const before = stickiesRef.current;
    setStickies(before.filter((s) => s.id !== id));
    const result = await makeStickyRegularTask({ id });
    if (!result.ok) {
      setStickies(before);
      return void toast.error(result.error.message);
    }
    toast.success("It's a regular task now. Find it in Tasks.");
  };

  return {
    board,
    stickies,
    version: () => versionRef.current,
    state,
    message,
    draft,
    flush,
    reload,
    loadLatest,
    keepMine,
    recoverDraft,
    discardDraft,
    columns: {
      rename: renameColumn,
      setTone: setColumnTone,
      toggleCollapsed,
      move: moveColumn,
      add: addColumn,
      setStatus: setColumnStatus,
      remove: removeColumn,
    },
    sticky: { add, editText, setTone, move, duplicate, remove, makeTask },
  };
}
