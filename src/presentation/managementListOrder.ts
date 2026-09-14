/**
 * Display-order contract of the management lists (`docs/UI_FLOW.md` 3.2).
 *
 * Owned Weapons and Target Weapons are never auto-sorted: a new item is
 * appended, an edited item replaces itself at its original index, and a
 * deletion keeps every other item's relative order. Editing alone must never
 * move an item to the end.
 */
export function upsertPreservingOrder<T extends { id: string }>(
  items: readonly T[],
  saved: T,
): T[] {
  const index = items.findIndex(({ id }) => id === saved.id)
  if (index === -1) return [...items, saved]
  return items.map((item, position) => (position === index ? saved : item))
}
