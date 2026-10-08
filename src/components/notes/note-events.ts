import type { NoteTreeRow } from "@/lib/notes/dto";

// What the open page tells the rest of the app about notes (V2 feature 07 §5): a note was renamed,
// got a new emoji, was created, or something changed where notes sit. The sidebar tree and the
// links inside other notes listen, so they stay current without waiting for a refresh. Events also
// reach the app's other tabs through a BroadcastChannel (the same browser, so no sync is needed).

export type NoteEvent =
  | { type: "title"; id: string; title: string }
  | { type: "emoji"; id: string; emoji: string | null }
  | { type: "created"; note: NoteTreeRow }
  /** Notes moved, were archived, trashed or restored: read the tree and link states again. */
  | { type: "structure" };

type Listener = (event: NoteEvent) => void;

const listeners = new Set<Listener>();
const CHANNEL = "dayboard-notes";

let channel: BroadcastChannel | null | undefined;

function getChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  if (typeof BroadcastChannel === "undefined") return (channel = null);
  channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (message: MessageEvent<NoteEvent>) => {
    for (const listener of listeners) listener(message.data);
  };
  return channel;
}

/** Tells this tab's listeners and every other tab. */
export function emitNoteEvent(event: NoteEvent): void {
  for (const listener of listeners) listener(event);
  try {
    getChannel()?.postMessage(event);
  } catch {
    // A channel that can't carry the message (a closed one) only costs the other tabs a refresh.
  }
}

/** Listens to events from this tab and others. Returns the way to stop. */
export function onNoteEvent(listener: Listener): () => void {
  listeners.add(listener);
  getChannel(); // start listening for other tabs
  return () => {
    listeners.delete(listener);
  };
}
