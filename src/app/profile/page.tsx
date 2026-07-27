import { getOrCreateProfile } from "@/lib/db";
import { requireUser } from "@/lib/server/session";
import { ProfileForm } from "@/components/ProfileForm";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const { id: userId } = await requireUser();
  return <ProfileForm initial={await getOrCreateProfile(userId)} />;
}
