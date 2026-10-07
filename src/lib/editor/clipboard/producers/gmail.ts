import type { Producer } from "./types";

// Gmail: `div.gmail_default`, `blockquote.gmail_quote`, lists with `margin-left` on the items.
export const gmail: Producer = {
  name: "gmail",
  detect: (_doc, html) => /gmail_(default|quote|signature|attr)/i.test(html),
};
