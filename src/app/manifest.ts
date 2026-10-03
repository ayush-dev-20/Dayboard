import type { MetadataRoute } from "next";

// App metadata only (name, colors, icons). There is no service worker: offline and install
// prompts are V2 (Serwist).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Dayboard",
    short_name: "Dayboard",
    description: "A calm personal workspace for tasks, todos, notes and projects.",
    start_url: "/today",
    display: "standalone",
    background_color: "#faf8f2",
    theme_color: "#faf8f2",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
