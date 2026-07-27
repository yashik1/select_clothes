import { getOrCreateProfile } from "@/lib/db";
import { ProfileForm } from "@/components/ProfileForm";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  return <ProfileForm initial={await getOrCreateProfile()} />;
}
