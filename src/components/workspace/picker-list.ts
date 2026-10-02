/** Up and Down move between the items of a picker; the search box hands focus to the first one. */
export function handlePickerKeys(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>("[data-picker-item]:not([disabled])"),
  );
  if (items.length === 0) return;
  event.preventDefault();
  const index = items.indexOf(document.activeElement as HTMLElement);
  const next =
    event.key === "ArrowDown"
      ? items[Math.min(items.length - 1, index + 1)]
      : index <= 0
        ? null
        : items[index - 1];
  if (next) next.focus();
  else event.currentTarget.querySelector<HTMLElement>("input")?.focus();
}
