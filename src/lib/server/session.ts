import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_DAYS, hashToken } from "@/lib/auth";
import { userForSession } from "@/lib/db";

export interface SessionUser {
  id: string;
  email: string;
}

/** The signed-in account, or null. Every data query keys off this. */
export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const user = await userForSession(hashToken(token));
  return user ? { id: user.id, email: user.email } : null;
}

/** For pages: sends anyone signed out to the login screen. */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/** For API routes, where a redirect would be nonsense — 401 instead. */
export async function requireApiUser(): Promise<
  { ok: true; user: SessionUser } | { ok: false; response: NextResponse }
> {
  const user = await currentUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not signed in." }, { status: 401 }),
    };
  }
  return { ok: true, user };
}

/**
 * Session cookie settings, in one place so the login and logout paths can't
 * disagree about them — a mismatched path or sameSite leaves a cookie that
 * can't be cleared.
 *
 * `secure` follows the deployment rather than being hardcoded: it would stop
 * the cookie ever being set over plain HTTP on localhost.
 */
export function sessionCookie(token: string) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  };
}

export function clearedSessionCookie() {
  return { ...sessionCookie(""), maxAge: 0 };
}
