import type { EditorView } from "@tiptap/pm/view";
import { toast } from "sonner";
import { startUpload } from "@/components/files/upload-manager";
import { ACCEPT, isImageMime, validateDeclared } from "@/lib/storage/policy";
import { insertBlockInView } from "./commands";
import type { EditorContext } from "./registry";

// Getting files into a note or task description (V2 feature 09 §6): the picker behind `/image` and
// `/file`, and the shared step for paste and drop. Each accepted file starts uploading at once and a
// block that points at it is inserted at the cursor, so the text never waits for the network.

/** Files per paste, drop or pick; more is almost certainly a mistake. */
const MAX_AT_ONCE = 10;

export const IMAGE_ACCEPT = ACCEPT.split(",")
  .filter((type) => type.startsWith("image/"))
  .join(",");

/** Opens the system file picker; resolves to the chosen files, or none when it is dismissed. */
export function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.oncancel = () => resolve([]);
    input.click();
  });
}

export const ownerTypeFor = (surface: EditorContext["surface"]) =>
  surface === "note" ? "NOTE" : "TASK";

/**
 * Starts uploading these files for the note or task being edited and puts a block for each at the
 * cursor, in order. A file that can't be accepted is named in a message and skipped.
 */
export async function attachFiles(
  view: EditorView,
  ctx: Pick<EditorContext, "surface" | "ownerId" | "ensureOwner">,
  files: File[],
  options: { imagesOnly?: boolean } = {},
): Promise<number> {
  if (files.length === 0) return 0;
  const ownerId = ctx.ownerId ?? (await ctx.ensureOwner?.()) ?? null;
  if (!ownerId) {
    toast.error("Couldn't attach that yet. Type something first, then try again.");
    return 0;
  }
  if (view.isDestroyed) return 0;

  let added = 0;
  for (const file of files.slice(0, MAX_AT_ONCE)) {
    const checked = validateDeclared({ name: file.name, mime: file.type, size: file.size });
    if (!checked.ok) {
      toast.error(`${file.name}: ${checked.message}`);
      continue;
    }
    const image = isImageMime(checked.mime);
    if (options.imagesOnly && !image) {
      toast.error(`${file.name}: pick a picture.`);
      continue;
    }
    const id = startUpload(file, { type: ownerTypeFor(ctx.surface), id: ownerId });
    const block = { type: image ? "image" : "file", attrs: { attachmentId: id } };
    if (insertBlockInView(view, block, { trailingParagraph: true })) {
      added += 1;
    }
  }
  if (files.length > MAX_AT_ONCE) toast(`Only the first ${MAX_AT_ONCE} files were added.`);
  return added;
}
