import { NextResponse } from "next/server";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { UPLOAD_DIR, getGarments, getImageRecord, getOrCreateProfile } from "@/lib/db";
import { providerStatus, renderTryOn, tryOnCategory } from "@/lib/tryon";

const schema = z.object({ garmentIds: z.array(z.string()).min(1).max(4) });

/** Providers take URLs or data URLs; local files have to be inlined. */
async function toDataUrl(imageId: string): Promise<string | null> {
  const rec = getImageRecord(imageId);
  if (!rec) return null;
  const full = path.resolve(UPLOAD_DIR, rec.filename);
  if (!full.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) return null;
  try {
    const buf = await readFile(full);
    return `data:${rec.mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function GET() {
  return NextResponse.json({ provider: providerStatus() });
}

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

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

  const profile = getOrCreateProfile();
  const photoId = profile.bodyPhotoIds?.[0];
  if (!photoId) {
    return NextResponse.json(
      { ok: false, provider: status, error: "Add a full-length photo of yourself on the You page first.", fallback: "flat-lay" },
      { status: 200 },
    );
  }

  const personImage = await toDataUrl(photoId);
  if (!personImage) {
    return NextResponse.json({ ok: false, provider: status, error: "Your body photo is missing from disk." }, { status: 200 });
  }

  // Render base layers before outerwear, or the jacket gets painted over.
  const order = ["dress", "top", "bottom", "outerwear"];
  const garments = getGarments(parsed.data.garmentIds)
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
    const img = await toDataUrl(g.imageIds[0]);
    if (img) layers.push({ image: img, category: tryOnCategory(g.category) });
  }

  const result = await renderTryOn({ personImage, garments: layers });
  return NextResponse.json({ ...result, provider: status });
}
