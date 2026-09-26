"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { addWishlist, listWishlist, removeWishlist, type WishlistItem } from "@/lib/features/wishlist";
import { Card, SectionTitle, Button, Empty } from "@/components/ui";

export function WishlistPage() {
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [price, setPrice] = useState("");

  function refresh() { setItems(listWishlist()); }
  useEffect(() => { refresh(); const fn = () => refresh(); window.addEventListener("fitcheck:wishlist", fn); return () => window.removeEventListener("fitcheck:wishlist", fn); }, []);

  function add() {
    if (!name.trim()) return;
    const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + url.trim();
    addWishlist({ id, name: name.trim(), url: url.trim() || undefined, price: price ? Number(price) : undefined });
    setName(""); setUrl(""); setPrice(""); refresh();
  }

  return (
    <div className="space-y-6">
      <SectionTitle hint="Keep products you are considering in one place, then run them through Shop Check before buying.">Wishlist</SectionTitle>
      <Card className="p-5"><div className="grid gap-3 sm:grid-cols-[1fr_1fr_9rem_auto]"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Item name" /><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Product URL" /><input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price" inputMode="decimal" /><Button onClick={add}>Save</Button></div></Card>
      {items.length === 0 ? <Empty title="Your wishlist is empty" body="Save products here before buying them. Shop Check can then compare them with what you already own." /> :
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{items.map((item) => <Card key={item.id} className="p-5"><p className="font-medium">{item.name}</p>{item.price != null && <p className="mt-1 text-sm text-[var(--color-muted)]">{item.currency ?? "$"}{item.price.toFixed(2)}</p>}<div className="mt-4 flex flex-wrap gap-2">{item.url && <Link href={"/shop-check?url=" + encodeURIComponent(item.url)} className="inline-flex min-h-10 items-center rounded-full bg-[var(--color-ink)] px-4 text-xs text-white">Shop Check</Link>}{item.url && <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center rounded-full border border-[var(--color-line)] px-4 text-xs">Open product</a>}<button onClick={() => { removeWishlist(item.id); refresh(); }} className="text-xs text-[var(--color-muted)]">Remove</button></div></Card>)}</div>}
    </div>
  );
}