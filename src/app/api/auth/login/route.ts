import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { createSession, getUserByEmail, purgeExpiredSessions } from "@/lib/db";
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

  /*
   * Counted against the address *and* the caller, because either alone leaves
   * a hole: per-address only lets one attacker work through a list of accounts
   * unimpeded, and per-caller only is defeated by a botnet — or by forging
   * `x-forwarded-for`, which nothing can stop and which the per-address limit
   * does not depend on.
   */
  const keys = [`login:email:${email}`, `login:from:${clientKey(req)}`];
  for (const key of keys) {
    const verdict = await consume(key, LIMITS.login);
    if (!verdict.ok) return tooMany(verdict.retryAfter, "sign-in attempts");
  }

  const user = await getUserByEmail(email);

  const ok = user
    ? await verifyPassword(parsed.data.password, user.passwordHash)
    : (await verifyPassword(parsed.data.password, await DUMMY_HASH_PROMISE), false);

  // Deliberately the same message either way — telling someone an address is
  // registered is an account-enumeration oracle.
  if (!ok || !user) {
    return NextResponse.json({ error: "Email or password is wrong." }, { status: 401 });
  }

  // Getting it right is not a guess, and shouldn't count toward a lockout.
  await Promise.all(keys.map(refund));

  const { token, tokenHash } = newSessionToken();
  await createSession(tokenHash, user.id, sessionExpiry());
  (await cookies()).set(sessionCookie(token));

  // Cheap to do here, and saves needing anything scheduled.
  purgeExpiredSessions().catch(() => {});

  return NextResponse.json({ ok: true, email: user.email });
}
