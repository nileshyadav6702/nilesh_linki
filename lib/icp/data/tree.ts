/** A two-level taxonomy entry: a selectable parent with optional selectable children. */
export interface TreeNode { label: string; children?: string[] }

/** Builds nodes from a { parent: children[] } map; an empty array means a leaf. */
export function toNodes(map: Record<string, string[]>): TreeNode[] {
  return Object.entries(map).map(([label, children]) => (children.length ? { label, children } : { label }));
}
