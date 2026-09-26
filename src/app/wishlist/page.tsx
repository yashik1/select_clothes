import { requireUser } from "@/lib/server/session";
import { WishlistPage } from "@/components/WishlistPage";

export const dynamic = "force-dynamic";

/*
 * `requireUser` even though everything on this page is client-side.
 *
 * It holds nothing from the server, so leaving it out leaked nothing — but the
 * nav links to it from a signed-in header, and a signed-out visitor who reached
 * it got a working-looking page that silently belonged to nobody. Every other
 * page in the app redirects; this one now does too, so "signed out" means the
 * same thing everywhere.
 */
export default async function Page() {
  await requireUser();
  return <WishlistPage />;
}
