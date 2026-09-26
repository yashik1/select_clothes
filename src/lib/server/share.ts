import "server-only";

import { getGarments, getOutfitByShareToken } from "@/lib/db";
import type { Garment, Outfit } from "@/lib/types";

/**
 * Reading an outfit somebody shared.
 *
 * This is the one path into the data that isn't scoped to a signed-in account,
 * so it is deliberately the narrowest one in the codebase: a token resolves to
 * exactly one outfit and the garments that outfit names, and nothing else about
 * the owner comes back with it — not their email, not their id beyond what is
 * needed to run the two lookups, not the rest of their wardrobe, and not their
 * measurements.
 *
 * What a viewer is therefore able to learn is the set of clothes in one outfit
 * and how well it scores. That is the whole point of the link, and it is the
 * ceiling on it.
 */
export interface SharedOutfit {
  outfit: Outfit;
  garments: Garment[];
  /** The owner, for follow-up lookups only. Never rendered. */
  ownerId: string;
}

/** 16 random bytes, hex. Anything else cannot be a token we issued. */
const TOKEN = /^[0-9a-f]{32}$/;

export async function loadSharedOutfit(token: string): Promise<SharedOutfit | null> {
  // Checked before the query so a malformed link costs nothing, and so the
  // column is never searched with a value it cannot hold.
  if (!TOKEN.test(token)) return null;

  const found = await getOutfitByShareToken(token);
  if (!found) return null;

  const garments = await getGarments(found.userId, found.outfit.garmentIds);
  if (!garments.length) return null;

  return { outfit: found.outfit, garments, ownerId: found.userId };
}

/**
 * Whether a shared link entitles the holder to one particular photo.
 *
 * Photos are otherwise private to their account, and the share page needs to
 * show the clothes or it is useless. So the rule is exactly as tight as it can
 * be: the image must belong to a garment that the shared outfit itself names.
 * A photo of the owner's body, of a garment they did not put in this outfit, or
 * of anything at all belonging to a different account, is not reachable.
 */
export async function shareGrantsImage(token: string, imageId: string): Promise<string | null> {
  const shared = await loadSharedOutfit(token);
  if (!shared) return null;

  for (const garment of shared.garments) {
    if (garment.imageIds?.includes(imageId)) return shared.ownerId;
  }
  return null;
}
