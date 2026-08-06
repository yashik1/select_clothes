import { NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteImages, deleteImagesByKindPrefix, getImageRecord, getOrCreateProfile, saveProfile,
} from "@/lib/db";
import { parseJsonBody } from "@/lib/http";
import { requireApiUser } from "@/lib/server/session";

const schema = z.object({
  /** Null clears the photo, which is how someone takes it back. */
  imageId: z.string().max(64).nullable(),
});

/**
 * Sets the photo of yourself that try-on renders against.
 *
 * Its own endpoint rather than a field on `PUT /api/profile`, because that
 * route validates a whole profile — name, units, every measurement — and
 * demanding all of it to attach one photo would mean the garment page had to
 * hold a copy of the profile just to avoid wiping it.
 */
export async function PUT(req: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;

  const parsed = await parseJsonBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { imageId } = parsed.data;

  // An id belonging to somebody else, or to nothing, would otherwise be stored
  // and then quietly fail at render time with a confusing message.
  if (imageId && !(await getImageRecord(userId, imageId))) {
    return NextResponse.json({ error: "That photo doesn't exist." }, { status: 404 });
  }

  const profile = await getOrCreateProfile(userId);
  const previous = profile.bodyPhotoIds ?? [];
  if (previous[0] === imageId) {
    return NextResponse.json({ ok: true, imageId, unchanged: true });
  }

  await saveProfile(userId, { ...profile, bodyPhotoIds: imageId ? [imageId] : [] });

  /*
   * Every cached render was of the old body. They are all wrong at once, and
   * keeping them would spend this account's photo budget on pictures nothing
   * will ever show.
   */
  const dropped = await deleteImagesByKindPrefix(userId, "tryon:");

  // The superseded photo, by id — not by kind, which would take the one just
  // attached along with it.
  await deleteImages(
    userId,
    previous.filter((id) => id !== imageId),
  );

  return NextResponse.json({ ok: true, imageId, cachedRendersCleared: dropped });
}
