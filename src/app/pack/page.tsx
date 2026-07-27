import { PackPlanner } from "@/components/PackPlanner";
import { requireUser } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function PackPage() {
  await requireUser();
  return <PackPlanner />;
}
