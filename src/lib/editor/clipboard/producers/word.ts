import { paragraphOf } from "../inline";
import type { Producer } from "./types";

// Word and Outlook write lists as styled paragraphs: `MsoListParagraph…` with `mso-list:l0 level2
// lfo1`, the bullet or number sitting in a span marked `mso-list:Ignore`.
const IGNORE = '[style*="mso-list:ignore" i], [style*="mso-list: ignore" i]';

export const word: Producer = {
  name: "word",
  detect: (_doc, html) =>
    /xmlns:w=|urn:schemas-microsoft-com:office|class="?Mso|mso-[a-z-]+:/i.test(html),
  listParagraph(el, api) {
    const style = el.getAttribute("style") ?? "";
    const cls = el.getAttribute("class") ?? "";
    const hasList = /mso-list:\s*(?!none)/i.test(style) && /level\d+/i.test(style);
    if (!/^MsoListParagraph/i.test(cls) && !hasList) return null;

    const level = /level(\d+)/i.exec(style);
    const clone = el.cloneNode(true) as Element;
    const marker = (clone.querySelector(IGNORE)?.textContent ?? "").replace(/[\s ]/g, "");
    clone.querySelectorAll(IGNORE).forEach((node) => node.remove());

    const ordered = /^\(?(\d+|[a-zA-Z]+)[.)]$/.test(marker);
    const number = /^\(?(\d+)[.)]$/.exec(marker);
    return {
      depth: level ? Math.max(Number(level[1]) - 1, 0) : 0,
      kind: ordered ? "ordered" : "bullet",
      ...(number ? { start: Number(number[1]) } : {}),
      content: [paragraphOf(api.inline(clone))],
    };
  },
};
