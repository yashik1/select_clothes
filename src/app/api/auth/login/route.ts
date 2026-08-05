import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import {
  createSession, getUserByEmail, purgeExpiredRateLimits, purgeExpiredSessions,
} from "@/lib/db";
import {
  hashPassword, newSessionToken, normaliseEmail, sessionExpiry, verifyPassword,
} from "@/lib/auth";
import { sessionCookie } from "@/lib/server/session";
import { parseJsonBody } from "@/lib/http";
import { LIMITS, caller, consume, refund, tooMany } from "@/lib/server/rateLimit";

const schema = z.object({
  email: z.string().max(254),
  password: z.string().max(200),
});

/**
 * Verifying against this when the account doesn't exist keeps the response
 * time of "no such user" and "wrong password" roughly equal. Without it, the
 * difference between an instant rejection and a ~100ms scrypt hash tells an
 * attacker which addresses are registered.
 */
const DUMMY_HASH_PROMISE = hashPassword("no account with this address exists");

export async function POST(req: Request) {
  const parsed = await parseJsonBody(req, schema);
  if (!parsed.ok) return parsed.response;

  const email = normaliseEmail(parsed.data.email);

  const who = caller(req);

  /*
   * Three counters, and what separates them is not what they count but what
   * they are keyed on.
   *
   * `pair` and `source` are keyed on the caller, so — *when the caller can be
   * told apart from anyone else* — the only budget a request can exhaust is
   * its own: one source guessing at one account runs out after eight, one
   * source spraying many accounts runs out after forty. Only then are they
   * allowed to refuse a request before its password has been looked at.
   *
   * `address` is keyed on a value the caller types about somebody else, and
   * that is exactly why it may never refuse anyone up front. An earlier
   * version treated it as a gate and the result was a weapon: nine junk
   * requests naming an address — no password needed, no account needed to even
   * exist — locked its owner out for five minutes from every device they own,
   * repeatable forever, while the attacker's own counter sat frozen below its
   * limit because the failing check short-circuited before reaching it.
   *
   * A caller-keyed counter stops being caller-keyed the moment `caller()`
   * cannot tell anyone apart, and then `pair` and `source` are one bucket
   * shared by the world: eight requests would lock out the account they name,
   * forty would lock out everybody. `next start` fills `x-forwarded-for` from
   * the socket when the client sends none, so that does not arise on either
   * documented deployment — but it is one header-handling change away from
   * arising, and it is not a thing to leave resting on an assumption. Hence
   * `gates`.
   *
   * The rule underneath all of it: a counter a stranger can fill decides
   * nothing until the password is known to be wrong. That is what makes the
   * scheme survive the header being forged, which it trivially can be —
   * rotating `x-forwarded-for` gets past `pair` and `source` at will, and
   * lands on `address`, which no header can touch. Verified: a hundred
   * attempts from a hundred forged addresses are refused after sixty, and the
   * owner still signs in.
   */
  const keys = [
    // `gates` only when the caller is identified — see above.
    { key: `login:pair:${who.id}:${email}`, limit: LIMITS.login, gates: who.identified },
    { key: `login:source:${who.id}`, limit: LIMITS.loginSource, gates: who.identified },
    { key: `login:address:${email}`, limit: LIMITS.loginAddress, gates: false },
  ];

  const verdicts = [];
  for (const { key, limit, gates } of keys) {
    const verdict = await consume(key, limit);
    verdicts.push(verdict);
    if (gates && !verdict.ok) return tooMany(verdict.retryAfter, "sign-in attempts");
  }

  const user = await getUserByEmail(email);

  const ok = user
    ? await verifyPassword(parsed.data.password, user.passwordHash)
    : (await verifyPassword(parsed.data.password, await DUMMY_HASH_PROMISE), false);

  if (!ok || !user) {
    // Now that the password is known to be wrong, any full counter may say no.
    // It costs an attacker their guess and costs the owner nothing, because
    // the owner never reaches this branch.
    const full = verdicts.find((v) => !v.ok);
    if (full) return tooMany(full.retryAfter, "sign-in attempts");

    /*
     * A flood never reaches the success path below, so the sweep it makes
     * necessary has to happen here too. Occasionally rather than every time:
     * one DELETE per failed attempt would hand an attacker a second write to
     * make the server do.
     */
    if (Math.random() < 0.02) purgeExpiredRateLimits().catch(() => {});

    // Deliberately the same message whether the address is unknown or the
    // password is wrong — telling them apart is an enumeration oracle.
    return NextResponse.json({ error: "Email or password is wrong." }, { status: 401 });
  }

  // Getting it right is not a guess, and shouldn't count toward a lockout.
  await Promise.all(keys.map((k) => refund(k.key)));

  const { token, tokenHash } = newSessionToken();
  await createSession(tokenHash, user.id, sessionExpiry());
  (await cookies()).set(sessionCookie(token));

  // Cheap to do here, and saves needing anything scheduled. Both tables grow
  // on unauthenticated traffic, so neither can be left to accumulate.
  purgeExpiredSessions().catch(() => {});
  purgeExpiredRateLimits().catch(() => {});

  return NextResponse.json({ ok: true, email: user.email });
}
