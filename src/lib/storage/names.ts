// File names (V2 feature 09 §5): kept for display and for the download header only, never in a
// key. Control characters and path separators are removed so a name can never break a header or
// hint at a path. Pure.

const MAX_NAME = 255;

export function sanitizeFileName(raw: string): string {
  const cleaned = raw.replace(
    /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g,
    "",
  );
  // A path becomes its parts, with "." and ".." dropped: nothing in a name can walk anywhere.
  let name = cleaned
    .split(/[\\/]+/)
    .map((part) => part.trim())
    .filter((part) => part !== "" && part !== "." && part !== "..")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  // A leading dot would make it a hidden file.
  name = name.replace(/^[.\s]+/, "");
  if (name.length > MAX_NAME) {
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : "";
    name = name.slice(0, MAX_NAME - ext.length) + ext;
  }
  return name || "file";
}

/** An ASCII-only fallback for old clients (quotes and non-ASCII replaced). */
const asciiFallback = (name: string) => name.replace(/[^\x20-\x7e]/g, "_").replace(/["\;]/g, "_");

/** RFC 6266 `Content-Disposition`, with the exact name in `filename*` (RFC 5987). */
export function contentDisposition(name: string, disposition: "inline" | "attachment"): string {
  const safe = sanitizeFileName(name);
  const encoded = encodeURIComponent(safe).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${disposition}; filename="${asciiFallback(safe)}"; filename*=UTF-8''${encoded}`;
}
