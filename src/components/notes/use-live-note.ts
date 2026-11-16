"use client";

import { useEffect, useRef, useState } from "react";
import type { AnyExtension } from "@tiptap/core";
import type { Doc, Map as YMap } from "yjs";
import { presenceColor } from "@/lib/collab/presence";

// The live path for one note (V3 feature 05 §2, §5, §6). Asks the app for a 60-second token; when there is none the note is
// an ordinary one and nothing else happens. Yjs, the provider and the Collaboration extensions are loaded only here, so a
// note nobody shares pays nothing for them.

export type LivePhase =
  /** Not live: the ordinary save path applies. */
  | "off"
  | "connecting"
  | "live"
  /** The socket dropped; edits are kept in memory and sent when it is back. */
  | "reconnecting"
  /** Access ended while the page was open. */
  | "denied";

export type Peer = { id: string; name: string; color: string };

export type LiveNote = {
  phase: LivePhase;
  role: "edit" | "read";
  extensions: AnyExtension[] | null;
  meta: YMap<unknown> | null;
  peers: Peer[];
  /** A short, polite sentence for a live region ("Rahul joined"), or "". */
  announcement: string;
  /** The server said "live" and the first token has not come back yet: do not show the ordinary editor. */
  checking: boolean;
};

const OFF: LiveNote = {
  phase: "off",
  role: "edit",
  extensions: null,
  meta: null,
  peers: [],
  announcement: "",
  checking: false,
};

type TokenReply = { token: string; role: "edit" | "read"; url: string };

async function fetchToken(noteId: string): Promise<TokenReply | null> {
  try {
    const response = await fetch("/api/collab/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ noteId }),
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as TokenReply;
  } catch {
    return null;
  }
}

const ANNOUNCE_GAP_MS = 5000;
/** The service did not answer on the first connect: the note falls back to ordinary saves (feature 05 §2). */
const FIRST_CONNECT_MS = 8000;

export function useLiveNote(options: {
  noteId: string | null;
  /** The server says this note can be live (sharing is on, the service is configured, someone else may edit). */
  enabled: boolean;
  user: { id: string; name: string };
}): LiveNote {
  const { noteId, enabled, user } = options;
  const [state, setState] = useState<LiveNote>(OFF);
  // The note whose token request has finished (answered or refused): until then the ordinary editor waits.
  const [resolvedFor, setResolvedFor] = useState<string | null>(null);
  const userRef = useRef(user);
  useEffect(() => {
    userRef.current = user;
  });

  useEffect(() => {
    if (!enabled || !noteId) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    void (async () => {
      const first = await fetchToken(noteId);
      if (cancelled) return;
      setResolvedFor(noteId);
      if (!first) return; // not live: the ordinary path stays
      const [Y, { HocuspocusProvider }, { Collaboration }, { CollaborationCaret }] =
        await Promise.all([
          import("yjs"),
          import("@hocuspocus/provider"),
          import("@tiptap/extension-collaboration"),
          import("@tiptap/extension-collaboration-caret"),
        ]);
      if (cancelled) return;

      const ydoc: Doc = new Y.Doc();
      let firstToken: string | null = first.token;
      let role = first.role;
      const provider = new HocuspocusProvider({
        url: first.url,
        name: noteId,
        document: ydoc,
        // A fresh token on every (re)connect: the first one is already in hand.
        token: async () => {
          if (firstToken) {
            const t = firstToken;
            firstToken = null;
            return t;
          }
          const next = await fetchToken(noteId);
          if (!next) throw new Error("no access");
          role = next.role;
          setState((s) => ({ ...s, role }));
          return next.token;
        },
      });

      const me = userRef.current;
      const color = presenceColor(me.id);
      const extensions: AnyExtension[] = [
        Collaboration.configure({ document: ydoc }),
        CollaborationCaret.configure({
          provider,
          user: { id: me.id, name: me.name, color },
        }),
      ];
      const meta = ydoc.getMap<unknown>("meta");

      let lastAnnounce = 0;
      let known = new Map<string, string>();
      let timer: ReturnType<typeof setTimeout> | null = null;
      const say = (text: string) => {
        const wait = Math.max(0, lastAnnounce + ANNOUNCE_GAP_MS - Date.now());
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          lastAnnounce = Date.now();
          setState((s) => ({ ...s, announcement: text }));
        }, wait);
      };

      setState({
        phase: "connecting",
        role,
        extensions,
        meta,
        peers: [],
        announcement: "",
        checking: false,
      });

      let everSynced = false;
      const giveUp = setTimeout(() => {
        if (everSynced || cancelled) return;
        // The service is down or unreachable: the ordinary save-and-conflict path takes over.
        provider.destroy();
        ydoc.destroy();
        setState(OFF);
      }, FIRST_CONNECT_MS);
      provider.on("synced", () => {
        everSynced = true;
        clearTimeout(giveUp);
        setState((s) => ({ ...s, phase: "live" }));
      });
      provider.on("status", ({ status }: { status: string }) => {
        if (status === "disconnected") {
          setState((s) => (s.phase === "denied" ? s : { ...s, phase: "reconnecting" }));
          say("Reconnecting… your changes are kept");
        } else if (status === "connected") {
          setState((s) => (s.phase === "reconnecting" ? { ...s, phase: "live" } : s));
        }
      });
      provider.on("authenticationFailed", () => {
        setState((s) => ({ ...s, phase: "denied", role: "read" }));
        say("You no longer have access to edit this note");
      });
      provider.on(
        "awarenessChange",
        ({ states }: { states: { clientId: number; user?: Peer }[] }) => {
          const own = ydoc.clientID;
          const peers = new Map<string, Peer>();
          for (const s of states) {
            if (s.clientId === own || !s.user?.id) continue;
            peers.set(s.user.id, { id: s.user.id, name: s.user.name, color: s.user.color });
          }
          const next = new Map([...peers.values()].map((p) => [p.id, p.name]));
          for (const [id, name] of next) if (!known.has(id)) say(`${name} joined`);
          for (const [id, name] of known) if (!next.has(id)) say(`${name} left`);
          known = next;
          setState((s) => ({ ...s, peers: [...peers.values()] }));
        },
      );
      provider.on("disconnect", () => {
        // A drop that came back is announced when it does; nothing to add here.
      });

      cleanup = () => {
        clearTimeout(giveUp);
        if (timer) clearTimeout(timer);
        provider.destroy();
        ydoc.destroy();
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
      setState(OFF);
    };
  }, [enabled, noteId]);

  return { ...state, checking: enabled && Boolean(noteId) && resolvedFor !== noteId };
}
