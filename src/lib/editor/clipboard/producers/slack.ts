import type { Producer } from "./types";

// Slack writes each list level as its own `<ul>`/`<ol>` with `data-indent`, one after another
// rather than nested. (When it gives only text, the bullets arrive as `•` lines: parse-text.)
export const slack: Producer = {
  name: "slack",
  detect: (_doc, html) => /p-rich_text|data-stringify|c-mrkdwn/i.test(html),
  level(el) {
    const indent = Number(el.getAttribute("data-indent"));
    return Number.isInteger(indent) && indent >= 0 ? indent : null;
  },
};
