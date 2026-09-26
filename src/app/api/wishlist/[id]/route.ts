import { NextResponse } from "next/server";
import { deleteImageIfUnused, deleteWishlistItem, getWishlistItem } from "@/lib/db";
import { requireApiUser } from "@/lib/server/session";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;
  const { id } = await params;

  // Read first, so the photo it points at is known before the row is gone.
  const item = await getWishlistItem(userId, id);
  // An item belonging to somebody else answers the same way as one that was
  // never there.
  if (!item) return NextResponse.json({ error: "No such item." }, { status: 404 });

  await deleteWishlistItem(userId, id);

  /*
   * An entry saved from Shop Check reuses the photo the importer already
   * fetched and stored, and that is the same photo the add-a-garment form
   * pre-fills with — so a garment may now be the thing pointing at it. Deleting
   * it unconditionally would pull the picture out from under that garment;
   * never deleting it would leak the account's photo quota to a row no screen
   * can reach. So: only when nothing else refers to it.
   */
  if (item.imageId) await deleteImageIfUnused(userId, item.imageId);

  return NextResponse.json({ ok: true });
}
