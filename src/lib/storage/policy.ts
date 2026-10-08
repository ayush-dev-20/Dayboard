// The file type policy (V2 feature 09 §5, ADR 0010). What may be attached, how big each kind may
// be, and what the browser's claimed type is worth (little: it is only the starting point, and the
// first bytes are checked at finalize). Pure.

export type FileCategory = "image" | "pdf" | "text" | "document";

const MB = 1024 * 1024;

export const CATEGORY_LIMITS: Record<FileCategory, number> = {
  image: 10 * MB,
  pdf: 25 * MB,
  text: 5 * MB,
  document: 25 * MB,
};

export const CATEGORY_LABELS: Record<FileCategory, string> = {
  image: "Image",
  pdf: "PDF",
  text: "Text",
  document: "Document",
};

type TypeInfo = { category: FileCategory; extensions: string[] };

/** Every accepted type, by its canonical media type. */
export const ALLOWED_TYPES: Record<string, TypeInfo> = {
  "image/png": { category: "image", extensions: ["png"] },
  "image/jpeg": { category: "image", extensions: ["jpg", "jpeg"] },
  "image/webp": { category: "image", extensions: ["webp"] },
  "image/gif": { category: "image", extensions: ["gif"] },
  "image/avif": { category: "image", extensions: ["avif"] },
  "application/pdf": { category: "pdf", extensions: ["pdf"] },
  "text/plain": { category: "text", extensions: ["txt", "text", "log"] },
  "text/markdown": { category: "text", extensions: ["md", "markdown"] },
  "text/csv": { category: "text", extensions: ["csv"] },
  "application/json": { category: "text", extensions: ["json"] },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    category: "document",
    extensions: ["docx"],
  },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    category: "document",
    extensions: ["xlsx"],
  },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": {
    category: "document",
    extensions: ["pptx"],
  },
  "application/vnd.oasis.opendocument.text": { category: "document", extensions: ["odt"] },
  "application/vnd.oasis.opendocument.spreadsheet": { category: "document", extensions: ["ods"] },
  "application/vnd.oasis.opendocument.presentation": { category: "document", extensions: ["odp"] },
  "application/rtf": { category: "document", extensions: ["rtf"] },
};

/** Spellings browsers and operating systems use for the types above. */
const ALIASES: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "text/x-markdown": "text/markdown",
  "text/rtf": "application/rtf",
  "application/x-rtf": "application/rtf",
  "text/json": "application/json",
  "application/csv": "text/csv",
};

/** Said when the browser does not know the type: the file name decides. */
const VAGUE = new Set(["", "application/octet-stream", "binary/octet-stream"]);

/** Windows reports a CSV as an Excel type, and some systems report Markdown as plain text. */
const EXTENSION_WINS_OVER = new Set(["application/vnd.ms-excel", "text/plain"]);

/** Never accepted, whatever type the browser claims (they can carry script or run). */
const DENIED_EXTENSIONS = new Set([
  "svg",
  "svgz",
  "html",
  "htm",
  "xhtml",
  "xml",
  "js",
  "mjs",
  "cjs",
  "jsx",
  "ts",
  "php",
  "exe",
  "msi",
  "bat",
  "cmd",
  "com",
  "scr",
  "sh",
  "ps1",
  "jar",
  "apk",
  "dmg",
  "app",
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  "tgz",
  "bz2",
]);

export function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

const byExtension = (ext: string): string | null => {
  for (const [mime, info] of Object.entries(ALLOWED_TYPES)) {
    if (info.extensions.includes(ext)) return mime;
  }
  return null;
};

/**
 * The canonical media type for a file, from what the browser said and the file's name; null when
 * the type is not accepted. A denied extension is refused even when the claimed type is fine.
 */
export function resolveMime(declared: string, name: string): string | null {
  const ext = extensionOf(name);
  if (DENIED_EXTENSIONS.has(ext)) return null;
  const claimed = declared.split(";")[0]!.trim().toLowerCase();
  const canonical = ALIASES[claimed] ?? claimed;
  if (VAGUE.has(canonical) || EXTENSION_WINS_OVER.has(canonical)) {
    const fromName = byExtension(ext);
    if (fromName) return fromName;
    // A plain-text claim with an unknown extension is just text.
    return canonical === "text/plain" ? "text/plain" : null;
  }
  return canonical in ALLOWED_TYPES ? canonical : null;
}

export const categoryOf = (mime: string): FileCategory | null =>
  ALLOWED_TYPES[mime]?.category ?? null;

export const limitFor = (category: FileCategory): number => CATEGORY_LIMITS[category];

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb >= 100 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
}

export type FileProblem = {
  code: "UNSUPPORTED_FILE_TYPE" | "FILE_TOO_LARGE" | "EMPTY_FILE";
  message: string;
};

/** What an upload row says when the file cannot be accepted. */
export const MESSAGES = {
  unsupported: "This file type isn't supported.",
  empty: "This file is empty.",
  tooLarge: (limit: number) => `Too large: max ${formatBytes(limit)}`,
} as const;

export type Declared = { name: string; mime: string; size: number };

/** The first check, from what the browser reports (before any bytes are uploaded). */
export function validateDeclared(
  declared: Declared,
): { ok: true; mime: string; category: FileCategory } | ({ ok: false } & FileProblem) {
  const mime = resolveMime(declared.mime, declared.name);
  const category = mime ? categoryOf(mime) : null;
  if (!mime || !category) {
    return { ok: false, code: "UNSUPPORTED_FILE_TYPE", message: MESSAGES.unsupported };
  }
  if (!Number.isFinite(declared.size) || declared.size <= 0) {
    return { ok: false, code: "EMPTY_FILE", message: MESSAGES.empty };
  }
  const limit = limitFor(category);
  if (declared.size > limit) {
    return { ok: false, code: "FILE_TOO_LARGE", message: MESSAGES.tooLarge(limit) };
  }
  return { ok: true, mime, category };
}

/** Images may be shown inline; everything else is a download. */
export const isImageMime = (mime: string) => categoryOf(mime) === "image";

/** A PDF can open in the browser; the rest download. */
export const dispositionFor = (mime: string): "inline" | "attachment" =>
  categoryOf(mime) === "image" || categoryOf(mime) === "pdf" ? "inline" : "attachment";

/** The `accept` attribute for a file picker. */
export const ACCEPT = [
  ...Object.keys(ALLOWED_TYPES),
  ...Object.values(ALLOWED_TYPES).flatMap((t) => t.extensions.map((e) => `.${e}`)),
].join(",");
