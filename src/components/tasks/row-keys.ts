/**
 * Keyboard for a list of rows. Each row's title button carries `data-row-focus`.
 * Up/Down move focus, Space toggles the row's checkbox, Alt+Up/Down reorders, Enter opens (the button's own click).
 * Returns true when the key was handled.
 */
export function handleRowKeys(
  event: React.KeyboardEvent<HTMLElement>,
  options: { idAttribute: string; onMove: (id: string, direction: -1 | 1) => void },
): boolean {
  const target = event.target as HTMLElement;
  if (!target.matches("[data-row-focus]")) return false;
  const row = target.closest<HTMLElement>(`[data-${options.idAttribute}]`);
  const id = row?.getAttribute(`data-${options.idAttribute}`);
  if (!row || !id) return false;

  if (event.key === " " && !event.altKey && !event.metaKey && !event.ctrlKey) {
    event.preventDefault();
    row.querySelector<HTMLElement>('[role="checkbox"]')?.click();
    return true;
  }

  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return false;
  const direction = event.key === "ArrowDown" ? 1 : -1;

  if (event.altKey) {
    event.preventDefault();
    options.onMove(id, direction);
    return true;
  }
  if (event.metaKey || event.ctrlKey || event.shiftKey) return false;

  event.preventDefault();
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-row-focus]"));
  rows[rows.indexOf(target) + direction]?.focus();
  return true;
}
