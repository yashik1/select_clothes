import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import {
  adoptOrphanedData, countUsers, createSession, createUser,
} from "@/lib/db";
import {
  emailProblem, hashPassword, newSessionToken, normaliseEmail,
  passwordProblem, sessionExpiry,
} from "@/lib/auth";
import { sessionCookie } from "@/lib/server/session";
import { parseJsonBody } from "@/lib/http";
import { signupsClosed } from "@/lib/server/policy";

const schema = z.object({
  email: z.string().max(254),
  password: z.string().max(200),
});

export async function POST(req: Request) {
  const parsed = await parseJsonBody(req, schema);
  if (!parsed.ok) return parsed.response;

  const email = normaliseEmail(parsed.data.email);
  const { password } = parsed.data;

  const problem = emailProblem(email) ?? passwordProblem(password);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  // A public instance shouldn't necessarily accept strangers. The first account
  // is always allowed, otherwise there'd be no way to set the instance up.
  const existing = await countUsers();
  if (existing > 0 && signupsClosed()) {
    return NextResponse.json(
      { error: "This instance isn't accepting new accounts." },
      { status: 403 },
    );
  }

  const user = await createUser(email, await hashPassword(password));
  if (!user) {
    return NextResponse.json({ error: "That email address is already registered." }, { status: 409 });
  }

  // Data from before this instance had accounts belongs to whoever sets it up.
  if (existing === 0) {
    const adopted = await adoptOrphanedData(user.id);
    if (adopted > 0) {
      console.log(`[auth] first account created; adopted ${adopted} pre-existing rows`);
    }
  }

  const { token, tokenHash } = newSessionToken();
  await createSession(tokenHash, user.id, sessionExpiry());
  (await cookies()).set(sessionCookie(token));

  return NextResponse.json({ ok: true, email: user.email }, { status: 201 });
}
