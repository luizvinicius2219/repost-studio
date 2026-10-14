import { decryptSecret, encryptSecret } from "@/lib/tiktok-crypto";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { refreshTikTokToken, revokeTikTokToken } from "@/lib/tiktok";

type ConnectionRow = {
  account_id: string;
  open_id: string;
  creator_username: string | null;
  creator_nickname: string | null;
  avatar_url: string | null;
  scope: string;
  access_token_enc: string;
  refresh_token_enc: string;
  access_expires_at: string;
  refresh_expires_at: string;
  connected_at: string;
  updated_at: string;
};

export async function getFreshTikTokAccessToken(accountId: string) {
  const db = getSupabaseAdmin();
  const result = await db.from("tiktok_connections").select("*").eq("account_id", accountId).single();
  if (result.error) throw new Error("TikTok account is not connected.");
  const connection = result.data as ConnectionRow;
  const expiresAt = new Date(connection.access_expires_at).getTime();
  if (Number.isFinite(expiresAt) && expiresAt > Date.now() + 15 * 60 * 1000) {
    return { accessToken: decryptSecret(connection.access_token_enc), connection };
  }

  const refreshed = await refreshTikTokToken(decryptSecret(connection.refresh_token_enc));
  const now = Date.now();
  const patch = {
    open_id: refreshed.open_id,
    scope: refreshed.scope,
    access_token_enc: encryptSecret(refreshed.access_token),
    refresh_token_enc: encryptSecret(refreshed.refresh_token),
    access_expires_at: new Date(now + refreshed.expires_in * 1000).toISOString(),
    refresh_expires_at: new Date(now + refreshed.refresh_expires_in * 1000).toISOString(),
    updated_at: new Date(now).toISOString(),
  };
  const updated = await db.from("tiktok_connections").update(patch).eq("account_id", accountId);
  if (updated.error) throw updated.error;
  return { accessToken: refreshed.access_token, connection: { ...connection, ...patch } };
}

export async function disconnectTikTokAccount(accountId: string) {
  const db = getSupabaseAdmin();
  const result = await db.from("tiktok_connections").select("access_token_enc").eq("account_id", accountId).maybeSingle();
  if (result.error) throw result.error;
  if (result.data?.access_token_enc) {
    try { await revokeTikTokToken(decryptSecret(result.data.access_token_enc)); } catch { /* revoke is best-effort */ }
  }
  const deleted = await db.from("tiktok_connections").delete().eq("account_id", accountId);
  if (deleted.error) throw deleted.error;
}
