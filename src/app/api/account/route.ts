import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { deleteAccount, getUserById } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import { clearedSessionCookie, requireApiUser } from "@/lib/server/session";
import { parseJsonBody } from "@/lib/http";
import { LIMITS, consume, tooMany } from "@/lib/server/rateLimit";

const schema = z.object({
  password: z.string().max(200),
  /** Typed by hand, so the request can't be a stray click or a forged form. */
  confirm: z.string().max(64),
});

const PHRASE = "delete";

/**
 * Erases the account and everything in it.
 *
 * Two gates, because this cannot be undone. The password, so a borrowed
 * unlocked laptop isn't enough — a session cookie proves someone sat down at
 * the machine, not that they own the account. And a typed word, so no amount
 * of cross-site trickery can produce the request by accident; the password
 * alone would still be satisfied by a phishing page that already had it.
 */
export async function DELETE(req: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const parsed = await parseJsonBody(req, schema);
  if (!parsed.ok) return parsed.response;

  /*
   * Same budget as a sign-in: this verifies a password, so it is exactly as
   * useful for guessing one, and exactly as expensive to serve.
   *
   * Keyed on the account rather than the caller, because unlike sign-in there
   * is a session here — an account id cannot be forged, cannot be shared with
   * a stranger, and cannot be absent. Filling this counter only ever costs the
   * person already holding the session.
   */
  const verdict = await consume(`delete:${auth.user.id}`, LIMITS.login);
  if (!verdict.ok) return tooMany(verdict.retryAfter, "attempts");

  if (parsed.data.confirm.trim().toLowerCase() !== PHRASE) {
    return NextResponse.json({ error: `Type ${PHRASE} to confirm.` }, { status: 400 });
  }

  const user = await getUserById(auth.user.id);
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return NextResponse.json({ error: "That password is wrong." }, { status: 401 });
  }

  await deleteAccount(user.id);

  // The sessions are gone from the database already; clearing the cookie stops
  // the browser presenting a token that can no longer resolve to anything.
  (await cookies()).set(clearedSessionCookie());

  return NextResponse.json({ ok: true });
}
