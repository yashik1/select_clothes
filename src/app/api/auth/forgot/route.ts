import { NextResponse } from "next/server";
import { z } from "zod";
import { createPasswordReset, getUserByEmail, purgeExpiredResets } from "@/lib/db";
import { hashToken, newSessionToken, normaliseEmail } from "@/lib/auth";
import { parseJsonBody } from "@/lib/http";
import { canEmailStrangers, publicOrigin, sendMail } from "@/lib/server/email";
import { LIMITS, clientKey, consume, tooMany } from "@/lib/server/rateLimit";

const schema = z.object({ email: z.string().max(254) });

/** Short, because it is a live credential sitting in somebody's inbox. */
const VALID_MINUTES = 45;

/**
 * Starts a password reset.
 *
 * Answers identically whether or not the address is registered. The whole
 * point of the matching error messages on sign-in is that this app will not
 * confirm who has an account, and a "no such address" here would give that
 * away through the back door.
 */
export async function POST(req: Request) {
  const parsed = await parseJsonBody(req, schema);
  if (!parsed.ok) return parsed.response;

  const email = normaliseEmail(parsed.data.email);

  // Per address and per caller: one stops an inbox being flooded, the other
  // stops the endpoint being used to send mail on somebody else's behalf.
  for (const key of [`reset:email:${email}`, `reset:from:${clientKey(req)}`]) {
    const verdict = await consume(key, LIMITS.passwordReset);
    if (!verdict.ok) return tooMany(verdict.retryAfter, "reset requests");
  }

  const sameAnswer = NextResponse.json({
    ok: true,
    // The UI needs to know whether to promise an email or tell the operator to
    // read the log. It is a property of the deployment, not of the address, so
    // it reveals nothing about who has an account.
    delivery: canEmailStrangers() ? "email" : "log",
  });

  const user = await getUserByEmail(email);
  if (!user) return sameAnswer;

  const origin = publicOrigin();
  if (!origin) {
    console.error(
      "[reset] FITCHECK_PUBLIC_URL is not set, so there is no address to put in the link.",
    );
    return sameAnswer;
  }

  const { token } = newSessionToken();
  const expiresAt = new Date(Date.now() + VALID_MINUTES * 60_000).toISOString();
  await createPasswordReset(hashToken(token), user.id, expiresAt);

  await sendMail({
    to: user.email,
    subject: "Reset your FitCheck password",
    text:
      `Someone asked to reset the password for this address.\n\n` +
      `${origin}/reset?token=${token}\n\n` +
      `The link works once and expires in ${VALID_MINUTES} minutes. ` +
      `If it wasn't you, nothing has changed and you can ignore this.\n`,
  });

  purgeExpiredResets().catch(() => {});
  return sameAnswer;
}
