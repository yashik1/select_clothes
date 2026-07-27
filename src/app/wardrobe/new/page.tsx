import { getOrCreateProfile } from "@/lib/db";
import { requireUser } from "@/lib/server/session";
import { GarmentForm } from "@/components/GarmentForm";

export const dynamic = "force-dynamic";

export default async function NewGarmentPage() {
  const { id: userId } = await requireUser();
  return <GarmentForm profile={await getOrCreateProfile(userId)} />;
}
