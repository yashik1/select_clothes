import { NextResponse } from "next/server";
import { newId, nowIso, saveImage } from "@/lib/db";
import { readFormBody } from "@/lib/http";
import { requireApiUser } from "@/lib/server/session";

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Image bytes go into Postgres alongside their metadata, so the app keeps no
 * local state and needs no attached volume. The client downscales before
 * upload, so what arrives here is already a sensible size.
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
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported type ${file.type}. Use JPEG, PNG or WebP.` },
      { status: 415 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Image is larger than 10MB." }, { status: 413 });
  }

  const id = newId();
  const bytes = Buffer.from(await file.arrayBuffer());
  await saveImage(userId, { id, mime: file.type, kind, createdAt: nowIso() }, bytes);

  return NextResponse.json({ id, url: `/api/images/${id}` }, { status: 201 });
}
