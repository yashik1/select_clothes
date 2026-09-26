import { NextResponse } from "next/server";
import { z } from "zod";
import { QUOTA, countOwned, getOutfit, listOutfits, newId, nowIso, saveOutfit } from "@/lib/db";
import { occasionSchema } from "@/lib/validate";
import { parseJsonBody } from "@/lib/http";
import { requireApiUser } from "@/lib/server/session";
import type { Outfit } from "@/lib/types";

/*
 * Saving a combination.
 *
 * The studio could already score anything you assembled and then had nowhere
 * to put it, so every arrangement someone worked out was thrown away the moment
 * they navigated off the page. That is the difference between a calculator and
 * a wardrobe, and it is also what the calendar needs to exist: a plan for
 * Thursday has to point at something.
 */

const schema = z.object({
  /** Supplying an id turns this into an update of that outfit. */
  id: z.string().min(1).max(64).optional(),
  name: z.string().trim().max(80).optional(),
  garmentIds: z.array(z.string().min(1).max(64)).min(1).max(12),
  occasion: occasionSchema,
  /** What the engine said at save time, so a list can be ordered without rescoring. */
  scoreSnapshot: z.number().min(0).max(100).optional(),
  pinned: z.boolean().optional(),
});

export async function GET() {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ outfits: await listOutfits(auth.user.id) });
}

export async function POST(req: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;

  const parsed = await parseJsonBody(req, schema, "Invalid outfit");
  if (!parsed.ok) return parsed.response;
  const input = parsed.data;

  const existing = input.id ? await getOutfit(userId, input.id) : null;

  /*
   * An id that is not ours is refused rather than quietly creating a new
   * outfit under that id. `saveOutfit`'s upsert is guarded on the owner, so
   * the write would be a silent no-op and the response would claim success.
   *
   * Before the quota, not after. Both orders refuse the request, but an
   * account that happens to be at its cap would otherwise be told "you can
   * save up to 2000 outfits" about a request that was never going to be
   * saved — an answer that describes the wrong problem.
   */
  if (input.id && !existing) {
    return NextResponse.json({ error: "No such outfit." }, { status: 404 });
  }

  /*
   * Same shape as the garment cap: count rows, but not on a write that
   * replaces one. An id the account already owns is an edit, and editing the
   * two-thousandth outfit must not be refused for being the two-thousandth.
   */
  if (!existing && (await countOwned(userId, "outfit")) >= QUOTA.outfits) {
    return NextResponse.json(
      { error: `You can save up to ${QUOTA.outfits} outfits. Delete a few first.` },
      { status: 409 },
    );
  }

  const now = nowIso();
  const outfit: Outfit = {
    id: existing?.id ?? newId(),
    name: input.name?.length ? input.name : undefined,
    garmentIds: input.garmentIds,
    occasion: input.occasion,
    scoreSnapshot: input.scoreSnapshot,
    // Pinning is a separate gesture on the list; an edit leaves it alone.
    pinned: input.pinned ?? existing?.pinned ?? false,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const saved = await saveOutfit(userId, outfit);
  // `saveOutfit` deliberately cannot see the share column, so carry over what
  // the row already had rather than reporting the link as gone.
  return NextResponse.json(
    { outfit: { ...saved, shareToken: existing?.shareToken ?? null } },
    { status: existing ? 200 : 201 },
  );
}
