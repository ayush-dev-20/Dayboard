import { ALLOWED_TYPES, categoryOf } from "./policy";

// What a file really is, from its first bytes (V2 feature 09 §5). The browser's claimed type is not
// trusted: a file whose signature does not match the category it claimed is rejected, and text that
// is really markup (HTML, SVG, script) is refused whatever it was called. Pure.

/** How many bytes the check needs. */
export const SNIFF_BYTES = 4096;

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
  signature.every((byte, i) => bytes[offset + i] === byte);

const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.slice(from, to));

/** The type the signature says, or null when it is none of the binary types we accept. */
export function signatureOf(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") return "image/gif";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  if (ascii(bytes, 4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(bytes, 8, 12))) {
    return "image/avif";
  }
  if (ascii(bytes, 0, 5) === "%PDF-") return "application/pdf";
  if (ascii(bytes, 0, 5) === "{\\rtf") return "application/rtf";
  // Office Open XML and OpenDocument files are ZIP containers.
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return "application/zip";
  return null;
}

const MARKUP = /<\s*(!doctype\s+html|html|head|body|script|svg|iframe|object|embed|\?xml)\b/i;

/** Text only: no NUL bytes, valid UTF-8, and not markup in disguise. */
function checkText(bytes: Uint8Array, mime: string): boolean {
  if (bytes.includes(0)) return false;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // A multi-byte character may be cut at the end of the slice: allow that, not worse.
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(0, bytes.length - 3));
    } catch {
      return false;
    }
  }
  if (MARKUP.test(text)) return false;
  if (mime === "application/json") return /^\s*[\[{"\d\-tfn]/.test(text);
  return true;
}

export type SniffResult = { ok: true } | { ok: false; reason: "SIGNATURE_MISMATCH" | "NOT_TEXT" };

/**
 * Whether the first bytes agree with the type the file was accepted as. `mime` is the canonical
 * type chosen at intent time.
 */
export function sniffMatches(bytes: Uint8Array, mime: string): SniffResult {
  const category = categoryOf(mime);
  if (!category || !(mime in ALLOWED_TYPES)) return { ok: false, reason: "SIGNATURE_MISMATCH" };

  if (category === "text") {
    return checkText(bytes, mime) ? { ok: true } : { ok: false, reason: "NOT_TEXT" };
  }
  const found = signatureOf(bytes);
  if (category === "document") {
    if (mime === "application/rtf") {
      return found === "application/rtf"
        ? { ok: true }
        : { ok: false, reason: "SIGNATURE_MISMATCH" };
    }
    return found === "application/zip" ? { ok: true } : { ok: false, reason: "SIGNATURE_MISMATCH" };
  }
  return found === mime ? { ok: true } : { ok: false, reason: "SIGNATURE_MISMATCH" };
}
