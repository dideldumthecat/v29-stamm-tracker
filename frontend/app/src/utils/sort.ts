/** Compare function for attributes and options: V29 maintains the order via `sort_order`. */
export const bySortOrder = (a: { sort_order: number }, b: { sort_order: number }) =>
  a.sort_order - b.sort_order
