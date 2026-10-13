// Which parts of the app hold changes that have not reached the server yet (V2 feature 03 §5). The
// update banner waits on this before it offers a reload, so a reload never drops an edit.
// Autosaving editors register here while a save is pending or failed.

const unsaved = new Set<string>();
const listeners = new Set<() => void>();

export function setUnsaved(id: string, value: boolean): void {
  if (unsaved.has(id) === value) return;
  if (value) unsaved.add(id);
  else unsaved.delete(id);
  for (const listener of listeners) listener();
}

export function hasUnsavedChanges(): boolean {
  return unsaved.size > 0;
}

export function subscribeUnsaved(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
