import type { Producer } from "./types";

// Google Docs wraps everything in `<b style="font-weight:normal" id="docs-internal-guid-…">`, writes
// bold as `font-weight:700` spans, and gives each list item an `aria-level`. Nested lists arrive
// as `<ul>` siblings of the `<li>` that owns them. The generic rules read all of that.
export const googleDocs: Producer = {
  name: "google-docs",
  detect: (doc, html) =>
    /docs-internal-guid-/i.test(html) || doc.querySelector('[id^="docs-internal-guid"]') !== null,
};
