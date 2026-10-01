// The shape of a Tiptap/ProseMirror document as stored (canonical form of rich text).
export type TiptapMark = { type: string; attrs?: Record<string, unknown> };

export type TiptapNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  marks?: TiptapMark[];
  text?: string;
};

export type TiptapDoc = { type: "doc"; content?: TiptapNode[] };
