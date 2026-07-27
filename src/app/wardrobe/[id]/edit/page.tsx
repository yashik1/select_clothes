import { notFound } from "next/navigation";
import { getGarment, getOrCreateProfile } from "@/lib/db";
import { GarmentForm } from "@/components/GarmentForm";

export const dynamic = "force-dynamic";

export default async function EditGarmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const garment = await getGarment(id);
  if (!garment) notFound();
  return <GarmentForm profile={await getOrCreateProfile()} initial={garment} />;
}
