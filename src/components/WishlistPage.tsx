"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  addWishlist,
  listWishlist,
  removeWishlist,
  type WishlistItem,
} from "@/lib/features/wishlist";
import { migrateWishlist } from "@/lib/features/localMigration";
import { Card, SectionTitle, Button, Empty } from "@/components/ui";
import { Status, useStatus } from "@/components/Status";

export function WishlistPage({ initial }: { initial: WishlistItem[] }) {
  // Seeded from the server render, so the list is right on the first paint
  // rather than flashing empty and filling in.
  const [items, setItems] = useState<WishlistItem[]>(initial);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const status = useStatus();

  const refresh = useCallback(async () => setItems(await listWishlist()), []);

  useEffect(() => {
    // Anything left in the old browser-only wishlist is moved across once.
    void (async () => {
      const moved = await migrateWishlist();
      if (moved > 0) {
        status.say(`Moved ${moved} saved ${moved === 1 ? "item" : "items"} into your account.`);
        await refresh();
      }
    })();
    // Deliberately once on mount: the migration clears the key it reads, and
    // `status` changes identity on every message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function add() {
    if (!name.trim()) {
      status.fail("Give it a name first.");
      return;
    }
    const parsedPrice = price.trim() === "" ? undefined : Number(price);
    if (parsedPrice !== undefined && !Number.isFinite(parsedPrice)) {
      status.fail("That price isn’t a number.");
      return;
    }

    setBusy(true);
    try {
      const saved = await addWishlist({
        name: name.trim(),
        url: url.trim() || undefined,
        price: parsedPrice,
      });
      if (!saved.ok) {
        status.fail(saved.error ?? "That didn’t save.");
        return;
      }
      setName("");
      setUrl("");
      setPrice("");
      status.say(`Saved ${saved.item?.name ?? "it"}.`);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: WishlistItem) {
    setBusy(true);
    try {
      const gone = await removeWishlist(item.id);
      if (!gone.ok) {
        status.fail(gone.error ?? "Couldn’t remove that.");
        return;
      }
      status.say(`Removed ${item.name}.`);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <SectionTitle hint="Keep products you are considering in one place, then run them through Shop Check before buying.">
        Wishlist
      </SectionTitle>

      <Status {...status.props} />

      <Card className="p-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_9rem_auto]">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Item name"
            aria-label="Item name"
          />
          <input
            type="text"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Product URL"
            aria-label="Product URL"
          />
          <input
            type="text"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Price"
            inputMode="decimal"
            aria-label="Price"
          />
          <Button onClick={add} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </Card>

      {items.length === 0 ? (
        <Empty
          title="Your wishlist is empty"
          body="Save products here before buying them. Shop Check can then compare them with what you already own."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <Card key={item.id} className="flex h-full flex-col p-5">
              {item.imageId && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/images/${item.imageId}`}
                  alt=""
                  className="mb-3 aspect-[3/4] w-full rounded-lg object-cover"
                />
              )}
              <p className="font-medium">{item.name}</p>
              {item.brand && <p className="text-xs text-[var(--color-faint)]">{item.brand}</p>}
              {item.price != null && (
                <p className="mt-1 text-sm text-[var(--color-muted)]">
                  {item.currency ?? "$"}
                  {item.price.toFixed(2)}
                </p>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {item.url && (
                  <Link
                    href={`/shop-check?url=${encodeURIComponent(item.url)}`}
                    className="inline-flex min-h-10 items-center rounded-full bg-[var(--color-ink)] px-4 text-xs text-white"
                  >
                    Shop Check
                  </Link>
                )}
                {item.url && (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-10 items-center rounded-full border border-[var(--color-line)] px-4 text-xs"
                  >
                    Open product
                  </a>
                )}
                <button
                  onClick={() => remove(item)}
                  disabled={busy}
                  className="min-h-10 px-2 text-xs text-[var(--color-muted)] hover:text-[var(--color-bad)] disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
