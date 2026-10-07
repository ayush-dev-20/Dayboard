import type { Producer } from "./types";

// GitHub's rendered Markdown: headings carry an anchor link and an icon, code sits in
// `div.highlight-source-<language>`, task items have a disabled checkbox.
export const github: Producer = {
  name: "github",
  detect: (_doc, html) =>
    /markdown-body|task-list-item|highlight-source-|data-snippet-clipboard-copy/i.test(html),
  prepare(root) {
    root
      .querySelectorAll("a.anchor, .zeroclipboard-container, clipboard-copy, .octicon")
      .forEach((node) => node.remove());
  },
  codeLanguage(el) {
    for (let node: Element | null = el; node; node = node.parentElement) {
      const m = /(?:^|\s)highlight-(?:source|text)-([\w+#.-]{1,32})/.exec(
        node.getAttribute("class") ?? "",
      );
      if (m) return m[1]!;
    }
    return null;
  },
};
