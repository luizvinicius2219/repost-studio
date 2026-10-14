import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { encryptSecret, parseOAuthState } from "@/lib/tiktok-crypto";
import { exchangeAuthorizationCode, queryCreatorInfo } from "@/lib/tiktok";

function home(request: NextRequest, params: Record<string, string>) {
  const url = new URL("/", request.url);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");
  if (error) return home(request, { tiktok: "error", message: errorDescription ?? error });

  try {
    const code = url.searchParams.get("code") ?? "";
    const state = url.searchParams.get("state") ?? "";
    if (!code || !state) throw new Error("TikTok callback is missing code/state.");
    const { accountId } = parseOAuthState(state);

    const token = await exchangeAuthorizationCode(code);
    if (!token.scope.split(",").map((s) => s.trim()).includes("video.publish")) {
      throw new Error("A conta nao autorizou o escopo video.publish.");
    }
    const creator = await queryCreatorInfo(token.access_token);
    const now = Date.now();

    const db = getSupabaseAdmin();
    const saved = await db.from("tiktok_connections").upsert({
      account_id: accountId,
      open_id: token.open_id,
      creator_username: creator.creator_username ?? null,
      creator_nickname: creator.creator_nickname ?? null,
      avatar_url: creator.creator_avatar_url ?? null,
      scope: token.scope,
      access_token_enc: encryptSecret(token.access_token),
      refresh_token_enc: encryptSecret(token.refresh_token),
      access_expires_at: new Date(now + token.expires_in * 1000).toISOString(),
      refresh_expires_at: new Date(now + token.refresh_expires_in * 1000).toISOString(),
      connected_at: new Date(now).toISOString(),
      updated_at: new Date(now).toISOString(),
    }, { onConflict: "account_id" });
    if (saved.error) throw saved.error;

    return home(request, { tiktok: "connected" });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Falha no retorno do TikTok.";
    return home(request, { tiktok: "error", message });
  }
}
