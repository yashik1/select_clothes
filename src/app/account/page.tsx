import { countOwned, imageBytesUsed, pool, ready } from "@/lib/db";
import { requireUser } from "@/lib/server/session";
import { AccountSettings } from "@/components/AccountSettings";

export const dynamic = "force-dynamic";

export const metadata = { title: "Account · FitCheck" };

export default async function AccountPage() {
  const user = await requireUser();
  await ready();

  // Counted rather than fetched — the point is the size of what is held, and
  // pulling every wear log to call `.length` on it is the thing the row limits
  // upstairs exist to prevent.
  const [garments, outfits, photoBytes, counts] = await Promise.all([
    countOwned(user.id, "garment"),
    countOwned(user.id, "outfit"),
    imageBytesUsed(user.id),
    pool().query<{ wear_logs: string; photos: string }>(
      `SELECT (SELECT count(*) FROM wear_log WHERE user_id = $1) AS wear_logs,
              (SELECT count(*) FROM image    WHERE user_id = $1) AS photos`,
      [user.id],
    ),
  ]);

  return (
    <AccountSettings
      email={user.email}
      stats={{
        garments,
        outfits,
        wearLogs: Number(counts.rows[0]?.wear_logs ?? 0),
        photos: Number(counts.rows[0]?.photos ?? 0),
        photoBytes,
      }}
    />
  );
}
