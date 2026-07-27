import { NextResponse } from "next/server";
import { pool, ready } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Railway's healthcheck gates the deploy on this. It deliberately touches the
 * database: the app is useless without one, so a build that can reach the port
 * but not Postgres should fail the deploy loudly rather than go live and serve
 * errors on every page.
 */
export async function GET() {
  const started = Date.now();
  try {
    await ready();
    await pool().query("SELECT 1");
    return NextResponse.json({ ok: true, db: "up", ms: Date.now() - started });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A failing healthcheck is reported by the platform as nothing more than
    // "healthcheck failed", and the response body never reaches the deploy log.
    // Print the reason where someone staring at the logs will actually see it.
    console.error(`[health] database unreachable: ${message}`);
    if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
      console.error(
        "[health] DATABASE_URL is not set on this service. Add a Postgres " +
          "service and set DATABASE_URL=${{Postgres.DATABASE_URL}} — as a " +
          "variable reference, not a pasted value.",
      );
    }
    return NextResponse.json({ ok: false, db: "down", error: message }, { status: 503 });
  }
}
