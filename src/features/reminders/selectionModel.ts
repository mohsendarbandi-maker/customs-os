export type SelectableReminder = { id: string };

/** Temporary offline drafts cannot be updated by server-side bulk actions. */
export function selectableReminderIds(rows: readonly SelectableReminder[]): string[] {
  return rows.filter((row) => !row.id.startsWith('local-')).map((row) => row.id);
}

/** Toggle one persisted reminder without mutating the caller's selection. */
export function toggleReminderSelection(selected: readonly string[], id: string): string[] {
  if (id.startsWith('local-')) return [...selected];
  return selected.includes(id)
    ? selected.filter((selectedId) => selectedId !== id)
    : [...selected, id];
}

/** Add all eligible visible rows once, leaving existing selections intact. */
export function selectVisibleReminderIds(
  selected: readonly string[],
  visibleIds: readonly string[],
): string[] {
  return [...new Set([...selected, ...visibleIds.filter((id) => !id.startsWith('local-'))])];
}

/** True only when at least one visible server-backed reminder exists and every one is selected. */
export function areAllVisibleReminderIdsSelected(
  selected: readonly string[],
  visibleIds: readonly string[],
): boolean {
  const eligible = visibleIds.filter((id) => !id.startsWith('local-'));
  return eligible.length > 0 && eligible.every((id) => selected.includes(id));
}

/** Remove the current page's selection without disturbing any other selected IDs. */
export function deselectVisibleReminderIds(
  selected: readonly string[],
  visibleIds: readonly string[],
): string[] {
  const visible = new Set(visibleIds.filter((id) => !id.startsWith('local-')));
  return selected.filter((id) => !visible.has(id));
}
