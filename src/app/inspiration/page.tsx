import { requireUser } from "@/lib/server/session";
import { InspirationBoard } from "@/components/InspirationBoard";

export const dynamic = "force-dynamic";

/** Signed-in only, like every other page. See `wishlist/page.tsx`. */
export default async function InspirationPage() {
  await requireUser();
  return <InspirationBoard />;
}
