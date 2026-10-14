import { NextRequest, NextResponse } from "next/server";

export function verifyStudioRequest(request: NextRequest): NextResponse | null {
  const expected = process.env.REPOST_STUDIO_ACCESS_KEY;
  if (!expected) {
    return NextResponse.json(
      { error: "REPOST_STUDIO_ACCESS_KEY is not configured on the server." },
      { status: 503 },
    );
  }

  const received = request.headers.get("x-repost-key") ?? "";
  if (!received || received !== expected) {
    return NextResponse.json({ error: "Invalid Repost Studio access key." }, { status: 401 });
  }

  return null;
}
