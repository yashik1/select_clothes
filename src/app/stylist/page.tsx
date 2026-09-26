import { requireUser } from "@/lib/server/session";
import { Stylist } from "@/components/Stylist";

export const dynamic = "force-dynamic";

export default async function StylistPage() {
  await requireUser();
  return <Stylist />;
}