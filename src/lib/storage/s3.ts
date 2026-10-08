import "server-only";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { contentDisposition } from "./names";
import type { StorageService } from "./types";

// The S3-compatible adapter (V2 feature 09 §3): the only file that imports the provider's SDK. Used
// with Backblaze B2 in V2; Cloudflare R2, MinIO and AWS S3 work by changing the settings.

export type S3Settings = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

/**
 * The client, built the way the spec requires (§3.4). The two checksum options are not optional:
 * SDK versions from 3.729.0 add a CRC32 checksum header to every upload by default, and Backblaze
 * (and several other S3-compatible services) rejects it, presigned PUTs included. A unit test
 * asserts both, so an upgrade or a refactor cannot quietly remove them.
 */
export function createS3Client(settings: S3Settings): S3Client {
  return new S3Client({
    endpoint: settings.endpoint,
    region: settings.region,
    forcePathStyle: settings.forcePathStyle,
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

const isMissing = (error: unknown) => {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NotFound" || e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404;
};

/**
 * Never calls a bucket-level API (`HeadBucket`, `ListBuckets`): a key restricted to one bucket is
 * refused for them, and some tools run them as a "connection test".
 */
export function createS3Storage(settings: S3Settings, client = createS3Client(settings)) {
  const Bucket = settings.bucket;

  const service: StorageService = {
    async createUploadUrl(key, { mime, expiresIn }) {
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({ Bucket, Key: key, ContentType: mime }),
        // By default the type is not part of the signature. Signing it means the browser must send
        // exactly this `Content-Type` (the file is stored with the confirmed type, not a claimed one).
        { expiresIn, signableHeaders: new Set(["content-type"]) },
      );
      // The browser must send this type unchanged, or the signature check fails.
      return { url, headers: { "Content-Type": mime } };
    },
    async createDownloadUrl(key, { filename, disposition, mime, expiresIn }) {
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket,
          Key: key,
          ResponseContentType: mime,
          ResponseContentDisposition: contentDisposition(filename, disposition),
        }),
        { expiresIn },
      );
    },
    async head(key) {
      try {
        const out = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return {
          size: out.ContentLength ?? 0,
          mime: out.ContentType ?? "application/octet-stream",
        };
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
    async readHead(key, bytes) {
      const out = await client.send(
        new GetObjectCommand({ Bucket, Key: key, Range: `bytes=0-${Math.max(0, bytes - 1)}` }),
      );
      return (await out.Body?.transformToByteArray()) ?? new Uint8Array();
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
  };
  return service;
}
