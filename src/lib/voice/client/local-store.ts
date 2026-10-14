import Dexie, { type Table } from "dexie";
import { localDbName } from "@/lib/local/user-key";

// Recordings that have not reached the server yet (V2 feature 13 §2, "Local (Dexie)"). Its own
// database, not the offline task database of feature 04: the two have their own versions and their own
// wiping rules, and a recording is audio, which is more private than a task. The name is a hash of the
// user id, so another person on the same browser opens another database. A recording is deleted as
// soon as it is uploaded.

export type LocalRecording = {
  /** The id the server will know it by (UUIDv7), made on this device. */
  id: string;
  blob: Blob;
  mimeType: string;
  sizeBytes: number;
  durationMs: number;
  createdAt: number;
  attempts: number;
  lastError: string | null;
};

class VoiceDatabase extends Dexie {
  voiceBlobs!: Table<LocalRecording, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({ voiceBlobs: "id, createdAt" });
  }
}

const opened = new Map<string, VoiceDatabase>();

async function open(userId: string): Promise<VoiceDatabase> {
  const name = (await localDbName(userId)).replace("dayboard-local-", "dayboard-voice-");
  let db = opened.get(name);
  if (!db) {
    db = new VoiceDatabase(name);
    opened.set(name, db);
  }
  if (!db.isOpen()) await db.open();
  return db;
}

/** Saves a recording on this device. Throws if the browser refuses storage, so the caller can say so. */
export async function saveRecording(userId: string, recording: LocalRecording): Promise<void> {
  await (await open(userId)).voiceBlobs.put(recording);
}

export async function listRecordings(userId: string): Promise<LocalRecording[]> {
  try {
    return await (await open(userId)).voiceBlobs.orderBy("createdAt").toArray();
  } catch {
    return [];
  }
}

export async function countRecordings(userId: string): Promise<number> {
  try {
    return await (await open(userId)).voiceBlobs.count();
  } catch {
    return 0;
  }
}

export async function deleteRecording(userId: string, id: string): Promise<void> {
  try {
    await (await open(userId)).voiceBlobs.delete(id);
  } catch {
    // Nothing stored, or storage is unavailable: nothing to delete.
  }
}

export async function noteAttempt(userId: string, id: string, error: string): Promise<void> {
  try {
    await (
      await open(userId)
    ).voiceBlobs
      .where("id")
      .equals(id)
      .modify((r) => {
        r.attempts += 1;
        r.lastError = error;
      });
  } catch {
    // Not worth failing for.
  }
}

/** Deletes every recording on this device for this person (sign-out). */
export async function wipeRecordings(userId: string): Promise<void> {
  try {
    const name = (await localDbName(userId)).replace("dayboard-local-", "dayboard-voice-");
    const db = opened.get(name);
    if (db) {
      db.close();
      opened.delete(name);
    }
    await Dexie.delete(name);
  } catch {
    // Storage unavailable: nothing was stored.
  }
}
