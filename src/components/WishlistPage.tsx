"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { addWishlist, listWishlist, removeWishlist, type WishlistItem } from "@/lib/features/wishlist";
import { Card, SectionTitle, Button, Empty } from "@/components/ui";
import { Status, useStatus } from "@/components/Status";

export function WishlistPage() {
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [price, setPrice] = useState("");
  const status = useStatus();

  const refresh = useCallback(() => setItems(listWishlist()), []);

  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    window.addEventListener("fitcheck:wishlist", onChange);
    return () => window.removeEventListener("fitcheck:wishlist", onChange);
  }, [refresh]);

  function add() {
    if (!name.trim()) {
      status.fail("Give it a name first.");
      return;
    }

    /*
     * Keyed on the URL when there is one, so saving the same product twice is
     * one entry rather than two. The previous key was the slugged name plus the
     * raw URL, which made "Blue Shirt" and "blue shirt!" two different items
     * and any two unnamed URLs collide.
     */
    const trimmedUrl = url.trim();
    const parsedPrice = price.trim() === "" ? undefined : Number(price);
    if (parsedPrice !== undefined && !Number.isFinite(parsedPrice)) {
      status.fail("That price isn’t a number.");
      return;
    }

    const ok = addWishlist({
      id: trimmedUrl || `manual:${name.trim().toLowerCase()}`,
      name: name.trim(),
      url: trimmedUrl || undefined,
      price: parsedPrice,
    });
    if (!ok) {
      status.fail("There’s no room left in this browser’s storage.");
      return;
    }

    setName("");
    setUrl("");
    setPrice("");
    status.say(`Saved ${name.trim()}.`);
    refresh();
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
          <Button onClick={add}>Save</Button>
        </div>
        <p className="mt-3 text-xs text-[var(--color-faint)]">
          Kept in this browser, not in your account — these won&rsquo;t appear on another device or
          in your data export.
        </p>
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
              {item.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.imageUrl}
                  alt=""
                  className="mb-3 aspect-[3/4] w-full rounded-lg object-cover"
                />
              )}
              <p className="font-medium">{item.name}</p>
              {item.brand && (
                <p className="text-xs text-[var(--color-faint)]">{item.brand}</p>
              )}
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
                  onClick={() => {
                    if (!removeWishlist(item.id)) {
                      status.fail("Couldn’t update this browser’s storage.");
                      return;
                    }
                    status.say(`Removed ${item.name}.`);
                    refresh();
                  }}
                  className="min-h-10 px-2 text-xs text-[var(--color-muted)] hover:text-[var(--color-bad)]"
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
