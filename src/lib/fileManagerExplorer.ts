export type ExplorerFolder = { id: string; parent_id: string | null; folder_type: string };

export function folderToneClass(folderType: string): string {
  switch (folderType) {
    case 'root': return 'text-sky-600 bg-sky-500/10 border-sky-500/25';
    case 'client': return 'text-amber-600 bg-amber-500/10 border-amber-500/25';
    case 'shipment': return 'text-blue-600 bg-blue-500/10 border-blue-500/25';
    case 'accounting_finance': return 'text-emerald-600 bg-emerald-500/10 border-emerald-500/25';
    case 'declaration': return 'text-orange-600 bg-orange-500/10 border-orange-500/25';
    case 'permits': return 'text-violet-600 bg-violet-500/10 border-violet-500/25';
    case 'exit': return 'text-rose-600 bg-rose-500/10 border-rose-500/25';
    case 'shipping_docs': return 'text-cyan-600 bg-cyan-500/10 border-cyan-500/25';
    case 'purchase_docs': return 'text-lime-600 bg-lime-500/10 border-lime-500/25';
    case 'warehouse_receipt': return 'text-teal-600 bg-teal-500/10 border-teal-500/25';
    default: return 'text-indigo-600 bg-indigo-500/10 border-indigo-500/25';
  }
}

export function isCopyableFolder(folder: Pick<ExplorerFolder, 'folder_type'> | null | undefined): boolean {
  return Boolean(folder && !['root', 'client', 'shipment'].includes(folder.folder_type));
}

export function getFolderSubtreeCounts(folders: ExplorerFolder[], directCounts: Record<string, number>): Record<string, number> {
  const children = new Map<string, ExplorerFolder[]>();
  for (const folder of folders) {
    if (!folder.parent_id) continue;
    const current = children.get(folder.parent_id) || [];
    current.push(folder);
    children.set(folder.parent_id, current);
  }
  const memo = new Map<string, number>();
  const count = (id: string, path: Set<string>): number => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    if (path.has(id)) return Math.max(0, directCounts[id] || 0);
    const nextPath = new Set(path);
    nextPath.add(id);
    let total = Math.max(0, directCounts[id] || 0);
    for (const child of children.get(id) || []) total += count(child.id, nextPath);
    memo.set(id, total);
    return total;
  };
  for (const folder of folders) count(folder.id, new Set());
  return Object.fromEntries(memo.entries());
}
