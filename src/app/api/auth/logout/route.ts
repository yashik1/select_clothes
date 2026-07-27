import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, hashToken } from "@/lib/auth";
import { deleteSession } from "@/lib/db";
import { clearedSessionCookie } from "@/lib/server/session";

export async function POST() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  // Drop the server-side row too, so the token is dead even if the cookie was
  // captured before it was cleared.
  if (token) await deleteSession(hashToken(token));
  jar.set(clearedSessionCookie());

  return NextResponse.json({ ok: true });
}
