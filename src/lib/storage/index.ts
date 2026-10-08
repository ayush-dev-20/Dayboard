import "server-only";
import { env } from "@/lib/env";
import { createLocalStorage, diskBlobStore, memoryBlobStore } from "./local";
import { createS3Storage } from "./s3";
import type { StorageService } from "./types";

// The configured storage service, or null when the feature is off (no `STORAGE_DRIVER`). Everything
// else in the app asks for storage here and never names a provider.

let cached: StorageService | null | undefined;

export function getStorage(): StorageService | null {
  if (cached !== undefined) return cached;
  cached = build();
  return cached;
}

function build(): StorageService | null {
  switch (env.storageDriver) {
    case "s3":
      return createS3Storage({
        endpoint: env.STORAGE_ENDPOINT!,
        region: env.STORAGE_REGION!,
        bucket: env.STORAGE_BUCKET!,
        accessKeyId: env.STORAGE_ACCESS_KEY_ID!,
        secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY!,
        forcePathStyle: env.storageForcePathStyle,
      });
    case "memory":
      return createLocalStorage({
        store: memoryBlobStore(),
        secret: env.BETTER_AUTH_SECRET,
        baseUrl: env.NEXT_PUBLIC_APP_URL,
      });
    case "disk":
      return createLocalStorage({
        store: diskBlobStore(env.STORAGE_DISK_DIR ?? ".storage-dev"),
        secret: env.BETTER_AUTH_SECRET,
        baseUrl: env.NEXT_PUBLIC_APP_URL,
      });
    default:
      return null;
  }
}

/** The store behind the local drivers, for the in-app object route. Null for `s3` or no storage. */
export function getLocalStore() {
  if (env.storageDriver === "memory") return memoryBlobStore();
  if (env.storageDriver === "disk") return diskBlobStore(env.STORAGE_DISK_DIR ?? ".storage-dev");
  return null;
}
