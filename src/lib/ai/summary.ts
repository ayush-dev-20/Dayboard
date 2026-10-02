import type { TiptapDoc, TiptapNode } from "@/lib/editor/types";

// A streamed summary arrives as plain text with "## Heading" lines and "- " bullets. These helpers
// turn it into sections to render (as text and lists, never as HTML) and into editor blocks for
// "Insert into note".

export const SUMMARY_HEADINGS = ["Summary", "Key points", "Action items"] as const;

export type SummarySection = {
  heading: string;
  /** Plain paragraphs. */
  paragraphs: string[];
  /** Bullet lines, without the marker. */
  bullets: string[];
};

export function parseSummary(text: string): SummarySection[] {
  const sections: SummarySection[] = [];
  let current: SummarySection | null = null;

  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    if (heading) {
      current = { heading: heading[1]!.trim(), paragraphs: [], bullets: [] };
      sections.push(current);
      continue;
    }
    // Text before any heading still belongs to the summary.
    current ??=
      sections[sections.push({ heading: "Summary", paragraphs: [], bullets: [] }) - 1] ?? null;
    if (!current) continue;
    const bullet = /^[-*•]\s+(.+)$/.exec(line);
    if (bullet) current.bullets.push(bullet[1]!.trim());
    else current.paragraphs.push(line);
  }
  return sections;
}

const text = (value: string): TiptapNode => ({ type: "text", text: value });
const paragraph = (value: string): TiptapNode => ({
  type: "paragraph",
  content: [text(value)],
});

/** The summary as editor blocks: a heading, then paragraphs and a bullet list per section. */
export function summaryToBlocks(sections: SummarySection[]): TiptapNode[] {
  return sections.flatMap((section) => {
    const blocks: TiptapNode[] = [
      { type: "heading", attrs: { level: 2 }, content: [text(section.heading)] },
      ...section.paragraphs.map(paragraph),
    ];
    if (section.bullets.length > 0) {
      blocks.push({
        type: "bulletList",
        content: section.bullets.map((b) => ({ type: "listItem", content: [paragraph(b)] })),
      });
    }
    return blocks;
  });
}

/** Puts the summary at the top of a note, above what is already there. */
export function insertSummary(doc: TiptapDoc | null, sections: SummarySection[]): TiptapDoc {
  return { type: "doc", content: [...summaryToBlocks(sections), ...(doc?.content ?? [])] };
}

/** The summary as plain text for Copy. */
export function summaryToPlainText(sections: SummarySection[]): string {
  return sections
    .map((s) => [s.heading, ...s.paragraphs, ...s.bullets.map((b) => `- ${b}`)].join("\n"))
    .join("\n\n");
}
