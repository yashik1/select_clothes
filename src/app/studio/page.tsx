import { Suspense } from "react";
import { getOrCreateProfile, listGarments } from "@/lib/db";
import { providerStatus } from "@/lib/tryon";
import { requireUser } from "@/lib/server/session";
import { Studio } from "@/components/Studio";

export const dynamic = "force-dynamic";

export default async function StudioPage() {
  const { id: userId } = await requireUser();
  const [wardrobe, profile] = await Promise.all([
    listGarments(userId),
    getOrCreateProfile(userId),
  ]);

  return (
    <Suspense fallback={<p className="text-sm text-[var(--color-muted)]">Loading your wardrobe…</p>}>
      <Studio
        wardrobe={wardrobe}
        measurements={profile.measurements ?? {}}
        unit={profile.unit}
        // Read here rather than fetched, because it comes from the server's own
        // environment and carries no secret — only which provider is on and
        // what is missing if it isn't.
        provider={providerStatus()}
        bodyPhotoId={profile.bodyPhotoIds?.[0] ?? null}
      />
    </Suspense>
  );
}
