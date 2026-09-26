import { requireUser } from "@/lib/server/session";
import { appContext } from "@/lib/server/context";
import { CapsuleBuilder } from "@/components/CapsuleBuilder";

export const dynamic = "force-dynamic";

export default async function CapsulePage() {
  const { id } = await requireUser();
  const ctx = await appContext(id);
  return <CapsuleBuilder wardrobe={ctx.wardrobe} />;
}