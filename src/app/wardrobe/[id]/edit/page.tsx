import { notFound } from "next/navigation";
import { getGarment, getOrCreateProfile } from "@/lib/db";
import { requireUser } from "@/lib/server/session";
import { GarmentForm } from "@/components/GarmentForm";

export const dynamic = "force-dynamic";

export default async function EditGarmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { id: userId } = await requireUser();
  const garment = await getGarment(userId, id);
  if (!garment) notFound();
  return <GarmentForm profile={await getOrCreateProfile(userId)} initial={garment} />;
}
