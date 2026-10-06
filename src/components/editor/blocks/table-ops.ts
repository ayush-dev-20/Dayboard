import type { Editor } from "@tiptap/react";
import { TextSelection, type EditorState } from "@tiptap/pm/state";
import {
  TableMap,
  isInTable,
  moveTableColumn,
  moveTableRow,
  selectedRect,
} from "@tiptap/pm/tables";
import { TABLE_MAX_COLUMNS, TABLE_MAX_ROWS } from "@/lib/editor/limits";

// Row and column operations the table toolbar needs beyond what the Tiptap table commands give
// (V2 feature 01 §5). They are plain ProseMirror transactions, so each is one undo step.

export type TableInfo = {
  rows: number;
  columns: number;
  /** The cursor's row and column, 0-based. */
  row: number;
  column: number;
  headerRow: boolean;
  headerColumn: boolean;
  canAddRow: boolean;
  canAddColumn: boolean;
};

export function tableInfo(state: EditorState): TableInfo | null {
  if (!isInTable(state)) return null;
  const rect = selectedRect(state);
  const { map, table } = rect;
  const firstRow = table.child(0);
  const headerRow = Array.from({ length: firstRow.childCount }, (_, i) => firstRow.child(i)).every(
    (cell) => cell.type.name === "tableHeader",
  );
  const headerColumn = Array.from({ length: table.childCount }, (_, i) => table.child(i)).every(
    (row) => row.childCount > 0 && row.child(0).type.name === "tableHeader",
  );
  return {
    rows: map.height,
    columns: map.width,
    row: rect.top,
    column: rect.left,
    headerRow,
    headerColumn,
    canAddRow: map.height < TABLE_MAX_ROWS,
    canAddColumn: map.width < TABLE_MAX_COLUMNS,
  };
}

export function duplicateRow(editor: Editor): boolean {
  const { state } = editor;
  if (!isInTable(state)) return false;
  const rect = selectedRect(state);
  const row = rect.table.child(rect.top);
  let rowPos = rect.tableStart;
  for (let i = 0; i < rect.top; i += 1) rowPos += rect.table.child(i).nodeSize;
  const tr = state.tr.insert(rowPos + row.nodeSize, row.copy(row.content));
  editor.view.dispatch(tr);
  return true;
}

export function duplicateColumn(editor: Editor): boolean {
  const { state } = editor;
  if (!isInTable(state)) return false;
  const rect = selectedRect(state);
  const map = TableMap.get(rect.table);
  const tr = state.tr;
  // Bottom row first, so earlier positions stay valid while cells are added.
  for (let row = map.height - 1; row >= 0; row -= 1) {
    const cellPos = map.map[row * map.width + rect.left]!;
    const cell = rect.table.nodeAt(cellPos)!;
    tr.insert(rect.tableStart + cellPos + cell.nodeSize, cell.copy(cell.content));
  }
  editor.view.dispatch(tr);
  return true;
}

export function moveRow(editor: Editor, direction: -1 | 1): boolean {
  const info = tableInfo(editor.state);
  if (!info) return false;
  const to = info.row + direction;
  if (to < 0 || to >= info.rows) return false;
  return moveTableRow({ from: info.row, to, select: true })(editor.state, editor.view.dispatch);
}

export function moveColumn(editor: Editor, direction: -1 | 1): boolean {
  const info = tableInfo(editor.state);
  if (!info) return false;
  const to = info.column + direction;
  if (to < 0 || to >= info.columns) return false;
  return moveTableColumn({ from: info.column, to, select: true })(
    editor.state,
    editor.view.dispatch,
  );
}

/** The table element the cursor is in, for placing the toolbar. */
export function tableElement(editor: Editor): HTMLElement | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === "table") {
      const dom = editor.view.nodeDOM($from.before(depth));
      return dom instanceof HTMLElement ? dom : null;
    }
  }
  return null;
}

/** Keeps the cursor in the table after an operation that may have moved it. */
export function keepInTable(editor: Editor): void {
  const { state } = editor;
  if (!isInTable(state)) {
    editor.view.dispatch(
      state.tr.setSelection(TextSelection.near(state.doc.resolve(state.selection.from))),
    );
  }
}
