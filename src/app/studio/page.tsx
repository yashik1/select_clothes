import { Suspense } from "react";
import { listGarments } from "@/lib/db";
import { requireUser } from "@/lib/server/session";
import { Studio } from "@/components/Studio";

export const dynamic = "force-dynamic";

export default async function StudioPage() {
  const { id: userId } = await requireUser();
  return (
    <Suspense fallback={<p className="text-sm text-[var(--color-muted)]">Loading your wardrobe…</p>}>
      <Studio wardrobe={await listGarments(userId)} />
    </Suspense>
  );
}
