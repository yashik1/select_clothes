export interface WishlistItem {
  id: string;
  name: string;
  url?: string;
  imageUrl?: string;
  brand?: string;
  price?: number;
  currency?: string;
  category?: string;
  color?: string;
  notes?: string;
  createdAt: string;
}

const KEY = "fitcheck:wishlist:v1";

function read(): WishlistItem[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

/**
 * Returns whether it stuck, rather than throwing.
 *
 * `setItem` throws `QuotaExceededError` on a full origin, and throws
 * unconditionally in Safari's private mode. Called bare, that rejection
 * propagates out of a click handler where nothing is catching it: the caller
 * has usually already updated the screen, so the item appears to have been
 * saved and is gone on the next load. Callers check the return.
 */
function write(items: WishlistItem[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    return false;
  }
  window.dispatchEvent(new CustomEvent("fitcheck:wishlist"));
  return true;
}

export function listWishlist() {
  return read().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function addWishlist(item: Omit<WishlistItem, "createdAt">): boolean {
  const current = read().filter((x) => x.id !== item.id);
  return write([{ ...item, createdAt: new Date().toISOString() }, ...current].slice(0, 200));
}

export function removeWishlist(id: string): boolean {
  return write(read().filter((x) => x.id !== id));
}

export function isWishlisted(id: string) {
  return read().some((x) => x.id === id);
}