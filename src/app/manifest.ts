import type { MetadataRoute } from "next";

// The web app manifest (V2 feature 03 §4): what the install prompt, the home screen icon and the
// app's launch behaviour are built from. The icons are PNG routes under /icons, made from the brand
// mark by src/lib/pwa/icon-art.tsx.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Dayboard",
    short_name: "Dayboard",
    description: "A calm personal workspace for tasks, todos, notes and projects.",
    start_url: "/today?source=pwa",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "any",
    categories: ["productivity"],
    lang: "en",
    background_color: "#faf8f2",
    theme_color: "#faf8f2",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
    shortcuts: [
      {
        name: "New task",
        short_name: "Task",
        url: "/tasks?focus=add",
        icons: [{ src: "/icons/96", sizes: "96x96", type: "image/png" }],
      },
      {
        name: "New note",
        short_name: "Note",
        url: "/notes/new",
        icons: [{ src: "/icons/96", sizes: "96x96", type: "image/png" }],
      },
      {
        name: "Quick capture",
        short_name: "Capture",
        url: "/today",
        icons: [{ src: "/icons/96", sizes: "96x96", type: "image/png" }],
      },
      {
        name: "Search",
        short_name: "Search",
        url: "/search",
        icons: [{ src: "/icons/96", sizes: "96x96", type: "image/png" }],
      },
    ],
  };
}
