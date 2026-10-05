# Feature 09 — Files, Attachments & Bookmarks

## 1. Scope

- **Attachments** on notes, tasks and projects: images, PDFs, text files, common office files
- A **storage service interface** with an S3-compatible adapter and test doubles; private objects, **presigned** upload and download
- **Upload intent → direct upload → finalize** flow with progress, retry, cancel, size and type validation, a quota
- **Authorized downloads** (every request checked), delete, metadata
- **Image and file blocks** in the editor (notes and task descriptions), paste and drop to upload
- **Bookmark cards**: server-side link previews with strong protection against requests to private addresses; the paste choice menu
- Offline: queue uploads while offline; show placeholders for files not available offline

Reuses: feature 01's block registry, feature 02's paste rule registry, feature 05's operations, feature 08's jobs (verify, purge, cleanup), V1 trash semantics, the rate limiter used for AI routes.

Packages: an S3 client (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`) after ADR 0010, which also fixes the file type policy. No image-processing dependency in V2.

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

**Object key:** `u/{userId}/{yyyy}/{mm}/{attachmentId}/{128-bit random hex}`. The file name never appears in the key; keys are unguessable and unique per upload; one prefix per user so a bad policy cannot cross users by accident.

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

Adapters: `s3` (Cloudflare R2, MinIO, AWS S3; env `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_FORCE_PATH_STYLE`), `memory` (tests and E2E; presigned URLs point at an in-process route), `disk` (local dev without MinIO). `STORAGE_DRIVER=s3|memory|disk`. Storage is **private**: no public bucket policy; CORS on the bucket allows only the app origin for `PUT` and `GET`. With no storage configured, the Attachments UI and file/image blocks are hidden and the rest of the app works.

---

## 4. Server contract

Route handlers under `src/app/api/files/` (technical spec §9). All start with `requireUser()`.

| Route | Purpose |
|---|---|
| `POST /api/files/intent` | `{ id, ownerType, ownerId, name, mime, size, width?, height? }` → validates, inserts a `PENDING` row, returns `{ attachmentId, upload: { url, headers }, expiresAt }`. Checks: owner belongs to the user; size ≤ limit; mime allowed; user quota; per-minute rate limit (30). |
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
- **Quota:** 500 MB per user (`STORAGE_QUOTA_MB`), checked at intent time against `READY` + `PENDING` bytes; over quota → `QUOTA_EXCEEDED` with the usage shown in Settings.
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
- Key generation (format, no filename, uniqueness); file policy matrix (allowed, SVG refused, size per category); name sanitising; quota arithmetic.
- **SSRF guard:** every blocked IPv4 and IPv6 range, IPv4-mapped IPv6, decimal/hex/octal host forms, `localhost` and DNS names resolving to private addresses, redirect to private, redirect chain limit, metadata IP, port restrictions, credentials in URL, DNS pinning (resolution changes between check and connect).
- Preview parsing: title/OG/favicon extraction, size and length caps, malformed HTML.
- Block schema validation for the three nodes.

**Integration** (storage driver `memory`)
- Intent authorization (owner must be the user; another person's note id is `NOT_FOUND`), size/type/quota rejections, finalize with size mismatch and signature mismatch, idempotent finalize.
- Download: owner gets a redirect; another user gets `NOT_FOUND`; signed out gets `UNAUTHENTICATED`; the redirect URL expires.
- Soft delete hides the file and the purge job removes the object after retention; pending cleanup job.
- `link-preview` blocks private targets, respects rate limit, returns cached results per user only.

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

- [ ] Authorized users can upload to and download from notes, tasks and projects; unauthorized users cannot read another person's file by any route
- [ ] Storage is private; uploads and downloads use short-lived signed URLs; no bucket credentials reach the browser
- [ ] Progress, retry, cancel, size and type validation, quota and delete all work; offline uploads queue and complete once
- [ ] Image and file blocks work in notes and task descriptions, with paste and drop
- [ ] Bookmark cards render from stored snapshots, never fetch from the browser, and refuse private addresses (tested)
- [ ] The storage interface hides the provider; `memory` driver runs in CI; no storage means the feature hides, not breaks
- [ ] Migration is expand-only
- [ ] ADR 0010 written before building
- [ ] `pnpm lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build`, `check:bundle` pass (no storage secrets in the client bundle)
- [ ] `agent_docs/files-attachments-and-bookmarks_v2.md` written and indexed

---

## 12. Out of scope (V2)

Thumbnails and image resizing; video and audio files (voice recordings have their own temporary handling in 13); antivirus scanning; file versioning; sharing links; OCR or text extraction from files; offline caching of arbitrary files; embeds of third-party media.
