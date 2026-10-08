# Feature 09 — Files, Attachments & Bookmarks

## 1. Scope

- **Attachments** on notes, tasks and projects: images, PDFs, text files, common office files
- A **storage service interface** with an S3-compatible adapter and test doubles; private objects, **presigned** upload and download. **Backblaze B2** is the V2 storage provider (always-free 10 GB, see §3); the adapter stays provider-neutral so R2 or MinIO is an environment change
- **Upload intent → direct upload → finalize** flow with progress, retry, cancel, size and type validation, a quota
- **Authorized downloads** (every request checked), delete, metadata
- **Image and file blocks** in the editor (notes and task descriptions), paste and drop to upload
- **Bookmark cards**: server-side link previews with strong protection against requests to private addresses; the paste choice menu
- Offline: queue uploads while offline; show placeholders for files not available offline

Reuses: feature 01's block registry, feature 02's paste rule registry, feature 05's operations, feature 08's jobs (verify, purge, cleanup), V1 trash semantics, the rate limiter used for AI routes.

Packages: an S3 client (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`) after ADR 0010, which also fixes the file type policy and **records the provider choice (Backblaze B2) and why**. These are free client libraries and need no AWS account; they talk to B2's S3-compatible endpoint. Pin an exact version, and use one that supports the `requestChecksumCalculation` option (3.729.0 or later; see §3.4). No image-processing dependency in V2.

Source spec sections: product §9, §18.6, §15.6 (copying images), §13; technical §9, §13; project plan Phase 4.

---

## 2. Data model

### `attachments`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | client-generated |
| `user_id` | uuid FK → user, cascade | |
| `owner_type` | enum `NOTE, TASK, PROJECT` | |
| `owner_id` | uuid | the note, task or project; verified to belong to the user |
| `storage_key` | text NOT NULL UNIQUE | see key format below |
| `original_name` | text NOT NULL | ≤ 255 chars, stored for display and download only, never used in the key |
| `mime_type` | text NOT NULL | declared, then confirmed by sniffing |
| `size_bytes` | bigint NOT NULL | declared, then confirmed from the object |
| `sha256` | text NULL | optional integrity check |
| `width`, `height` | integer NULL | images, from the browser at upload time |
| `status` | enum `PENDING, READY, REJECTED, DELETED` | |
| `created_at`, `finalized_at`, `deleted_at` | timestamptz | `deleted_at` = soft delete with 30-day retention |

Indexes: `(user_id, owner_type, owner_id, deleted_at)`, `(user_id, status, created_at)`.

**Object key:** `u/{userId}/{note|task|project}/{ownerId}/{yyyy}/{mm}/{attachmentId}/{128-bit random hex}` (the owner kind and id were added to the path on 2026-10-09 so the bucket reads by where a file belongs; the database row, not the key, decides ownership; keys made before that, without the owner part, stay valid). The file name never appears in the key; keys are unguessable and unique per upload; one prefix per user so a bad policy cannot cross users by accident.

### `link_previews`

| Column | Notes |
|---|---|
| `id`, `user_id` | per user (no cross-user cache, so one person's fetch cannot hint at another's) |
| `url_hash`, `url` | normalised URL (lower-cased host, no fragment, tracking params kept) |
| `title`, `description`, `site_name` | text, length-capped (200 / 400 / 100) |
| `favicon_data_uri` | text NULL, ≤ 8 KB, fetched server-side (the browser never loads a third-party icon) |
| `status` | `OK \| FAILED \| BLOCKED` |
| `fetched_at`, `expires_at` | 7 days |

Unique `(user_id, url_hash)`.

### Editor nodes (feature 01 infrastructure)

| Node | Attributes |
|---|---|
| `image` (block) | `attachmentId`, `caption`, `width` (optional percentage) |
| `file` (block) | `attachmentId` |
| `bookmark` (block) | `url`, `title`, `description`, `siteName`, `favicon` (data URI), `fetchedAt` |

`bookmark` stores a **snapshot** of the preview inside the document so it renders offline and never changes unexpectedly; **Refresh** from its menu fetches again and updates the attrs. `sanitizeDoc` allows these nodes: `attachmentId` must be a UUID; `url` must be `http(s)`; `favicon` must be a `data:image/` URI under 8 KB.

---

## 3. Storage service

`src/lib/storage/` — one interface, the only place provider SDKs are imported:

```ts
interface StorageService {
  createUploadUrl(key: string, opts: { mime: string; size: number; expiresIn: number }): Promise<{ url: string; headers: Record<string,string> }>;
  createDownloadUrl(key: string, opts: { filename: string; disposition: "inline" | "attachment"; mime: string; expiresIn: number }): Promise<string>;
  head(key: string): Promise<{ size: number; mime: string } | null>;
  readHead(key: string, bytes: number): Promise<Uint8Array>;   // for type sniffing
  delete(key: string): Promise<void>;
}
```

Adapters:

- **`s3`**: any S3-compatible service, used with **Backblaze B2** in V2 (also works with Cloudflare R2, MinIO and AWS S3 by changing the environment values).
- **`memory`**: tests and E2E; presigned URLs point at an in-process route.
- **`disk`**: local development without a bucket. **Not usable on Vercel** (its file system is read-only and temporary), so production always uses `s3`.

`STORAGE_DRIVER=s3|memory|disk`. Storage is **private**: no public bucket; CORS on the bucket allows only the app origin (§3.5). With no storage configured, the Attachments UI and file/image blocks are hidden and the rest of the app works. `E2E=true` forces `memory`, as it does for AI and email, so tests never reach a real bucket.

### 3.1 Why Backblaze B2

| | |
|---|---|
| **Free** | 10 GB of storage, free forever (no trial period). Free downloads are limited (reported as about 1 GB a day, or up to 3 times the stored amount; sources differ, so read the numbers on the B2 pricing page when signing up). Beyond the free parts it is pay as you go (about $6.95 per TB a month for storage). |
| **Fits this design** | S3-compatible API with **presigned URLs**, which is what the intent, upload and download flow uses |
| **Does not need** | An AWS account. This feature does not use AWS, S3 pricing or the AWS free tier |
| **Not supported by B2's S3 API** | ACLs, IAM roles, object tagging, website configuration, and **browser uploads using POST policies**. Dayboard uses a presigned **PUT**, so none of these matter. Do not add features that need them |

These limits come from the provider's pages and third-party summaries and can change. Re-check them when you create the account, and record what you saw in the as-built doc.

### 3.2 One-time account setup (before the first deploy)

1. **Create a Backblaze account** and open B2 Cloud Storage. Choose the region closest to your users; it cannot be changed later.
2. **Create a bucket.** Name it for the app (bucket names are global, so add a suffix, e.g. `dayboard-files-<random>`). Settings:
   - **Files in bucket are:** **Private**.
   - **Default encryption:** enable **SSE-B2** (free, one switch).
   - **Object lock:** off.
   - **Lifecycle:** **Keep only the last version of the file.** B2 keeps every version of a file by default, and a delete through the S3 API only adds a delete marker, so without this the data stays and still counts against the 10 GB. With this setting B2 removes hidden versions on its own (it runs about once a day, so freed space shows up after a delay).
3. **Note the endpoint and region** shown on the bucket page. The endpoint looks like `https://s3.<region>.backblazeb2.com` (for example `https://s3.us-west-004.backblazeb2.com`); the region is the middle part (`us-west-004`).
4. **Create an Application Key**, not the master key:
   - **Restrict it to this one bucket.**
   - **Allow:** read files, write files, delete files. List files is optional (Dayboard keeps its own list in PostgreSQL and does not need it).
   - **Do not** give it permission to list or manage buckets.
   - Copy the **keyID** and the **applicationKey** immediately; B2 shows the secret once.
5. **Apply the CORS rule** in §3.5.
6. **Set spending caps** in the account's Caps and Alerts page: a **$0 daily cap** for storage, downloads and transactions means B2 stops serving rather than billing you. This is the real guarantee that the feature never costs money. Alerts at 75% are a useful early warning. (Confirm the page and wording in the B2 console; they are not checked here.)
7. **Add the environment values** (§3.3) to the local `.env.local` and to the Vercel project.
8. Run the **smoke test** (§3.9) once. Do not ship before it passes.

Because the key is limited to one bucket, a leaked key can only reach Dayboard's files. The master key is never put in the app or in Vercel.

### 3.3 Environment variables

| Variable | Required | Value for B2 |
|---|---|---|
| `STORAGE_DRIVER` | no | `s3` in production. Empty means the feature is hidden |
| `STORAGE_ENDPOINT` | with `s3` | `https://s3.<region>.backblazeb2.com` |
| `STORAGE_REGION` | with `s3` | the region part of the endpoint, e.g. `us-west-004` |
| `STORAGE_BUCKET` | with `s3` | the bucket name |
| `STORAGE_ACCESS_KEY_ID` | with `s3` | the application **keyID** |
| `STORAGE_SECRET_ACCESS_KEY` | with `s3` | the **applicationKey** (server only, never `NEXT_PUBLIC_`) |
| `STORAGE_FORCE_PATH_STYLE` | no | default `false`. Set `true` if the SDK reports a host or certificate error for the bucket address. B2 supports both styles; confirm which works in the smoke test and record it |
| `STORAGE_QUOTA_MB` | no | per person, default `500` (§5) |
| `STORAGE_TOTAL_LIMIT_MB` | no | all people together, default `9000` (§3.8) |

Validation lives in `src/lib/env-schema.ts`, like the other optional services: with `STORAGE_DRIVER=s3` all five connection values are required; in production an unset driver means the feature is off, not a crash; `E2E=true` forces `memory`. Add these names, with empty values and comments, to `.env.example`. Add `STORAGE_SECRET_ACCESS_KEY` and `STORAGE_ACCESS_KEY_ID` to the patterns searched by `scripts/check-client-bundle.mjs`.

### 3.4 The S3 client (the one trap that breaks uploads)

Newer AWS SDK versions (3.729.0 and later) add a CRC32 checksum header to uploads by default. Backblaze does not accept those headers and rejects the request, including presigned PUTs. The client **must** be created like this, for every provider:

```ts
import { S3Client } from "@aws-sdk/client-s3";

const client = new S3Client({
  endpoint: env.STORAGE_ENDPOINT,            // https://s3.<region>.backblazeb2.com
  region: env.STORAGE_REGION,                // e.g. us-west-004
  forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
  },
  // B2 (and several other S3-compatible services) do not support the SDK's default checksums.
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});
```

A unit test asserts both options are set (§10), so an SDK upgrade or a refactor cannot quietly remove them.

How each interface method maps to B2:

| Method | S3 call | Notes |
|---|---|---|
| `createUploadUrl` | `getSignedUrl(client, new PutObjectCommand({ Bucket, Key, ContentType }), { expiresIn })` | Returns `headers: { "Content-Type": mime }`. The browser **must** send the same `Content-Type` or the signature fails. Expiry 5 minutes |
| `createDownloadUrl` | `getSignedUrl` with `GetObjectCommand` and `ResponseContentDisposition`, `ResponseContentType` | Expiry 60 seconds. **Check in the smoke test** that the response really carries the requested `Content-Disposition` and `Content-Type`. If B2 ignores them, fall back to storing `Content-Disposition` and `Content-Type` on the object at upload time (the file name is known at intent time, so it can be signed into the upload headers) |
| `head` | `HeadObjectCommand` | Returns size and stored type, or `null` for a missing key |
| `readHead` | `GetObjectCommand` with `Range: bytes=0-<n>` | For type sniffing. Confirm ranged reads in the smoke test |
| `delete` | `DeleteObjectCommand` | With the lifecycle setting in §3.2, the stored data is removed within about a day |

**Never call** `HeadBucket`, `ListBuckets` or any bucket-level API: a bucket-restricted key is refused for those, and some tools run them as a "connection test".

### 3.5 CORS

The browser uploads straight to Backblaze, so the bucket must allow the app's origin. Without a rule, uploads fail in the browser with a CORS error even though the URL is valid.

```json
[
  {
    "corsRuleName": "dayboard-browser-access",
    "allowedOrigins": ["https://<your-production-domain>", "http://localhost:3000"],
    "allowedOperations": ["s3_put", "s3_get", "s3_head"],
    "allowedHeaders": ["content-type", "x-amz-*"],
    "exposeHeaders": ["etag"],
    "maxAgeSeconds": 3600
  }
]
```

- Rule names are 6 to 63 characters of letters, numbers and hyphens, and must not start with `b2-`. `maxAgeSeconds` is at most 86,400.
- List **exact origins only**, never `*`. Add the Vercel preview domain only if you test uploads on previews.
- Apply it with the B2 command-line tool (`b2 bucket update --cors-rules '<json>' <bucket>`) or the bucket's CORS settings in the B2 console. Command names and screens change, so check Backblaze's current docs when you do it.
- If the app later sets a Content Security Policy, allow `https://*.backblazeb2.com` for `img-src`, `connect-src` and `frame-src` (PDF viewing).
- The smoke test (§3.9) sends a real preflight request and fails if the rule is wrong.

### 3.6 Behaviours to design around

- **Delivery goes browser to B2.** `GET /api/files/{id}` checks the session and then redirects (302) to a 60-second presigned URL, so files never pass through Vercel. This matters on Vercel because a serverless function can only carry a small response body (about 4.5 MB), and streaming files through it would use Vercel's own transfer allowance too.
- **Response headers come from B2, not from Dayboard.** The `X-Content-Type-Options: nosniff` header on our redirect does **not** apply to the file that follows it. Safety therefore rests on what is stored: only allowed types are accepted, the type is confirmed by sniffing at finalize, SVG and HTML are refused, and the object is stored with the confirmed `Content-Type`. Files are served from a different origin than the app, which also keeps a PDF from touching the app's cookies. Whether B2 adds `nosniff` itself is not confirmed; do not rely on it.
- **Size is enforced at finalize, not by the URL.** The presigned PUT does not stop an oversized upload by itself. `finalize` compares the real size to the declared and allowed size, and an oversized object is `REJECTED` and deleted. The `PENDING` cleanup job removes anything that never finalized.
- **Egress is the scarce free resource.** Each image view and download counts against B2's free daily download amount. The redirect response carries `Cache-Control: private, max-age=300` so the browser reuses recently seen files; thumbnails are out of scope in V2 (§12). If downloads grow past the free amount, the options are R2 (free downloads) or a small paid B2 plan.
- **Counters:** B2 groups S3 calls into transaction classes with free daily amounts; a download or `head` is a read call and counts toward that day's free reads. Heavy use costs fractions of a cent, and the $0 cap in §3.2 turns "over the free amount" into "pauses" instead of a charge.
- **Keys rotate without downtime:** create a new application key, update the environment values, redeploy, then delete the old key.

### 3.7 Deploying on Vercel

- Add the `STORAGE_*` values under the Vercel project's environment variables for **Production** (and Preview only if previews should upload). Mark the secret as sensitive.
- No Vercel storage product is involved; B2 is reached over HTTPS from the functions and from the browser.
- The upload intent and finalize routes are short, authenticated JSON calls and fit easily in a function. The file bytes never pass through them.
- After the first production deploy, run the smoke test once against the production bucket with production-like values, and upload a real file from the deployed site.

### 3.8 Keeping the free tier free

1. **Per-person quota** (`STORAGE_QUOTA_MB`, default 500, §5).
2. **Global limit** (`STORAGE_TOTAL_LIMIT_MB`, default 9000): at intent time the server also sums the bytes of all `READY` and `PENDING` attachments. If adding the new file would pass the limit, the intent fails with `STORAGE_FULL` and the UI says "Uploads are paused because storage is full." and nothing is written. This keeps total storage under B2's free 10 GB with a margin, even if many accounts exist. The sum is one indexed aggregate query.
3. **Provider caps** at $0 (§3.2 step 6), as the last safety net.
4. **Cleanup jobs** (§8) keep abandoned uploads and deleted files from using space.
5. The Settings page shows the person's usage against their quota; operators see total usage in the B2 console.

### 3.9 Smoke test (run by hand, not in CI)

`scripts/storage-smoke.ts`, run as `pnpm storage:smoke`. It reads the real `STORAGE_*` values and never runs in CI (no secrets there). It must pass before the first production deploy and after any change of key, bucket, SDK version or CORS rule. Steps, each printing pass or fail with the reason:

1. Build the client exactly as the app does and check the checksum options are set.
2. Create an upload URL and send a **CORS preflight** (`OPTIONS` with `Origin`, `Access-Control-Request-Method: PUT`, `Access-Control-Request-Headers: content-type`) from the configured origin; expect the allow headers back.
3. Upload a small test file with a plain `fetch` PUT using the returned headers.
4. `head` it: size and content type match.
5. `readHead`: a ranged read returns exactly the requested bytes.
6. Download through a presigned URL and check `Content-Disposition` and `Content-Type` (see §3.4 fallback if they are ignored).
7. Upload again with a **wrong** `Content-Type` and confirm the signature check rejects it.
8. Delete it, then `head` returns `null` (or the delete marker behaviour is noted).
9. Print the effective settings that mattered (path style, region) so they can go in the as-built doc.

### 3.10 Switching provider later

Because the S3 API is the contract, moving to Cloudflare R2 (free downloads) or MinIO means new `STORAGE_ENDPOINT`, `STORAGE_REGION` (R2 uses `auto`), bucket and keys, a CORS rule on the new bucket, and a copy of existing objects (for example with `rclone`) **keeping the same keys**, since `attachments.storage_key` stores them. No code change should be needed. Run the smoke test against the new provider first.

---

## 4. Server contract

Route handlers under `src/app/api/files/` (technical spec §9). All start with `requireUser()`.

| Route | Purpose |
|---|---|
| `POST /api/files/intent` | `{ id, ownerType, ownerId, name, mime, size, width?, height? }` → validates, inserts a `PENDING` row, returns `{ attachmentId, upload: { url, headers }, expiresAt }`. Checks: owner belongs to the user; size ≤ limit; mime allowed; user quota; **global storage limit (§3.8, `STORAGE_FULL`)**; per-minute rate limit (30). The upload URL is a presigned PUT that expires in 5 minutes and signs the `Content-Type`; the response's `headers` must be sent unchanged by the browser. |
| `POST /api/files/finalize` | `{ id }` → `head` the object; compares size; reads the first bytes and **sniffs** the type; sets `READY` or `REJECTED` (and deletes the object). Idempotent. |
| `GET /api/files/{id}` | Authorizes the session user as owner (else `NOT_FOUND`), then **302** to a short-lived (60 s) presigned download URL with `Content-Disposition` and the confirmed `Content-Type`. `Cache-Control: private, max-age=300` on the redirect only. |
| `DELETE /api/files/{id}` | Soft delete (`DELETED`, `deleted_at`); a `attachment.purge` job removes the object after 30 days. |
| `GET /api/files?ownerType=&ownerId=` | Metadata list (name, size, mime, created, dimensions). |
| `POST /api/link-preview` | `{ url }` → server-side fetch (§7) → `{ title, description, siteName, favicon }`. Rate limit 30 per minute per user. |

Operations for offline use: `attachment.create` (metadata with a client id; the blob follows when online) and `attachment.delete`.

---

## 5. File policy (ADR 0010)

| Category | Types | Limit | Delivery |
|---|---|---|---|
| Images | PNG, JPEG, WebP, GIF, AVIF | 10 MB | shown inline in image blocks (`<img src="/api/files/{id}">`), `X-Content-Type-Options: nosniff` |
| PDF | `application/pdf` | 25 MB | opens inline in a new tab, or downloads |
| Text | `text/plain`, Markdown, CSV, JSON | 5 MB | download |
| Office and documents | DOCX, XLSX, PPTX, ODT, ODS, ODP, RTF | 25 MB | download as attachment, metadata only (no preview) |
| Everything else, **SVG**, HTML, scripts, executables, archives | not accepted in V2 | — | `UNSUPPORTED_FILE_TYPE` (SVG can carry script) |

- The browser's declared type is **not trusted**: after upload, `readHead` checks the file signature against the declared category; a mismatch is `REJECTED`.
- **Quota:** 500 MB per user (`STORAGE_QUOTA_MB`), checked at intent time against `READY` + `PENDING` bytes; over quota → `QUOTA_EXCEEDED` with the usage shown in Settings. A second, global check (`STORAGE_TOTAL_LIMIT_MB`, §3.8) protects the provider's free tier: over it → `STORAGE_FULL`, shown as "Uploads are paused because storage is full." The per-person default (500 MB) is a default, not a promise: 10 GB of free storage is about 20 people at full quota, so lower `STORAGE_QUOTA_MB` if many accounts are expected.
- Names are sanitised for display and for the download header; control characters removed; no path separators.
- No antivirus in V2. State this in the as-built doc; downloads are never rendered as HTML.

---

## 6. UI

### Attachments section

On notes, task details and project pages: an **Attachments** section (a hairline list, not cards) with an **Attach files** button and a drop zone. Each row: icon by category, name, size, date, a menu (Download, Delete). Images show a small thumbnail. Empty state: "No attachments."

### Upload experience

- Multiple files at once; each row shows a **progress bar** (XHR upload progress), **Cancel**, and on failure **Retry** (resumes the intent with the same id); validation errors appear in the row ("Too large: max 10 MB", "This file type isn't supported").
- **Offline:** the file is stored as a Blob in Dexie with its intent metadata; the row says "Waiting to upload"; it uploads when online (05's trigger). The attachment appears in the local list immediately; others see it after upload.
- Large files do not pass through the web server (direct to storage).

### Editor blocks

- **`/image`** and **`/file`** (registry items, notes and task descriptions) open the file picker. **Paste or drop** of image files (paste rule from 02; drop handler) uploads and inserts an image block at the cursor; multiple files insert in order.
- **Image block:** the picture with an optional caption (editable), max width of the column, click opens a viewer (lightbox with keyboard close); alt text from the caption or file name. While uploading it shows a placeholder with progress; if the upload fails it shows "Couldn't upload. Retry".
- **File block:** a row with icon, name, size and a download button.
- **Removed or unavailable:** if the attachment is deleted or not downloadable, the block shows "File removed" or "Not available offline" (muted), never a broken image.
- **Gallery view** (06) shows a cover image from the first image block when present.

### Bookmark cards

- **Paste choice (paste rule from 02):** pasting a lone `http(s)` address onto an empty line shows a small popover: **Keep as link** (default, Enter), **Link with page title**, **Bookmark card**. Dismissing keeps the plain link. Pasting over selected text still just makes a link.
- `/bookmark` asks for an address and inserts a card.
- **Card:** title, short description, site name and favicon, opens in a new tab (`rel="noopener noreferrer"`); menu: Refresh, Convert to link, Remove. If the fetch fails or the address is blocked, the card becomes a plain link with the address as text and a quiet note "Couldn't load a preview."
- **Link with page title** fetches only the title and sets it as the link text.

---

## 7. Link preview fetching (SSRF protection)

`src/lib/net/safe-fetch.ts`, used only by the preview endpoint. Requirements, each with a unit test:

- Only `http` and `https`, ports 80 and 443 only; no credentials in the URL.
- **Resolve DNS first** and reject any address that is loopback, private (RFC 1918), link-local (including the cloud metadata address `169.254.169.254`), carrier-grade NAT, multicast, unspecified, unique-local or link-local IPv6, or an IPv4-mapped form of those. **Connect to the resolved address** (pin the IP) so DNS cannot change between check and use.
- Follow at most 3 redirects, **re-validating every hop** (scheme, host, resolved address).
- Timeout 5 s total; read at most 512 KB of body; accept only `text/html` and `application/xhtml+xml` (and `image/*` for the favicon, ≤ 8 KB).
- No cookies, no `Authorization`, a fixed `User-Agent: DayboardLinkPreview/1.0`; `Accept-Language` not forwarded.
- Parse only `<title>`, `og:title`, `og:description`, `og:site_name`, `<link rel="icon">` with a bounded, non-executing scanner of the document head (no DOM execution, no script, no resource loading).
- Cache per user for 7 days; refresh on demand (rate-limited).
- Failures return `status: FAILED` or `BLOCKED` without leaking why (the blocked reason is logged, not shown).

---

## 8. Jobs (feature 08)

| Type | When | Purpose |
|---|---|---|
| `attachment.verify` | after finalize if a deeper check is needed | re-sniff and set status (kept for later checks; V2 does the first-bytes check inline) |
| `attachment.purge` | daily | delete objects of attachments soft-deleted more than 30 days ago and permanently deleted notes/tasks/projects' attachments |
| `attachment.cleanup_pending` | hourly | delete `PENDING` attachments older than 24 h and their objects |
| `link_preview.prune` | daily | delete expired previews |

Deleting a note, task or project soft-deletes its attachments with it; restore brings them back; permanent delete schedules purge (cascade rules follow 07 for sub-notes).

---

## 9. Offline and sync

- `attachment.create` and `attachment.delete` are operations (05); the blob upload is a separate queue item with retry. Attachments list and metadata are local data; **bytes are not cached offline** except for images already viewed on this device (cached through the browser HTTP cache for `private, max-age=300`); everything else shows "Not available offline".
- Copying content with images into other apps: limited by those apps (product §15.6); a single selected image block copies as image data when the browser allows it, otherwise as a link to the note.

---

## 10. Tests

**Unit**
- Key generation (format, no filename, uniqueness); file policy matrix (allowed, SVG refused, size per category); name sanitising; quota arithmetic, including the global limit (exactly at the limit passes, one byte over is `STORAGE_FULL`).
- **S3 adapter configuration:** the client is built with `requestChecksumCalculation` and `responseChecksumValidation` both `"WHEN_REQUIRED"`, with the configured endpoint, region and path style; a presigned upload URL signs `Content-Type`; the returned `headers` contain it; env validation (`s3` needs all five connection values, `E2E=true` forces `memory`, an unset driver hides the feature).
- **SSRF guard:** every blocked IPv4 and IPv6 range, IPv4-mapped IPv6, decimal/hex/octal host forms, `localhost` and DNS names resolving to private addresses, redirect to private, redirect chain limit, metadata IP, port restrictions, credentials in URL, DNS pinning (resolution changes between check and connect).
- Preview parsing: title/OG/favicon extraction, size and length caps, malformed HTML.
- Block schema validation for the three nodes.

**Integration** (storage driver `memory`)
- Intent authorization (owner must be the user; another person's note id is `NOT_FOUND`), size/type/quota rejections, finalize with size mismatch and signature mismatch, idempotent finalize.
- Download: owner gets a redirect; another user gets `NOT_FOUND`; signed out gets `UNAUTHENTICATED`; the redirect URL expires.
- Soft delete hides the file and the purge job removes the object after retention; pending cleanup job.
- `link-preview` blocks private targets, respects rate limit, returns cached results per user only.
- Global storage limit: with the limit set low, an intent that would pass it returns `STORAGE_FULL` and inserts no row.

**Real provider (manual, not in CI):** `pnpm storage:smoke` against the real bucket (§3.9) passes: CORS preflight, presigned PUT, `head`, ranged read, download headers, wrong-content-type rejection, delete. Record the result and the settings it found (path style, region) in the as-built doc.

**E2E**
1. Attach an image, a PDF and a DOCX to a note and a task; progress shows; download works; another user's access to the same URL fails.
2. Paste an image into a note: an image block appears and persists after reload; caption editable; viewer opens and closes with Esc.
3. Upload failure and Retry; Cancel; oversize and unsupported type messages.
4. Offline: attach a file offline → "Waiting to upload" → reconnect → uploaded, one copy.
5. Deleting an attachment shows "File removed" in a block that referenced it.
6. Bookmark: paste a URL → choice popover (Keep as link default); card renders; a private address becomes a plain link; refresh updates; offline shows the stored snapshot.
7. Quota exceeded message with usage in Settings.
8. Axe on the attachments section, image viewer and popover; 360px.

---

## 11. Definition of done

- [x] Authorized users can upload to and download from notes, tasks and projects; unauthorized users cannot read another person's file by any route
- [x] Storage is private; uploads and downloads use short-lived signed URLs; no bucket credentials reach the browser
- [ ] Progress, retry, cancel, size and type validation, quota and delete all work (done); offline uploads queue and complete once (waits for features 04 and 05; see As built)
- [x] Image and file blocks work in notes and task descriptions, with paste and drop
- [x] Bookmark cards render from stored snapshots, never fetch from the browser, and refuse private addresses (tested)
- [x] The storage interface hides the provider; `memory` driver runs in CI; no storage means the feature hides, not breaks
- [ ] **Backblaze B2 is set up as in §3.2:** private bucket, SSE-B2 on, lifecycle "keep only the last version", an application key limited to that one bucket (the master key is nowhere in the app or in Vercel), CORS applied with exact origins, $0 caps set
- [x] The S3 client uses `WHEN_REQUIRED` for request and response checksums (tested), and the app never calls bucket-level APIs
- [x] The global storage limit (`STORAGE_TOTAL_LIMIT_MB`) works and shows `STORAGE_FULL` (tested)
- [x] `pnpm storage:smoke` passes against the real bucket before the first production deploy, and its findings (path style, download headers behaviour, effective free-tier numbers seen at signup) are in the as-built doc (all eight steps passed on 2026-10-09; free-tier numbers not recorded)
- [x] `STORAGE_*` names are in `.env.example`, validated in `env-schema.ts`, and the secret and key ID are covered by `scripts/check-client-bundle.mjs`
- [x] Migration is expand-only
- [x] ADR 0010 written before building: the file type policy, **and the provider decision** (Backblaze B2 chosen for its always-free 10 GB and S3-compatible presigned URLs; alternatives considered: Cloudflare R2, Supabase Storage, Vercel Blob, Cloudinary, and why each was not the default; the trade-off that B2's free downloads are limited and R2 is the planned fallback)
- [ ] `pnpm lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build`, `check:bundle` pass (all pass except `test:e2e`: 4 stale empty-state visual baselines from before this feature, and a few tests that fail only when many run at once and pass alone, e.g. two in `views.spec.ts`)
- [x] `agent_docs/files-attachments-and-bookmarks_v2.md` written and indexed

---

## 12. Out of scope (V2)

Thumbnails and image resizing (a hosted image service such as Cloudinary was considered and not adopted: it is image-focused, caps raw files at 10 MB on its free plan, and is not S3-compatible); a CDN in front of the bucket; B2's native (non-S3) API; browser POST-policy uploads (not supported by B2's S3 API); multipart uploads for large files (files are at most 25 MB, so one PUT is enough); provider-side bucket replication or backups; video and audio files (voice recordings have their own temporary handling in 13); antivirus scanning; file versioning; sharing links; OCR or text extraction from files; offline caching of arbitrary files; embeds of third-party media.

---

## 13. As built (2026-10-08)

What differs from the sections above. The agent hand-off is `agent_docs/files-attachments-and-bookmarks_v2.md`; the provider decision is ADR 0010.

- **Server-backed only.** Features 03 to 05 were skipped on purpose, so there is no "Waiting to upload" state, no "Not available offline" block state and no offline E2E (§9, §10 cases 4 and 6). The upload manager is a small client store (`startUpload`, `retryUpload`, `cancelUpload`), the place a queue would go.
- **No jobs yet (feature 08).** `cleanupPending`, `purgeExpired` and `pruneLinkPreviews` are plain functions; the first two run opportunistically for the signed-in person on an upload intent, the last on a preview request. They are written to be registered as the `attachment.cleanup` / `attachment.purge` / preview-expiry handlers.
- **Download redirect caches for 45 s, not 300 s** (§3.6): the signed URL lives 60 s, so a longer cache would hand the browser a dead address. A failed link preview is cached for **1 hour** (a good one for 7 days) so a flaky page isn't hammered.
- **No client-made id leaks.** The intent accepts a suggested `id` (so an editor block can point at the file before the server answers) but uses it only when nothing holds it, in any state, for anyone; otherwise the server picks one and the client treats that as a failed upload.
- **Another route:** `POST /api/files/meta` returns name, size, type and dimensions for a batch of ids (blocks draw themselves from it); a file that is deleted, unfinished, not the person's or whose owner is in Trash is simply absent and its block says "File removed".
- **Images in the Attachments list:** files added through the editor belong to the same owner, so they are listed there too.
- **Paste rules:** `image-files` (priority 50) claims an image paste only when the clipboard has no text; `url-choice` (110) offers the popover only for a lone address on an empty line. A picture or file block copies as nothing into other apps (it holds only an id); a bookmark copies as a link.
- **Gallery cover:** the first top-level picture block of a note (not looking inside toggles), shown only if it loads.
- **Not built:** a UI to set an image's `width`; thumbnails (out of scope).
- **Real B2 smoke test (run by the owner, 2026-10-09):** `pnpm storage:smoke` passed all eight steps against the Dayboard bucket. Findings: region `eu-central-003`, endpoint `https://s3.eu-central-003.backblazeb2.com`, **path style off** (`STORAGE_FORCE_PATH_STYLE=false` works); the CORS preflight from `http://localhost:3000` is accepted; B2 **honours** the `Content-Disposition` and `Content-Type` overrides on a presigned download (so the §3.4 fallback of storing them on the object is not needed); a presigned PUT with a different `Content-Type` is rejected; a ranged read returns exactly the bytes asked for; `head` of a deleted key returned nothing straight away. Free-tier numbers seen at signup were not recorded.
- **CORS rule names:** B2's S3 operations are `s3_put`, `s3_get` and `s3_head` (the first draft of §3.5 said `s3_put_object` and so on, which the B2 CLI rejects; fixed). The rule is applied with `b2 bucket update --cors-rules` (the console's CORS dialog only offers presets and shows "custom rules" read-only).
- **Still open (manual B2 and Vercel steps):** confirm the bucket's lifecycle rule is "keep only the last version" (a bucket made through the console shows `lifecycleRules: []`, which keeps every version), the $0 caps, that the application key is limited to this one bucket, the production origin in CORS, and the `STORAGE_*` values in Vercel.
- **Database:** migration 0009 (expand-only: two tables, two enums, no change to existing tables). Neon needs it applied by hand, after 0008.
