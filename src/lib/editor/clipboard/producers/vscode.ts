import type { Producer } from "./types";
import { MONOSPACE, styleOf } from "./types";

// VS Code copies code as `<div style="…font-family: Menlo, monospace; white-space: pre;">` holding
// one `<div>` per line of coloured `<span>`s. The whole block becomes a code block.
const isCodeRoot = (el: Element) => {
  const style = styleOf(el);
  return /^pre/.test(style["white-space"] ?? "") && MONOSPACE.test(style["font-family"] ?? "");
};

export const vscode: Producer = {
  name: "vscode",
  detect: (doc) => [...doc.body.querySelectorAll("div")].some(isCodeRoot),
  block(el, api) {
    if (el.tagName !== "DIV" || !isCodeRoot(el)) return null;
    const text = api.code(el);
    const mode = api.vscodeMode;
    const language = mode && mode !== "plaintext" && /^[\w+#.-]{1,32}$/.test(mode) ? mode : null;
    return [
      {
        type: "codeBlock",
        ...(language ? { attrs: { language } } : {}),
        ...(text ? { content: [{ type: "text", text }] } : {}),
      },
    ];
  },
};
