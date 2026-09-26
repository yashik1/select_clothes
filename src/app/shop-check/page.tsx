import { requireUser } from "@/lib/server/session";
import { appContext } from "@/lib/server/context";
import { ShopCheck } from "@/components/ShopCheck";

export const dynamic = "force-dynamic";

export default async function ShopCheckPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string }>;
}) {
  const { id } = await requireUser();
  const ctx = await appContext(id);
  const params = await searchParams;

  return (
    <ShopCheck
      wardrobe={ctx.wardrobe}
      profile={ctx.profile}
      initialUrl={params.url ?? ""}
    />
  );
}