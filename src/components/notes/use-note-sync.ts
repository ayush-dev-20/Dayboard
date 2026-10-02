"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { createNote, loadNote, saveNoteContent, saveNoteTitle } from "@/actions/notes";
import type { TiptapDoc } from "@/lib/editor/types";
import type { NoteDTO } from "@/lib/notes/dto";
import { clearDraft, writeDraft } from "@/lib/notes/draft";
import {
  INITIAL_SAVE_STATE,
  noteSaveReducer,
  retryDelayMs,
  type NoteSaveState,
} from "@/lib/notes/save-state";

type Options = {
  /** The saved note, or null for a new one that doesn't exist yet. */
  initial: { id: string; version: number; title: string; doc: TiptapDoc } | null;
  /** For a new note: where it should live when it is created. */
  create: { projectId?: string | null; linkTaskId?: string | null };
  /** Called once the new note exists, with its id (the address bar is updated, the editor keeps running). */
  onCreated: (id: string) => void;
};

const CONTENT_DELAY_MS = 800;
const TITLE_DELAY_MS = 500;
const FIRST_SAVE_DELAY_MS = 300;
const SAVED_VISIBLE_MS = 2000;

export type NoteSync = {
  state: NoteSaveState;
  noteId: string | null;
  onDocChange: (doc: TiptapDoc) => void;
  onTitleChange: (title: string) => void;
  onEmojiChange: (emoji: string | null) => void;
  /** Save right now (blur, leaving, archive). Resolves when nothing is pending or the save failed. */
  flush: () => Promise<void>;
  /** After a conflict: take the server's copy. Returns it so the editor can show it. */
  loadLatest: () => Promise<NoteDTO | null>;
  /** After a conflict: save what is on screen on top of the server's copy. */
  keepMine: () => void;
};

/**
 * Keeps one note saved. Changes are debounced and sent one at a time, each carrying the version
 * the editor last saw. The server refusing a stale version is a conflict, which stops saving and
 * waits for the person to choose. A network failure keeps the text in memory (and in a local
 * draft), shows "Not saved, retrying" and retries with growing delays and when the browser comes
 * back online. A new note is created on its first change, so abandoned "new note" clicks leave
 * nothing behind.
 */
export function useNoteSync({ initial, create, onCreated }: Options): NoteSync {
  const [state, dispatch] = useReducer(noteSaveReducer, INITIAL_SAVE_STATE);

  const [noteId, setNoteId] = useState<string | null>(initial?.id ?? null);
  const idRef = useRef<string | null>(initial?.id ?? null);
  const versionRef = useRef(initial?.version ?? 1);
  const docRef = useRef<TiptapDoc | null>(initial?.doc ?? null);
  const titleRef = useRef(initial?.title ?? "");
  const emojiRef = useRef<string | null>(null);
  const dirtyDoc = useRef<TiptapDoc | null>(null);
  const dirtyTitle = useRef<string | null>(null);
  const inFlight = useRef(false);
  const conflict = useRef<{ version: number } | null>(null);
  const attempts = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failedRef = useRef(false);
  const settled = useRef<(() => void)[]>([]);
  const optionsRef = useRef({ create, onCreated });
  // `run` calls itself again (more typing arrived, or a retry); going through a ref keeps it from
  // referring to itself while it is being declared.
  const runRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    optionsRef.current = { create, onCreated };
  });

  const isDirty = () => dirtyDoc.current !== null || dirtyTitle.current !== null;

  const mirrorDraft = useCallback(() => {
    const id = idRef.current;
    if (id && docRef.current) {
      writeDraft(id, {
        doc: docRef.current,
        title: titleRef.current,
        savedAt: Date.now(),
        baseVersion: versionRef.current,
      });
    }
  }, []);

  const finish = () => {
    for (const resolve of settled.current.splice(0)) resolve();
  };

  const run = useCallback(async () => {
    if (inFlight.current || conflict.current || !isDirty()) return;
    inFlight.current = true;
    dispatch({ type: "start" });

    const sentDoc = dirtyDoc.current;
    const sentTitle = dirtyTitle.current;
    let failed = false;
    let conflictVersion: number | null = null;

    try {
      if (!idRef.current) {
        const result = await createNote({
          title: titleRef.current,
          emoji: emojiRef.current,
          contentJson: docRef.current ?? undefined,
          projectId: optionsRef.current.create.projectId ?? null,
          linkTaskId: optionsRef.current.create.linkTaskId ?? null,
        });
        if (!result.ok) {
          failed = true;
        } else {
          idRef.current = result.data.id;
          versionRef.current = result.data.version;
          if (dirtyDoc.current === sentDoc) dirtyDoc.current = null;
          if (dirtyTitle.current === sentTitle) dirtyTitle.current = null;
          setNoteId(result.data.id);
          optionsRef.current.onCreated(result.data.id);
        }
      } else {
        const id = idRef.current;
        if (sentDoc) {
          const result = await saveNoteContent({
            id,
            contentJson: sentDoc,
            baseVersion: versionRef.current,
          });
          if (!result.ok) failed = true;
          else if (result.data.outcome === "conflict") conflictVersion = result.data.version;
          else {
            versionRef.current = result.data.version;
            if (dirtyDoc.current === sentDoc) dirtyDoc.current = null;
          }
        }
        if (!failed && conflictVersion === null && sentTitle !== null) {
          const result = await saveNoteTitle({
            id,
            title: sentTitle,
            baseVersion: versionRef.current,
          });
          if (!result.ok) failed = true;
          else if (result.data.outcome === "conflict") conflictVersion = result.data.version;
          else {
            versionRef.current = result.data.version;
            if (dirtyTitle.current === sentTitle) dirtyTitle.current = null;
          }
        }
      }
    } catch {
      failed = true;
    }
    inFlight.current = false;

    if (conflictVersion !== null) {
      conflict.current = { version: conflictVersion };
      dispatch({ type: "conflicted" });
      finish();
      return;
    }
    if (failed) {
      failedRef.current = true;
      dispatch({ type: "failed" });
      const delay = retryDelayMs(++attempts.current);
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(() => void runRef.current(), delay);
      finish();
      return;
    }

    attempts.current = 0;
    failedRef.current = false;
    if (isDirty()) {
      void runRef.current(); // more typing arrived while saving
      return;
    }
    if (idRef.current) clearDraft(idRef.current);
    dispatch({ type: "succeeded" });
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    fadeTimer.current = setTimeout(() => dispatch({ type: "fade" }), SAVED_VISIBLE_MS);
    finish();
  }, []);

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  const schedule = useCallback(
    (delay: number) => {
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
      if (retryTimer.current) clearTimeout(retryTimer.current);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void run(), idRef.current ? delay : FIRST_SAVE_DELAY_MS);
    },
    [run],
  );

  const onDocChange = useCallback(
    (doc: TiptapDoc) => {
      docRef.current = doc;
      dirtyDoc.current = doc;
      mirrorDraft();
      dispatch({ type: "edit" });
      if (!conflict.current) schedule(CONTENT_DELAY_MS);
    },
    [mirrorDraft, schedule],
  );

  const onTitleChange = useCallback(
    (title: string) => {
      titleRef.current = title;
      dirtyTitle.current = title;
      dispatch({ type: "edit" });
      if (!conflict.current) schedule(TITLE_DELAY_MS);
    },
    [schedule],
  );

  const onEmojiChange = useCallback(
    (emoji: string | null) => {
      emojiRef.current = emoji;
      // Before the note exists, the emoji rides along with the first save.
      if (!idRef.current) {
        dirtyTitle.current = titleRef.current;
        schedule(FIRST_SAVE_DELAY_MS);
      }
    },
    [schedule],
  );

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!isDirty() && !inFlight.current) return Promise.resolve();
    return new Promise<void>((resolve) => {
      settled.current.push(resolve);
      void run();
      if (!inFlight.current) finish();
    });
  }, [run]);

  const loadLatest = useCallback(async () => {
    const id = idRef.current;
    if (!id) return null;
    const result = await loadNote({ id });
    if (!result.ok) return null;
    const note = result.data;
    versionRef.current = note.version;
    docRef.current = note.contentJson;
    titleRef.current = note.title;
    dirtyDoc.current = null;
    dirtyTitle.current = null;
    conflict.current = null;
    attempts.current = 0;
    clearDraft(id);
    dispatch({ type: "resolved" });
    return note;
  }, []);

  const keepMine = useCallback(() => {
    const latest = conflict.current;
    if (!latest) return;
    versionRef.current = latest.version;
    conflict.current = null;
    dispatch({ type: "resolved" });
    void run();
  }, [run]);

  useEffect(() => {
    const onOnline = () => {
      if (isDirty() && !inFlight.current && !conflict.current) void runRef.current();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isDirty() || failedRef.current || conflict.current) event.preventDefault();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (timer.current) clearTimeout(timer.current);
      if (retryTimer.current) clearTimeout(retryTimer.current);
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
      // Leaving the page with unsaved text: send it now rather than dropping it.
      if (isDirty() && !inFlight.current && !conflict.current) void runRef.current();
    };
  }, []);

  return {
    state,
    noteId,
    onDocChange,
    onTitleChange,
    onEmojiChange,
    flush,
    loadLatest,
    keepMine,
  };
}
