import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteOutfit, getOutfit, saveOutfit, setOutfitShare } from "@/lib/db";
import { parseJsonBody } from "@/lib/http";
import { requireApiUser } from "@/lib/server/session";

/**
 * The share token.
 *
 * 16 bytes of `randomBytes`, hex, so the link is the whole authorisation and
 * has to be unguessable on its own — there is no second factor behind it and
 * no account check when it is redeemed. 128 bits is the same budget the
 * session cookie works to.
 *
 * Unlike a session token this one is stored in the clear, because it is not a
 * credential the owner authenticates with: it grants read of one outfit. It
 * has to be printable back to the person who minted it, which a hash cannot
 * be, and the blast radius of a leaked database row is that one outfit rather
 * than the account.
 */
function newShareToken(): string {
  return randomBytes(16).toString("hex");
}

const patchSchema = z
  .object({
    name: z.string().trim().max(80).nullable().optional(),
    pinned: z.boolean().optional(),
    /** true mints a link if there isn't one; false revokes whatever there is. */
    shared: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;
  const { id } = await params;

  const parsed = await parseJsonBody(req, patchSchema);
  if (!parsed.ok) return parsed.response;
  const patch = parsed.data;

  const existing = await getOutfit(userId, id);
  // An outfit belonging to someone else answers the same way as one that isn't
  // there, so this never confirms another account's ids.
  if (!existing) return NextResponse.json({ error: "No such outfit." }, { status: 404 });

  let outfit = existing;

  if (patch.name !== undefined || patch.pinned !== undefined) {
    outfit = await saveOutfit(userId, {
      ...outfit,
      name: patch.name === null || patch.name === "" ? undefined : (patch.name ?? outfit.name),
      pinned: patch.pinned ?? outfit.pinned,
    });
  }

  if (patch.shared !== undefined) {
    /*
     * Re-sharing keeps the existing token. Minting a fresh one on every toggle
     * would silently break a link already sitting in somebody's messages, and
     * the gesture people mean by tapping "share" twice is "show me the link",
     * not "invalidate it". Revoking is the deliberate way to break it.
     */
    const token = patch.shared ? (existing.shareToken ?? newShareToken()) : null;
    const updated = await setOutfitShare(userId, id, token);
    if (!updated) return NextResponse.json({ error: "No such outfit." }, { status: 404 });
    outfit = { ...outfit, shareToken: updated.shareToken, updatedAt: updated.updatedAt };
  } else {
    outfit = { ...outfit, shareToken: existing.shareToken };
  }

  return NextResponse.json({ outfit });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  await deleteOutfit(auth.user.id, id);
  /*
   * Plans pointing at it are left alone on purpose. A plan stores the garment
   * ids as well as the outfit id, so Thursday still knows what you meant to
   * wear after the saved outfit it came from is gone — deleting a shortcut
   * should not empty the calendar.
   */
  return NextResponse.json({ ok: true });
}
