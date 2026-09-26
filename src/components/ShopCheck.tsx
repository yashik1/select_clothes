"use client";

import { useMemo, useState } from "react";
import { Card, SectionTitle, Button, GarmentThumb } from "@/components/ui";
import type { Garment, Profile } from "@/lib/types";
import { addWishlist } from "@/lib/features/wishlist";

function normalize(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

export function ShopCheck({ wardrobe, profile, initialUrl }: { wardrobe: Garment[]; profile: Profile; initialUrl: string }) {
  const [url, setUrl] = useState(initialUrl);
  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function check() {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/garments/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "The product could not be read.");
      setProduct(body.product);
    } catch (e) { setError(e instanceof Error ? e.message : "The product could not be read."); }
    finally { setLoading(false); }
  }

  const analysis = useMemo(() => {
    if (!product) return null;
    const category = normalize(product.category || "");
    const matches = wardrobe.filter((g) => category && (normalize(g.category).includes(category) || category.includes(normalize(g.category))));
    const brandMatches = product.brand ? wardrobe.filter((g) => normalize(g.brand || "") === normalize(product.brand)) : [];
    const duplicate = matches.length > 0;
    const complementary = wardrobe.filter((g) => !matches.includes(g)).slice(0, 8);
    return { duplicate, matches: matches.slice(0, 5), brandMatches: brandMatches.slice(0, 5), complementary, unlockPotential: Math.min(20, Math.max(0, complementary.length + (duplicate ? 2 : 8))) };
  }, [product, wardrobe]);

  function saveWishlist() {
    if (!product) return;
    addWishlist({ id: String(product.name) + "-" + String(product.url), name: product.name, url: product.url, imageUrl: product.imageUrls?.[0], brand: product.brand, price: product.price, currency: product.currency });
  }

  return (
    <div className="space-y-6">
      <SectionTitle hint="Shop Check is evidence, not a buy/no-buy verdict: fit, duplication, wardrobe compatibility and price are shown separately.">Shop Check</SectionTitle>
      <Card className="p-5"><div className="flex flex-col gap-3 sm:flex-row"><input className="min-h-12 flex-1" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a product URL…" /><Button onClick={check} disabled={loading || !url.trim()}>{loading ? "Checking…" : "Check product"}</Button></div>{error && <p className="mt-3 text-sm text-[var(--color-bad)]">{error}</p>}</Card>
      {product && analysis && <>
        <Card className="p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-wide text-[var(--color-faint)]">{product.brand || "Product"}</p><h2 className="display mt-1 text-2xl">{product.name}</h2>{product.price != null && <p className="mt-1 text-sm text-[var(--color-muted)]">{product.currency || "$"}{Number(product.price).toFixed(2)}</p>}</div><div className="flex gap-2"><Button variant="ghost" onClick={saveWishlist}>Save to wishlist</Button>{product.url && <a className="inline-flex min-h-11 items-center rounded-full border border-[var(--color-line)] px-4 text-sm" href={product.url} target="_blank" rel="noreferrer">Open shop</a>}</div></div></Card>
        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="p-5"><p className="text-xs uppercase tracking-wide text-[var(--color-faint)]">Wardrobe overlap</p><p className="display mt-2 text-3xl">{analysis.matches.length}</p><p className="mt-1 text-sm text-[var(--color-muted)]">{analysis.duplicate ? "You already own pieces in this category." : "No obvious category duplicate."}</p></Card>
          <Card className="p-5"><p className="text-xs uppercase tracking-wide text-[var(--color-faint)]">Brand history</p><p className="display mt-2 text-3xl">{analysis.brandMatches.length}</p><p className="mt-1 text-sm text-[var(--color-muted)]">Existing items from the same brand.</p></Card>
          <Card className="p-5"><p className="text-xs uppercase tracking-wide text-[var(--color-faint)]">Potential</p><p className="display mt-2 text-3xl">+{analysis.unlockPotential}</p><p className="mt-1 text-sm text-[var(--color-muted)]">A quick compatibility signal based on your current wardrobe.</p></Card>
        </div>
        <Card className="p-5"><p className="text-xs uppercase tracking-wide text-[var(--color-faint)]">What to verify before buying</p><ul className="mt-3 space-y-2 text-sm text-[var(--color-muted)]"><li>· Add garment measurements for a real FitCheck score; a product size label alone is lower-confidence.</li><li>· Compare the item against your existing pieces rather than treating the product page photo as fit evidence.</li><li>· Check return policy and the retailer's size chart before purchasing.</li></ul></Card>
        {analysis.matches.length > 0 && <Card className="p-5"><p className="text-xs uppercase tracking-wide text-[var(--color-faint)]">Potential duplicates</p><div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">{analysis.matches.map((g) => <div key={g.id}><div className="aspect-[3/4] overflow-hidden rounded-lg border border-[var(--color-line)]"><GarmentThumb garment={g} /></div><p className="mt-1 truncate text-xs">{g.name}</p></div>)}</div></Card>}
      </>}
    </div>
  );
}