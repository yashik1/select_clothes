import { NextResponse } from "next/server";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { UPLOAD_DIR, newId, nowIso, saveImageRecord } from "@/lib/db";

const ALLOWED = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Images live on disk with only their metadata in SQLite. The client downscales
 * before upload, so what arrives here is already a sensible size.
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  const kind = (form.get("kind") as string) || "garment";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file supplied." }, { status: 400 });
  }
  const ext = ALLOWED.get(file.type);
  if (!ext) {
    return NextResponse.json(
      { error: `Unsupported type ${file.type}. Use JPEG, PNG or WebP.` },
      { status: 415 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Image is larger than 10MB." }, { status: 413 });
  }

  const id = newId();
  const filename = `${id}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(UPLOAD_DIR, filename), buffer);

  saveImageRecord({ id, mime: file.type, filename, kind, createdAt: nowIso() });
  return NextResponse.json({ id, url: `/api/images/${id}` }, { status: 201 });
}
