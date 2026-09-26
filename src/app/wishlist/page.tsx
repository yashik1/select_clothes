import { listWishlist } from "@/lib/db";
import { requireUser } from "@/lib/server/session";
import { WishlistPage } from "@/components/WishlistPage";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { id } = await requireUser();
  // Fetched here rather than in an effect, so the list is right on the first
  // paint instead of flashing empty.
  return <WishlistPage initial={await listWishlist(id)} />;
}
