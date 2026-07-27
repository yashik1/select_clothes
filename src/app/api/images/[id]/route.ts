import { readFile } from "node:fs/promises";
import path from "node:path";
import { UPLOAD_DIR, getImageRecord } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rec = getImageRecord(id);
  if (!rec) return new Response("Not found", { status: 404 });

  try {
    // Resolve and confirm the file stays inside the upload directory — the id
    // comes from the URL, so it must never be trusted as a path fragment.
    const full = path.resolve(UPLOAD_DIR, rec.filename);
    if (!full.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) {
      return new Response("Not found", { status: 404 });
    }
    const data = await readFile(full);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": rec.mime,
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
