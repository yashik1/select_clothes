import { getOrCreateProfile } from "@/lib/db";
import { GarmentForm } from "@/components/GarmentForm";

export const dynamic = "force-dynamic";

export default async function NewGarmentPage() {
  return <GarmentForm profile={await getOrCreateProfile()} />;
}
