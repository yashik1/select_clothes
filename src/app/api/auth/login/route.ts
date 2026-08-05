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
import { LIMITS, clientKey, consume, refund, tooMany } from "@/lib/server/rateLimit";

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

  const from = clientKey(req);

  /*
   * Three counters, and the difference between the first two and the third is
   * the entire design.
   *
   * `pair` and `source` are hard gates. Both are keyed on the caller, so the
   * only budget a request can exhaust is its own: one source guessing at one
   * account runs out after eight, one source spraying many accounts runs out
   * after forty, and neither can spend anybody else's allowance.
   *
   * `address` is keyed on a value the caller types about somebody else, and
   * that is exactly why it is not allowed to refuse anyone. An earlier version
   * of this route treated it as a gate, and the result was a weapon: nine junk
   * requests naming an address — no password needed, no account needed to even
   * exist — locked its owner out for five minutes from every device they own,
   * repeatable forever, while the attacker's own counter sat frozen below its
   * limit because the failing check short-circuited before reaching it. A
   * limiter that converts knowledge of an email address into a lockout is a
   * denial of service pointed at the person it was added to protect.
   *
   * So the address counter is consumed, and it only ever shapes the answer to
   * a *wrong* password. Whoever holds the right one always gets in.
   */
  const gates = [`login:pair:${from}:${email}`, `login:source:${from}`];
  const limits = [LIMITS.login, LIMITS.loginSource];
  for (let i = 0; i < gates.length; i++) {
    const verdict = await consume(gates[i], limits[i]);
    if (!verdict.ok) return tooMany(verdict.retryAfter, "sign-in attempts");
  }

  const addressKey = `login:address:${email}`;
  const spread = await consume(addressKey, LIMITS.loginAddress);

  const user = await getUserByEmail(email);

  const ok = user
    ? await verifyPassword(parsed.data.password, user.passwordHash)
    : (await verifyPassword(parsed.data.password, await DUMMY_HASH_PROMISE), false);

  if (!ok || !user) {
    // Only now, once the password is known to be wrong, may the address-wide
    // counter say no. It costs an attacker their guess and costs the owner
    // nothing, because the owner never reaches this branch.
    if (!spread.ok) return tooMany(spread.retryAfter, "sign-in attempts");

    // Deliberately the same message whether the address is unknown or the
    // password is wrong — telling them apart is an enumeration oracle.
    return NextResponse.json({ error: "Email or password is wrong." }, { status: 401 });
  }

  // Getting it right is not a guess, and shouldn't count toward a lockout.
  await Promise.all([...gates, addressKey].map(refund));

  const { token, tokenHash } = newSessionToken();
  await createSession(tokenHash, user.id, sessionExpiry());
  (await cookies()).set(sessionCookie(token));

  // Cheap to do here, and saves needing anything scheduled. Both tables grow
  // on unauthenticated traffic, so neither can be left to accumulate.
  purgeExpiredSessions().catch(() => {});
  purgeExpiredRateLimits().catch(() => {});

  return NextResponse.json({ ok: true, email: user.email });
}
