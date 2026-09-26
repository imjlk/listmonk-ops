/**
 * Sort directions accepted by the shared campaign and subscriber list
 * operations. Listmonk 6.2 compares `order` with lowercase `asc`/`desc`
 * and silently sorts descending for any other value, so uppercase `ASC`
 * never ascends. The uppercase spellings stay accepted for existing
 * callers and are sent lowercase.
 */
export const LISTMONK_SORT_ORDERS = ["asc", "desc", "ASC", "DESC"] as const;

export type ListmonkSortOrder = (typeof LISTMONK_SORT_ORDERS)[number];

/** Map an accepted sort direction to the lowercase value Listmonk honors. */
export function toListmonkSortOrder(order: ListmonkSortOrder): "asc" | "desc" {
	return order.toLowerCase() === "asc" ? "asc" : "desc";
}
