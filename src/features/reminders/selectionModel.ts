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
