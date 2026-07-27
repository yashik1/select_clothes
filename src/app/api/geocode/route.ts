import { NextResponse } from "next/server";
import { geocode } from "@/lib/weather";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q || q.length < 2) return NextResponse.json({ results: [] });
  return NextResponse.json({ results: await geocode(q) });
}
