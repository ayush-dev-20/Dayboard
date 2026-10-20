import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

// Export (V3 feature 01 §1): PNG, SVG and an Excalidraw file, made in the browser from what is on screen. Excalidraw
// is already loaded by the time a person opens the menu; importing it here keeps this file out of the main bundle.

export type ExportKind = "png" | "svg" | "excalidraw";

function fileStem(title: string): string {
  const stem = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return stem || "canvas";
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function exportCanvas(
  api: ExcalidrawImperativeAPI,
  kind: ExportKind,
  title: string,
): Promise<void> {
  const lib = await import("@excalidraw/excalidraw");
  const elements = api.getSceneElements();
  const appState = api.getAppState();
  const files = api.getFiles();
  const stem = fileStem(title);
  const options = {
    elements,
    appState: { ...appState, exportBackground: true, exportWithDarkMode: false },
    files,
  };
  if (kind === "png") {
    download(await lib.exportToBlob({ ...options, mimeType: "image/png" }), `${stem}.png`);
  } else if (kind === "svg") {
    const svg = await lib.exportToSvg(options);
    download(
      new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }),
      `${stem}.svg`,
    );
  } else {
    download(
      new Blob([lib.serializeAsJSON(elements, appState, files, "local")], {
        type: "application/vnd.excalidraw+json",
      }),
      `${stem}.excalidraw`,
    );
  }
}
