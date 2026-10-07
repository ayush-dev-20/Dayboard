import type { Producer } from "./types";

// Apple Notes and Pages: `p.p1` with a `<style>` block, `Apple-converted-space` spans, plain
// `ul.ul1 > li.li1` lists. Nothing here needs more than the generic rules.
export const apple: Producer = {
  name: "apple",
  detect: (_doc, html) =>
    /Apple-converted-space|Apple-interchange-newline|Apple-tab-span|class="p1"/i.test(html),
};
