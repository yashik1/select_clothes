import "server-only";
import sharp from "sharp";
import { newId, nowIso, saveImage } from "@/lib/db";

/**
 * One place that turns bytes into a stored image.
 *
 * Upload and import both land here, so a photo taken on a phone and a photo
 * pulled off a product page are stored identically: sRGB JPEG, EXIF rotation
 * applied to the pixels, metadata dropped, long edge capped. Duplicating the
 * sharp pipeline instead would let the two paths drift, and the drift would
 * only show up as one of them rendering sideways.
 */

/** Long edge of the stored image. */
export const MAX_EDGE = 1600;

/**
 * Deliberately not SVG. sharp will rasterise one, but an SVG is a document
 * that can reference external resources, and nothing in a wardrobe is a vector
 * drawing — so the format is simply not accepted.
 */
export const REFUSED_MIME = new Set(["image/svg+xml", "image/svg"]);

export function describeImageError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  // libvips messages are accurate but not sentences.
  if (/unsupported image format|bad extract area|not a known format/i.test(message)) {
    return "That file isn't an image this server can read. JPEG, PNG, HEIC, WebP, AVIF, GIF, TIFF and BMP all work.";
  }
  return `Couldn't process that image (${message}).`;
}

export async function normaliseImage(input: Buffer): Promise<Buffer> {
  return sharp(input, { failOn: "none" })
    // Phones record orientation in EXIF rather than rotating the pixels, so
    // without this a photo taken sideways is stored sideways.
    .rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, progressive: true, mozjpeg: true })
    .toBuffer();
}

/** Normalises and stores, returning the new image id. */
export async function storeImage(userId: string, input: Buffer, kind: string): Promise<string> {
  const bytes = await normaliseImage(input);
  const id = newId();
  await saveImage(userId, { id, mime: "image/jpeg", kind, createdAt: nowIso() }, bytes);
  return id;
}
