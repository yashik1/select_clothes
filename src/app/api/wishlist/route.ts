import { NextResponse } from "next/server";
import { z } from "zod";
import {
  QUOTA,
  countOwned,
  getImageRecord,
  listWishlist,
  newId,
  nowIso,
  saveWishlistItem,
} from "@/lib/db";
import { parseJsonBody } from "@/lib/http";
import { requireApiUser } from "@/lib/server/session";

/*
 * Things you are considering buying.
 *
 * This lived in `localStorage` until now, which made it the only part of the
 * app that was not a row: missing from the account export, left behind by
 * account deletion, and invisible from any other device. It is a table.
 */

const schema = z.object({
  name: z.string().trim().min(1).max(160),
  url: z.string().trim().max(2048).optional(),
  /** An image this account already owns — the one the importer stored. */
  imageId: z.string().trim().max(64).optional(),
  brand: z.string().trim().max(120).optional(),
  price: z.number().min(0).max(1_000_000).optional(),
  currency: z.string().trim().max(8).optional(),
  notes: z.string().trim().max(500).optional(),
});

export async function GET() {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ items: await listWishlist(auth.user.id) });
}

export async function POST(req: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;

  const parsed = await parseJsonBody(req, schema, "Invalid wishlist item");
  if (!parsed.ok) return parsed.response;
  const input = parsed.data;

  /*
   * The dedupe key, and the reason saving the same product twice is one entry.
   * A URL when there is one; the name otherwise, lowercased so "Blue Shirt" and
   * "blue shirt" are the same intention rather than two rows.
   */
  const key = input.url || `manual:${input.name.toLowerCase()}`;

  /*
   * An id belonging to somebody else must not be storable. It is only ever
   * rendered back through `/api/images/<id>`, which is itself scoped to the
   * owner — so the worst case was a broken picture rather than a leak — but a
   * row that references another account's data is wrong on its own terms.
   */
  const imageId =
    input.imageId && (await getImageRecord(userId, input.imageId)) ? input.imageId : undefined;

  /*
   * Counted before the write, and skipped when this is a replacement — the cap
   * is on how many things you are tracking, and re-saving the two-hundredth
   * must not be refused for being the two-hundredth.
   */
  const existing = (await listWishlist(userId)).find((x) => x.key === key);
  if (!existing && (await countOwned(userId, "wishlist")) >= QUOTA.wishlist) {
    return NextResponse.json(
      { error: `A wishlist holds up to ${QUOTA.wishlist} items. Remove a few first.` },
      { status: 409 },
    );
  }

  const item = await saveWishlistItem(userId, {
    id: existing?.id ?? newId(),
    key,
    name: input.name,
    url: input.url || undefined,
    imageId,
    brand: input.brand || undefined,
    price: input.price,
    currency: input.currency || undefined,
    notes: input.notes || undefined,
    createdAt: existing?.createdAt ?? nowIso(),
  });

  return NextResponse.json({ item }, { status: existing ? 200 : 201 });
}
