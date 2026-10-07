import { MAX_DOC_BYTES } from "../schema";
import type { TiptapNode } from "../types";

const encoder = new TextEncoder();
const sizeOf = (node: TiptapNode) => encoder.encode(JSON.stringify(node)).length;

/** A text block cut down to `limit` bytes of JSON; null for blocks that are not just text. */
function trimText(block: TiptapNode, limit: number): TiptapNode | null {
  if (block.type !== "paragraph" && block.type !== "heading" && block.type !== "codeBlock")
    return null;
  const nodes = (block.content ?? []).filter((n) => n.type === "text");
  let total = nodes.reduce((n, node) => n + (node.text?.length ?? 0), 0);
  while (total > 0) {
    total = Math.floor(total * 0.9);
    let left = total;
    const content = nodes
      .map((node) => {
        const text = (node.text ?? "").slice(0, Math.max(left, 0));
        left -= text.length;
        return text ? { ...node, text } : null;
      })
      .filter((n) => n !== null) as TiptapNode[];
    const trimmed = { ...block, content };
    if (content.length > 0 && sizeOf(trimmed) <= limit) return trimmed;
  }
  return null;
}

/**
 * Keeps the blocks that fit in what is left of the document size limit, cutting at a block
 * boundary. `currentBytes` is the size of the document being pasted into. A single text block that
 * is larger than everything that is left (a huge line of text) is cut inside the block instead,
 * since there is no boundary to cut at.
 */
export function fitToBudget(
  blocks: TiptapNode[],
  currentBytes: number,
): { blocks: TiptapNode[]; shortened: boolean } {
  const budget = MAX_DOC_BYTES - currentBytes - 1024;
  let used = 0;
  const kept: TiptapNode[] = [];
  for (const block of blocks) {
    const size = sizeOf(block) + 1;
    if (used + size > budget) {
      if (kept.length === 0) {
        const trimmed = trimText(block, budget);
        if (trimmed) kept.push(trimmed);
      }
      return { blocks: kept, shortened: true };
    }
    used += size;
    kept.push(block);
  }
  return { blocks, shortened: false };
}
