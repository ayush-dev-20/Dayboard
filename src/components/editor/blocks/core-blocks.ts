import type { Editor } from "@tiptap/react";
import {
  Code,
  Heading1,
  Heading2,
  Heading3,
  Lightbulb,
  List,
  ListCollapse,
  ListOrdered,
  ListTodo,
  Minus,
  Quote,
  Table2,
  TableOfContents,
  Type,
} from "lucide-react";
import {
  calloutJSON,
  insertBlock,
  tableJSON,
  toggleJSON,
  topBlockAtSelection,
  turnInto,
  type TurnIntoKind,
} from "./commands";
import { hasBlock, registerBlock, type BlockItem } from "./registry";

const BOTH: BlockItem["surfaces"] = ["note", "task"];

/** Converts the block the cursor is in. */
const convert = (kind: TurnIntoKind) => (editor: Editor) => {
  const top = topBlockAtSelection(editor.state);
  if (top) turnInto(editor, top.pos, kind);
};

const CORE: BlockItem[] = [
  {
    id: "text",
    title: "Text",
    keywords: ["paragraph", "plain"],
    group: "Basic",
    icon: Type,
    surfaces: BOTH,
    insert: convert("text"),
  },
  {
    id: "h1",
    title: "Heading 1",
    keywords: ["title", "h1", "big"],
    group: "Basic",
    icon: Heading1,
    surfaces: BOTH,
    insert: convert("h1"),
  },
  {
    id: "h2",
    title: "Heading 2",
    keywords: ["subtitle", "h2", "medium"],
    group: "Basic",
    icon: Heading2,
    surfaces: BOTH,
    insert: convert("h2"),
  },
  {
    id: "h3",
    title: "Heading 3",
    keywords: ["h3", "small"],
    group: "Basic",
    icon: Heading3,
    surfaces: BOTH,
    insert: convert("h3"),
  },
  {
    id: "quote",
    title: "Quote",
    keywords: ["blockquote", "cite"],
    group: "Basic",
    icon: Quote,
    surfaces: BOTH,
    insert: convert("quote"),
  },
  {
    id: "code",
    title: "Code",
    keywords: ["snippet", "pre", "monospace"],
    group: "Basic",
    icon: Code,
    surfaces: BOTH,
    insert: convert("code"),
  },
  {
    id: "divider",
    title: "Divider",
    keywords: ["rule", "line", "separator", "hr"],
    group: "Basic",
    icon: Minus,
    surfaces: BOTH,
    insert: (editor) => void editor.chain().focus().setHorizontalRule().run(),
  },
  {
    id: "bullet",
    title: "Bulleted list",
    keywords: ["ul", "unordered", "points"],
    group: "Lists",
    icon: List,
    surfaces: BOTH,
    insert: convert("bullet"),
  },
  {
    id: "ordered",
    title: "Numbered list",
    keywords: ["ol", "ordered", "steps"],
    group: "Lists",
    icon: ListOrdered,
    surfaces: BOTH,
    insert: convert("ordered"),
  },
  {
    id: "task",
    title: "Checklist",
    keywords: ["todo", "to-do", "checkbox", "tasks"],
    group: "Lists",
    icon: ListTodo,
    surfaces: BOTH,
    insert: convert("task"),
  },
  {
    id: "table",
    title: "Table",
    keywords: ["grid", "rows", "columns", "spreadsheet"],
    group: "Layout",
    icon: Table2,
    surfaces: BOTH,
    insert: (editor) => void insertBlock(editor, tableJSON(3, 3)),
  },
  {
    id: "toggle",
    title: "Toggle",
    keywords: ["collapse", "expand", "details", "fold"],
    group: "Layout",
    icon: ListCollapse,
    surfaces: BOTH,
    insert: (editor) => void insertBlock(editor, toggleJSON(0)),
  },
  ...([1, 2, 3] as const).map<BlockItem>((level) => ({
    id: `toggle-h${level}`,
    title: `Toggle heading ${level}`,
    keywords: ["collapse", "expand", "heading", `h${level}`],
    group: "Layout",
    icon: ListCollapse,
    surfaces: BOTH,
    insert: (editor: Editor) => void insertBlock(editor, toggleJSON(level)),
  })),
  {
    id: "callout",
    title: "Callout",
    keywords: ["note", "tip", "warning", "highlight", "box"],
    group: "Layout",
    icon: Lightbulb,
    surfaces: BOTH,
    insert: (editor) => void insertBlock(editor, calloutJSON()),
  },
  {
    id: "contents",
    title: "Table of contents",
    keywords: ["toc", "outline", "headings", "contents"],
    group: "Layout",
    icon: TableOfContents,
    surfaces: BOTH,
    insert: (editor) => void insertBlock(editor, { type: "tableOfContents" }),
  },
];

/** Registers the blocks every editor has. Safe to call more than once (hot reload). */
export function registerCoreBlocks(): void {
  for (const item of CORE) if (!hasBlock(item.id)) registerBlock(item);
}
