import "server-only";

/**
 * Sending the one email this app sends.
 *
 * No mail library. A password reset is a single transactional message, every
 * modern provider accepts one over plain HTTPS, and adding a dependency plus
 * SMTP configuration to send it would be more moving parts than the feature.
 *
 * With nothing configured the link is written to the server log instead. That
 * is a real answer for the self-hosted case this app is mostly deployed in —
 * the person who needs the link is the person reading the log — and a useless
 * one for anybody else, so it says so loudly and the UI says so too rather
 * than implying an email is on its way.
 */

export type Delivery = "resend" | "log";

export function deliveryMode(): Delivery {
  return process.env.RESEND_API_KEY ? "resend" : "log";
}

/** Whether a stranger could actually receive a reset link on this instance. */
export function canEmailStrangers(): boolean {
  return deliveryMode() !== "log";
}

export interface Message {
  to: string;
  subject: string;
  text: string;
}

export async function sendMail(message: Message): Promise<{ ok: boolean; error?: string }> {
  if (deliveryMode() === "log") {
    // Deliberately one line and deliberately loud. An operator scanning logs
    // should not have to wonder whether this was meant to go somewhere.
    console.warn(
      `[email] No RESEND_API_KEY set, so nothing was sent. The message for ${message.to} was:\n${message.text}`,
    );
    return { ok: true };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.FITCHECK_EMAIL_FROM ?? "FitCheck <onboarding@resend.dev>",
        to: [message.to],
        subject: message.subject,
        text: message.text,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[email] provider returned ${res.status}: ${detail.slice(0, 300)}`);
      return { ok: false, error: `Mail provider returned ${res.status}.` };
    }
    return { ok: true };
  } catch (err) {
    console.error("[email] send failed:", err);
    return { ok: false, error: "Could not reach the mail provider." };
  }
}

/**
 * Where this instance is reachable, for links inside an email.
 *
 * A relative URL is meaningless in a mail client, and the request's own Host
 * header is attacker-controlled — poisoning it is how reset links get sent to
 * somebody else's server. So it comes from configuration, and when there is
 * none the caller is told rather than guessing.
 */
export function publicOrigin(): string | null {
  const configured = process.env.FITCHECK_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  // Railway and Vercel both publish the deployment's own hostname.
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (railway) return `https://${railway}`;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return null;
}
