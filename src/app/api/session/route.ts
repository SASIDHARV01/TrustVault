import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json(
      { error: "Authentication required" },
      {
        status: 401,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }

  return NextResponse.json(
    {
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        role: session.user.role,
      },
      expiresAt: session.session.expiresAt,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
