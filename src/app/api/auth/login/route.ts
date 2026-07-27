import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { createSession, getUserByEmail, purgeExpiredSessions } from "@/lib/db";
import {
  hashPassword, newSessionToken, normaliseEmail, sessionExpiry, verifyPassword,
} from "@/lib/auth";
import { sessionCookie } from "@/lib/server/session";
import { parseJsonBody } from "@/lib/http";

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
  const user = await getUserByEmail(email);

  const ok = user
    ? await verifyPassword(parsed.data.password, user.passwordHash)
    : (await verifyPassword(parsed.data.password, await DUMMY_HASH_PROMISE), false);

  // Deliberately the same message either way — telling someone an address is
  // registered is an account-enumeration oracle.
  if (!ok || !user) {
    return NextResponse.json({ error: "Email or password is wrong." }, { status: 401 });
  }

  const { token, tokenHash } = newSessionToken();
  await createSession(tokenHash, user.id, sessionExpiry());
  (await cookies()).set(sessionCookie(token));

  // Cheap to do here, and saves needing anything scheduled.
  purgeExpiredSessions().catch(() => {});

  return NextResponse.json({ ok: true, email: user.email });
}
