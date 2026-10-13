import { uuidv7 } from "@/lib/ids";
import type { SnapshotPreferences } from "@/lib/sync/snapshot";
import { bootstrapTasks, readPreferences, storePreferences } from "./bootstrap";
import type { CommandContext } from "./commands/tasks";
import { openLocalDatabase, type LocalDatabase } from "./db";
import { fetchPreferencesPage, fetchTaskPage } from "./api";
import { replayPending, type ReplayResult, type TaskActions } from "./replay";

// One person's offline workspace on this device: the database, the device's id, the preferences the
// commands need, and the bootstrap and replay steps (V2 feature 04). The UI reaches the data only
// through this module and the commands it returns.

export type Workspace = {
  db: LocalDatabase;
  /** Context for the commands in `commands/tasks.ts`. */
  commands(): Promise<CommandContext>;
  /** Pulls preferences and every task page, then drops what the server no longer has. */
  bootstrap(): Promise<number>;
  /** Sends what is waiting, in order. */
  replay(actions: TaskActions): Promise<ReplayResult>;
};

async function deviceIdOf(db: LocalDatabase): Promise<string> {
  const row = await db.meta.get("deviceId");
  if (typeof row?.value === "string") return row.value;
  const id = uuidv7();
  await db.meta.put({ key: "deviceId", value: id });
  return id;
}

export async function openWorkspace(userId: string): Promise<Workspace> {
  const db = await openLocalDatabase(userId);
  const deviceId = await deviceIdOf(db);

  return {
    db,
    async commands() {
      const prefs: SnapshotPreferences | null = await readPreferences(db);
      return {
        db,
        deviceId,
        defaultPriority: prefs?.defaultTaskPriority ?? "NONE",
      };
    },
    async bootstrap() {
      await storePreferences(db, await fetchPreferencesPage());
      return bootstrapTasks(db, fetchTaskPage);
    },
    replay(actions) {
      return replayPending(db, actions);
    },
  };
}
