import { requireUser } from "@/lib/server/session";
import { appContext } from "@/lib/server/context";
import { providerStatus } from "@/lib/tryon";
import { TryOnHub } from "@/components/TryOnHub";

export const dynamic = "force-dynamic";

export default async function TryOnPage() {
  const { id } = await requireUser();
  const [ctx, provider] = await Promise.all([appContext(id), Promise.resolve(providerStatus())]);

  return (
    <TryOnHub
      wardrobe={ctx.wardrobe}
      bodyPhotoId={ctx.profile.bodyPhotoIds?.[0] ?? null}
      provider={provider}
    />
  );
}