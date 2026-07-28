import { NextResponse } from "next/server";
import sharp from "sharp";
import { newId, nowIso, saveImage } from "@/lib/db";
import { readFormBody } from "@/lib/http";
import { requireApiUser } from "@/lib/server/session";

/**
 * Originals can be large — a phone HEIC or a 48MP JPEG runs to tens of
 * megabytes — and the browser only sends the original when it couldn't decode
 * the file itself. What gets stored is always far smaller than this.
 */
const MAX_BYTES = 30 * 1024 * 1024;

/** Long edge of the stored image. Enough for a full-bleed thumbnail and a
 *  try-on input, and nowhere near what a phone camera produces. */
const MAX_EDGE = 1600;

/**
 * Deliberately not SVG. sharp will rasterise one, but an SVG is a document
 * that can reference external resources, and nothing in a wardrobe is a
 * vector drawing — so the format is simply not accepted.
 */
const REFUSED = new Set(["image/svg+xml", "image/svg"]);

function describe(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  // libvips messages are accurate but not sentences.
  if (/unsupported image format|bad extract area|not a known format/i.test(message)) {
    return "That file isn't an image this server can read. JPEG, PNG, HEIC, WebP, AVIF, GIF, TIFF and BMP all work.";
  }
  return `Couldn't process that image (${message}).`;
}

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
  if (REFUSED.has(file.type)) {
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
    bytes = await sharp(Buffer.from(await file.arrayBuffer()), { failOn: "none" })
      // Phones record orientation in EXIF rather than rotating the pixels, so
      // without this a photo taken sideways is stored sideways.
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, progressive: true, mozjpeg: true })
      .toBuffer();
  } catch (err) {
    console.error("[images] conversion failed:", err);
    return NextResponse.json({ error: describe(err) }, { status: 415 });
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
