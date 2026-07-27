import { getImage } from "@/lib/db";
import { currentUser } from "@/lib/server/session";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  // Photos are private. An unowned id is indistinguishable from a missing one,
  // so this never confirms that someone else's image exists.
  const user = await currentUser();
  if (!user) return new Response("Not found", { status: 404 });

  const { id } = await params;
  const image = await getImage(user.id, id);
  if (!image) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(image.bytes), {
    headers: {
      "Content-Type": image.mime,
      "Content-Length": String(image.bytes.length),
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
