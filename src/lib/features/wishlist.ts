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

function write(items: WishlistItem[]) {
  localStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent("fitcheck:wishlist"));
}

export function listWishlist() {
  return read().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function addWishlist(item: Omit<WishlistItem, "createdAt">) {
  const current = read().filter((x) => x.id !== item.id);
  write([{ ...item, createdAt: new Date().toISOString() }, ...current].slice(0, 200));
}

export function removeWishlist(id: string) {
  write(read().filter((x) => x.id !== id));
}

export function isWishlisted(id: string) {
  return read().some((x) => x.id === id);
}