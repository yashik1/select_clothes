import type { WishlistItem } from "@/lib/types";

/*
 * The wishlist, over the API.
 *
 * This used to be a `localStorage` module with the same function names. It is
 * kept as a module rather than folded into the components because two screens
 * write to it — the wishlist page and Shop Check — and they should not each
 * reimplement the request.
 *
 * Every function returns what happened rather than throwing, because every
 * caller is a click handler: an unhandled rejection there clears the spinner
 * and leaves the button looking like it simply did not work.
 */

export type { WishlistItem };

export interface Saved {
  ok: boolean;
  item?: WishlistItem;
  error?: string;
}

/** The shape the API accepts. `key` and `id` are the server's business. */
export type NewWishlistItem = Omit<WishlistItem, "id" | "key" | "createdAt">;

async function problem(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error || fallback;
  } catch {
    return fallback;
  }
}

export async function listWishlist(): Promise<WishlistItem[]> {
  try {
    const res = await fetch("/api/wishlist");
    if (!res.ok) return [];
    return ((await res.json()) as { items: WishlistItem[] }).items;
  } catch {
    return [];
  }
}

export async function addWishlist(item: NewWishlistItem): Promise<Saved> {
  try {
    const res = await fetch("/api/wishlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item),
    });
    if (!res.ok) return { ok: false, error: await problem(res, "That didn’t save.") };
    return { ok: true, item: ((await res.json()) as { item: WishlistItem }).item };
  } catch {
    return { ok: false, error: "That didn’t save — check your connection." };
  }
}

export async function removeWishlist(id: string): Promise<Saved> {
  try {
    const res = await fetch(`/api/wishlist/${id}`, { method: "DELETE" });
    if (!res.ok) return { ok: false, error: await problem(res, "Couldn’t remove that.") };
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn’t remove that — check your connection." };
  }
}
