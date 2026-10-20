// The audit row of an AI diagram (V3 feature 01 §6, §8): counts only. Built from numbers the server has checked, never
// from a label, a title or the prompt.

export function describeDiagramApplied(
  counts: { sections: number; boxes: number; connections: number },
  mode: "draw" | "add",
): string {
  const s = counts.sections;
  const b = counts.boxes;
  const c = counts.connections;
  const parts = [
    ...(s > 0 ? [`${s} ${s === 1 ? "section" : "sections"}`] : []),
    `${b} ${b === 1 ? "box" : "boxes"}`,
    `${c} ${c === 1 ? "connection" : "connections"}`,
  ];
  return `${mode === "draw" ? "Drew a diagram" : "Added a diagram to a canvas"}: ${parts.join(", ")}`;
}
