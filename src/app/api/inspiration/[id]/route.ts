import { NextResponse } from "next/server";
import { deleteInspiration } from "@/lib/db";
import { requireApiUser } from "@/lib/server/session";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  // The row and its photo go together, in one transaction — nothing else ever
  // points at an image stored under the `inspiration` kind.
  const gone = await deleteInspiration(auth.user.id, id);
  if (!gone) return NextResponse.json({ error: "No such reference." }, { status: 404 });

  return NextResponse.json({ ok: true });
}
