import { NextResponse } from "next/server";
import { z } from "zod";
import {
  QUOTA,
  countOwned,
  getImageRecord,
  listInspiration,
  newId,
  nowIso,
  saveInspiration,
} from "@/lib/db";
import { parseJsonBody } from "@/lib/http";
import { requireApiUser } from "@/lib/server/session";

/*
 * Reference photos of other people's outfits.
 *
 * The picture goes through `/api/images` like every other photo in this app —
 * same downscale, same EXIF handling, same conversion, same byte quota — and
 * this row records what it is. Previously the whole thing was a base64 data URL
 * in `localStorage`, where a single phone photo exceeded the entire budget.
 */

const schema = z.object({
  name: z.string().trim().min(1).max(160),
  /** Uploaded first, through `/api/images` with kind `inspiration`. */
  imageId: z.string().trim().min(1).max(64),
  note: z.string().trim().max(500).optional(),
});

export async function GET() {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ items: await listInspiration(auth.user.id) });
}

export async function POST(req: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;

  const parsed = await parseJsonBody(req, schema, "Invalid reference");
  if (!parsed.ok) return parsed.response;
  const input = parsed.data;

  // Refused rather than stored, unlike the wishlist's optional photo: a board
  // entry is the picture, so a reference to one this account does not own is
  // not a degraded row, it is an empty one.
  if (!(await getImageRecord(userId, input.imageId))) {
    return NextResponse.json({ error: "No such image." }, { status: 404 });
  }

  if ((await countOwned(userId, "inspiration")) >= QUOTA.inspiration) {
    return NextResponse.json(
      { error: `The board holds up to ${QUOTA.inspiration} references. Remove a few first.` },
      { status: 409 },
    );
  }

  const item = await saveInspiration(userId, {
    id: newId(),
    name: input.name,
    imageId: input.imageId,
    note: input.note || undefined,
    createdAt: nowIso(),
  });

  return NextResponse.json({ item }, { status: 201 });
}
