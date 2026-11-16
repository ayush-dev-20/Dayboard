import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { Server, type Document } from "@hocuspocus/server";
import * as Y from "yjs";
import { verifyCollabToken } from "@/lib/collab/token";
import { logger } from "@/lib/logger";
import { uuidv7 } from "@/lib/ids";
import { can, resolveAccess } from "@/modules/permissions/access";
import { MAX_DOC_BYTES, loadLiveDoc, retireIfNoEditors, storeLiveDoc, takeSnapshot } from "./docs";

// The collaboration service (V3 feature 05 §3, docs/decisions/0019): Hocuspocus, one document per note, named by the note
// id. The app signs a 60-second token; the service verifies it, re-checks access against the database on connect and every
// minute, and keeps `notes` current by projecting the document. No text reaches a log, only ids and sizes.

export type CollabOptions = {
  port: number;
  tokenSecret: string;
  internalSecret: string;
  /** Quiet period and longest wait before a projection (2 s and 10 s in the spec). */
  debounceMs?: number;
  maxDebounceMs?: number;
  /** How often access is re-checked for every open connection (60 s). */
  recheckMs?: number;
  /** Interval snapshots while a note is being edited (10 minutes). */
  snapshotEveryMs?: number;
  limits?: Partial<typeof DEFAULT_LIMITS>;
};

export const DEFAULT_LIMITS = {
  connectionsPerNote: 20,
  connectionsPerUser: 20,
  updateBytes: 1024 * 1024,
  docBytes: MAX_DOC_BYTES,
  messagesPerSecond: 50,
};

type Context = { userId: string; role: "edit" | "read"; session: string };

function sameSecret(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > 64 * 1024) throw new Error("too large");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}

export function createCollabServer(options: CollabOptions) {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const owners = new Map<string, string>();
  const lastSnapshot = new Map<string, number>();
  const rates = new Map<string, { windowStart: number; count: number }>();

  async function accessFor(userId: string, noteId: string): Promise<"edit" | "read" | null> {
    const access = await resolveAccess(userId, "NOTE", noteId, { enabled: true });
    if (access.role === null) return null;
    return can(access, "NOTE", "update") ? "edit" : can(access, "NOTE", "read") ? "read" : null;
  }

  /** Re-checks every open connection (or those of one note): drops the ones that lost access, downgrades the others. */
  async function recheck(instance: { documents: Map<string, Document> }, noteIds?: string[]) {
    for (const [name, document] of instance.documents) {
      if (noteIds && !noteIds.includes(name)) continue;
      for (const connection of [...document.connections.keys()]) {
        const context = connection.context as Context | undefined;
        if (!context) continue;
        const role = await accessFor(context.userId, name).catch(() => null);
        if (role === null) {
          connection.webSocket.close(4403, "access ended");
        } else if (role === "read" && !connection.readOnly) {
          connection.readOnly = true;
        }
      }
    }
  }

  const server = new Server({
    port: options.port,
    quiet: true,
    debounce: options.debounceMs ?? 2000,
    maxDebounce: options.maxDebounceMs ?? 10_000,
    // Wait for the debounce before unloading, so a refresh does not reload the document from the database every time.
    unloadImmediately: false,
    extensions: [
      {
        async onAuthenticate({ token, documentName, connectionConfig, instance }) {
          const claims = verifyCollabToken(token, options.tokenSecret, { noteId: documentName });
          if (!claims) throw new Error("denied");
          // The database decides, not the token: access may have ended in the last minute.
          const role = await accessFor(claims.userId, documentName);
          if (role === null) throw new Error("denied");

          const document = instance.documents.get(documentName);
          if ((document?.connections.size ?? 0) >= limits.connectionsPerNote)
            throw new Error("full");
          let mine = 0;
          for (const doc of instance.documents.values())
            for (const connection of doc.connections.keys())
              if ((connection.context as Context | undefined)?.userId === claims.userId) mine++;
          if (mine >= limits.connectionsPerUser) throw new Error("full");

          const effective = claims.role === "edit" && role === "edit" ? "edit" : "read";
          connectionConfig.readOnly = effective === "read";
          return { userId: claims.userId, role: effective, session: uuidv7() } satisfies Context;
        },

        async onLoadDocument({ documentName }) {
          const loaded = await loadLiveDoc(documentName);
          if (!loaded) throw new Error("gone");
          owners.set(documentName, loaded.ownerId);
          return loaded.ydoc;
        },

        async beforeHandleMessage({ update, connection, socketId }) {
          const now = Date.now();
          const rate = rates.get(socketId);
          if (!rate || now - rate.windowStart >= 1000)
            rates.set(socketId, { windowStart: now, count: 1 });
          else if (++rate.count > limits.messagesPerSecond) {
            connection.webSocket.close(4429, "too fast");
            throw new Error("too fast");
          }
          if (update.byteLength > limits.updateBytes) {
            connection.webSocket.close(4413, "too large");
            throw new Error("too large");
          }
        },

        async onChange({ document, documentName }) {
          // Over the size cap the note turns read-only for everyone (they are told in the editor).
          if (Y.encodeStateAsUpdate(document).byteLength > limits.docBytes)
            for (const connection of document.connections.keys()) connection.readOnly = true;
          void documentName;
        },

        async onStoreDocument({ document, documentName, lastContext }) {
          const context = lastContext as Context | undefined;
          await storeLiveDoc(documentName, document, context?.userId ?? null);
          const last = lastSnapshot.get(documentName) ?? 0;
          if (Date.now() - last >= (options.snapshotEveryMs ?? 10 * 60 * 1000)) {
            lastSnapshot.set(documentName, Date.now());
            await takeSnapshot(documentName, document, "INTERVAL", context?.userId ?? null);
          }
        },

        async onDisconnect({ clientsCount, document, documentName, context, socketId }) {
          rates.delete(socketId);
          if (clientsCount > 0) return;
          await retireIfNoEditors(
            documentName,
            document,
            (context as Context | undefined)?.userId ?? null,
          ).catch((error: unknown) =>
            logger.warn("collab retire failed", {
              noteId: documentName,
              error: error instanceof Error ? error.name : "unknown",
            }),
          );
        },

        async afterUnloadDocument({ documentName }) {
          owners.delete(documentName);
          lastSnapshot.delete(documentName);
        },

        // The internal endpoints, for the app only: a health check, and "check access now" after a share changes.
        async onRequest({ request, response, instance }) {
          const url = new URL(request.url ?? "/", "http://internal");
          const send = (status: number, body: unknown) => {
            response.writeHead(status, { "Content-Type": "application/json" });
            response.end(JSON.stringify(body));
          };
          if (url.pathname === "/health") {
            send(200, {
              ok: true,
              documents: instance.getDocumentsCount(),
              connections: instance.getConnectionsCount(),
            });
            throw null;
          }
          if (url.pathname === "/internal/recheck" && request.method === "POST") {
            if (
              !sameSecret(
                request.headers["x-collab-secret"] as string | undefined,
                options.internalSecret,
              )
            ) {
              send(403, { error: "forbidden" });
              throw null;
            }
            const body = (await readBody(request)) as { noteIds?: unknown };
            const noteIds = Array.isArray(body.noteIds)
              ? body.noteIds.filter((id): id is string => typeof id === "string")
              : undefined;
            await recheck(instance, noteIds);
            send(200, { ok: true });
            throw null;
          }
        },
      },
    ],
  });

  let timer: ReturnType<typeof setInterval> | null = null;

  return {
    server,
    async start() {
      await server.listen();
      timer = setInterval(() => {
        void recheck(server.hocuspocus).catch((error: unknown) =>
          logger.warn("collab recheck failed", {
            error: error instanceof Error ? error.name : "unknown",
          }),
        );
      }, options.recheckMs ?? 60_000);
      timer.unref();
      return server;
    },
    recheck: (noteIds?: string[]) => recheck(server.hocuspocus, noteIds),
    async stop() {
      if (timer) clearInterval(timer);
      server.hocuspocus.flushPendingStores();
      await server.destroy();
    },
  };
}
