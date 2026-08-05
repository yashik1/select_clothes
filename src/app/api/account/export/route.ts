import { NextResponse } from "next/server";
import { exportAccount } from "@/lib/db";
import { requireApiUser } from "@/lib/server/session";

/**
 * Everything the account owns, as a file.
 *
 * `Content-Disposition: attachment` rather than a JSON body a script has to
 * save: the point of an export is that someone ends up with a file they can
 * keep, and asking them to right-click-save-as a browser's JSON viewer is a
 * worse version of the same thing.
 */
export async function GET() {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const data = await exportAccount(auth.user.id);
  if (!data) {
    // The session resolved but the account is gone — deleted in another tab.
    return NextResponse.json({ error: "That account no longer exists." }, { status: 404 });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="fitcheck-${stamp}.json"`,
      // Someone's whole wardrobe should not sit in a shared cache.
      "Cache-Control": "no-store",
    },
  });
}
