# 0010. Object storage (S3-compatible, Backblaze B2) and the file type policy

**Status:** Accepted
**Date:** 2026-10-08
**Phase:** V2

## Context

V2 feature 09 (`specs/v2/features/09-files-attachments-and-bookmarks.md`) adds file attachments on notes, tasks and projects, image and file blocks in the editor, and bookmark cards. Files must be **private**, uploaded **straight from the browser to storage** and downloaded through **short-lived signed URLs**, and the app is deployed on **Vercel** with **Neon** (a serverless function carries only a small response body, has a read-only file system and cannot hold files). The storage provider must be hidden behind an interface (`specs/v2/Agent.md` §6, technical spec §9). The V2 budget is zero: the feature must not be able to cost money.

## Decision

**Provider: Backblaze B2**, reached through its **S3-compatible API** with the AWS SDK for JavaScript v3 (`@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`, pinned to one exact version, 3.729.0 or later). The SDK is used **only** inside `src/lib/storage/s3.ts`; the rest of the app sees a `StorageService` interface. The SDK needs no AWS account: it only speaks the S3 protocol. Because the contract is S3, moving to Cloudflare R2 (free downloads), MinIO or AWS S3 is an environment change plus a copy of the objects with their keys kept.

Why B2: an always-free 10 GB (no trial period), S3-compatible presigned URLs (what the upload and download flow needs), application keys that can be restricted to one bucket, and spending caps that turn "over the free amount" into "paused" instead of a charge. The S3 client is created with `requestChecksumCalculation` and `responseChecksumValidation` both `"WHEN_REQUIRED"`, because the SDK's default CRC32 checksum headers (3.729.0 and later) are rejected by B2, including on presigned PUTs. A unit test asserts both options.

Three adapters behind one interface: `s3` (production), `memory` (tests and E2E; forced when `E2E=true`) and `disk` (local development without a bucket; not usable on Vercel). With no driver configured the feature is **hidden**, not broken.

**File type policy** (the browser's declared type is never trusted; the first bytes are sniffed at finalize):

| Category                                                                    | Types                                | Limit | Delivery                           |
| --------------------------------------------------------------------------- | ------------------------------------ | ----- | ---------------------------------- |
| Images                                                                      | PNG, JPEG, WebP, GIF, AVIF           | 10 MB | inline in image blocks             |
| PDF                                                                         | `application/pdf`                    | 25 MB | inline in a new tab, or download   |
| Text                                                                        | `text/plain`, Markdown, CSV, JSON    | 5 MB  | download                           |
| Office and documents                                                        | DOCX, XLSX, PPTX, ODT, ODS, ODP, RTF | 25 MB | download as attachment, no preview |
| Everything else, including **SVG**, HTML, scripts, executables and archives | not accepted                         | n/a   | `UNSUPPORTED_FILE_TYPE`            |

SVG and HTML are refused because they can carry script. Quotas: 500 MB per person (`STORAGE_QUOTA_MB`) and 9,000 MB in total (`STORAGE_TOTAL_LIMIT_MB`, below B2's free 10 GB). There is no antivirus in V2; a download is never rendered as HTML.

## Alternatives

- **Cloudflare R2.** Free downloads (egress), S3-compatible, the best long-run free option and the **planned fallback** when B2's limited free downloads run out. Not the default because its free tier needs a payment method on file and the Backblaze account does not.
- **Supabase Storage.** S3-compatible and has a free tier, but ties files to a second platform and its auth model, when the app already has Better Auth and its own authorization checks.
- **Vercel Blob.** Easiest on Vercel, but proprietary (no S3 contract to move away from), small free allowance, and a lock-in the spec rules out.
- **Cloudinary.** Image-focused, caps raw files at 10 MB on its free plan and is not S3-compatible; it would not cover PDFs and documents.
- **Streaming files through the app.** Rejected: a Vercel function can carry only about 4.5 MB of body and the transfer would count against Vercel's own allowance.

## Consequences

- Download delivery is a redirect to a 60-second signed URL, so file response headers come from B2, not from Dayboard. Safety rests on what is stored (allowed types only, type confirmed by sniffing, SVG and HTML refused, the object stored with the confirmed `Content-Type`) and on serving files from another origin. `nosniff` on our redirect does not apply to the file.
- B2's free downloads are limited, so each image view counts. The redirect carries `Cache-Control: private, max-age=45` (the spec said 300, but a signed URL lives 60 seconds, so a longer cache would hand the browser a dead address); thumbnails are out of scope. If downloads outgrow the free amount, switch to R2.
- B2 keeps every version of a file unless the bucket lifecycle is "keep only the last version", so that setting is part of the account setup. Freed space shows up after about a day.
- The app never calls bucket-level APIs (`HeadBucket`, `ListBuckets`): a bucket-restricted key is refused for them.
- Size is enforced at finalize, not by the URL (a presigned PUT cannot limit size); an oversized object is rejected and deleted.
- The `memory` and `disk` drivers presign URLs that point at an in-app route, so CI and local development exercise the same intent, upload, finalize and download flow with no bucket.
- Cleanup of abandoned uploads and of soft-deleted files is a background job in the spec (feature 08). That feature does not exist yet, so the cleanup functions are written to be registered as job handlers later and, meanwhile, run opportunistically for the signed-in person.
