import { listGarments, listOutfits, listPlans, listWearLogs } from "@/lib/db";
import { requireUser } from "@/lib/server/session";
import { Planner } from "@/components/Planner";

export const dynamic = "force-dynamic";

/** A day, as a plain `YYYY-MM-DD`, offset from today. */
function day(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function CalendarPage() {
  const { id: userId } = await requireUser();

  /*
   * A year either side, fetched up front.
   *
   * Plans are three small columns and a short array, so a couple of hundred of
   * them cost less to send once than the round trip each month arrow would
   * otherwise need — and month navigation that never waits is the difference
   * between a calendar you flick through and one you interrogate. Wear logs get
   * the same window for the same reason; the default 120 days would have left
   * the grid blank the moment someone paged back past April.
   */
  const [wardrobe, outfits, plans, wearLogs] = await Promise.all([
    listGarments(userId),
    listOutfits(userId),
    listPlans(userId, day(-365), day(365)),
    listWearLogs(userId, 400),
  ]);

  return (
    <Planner wardrobe={wardrobe} outfits={outfits} plans={plans} wearLogs={wearLogs} />
  );
}
