import { NextRequest, NextResponse } from "next/server";
import { verifyStudioRequest } from "@/lib/server-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { buildTikTokAuthorizationUrl } from "@/lib/tiktok";
import { createOAuthState } from "@/lib/tiktok-crypto";

export async function POST(request: NextRequest) {
  const denied = verifyStudioRequest(request);
  if (denied) return denied;

  try {
    const body = await request.json() as { accountId?: string };
    const accountId = String(body.accountId ?? "");
    if (!accountId) throw new Error("Conta de publicacao nao informada.");

    const db = getSupabaseAdmin();
    const account = await db.from("publishing_accounts").select("id").eq("id", accountId).single();
    if (account.error) throw new Error("Conta de publicacao nao encontrada.");

    const state = createOAuthState(accountId);
    return NextResponse.json({ url: buildTikTokAuthorizationUrl(state) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao iniciar TikTok OAuth." }, { status: 400 });
  }
}
