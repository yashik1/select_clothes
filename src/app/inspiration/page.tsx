import { listInspiration } from "@/lib/db";
import { requireUser } from "@/lib/server/session";
import { InspirationBoard } from "@/components/InspirationBoard";

export const dynamic = "force-dynamic";

export default async function InspirationPage() {
  const { id } = await requireUser();
  return <InspirationBoard initial={await listInspiration(id)} />;
}
