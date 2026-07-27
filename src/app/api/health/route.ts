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
    return NextResponse.json(
      { ok: false, db: "down", error: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }
}
