import { NextResponse } from "next/server";
import { z } from "zod";
import {
  findImageByKind, getGarments, getImage, getOrCreateProfile, newId, nowIso, saveImage,
} from "@/lib/db";
import { providerStatus, renderTryOn, tryOnCategory } from "@/lib/tryon";
import { parseJsonBody } from "@/lib/http";
import { requireApiUser } from "@/lib/server/session";

const schema = z.object({
  garmentIds: z.array(z.string()).min(1).max(4),
  /** Skip the cache and pay for a fresh render — the "try again" button. */
  refresh: z.boolean().optional(),
});

/**
 * A render is fully determined by the body photo and the garments on it, so
 * that pair is the cache key. Order is normalised because the same outfit
 * chosen in a different order is the same picture.
 */
const cacheKey = (photoId: string, garmentIds: string[]) =>
  `tryon:${photoId}:${[...garmentIds].sort().join("+")}`;

/** Renders are stored, so the cheap path is the one taken by default. */
const MAX_RENDER_BYTES = 8 * 1024 * 1024;

/**
 * Keeps a finished render, so revisiting a garment costs nothing.
 *
 * Every failure here is swallowed. The person asked for a picture and has one;
 * refusing to show it because the copy could not be filed would be trading the
 * thing they wanted for an optimisation they never asked about.
 */
async function cacheRender(
  userId: string,
  key: string,
  imageUrl: string,
): Promise<string | null> {
  try {
    let mime = "image/jpeg";
    let bytes: Buffer;

    if (imageUrl.startsWith("data:")) {
      const [header, base64] = imageUrl.split(",", 2);
      if (!base64) return null;
      mime = header.slice(5).split(";")[0] || mime;
      bytes = Buffer.from(base64, "base64");
    } else {
      const res = await fetch(imageUrl, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) return null;
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > MAX_RENDER_BYTES) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_RENDER_BYTES) return null;
      mime = res.headers.get("content-type")?.split(";")[0] ?? mime;
      bytes = buf;
    }

    if (!mime.startsWith("image/") || !bytes.length) return null;

    const id = newId();
    await saveImage(userId, { id, mime, kind: key, createdAt: nowIso() }, bytes);
    return id;
  } catch {
    return null;
  }
}

/** Providers take URLs or data URLs; our images are private, so they're inlined. */
async function toDataUrl(userId: string, imageId: string): Promise<string | null> {
  const image = await getImage(userId, imageId);
  if (!image) return null;
  return `data:${image.mime};base64,${image.bytes.toString("base64")}`;
}

/**
 * Which provider is configured. Behind auth like everything else: whether an
 * instance has a paid render provider, and which, is not something a passer-by
 * needs to know.
 */
export async function GET() {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ provider: providerStatus() });
}

export async function POST(req: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;

  const parsed = await parseJsonBody(req, schema);
  if (!parsed.ok) return parsed.response;

  const status = providerStatus();
  if (status.id === "none" || !status.configured) {
    return NextResponse.json(
      {
        ok: false,
        provider: status,
        error: status.hint,
        fallback: "flat-lay",
      },
      { status: 200 },
    );
  }

  const profile = await getOrCreateProfile(userId);
  const photoId = profile.bodyPhotoIds?.[0];
  if (!photoId) {
    return NextResponse.json(
      { ok: false, provider: status, error: "Add a full-length photo of yourself on the You page first.", fallback: "flat-lay" },
      { status: 200 },
    );
  }

  /*
   * The same photo and the same garments produce the same picture, and that
   * picture cost money and twenty seconds the first time. Looked up before
   * anything else is done, so returning to a garment page is free and instant.
   */
  const key = cacheKey(photoId, parsed.data.garmentIds);
  if (!parsed.data.refresh) {
    const cached = await findImageByKind(userId, key);
    if (cached) {
      return NextResponse.json({
        ok: true,
        image: `/api/images/${cached}`,
        provider: status,
        cached: true,
      });
    }
  }

  const personImage = await toDataUrl(userId, photoId);
  if (!personImage) {
    return NextResponse.json({ ok: false, provider: status, error: "Your body photo is missing." }, { status: 200 });
  }

  // Render base layers before outerwear, or the jacket gets painted over.
  const order = ["dress", "top", "bottom", "outerwear"];
  const garments = (await getGarments(userId, parsed.data.garmentIds))
    .filter((g) => order.includes(g.category) && g.imageIds.length)
    .sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));

  if (!garments.length) {
    return NextResponse.json(
      { ok: false, provider: status, error: "None of the selected items have photos to render.", fallback: "flat-lay" },
      { status: 200 },
    );
  }

  const layers: { image: string; category: ReturnType<typeof tryOnCategory> }[] = [];
  for (const g of garments) {
    const img = await toDataUrl(userId, g.imageIds[0]);
    if (img) layers.push({ image: img, category: tryOnCategory(g.category) });
  }

  const result = await renderTryOn({ personImage, garments: layers });
  if (!result.ok || !result.image) return NextResponse.json({ ...result, provider: status });

  /*
   * Served from here rather than from the provider's URL, which is a signed
   * link that expires — a rendered picture of somebody's body should not stop
   * loading a week later, and should not be fetched from a third party every
   * time the page opens either.
   */
  const stored = await cacheRender(userId, key, result.image);
  return NextResponse.json({
    ...result,
    image: stored ? `/api/images/${stored}` : result.image,
    provider: status,
    cached: false,
  });
}
