import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonBody } from "@/lib/http";
import { requireApiUser } from "@/lib/server/session";
import { storeImage } from "@/lib/server/storeImage";
import { ImportError, fetchPublic, fetchPublicText } from "@/lib/import/fetch";
import {
  extractProduct,
  shopifyJsonUrl,
  stillNeeded,
  type ImportedProduct,
} from "@/lib/import/product";

const schema = z.object({ url: z.string().min(4).max(2048) });

const PAGE_ACCEPT = "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8";
const IMAGE_ACCEPT = "image/avif,image/webp,image/jpeg,image/png,*/*;q=0.8";
const IMAGE_LIMIT = 8 * 1024 * 1024;

/**
 * Reads one product page and hands back fields to pre-fill the add-item form.
 *
 * It deliberately does not create the garment. Everything structured data can
 * give is catalogue metadata; the measurements the fit engine actually runs on
 * are not in there and never will be, so saving silently would produce an item
 * that looks complete and scores at the confidence of a guessed size. The form
 * opens pre-filled instead, still visibly asking for the tape measure.
 */
export async function POST(req: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;

  const parsed = await parseJsonBody(req, schema);
  if (!parsed.ok) return parsed.response;

  const raw = parsed.data.url.trim();

  /*
   * A bare "shop.example/x" is what people paste, so a missing scheme gets
   * https. But only a missing one: prefixing blindly turned "file:///etc/passwd"
   * into "https://file:///etc/passwd", which failed later by accident at DNS
   * and reported "site not found". Refusing it here makes the refusal
   * deliberate and the message true.
   */
  const scheme = raw.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (scheme && scheme !== "http" && scheme !== "https") {
    return NextResponse.json(
      { error: "Only http and https links can be imported." },
      { status: 400 },
    );
  }
  const url = scheme ? raw : `https://${raw}`;

  try {
    let product: ImportedProduct | null = null;

    // Shopify first: it is exact, and it is a large share of the independent
    // brands people actually buy from.
    const shopify = shopifyJsonUrl(url);
    if (shopify) {
      try {
        const res = await fetchPublicText(shopify, "application/json");
        if (res.status === 200 && res.contentType.includes("json")) {
          const candidate = extractProduct(url, { shopifyJson: res.body });
          if (candidate.source === "shopify") product = candidate;
        }
      } catch {
        // Not a Shopify store, or it declined. Fall through to the page.
      }
    }

    if (!product) {
      const page = await fetchPublicText(url, PAGE_ACCEPT);
      if (page.status === 403 || page.status === 401) {
        return NextResponse.json(
          {
            error:
              "That shop refused the request. Some sites only answer browsers — save the photo and add the item by hand.",
          },
          { status: 422 },
        );
      }
      if (page.status >= 400 || !page.body) {
        return NextResponse.json(
          { error: `That page returned ${page.status || "no content"}.` },
          { status: 422 },
        );
      }
      product = extractProduct(page.finalUrl, { html: page.body });
    }

    if (product.source === "none" || !product.name) {
      return NextResponse.json(
        {
          error:
            "That page doesn't publish product data this can read. Add the item by hand — the photo and the measurements are what matter most anyway.",
        },
        { status: 422 },
      );
    }

    // The shop's colour word is a name, not a value; the photo is what tells
    // the colour engine anything, so it comes in through the same pipeline as
    // an upload and the client reads the colours back off it.
    let imageId: string | undefined;
    if (product.imageUrls.length) {
      try {
        const img = await fetchPublic(product.imageUrls[0], IMAGE_ACCEPT, IMAGE_LIMIT);
        if (img.status === 200 && img.bytes.length) {
          imageId = await storeImage(userId, img.bytes, "garment");
        }
      } catch {
        // A missing photo is not a failed import.
      }
    }

    return NextResponse.json({
      product: { ...product, imageUrls: undefined },
      imageId,
      stillNeeded: stillNeeded(product),
    });
  } catch (err) {
    if (err instanceof ImportError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[import] failed:", err);
    return NextResponse.json({ error: "That link couldn't be read." }, { status: 500 });
  }
}
