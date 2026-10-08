import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { KEY_PATTERN } from "./keys";
import { signToken } from "./tokens";
import type { StorageService } from "./types";

// The `memory` and `disk` drivers (V2 feature 09 §3): one StorageService over a small blob store.
// Their presigned URLs point at `/api/storage/object` in this app, which checks the signed token and
// then reads or writes the same store. `memory` is for tests; `disk` is for local development. Neither
// is usable on a serverless host (the file system is read-only and temporary).

export type BlobStore = {
  put(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  get(key: string): Promise<{ bytes: Uint8Array; mime: string } | null>;
  delete(key: string): Promise<void>;
};

type Shared = { __dayboardBlobs?: Map<string, { bytes: Uint8Array; mime: string }> };

/**
 * The map lives on `globalThis`: the upload route and the server code that finalizes are separate
 * bundles in a production build, and a module-level variable would be two different maps.
 */
export function memoryBlobStore(): BlobStore {
  const shared = globalThis as Shared;
  const blobs = (shared.__dayboardBlobs ??= new Map());
  return {
    async put(key, bytes, mime) {
      blobs.set(key, { bytes, mime });
    },
    async get(key) {
      return blobs.get(key) ?? null;
    },
    async delete(key) {
      blobs.delete(key);
    },
  };
}

export function diskBlobStore(directory: string): BlobStore {
  const root = path.resolve(directory);
  // Keys are only ever made by `createStorageKey`; anything else could be a path trick.
  const fileFor = (key: string) => {
    if (!KEY_PATTERN.test(key)) throw new Error("Not a storage key.");
    const file = path.resolve(root, key);
    if (!file.startsWith(root + path.sep)) throw new Error("Not a storage key.");
    return file;
  };
  return {
    async put(key, bytes, mime) {
      const file = fileFor(key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, bytes);
      await writeFile(`${file}.mime`, mime);
    },
    async get(key) {
      const file = fileFor(key);
      try {
        const [bytes, mime] = await Promise.all([readFile(file), readFile(`${file}.mime`, "utf8")]);
        return { bytes: new Uint8Array(bytes), mime };
      } catch {
        return null;
      }
    },
    async delete(key) {
      const file = fileFor(key);
      await rm(file, { force: true });
      await rm(`${file}.mime`, { force: true });
    },
  };
}

export type LocalOptions = {
  store: BlobStore;
  /** The secret the tokens are signed with. */
  secret: string;
  /** This app's origin, for the URLs. */
  baseUrl: string;
  now?: () => number;
};

export function createLocalStorage({ store, secret, baseUrl, now = Date.now }: LocalOptions) {
  const url = (token: string) => `${baseUrl.replace(/\/$/, "")}/api/storage/object?t=${token}`;
  const exp = (seconds: number) => Math.floor(now() / 1000) + seconds;

  const service: StorageService = {
    async createUploadUrl(key, { mime, expiresIn }) {
      return {
        url: url(signToken({ op: "put", key, mime, exp: exp(expiresIn) }, secret)),
        headers: { "Content-Type": mime },
      };
    },
    async createDownloadUrl(key, { filename, disposition, mime, expiresIn }) {
      return url(
        signToken({ op: "get", key, mime, filename, disposition, exp: exp(expiresIn) }, secret),
      );
    },
    async head(key) {
      const blob = await store.get(key);
      return blob ? { size: blob.bytes.length, mime: blob.mime } : null;
    },
    async readHead(key, bytes) {
      const blob = await store.get(key);
      return blob ? blob.bytes.slice(0, bytes) : new Uint8Array();
    },
    async delete(key) {
      await store.delete(key);
    },
  };
  return service;
}
