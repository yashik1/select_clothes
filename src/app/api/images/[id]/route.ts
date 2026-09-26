import { getImage } from "@/lib/db";
import { currentUser } from "@/lib/server/session";
import { shareGrantsImage } from "@/lib/server/share";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  /*
   * Two ways to be entitled to a photo: own it, or hold a share link for an
   * outfit containing the garment it belongs to. Ownership is tried first, so a
   * signed-in person looking at their own page never pays for the share lookup.
   *
   * Everything else is a 404 rather than a 403. An unowned id has to be
   * indistinguishable from a missing one, or this endpoint becomes a way to ask
   * whether someone else's image exists.
   */
  const user = await currentUser();
  let image = user ? await getImage(user.id, id) : null;
  let shared = false;

  if (!image) {
    const token = new URL(req.url).searchParams.get("share");
    const ownerId = token ? await shareGrantsImage(token, id) : null;
    if (!ownerId) return new Response("Not found", { status: 404 });
    image = await getImage(ownerId, id);
    if (!image) return new Response("Not found", { status: 404 });
    shared = true;
  }

  return new Response(new Uint8Array(image.bytes), {
    headers: {
      "Content-Type": image.mime,
      "Content-Length": String(image.bytes.length),
      /*
       * `private` in both cases. A shared photo is readable by anyone holding
       * the link, but the link can be revoked, and a shared cache that had
       * stored the bytes against this URL would go on serving them afterwards.
       * An hour on a shared photo, a year on your own: only the former can be
       * taken away again.
       */
      "Cache-Control": shared ? "private, max-age=3600" : "private, max-age=31536000, immutable",
    },
  });
}
