/*
 * Rescuing what the browser-only versions left behind.
 *
 * The wishlist and the inspiration board both used to live in `localStorage`.
 * They are tables now, and anybody who used the old version has rows sitting in
 * a browser that nothing reads any more — so on first load each page offers
 * them to the server once and then clears the key.
 *
 * Two rules make this safe to run on every mount:
 *
 *  - the key is only removed when every item went, so a failed request means it
 *    is tried again next time rather than silently dropped;
 *  - duplicates are the server's problem, not this file's. The wishlist upserts
 *    on `(user_id, key)`, so importing the same entry twice is one row.
 *
 * This is meant to be deleted. Once the people using it have opened the app
 * once, it does nothing but read an empty key.
 */

const WISHLIST_KEY = "fitcheck:wishlist:v1";
const INSPIRATION_KEY = "fitcheck:inspiration:v1";

function readArray(key: string): unknown[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function forget(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* Nothing more to do; it will be retried and will upsert to the same rows. */
  }
}

/** Returns how many were moved, so the page can say so rather than silently changing. */
export async function migrateWishlist(): Promise<number> {
  const old = readArray(WISHLIST_KEY) as {
    name?: string;
    url?: string;
    brand?: string;
    price?: number;
    currency?: string;
  }[];
  if (!old.length) return 0;

  let moved = 0;
  for (const item of old) {
    if (!item?.name) continue;
    const res = await fetch("/api/wishlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: item.name,
        url: item.url,
        brand: item.brand,
        price: typeof item.price === "number" ? item.price : undefined,
        currency: item.currency,
      }),
    }).catch(() => null);
    if (res?.ok) moved++;
  }

  if (moved === old.filter((i) => i?.name).length) forget(WISHLIST_KEY);
  return moved;
}

/**
 * The board's images were base64 data URLs. Each one is turned back into a file
 * and uploaded through `/api/images`, the same path every other photo takes.
 */
export async function migrateInspiration(): Promise<number> {
  const old = readArray(INSPIRATION_KEY) as { name?: string; dataUrl?: string }[];
  if (!old.length) return 0;

  let moved = 0;
  for (const look of old) {
    if (!look?.dataUrl) continue;
    try {
      const blob = await (await fetch(look.dataUrl)).blob();
      const form = new FormData();
      form.append("file", new File([blob], "reference.jpg", { type: blob.type || "image/jpeg" }));
      form.append("kind", "inspiration");
      const up = await fetch("/api/images", { method: "POST", body: form });
      if (!up.ok) continue;
      const { id } = (await up.json()) as { id: string };

      const saved = await fetch("/api/inspiration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: look.name || "Reference", imageId: id }),
      });
      if (saved.ok) moved++;
    } catch {
      /* Left in place, retried next load. */
    }
  }

  if (moved === old.filter((i) => i?.dataUrl).length) forget(INSPIRATION_KEY);
  return moved;
}
