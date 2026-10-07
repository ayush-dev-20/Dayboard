import { isSingleEmoji } from "@/lib/emoji";
import { DEFAULT_CALLOUT_EMOJI } from "../../limits";
import type { Producer } from "./types";

// Notion writes ordinary lists (`ul.bulleted-list`), toggles as `ul.toggle > li > details`, to-dos
// with a `.checkbox` div, and callouts as `figure.callout` with an icon. The generic rules read
// the first three; the callout is Notion's own.
export const notion: Producer = {
  name: "notion",
  detect: (_doc, html) =>
    /notion-|block-color-|simple-table|class="(bulleted-list|numbered-list|to-do-list|toggle|callout)\b/i.test(
      html,
    ),
  prepare(root) {
    // A ticked to-do is struck through by the page; Dayboard draws that itself, so it is not a mark.
    root.querySelectorAll('[class*="to-do-children"]').forEach((el) => el.removeAttribute("style"));
  },
  block(el, api) {
    if (el.tagName !== "FIGURE" || !el.classList.contains("callout")) return null;
    const icon = el.querySelector(".icon");
    const emoji = icon?.textContent?.trim() ?? "";
    const clone = el.cloneNode(true) as Element;
    const iconHolder = clone.querySelector(".icon");
    (iconHolder?.parentElement ?? iconHolder)?.remove();
    const content = api.blocks(clone);
    return [
      {
        type: "callout",
        attrs: { emoji: isSingleEmoji(emoji) ? emoji : DEFAULT_CALLOUT_EMOJI, tone: "neutral" },
        content: content.length > 0 ? content : [{ type: "paragraph" }],
      },
    ];
  },
};
