import { NextResponse } from "next/server";
import { readFormBody } from "@/lib/http";
import { requireApiUser } from "@/lib/server/session";
import { REFUSED_MIME, describeImageError, normaliseImage } from "@/lib/server/storeImage";
import { QUOTA, imageBytesUsed, newId, nowIso, saveImage } from "@/lib/db";

/**
 * Originals can be large — a phone HEIC or a 48MP JPEG runs to tens of
 * megabytes — and the browser only sends the original when it couldn't decode
 * the file itself. What gets stored is always far smaller than this.
 */
const MAX_BYTES = 30 * 1024 * 1024;




/**
 * Normalises whatever arrives into one stored form.
 *
 * The browser downscales when it can, but it can't decode everything — Chrome
 * has no HEIC decoder, and no browser reads TIFF — so anything it fails on is
 * sent here whole and converted with libvips instead. Doing the conversion in
 * one place also means the stored image is consistent regardless of which path
 * it came in by: sRGB, EXIF rotation applied, metadata dropped.
 */
export async function POST(req: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;

  const read = await readFormBody(req);
  if (!read.ok) return read.response;

  const file = read.data.get("file");
  const kind = (read.data.get("kind") as string) || "garment";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file supplied." }, { status: 400 });
  }
  if (REFUSED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: "SVG files aren't accepted. Use a photo." },
      { status: 415 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `That image is ${(file.size / 1024 / 1024).toFixed(0)}MB. The limit is 30MB.` },
      { status: 413 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "That file is empty." }, { status: 400 });
  }

  let bytes: Buffer;
  try {
    bytes = await normaliseImage(Buffer.from(await file.arrayBuffer()));
  } catch (err) {
    console.error("[images] conversion failed:", err);
    return NextResponse.json({ error: describeImageError(err) }, { status: 415 });
  }

  /*
   * Checked after conversion, against the size that will actually be stored —
   * measuring the upload instead would reject a 20MB HEIC that becomes a 300KB
   * JPEG. There is a race here if someone uploads in parallel, and it does not
   * matter: the worst case is a few megabytes over a 256MB line.
   */
  const used = await imageBytesUsed(userId);
  if (used + bytes.length > QUOTA.imageBytes) {
    return NextResponse.json(
      {
        error:
          `Your photos already use ${(used / 1024 / 1024).toFixed(0)}MB of ` +
          `${(QUOTA.imageBytes / 1024 / 1024).toFixed(0)}MB. Delete some garments to make room.`,
      },
      { status: 413 },
    );
  }

  try {
    const id = newId();
    await saveImage(userId, { id, mime: "image/jpeg", kind, createdAt: nowIso() }, bytes);
    return NextResponse.json({ id, url: `/api/images/${id}` }, { status: 201 });
  } catch (err) {
    // Storage failures used to surface as a bare "Upload failed" with no clue
    // whether the problem was the file, the session or the database.
    console.error("[images] save failed:", err);
    return NextResponse.json(
      { error: "The image was read but couldn't be saved. Try again." },
      { status: 500 },
    );
  }
}
