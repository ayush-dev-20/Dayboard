// Manual order is a floating-point `sort_order`. Moving an item sets it to the midpoint of its new
// neighbours, so one row changes instead of renumbering the list.
export const ORDER_STEP = 1024;
/** Below this gap the midpoint is no longer reliable and the list is renumbered. */
export const MIN_ORDER_GAP = 1e-9;

export function orderAtTop(currentMin: number | null): number {
  return currentMin === null ? 0 : currentMin - ORDER_STEP;
}

export function orderAtBottom(currentMax: number | null): number {
  return currentMax === null ? 0 : currentMax + ORDER_STEP;
}

/**
 * `above` is the neighbour that will sit just before the moved item, `below` the one just after.
 * Either may be null (moving to the very top or bottom).
 */
export function orderBetween(
  above: number | null,
  below: number | null,
): { order: number; needsRenumber: boolean } {
  if (above === null && below === null) return { order: 0, needsRenumber: false };
  if (above === null) return { order: (below as number) - ORDER_STEP, needsRenumber: false };
  if (below === null) return { order: above + ORDER_STEP, needsRenumber: false };

  const gap = below - above;
  return { order: above + gap / 2, needsRenumber: Math.abs(gap) < MIN_ORDER_GAP * 2 };
}

/** New evenly spaced orders for ids already in the desired sequence. */
export function renumber(ids: readonly string[]): Map<string, number> {
  return new Map(ids.map((id, index) => [id, index * ORDER_STEP]));
}
