"use client";

import { useMemo, useState } from "react";
import { Card, SectionTitle, Button, GarmentThumb } from "@/components/ui";
import { Status, useStatus } from "@/components/Status";
import type { Garment } from "@/lib/types";
import type { ImportedProduct } from "@/lib/import/product";
import { addWishlist } from "@/lib/features/wishlist";

/*
 * What `/api/garments/import` actually answers with.
 *
 * Typed rather than `any`, because `any` is what let this component read
 * `product.price`, `product.url` and `product.imageUrls[0]` — none of which
 * exist on that response. The real names are `pricePaid` and `productUrl`, and
 * the route deliberately strips `imageUrls` because it has already fetched the
 * first photo and stored it, handing back an `imageId` instead. Every one of
 * those three reads was silently undefined, which is why a wishlist entry saved
 * from here came out with no price, no link and no picture — a card with
 * nothing on it but a Remove button.
 */
interface ImportResponse {
  product: Omit<ImportedProduct, "imageUrls">;
  imageId?: string;
  stillNeeded?: string[];
}

function normalize(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

export function ShopCheck({ wardrobe, initialUrl }: { wardrobe: Garment[]; initialUrl: string }) {
  const status = useStatus();
  const [url, setUrl] = useState(initialUrl);
  const [product, setProduct] = useState<ImportResponse["product"] | null>(null);
  const [imageId, setImageId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function check() {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/garments/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const body = (await res.json()) as ImportResponse & { error?: string };
      if (!res.ok) throw new Error(body.error || "The product could not be read.");
      setProduct(body.product);
      setImageId(body.imageId);
    } catch (e) { setError(e instanceof Error ? e.message : "The product could not be read."); }
    finally { setLoading(false); }
  }

  const analysis = useMemo(() => {
    if (!product) return null;
    const category = normalize(product.category || "");
    const matches = wardrobe.filter((g) => category && (normalize(g.category).includes(category) || category.includes(normalize(g.category))));
    // Hoisted out of the closure: `product.brand` is optional, and the guard
    // on the ternary does not narrow it inside the callback.
    const brand = product.brand ? normalize(product.brand) : "";
    const brandMatches = brand ? wardrobe.filter((g) => normalize(g.brand || "") === brand) : [];
    const duplicate = matches.length > 0;
    return { duplicate, matches: matches.slice(0, 5), brandMatches: brandMatches.slice(0, 5) };
  }, [product, wardrobe]);

  const [saving, setSaving] = useState(false);

  async function saveWishlist() {
    if (!product?.name) return;
    setSaving(true);
    try {
      /*
       * The server decides the dedupe key from the URL, so saving the same
       * product twice is one entry. It used to be built here as the name plus
       * `String(product.url)` — always the literal "undefined" — which made
       * every product from one shop collide under a single id.
       */
      const saved = await addWishlist({
        name: product.name,
        url: product.productUrl,
        // The import already fetched and stored the photo; this points at it.
        imageId,
        brand: product.brand,
        price: product.pricePaid,
        currency: product.currency,
      });
      if (!saved.ok) {
        status.fail(saved.error ?? "That didn’t save.");
        return;
      }
      status.say(`Saved ${product.name} to your wishlist.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <SectionTitle hint="Shop Check is evidence, not a buy/no-buy verdict: fit, duplication, wardrobe compatibility and price are shown separately.">Shop Check</SectionTitle>
      <Status {...status.props} />
      <Card className="p-5"><div className="flex flex-col gap-3 sm:flex-row"><input type="text" inputMode="url" className="min-h-12 flex-1" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a product URL…" aria-label="Product URL" /><Button onClick={check} disabled={loading || !url.trim()}>{loading ? "Checking…" : "Check product"}</Button></div>{error && <p className="mt-3 text-sm text-[var(--color-bad)]">{error}</p>}</Card>
      {product && analysis && <>
        <Card className="p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-wide text-[var(--color-faint)]">{product.brand || "Product"}</p><h2 className="display mt-1 text-2xl">{product.name}</h2>{product.pricePaid != null && <p className="mt-1 text-sm text-[var(--color-muted)]">{product.currency || "$"}{Number(product.pricePaid).toFixed(2)}</p>}</div><div className="flex gap-2"><Button variant="ghost" onClick={saveWishlist} disabled={saving}>{saving ? "Saving…" : "Save to wishlist"}</Button>{product.productUrl && <a className="inline-flex min-h-11 items-center rounded-full border border-[var(--color-line)] px-4 text-sm" href={product.productUrl} target="_blank" rel="noreferrer">Open shop</a>}</div></div></Card>
        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="p-5"><p className="text-xs uppercase tracking-wide text-[var(--color-faint)]">Wardrobe overlap</p><p className="display mt-2 text-3xl">{analysis.matches.length}</p><p className="mt-1 text-sm text-[var(--color-muted)]">{analysis.duplicate ? "You already own pieces in this category." : "No obvious category duplicate."}</p></Card>
          <Card className="p-5"><p className="text-xs uppercase tracking-wide text-[var(--color-faint)]">Brand history</p><p className="display mt-2 text-3xl">{analysis.brandMatches.length}</p><p className="mt-1 text-sm text-[var(--color-muted)]">Existing items from the same brand.</p></Card>
          {/*
            This tile used to show a "+N Potential" score. It was not measuring
            anything: the figure was the number of garments you own outside the
            product's category, capped at eight, plus a constant — so a
            twenty-item wardrobe and a five-hundred-item wardrobe both scored
            +16, and an empty wardrobe scored +8. A made-up number in a display
            face, next to two real counts, on a page whose own footer promises
            that every score here is arithmetic.

            What is actually true at this point is that nobody has any fit
            evidence, because shops publish size charts in a modal rather than
            in structured data. Saying so is more use than inventing a number,
            and it points at the one thing that would fix it.
          */}
          <Card className="p-5"><p className="text-xs uppercase tracking-wide text-[var(--color-faint)]">Fit</p><p className="display mt-2 text-3xl">—</p><p className="mt-1 text-sm text-[var(--color-muted)]">No fit verdict yet: this page published no garment measurements. Add it to your wardrobe with a chest or waist figure and the engine can score it against you.</p></Card>
        </div>
        <Card className="p-5"><p className="text-xs uppercase tracking-wide text-[var(--color-faint)]">What to verify before buying</p><ul className="mt-3 space-y-2 text-sm text-[var(--color-muted)]"><li>· Add garment measurements for a real FitCheck score; a product size label alone is lower-confidence.</li><li>· Compare the item against your existing pieces rather than treating the product page photo as fit evidence.</li><li>· Check return policy and the retailer's size chart before purchasing.</li></ul></Card>
        {analysis.matches.length > 0 && <Card className="p-5"><p className="text-xs uppercase tracking-wide text-[var(--color-faint)]">Potential duplicates</p><div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">{analysis.matches.map((g) => <div key={g.id}><div className="aspect-[3/4] overflow-hidden rounded-lg border border-[var(--color-line)]"><GarmentThumb garment={g} /></div><p className="mt-1 truncate text-xs">{g.name}</p></div>)}</div></Card>}
      </>}
    </div>
  );
}