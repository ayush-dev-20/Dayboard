import type { Producer } from "./types";

/** Any other web page or tool: ordinary HTML, read by the common rules. */
export const generic: Producer = { name: "generic", detect: () => true };
