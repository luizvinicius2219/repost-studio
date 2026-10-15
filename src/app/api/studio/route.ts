import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { verifyStudioRequest } from "@/lib/server-auth";
import { disconnectTikTokAccount, getFreshTikTokAccessToken } from "@/lib/tiktok-connection";
import { queryCreatorInfo } from "@/lib/tiktok";
import { bufferConfigured } from "@/lib/buffer-api";

function profileFromUrl(input: unknown) {
  if (typeof input !== "string" || input.length > 240) throw new Error("Informe a URL do perfil TikTok.");
  const parsed = new URL(input.trim());
  if (parsed.protocol !== "https:" || !["tiktok.com", "www.tiktok.com", "m.tiktok.com"].includes(parsed.hostname.toLowerCase())) {
    throw new Error("Use uma URL HTTPS do TikTok.");
  }
  const match = parsed.pathname.match(/^\/@([A-Za-z0-9._]{2,30})\/?$/);
  if (!match) throw new Error("Use uma URL de perfil: https://www.tiktok.com/@usuario");
  const username = match[1].toLowerCase();
  return { username, profile_url: `https://www.tiktok.com/@${username}` };
}

function validTimes(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("Horarios invalidos.");
  const times = [...new Set(value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean))];
  if (!times.length || !times.every((v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v))) throw new Error("Use horarios como 09:00 e 18:30.");
  return times.sort();
}

function validWeekdays(value: unknown): number[] {
  if (!Array.isArray(value)) throw new Error("Dias da semana invalidos.");
  const days = [...new Set(value.map(Number).filter((v) => Number.isInteger(v) && v >= 0 && v <= 6))];
  if (!days.length) throw new Error("Escolha pelo menos um dia da semana.");
  return days.sort((a, b) => a - b);
}

function cleanUsername(input: unknown): string {
  const value = String(input ?? "").trim().replace(/^@/, "").toLowerCase();
  if (!/^[A-Za-z0-9._]{2,30}$/.test(value)) throw new Error("Informe um @usuario valido.");
  return value;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "Falha inesperada.";
}

export async function GET(request: NextRequest) {
  const denied = verifyStudioRequest(request);
  if (denied) return denied;

  try {
    const db = getSupabaseAdmin();
    const [profiles, accounts, slots, videos, jobs, posts, tiktokConnections] = await Promise.all([
      db.from("source_profiles").select("*").order("created_at", { ascending: false }),
      db.from("publishing_accounts").select("*").order("created_at", { ascending: false }),
      db.from("schedule_slots").select("*").order("weekday").order("time_local"),
      db.from("videos").select("*").order("discovered_at", { ascending: false }).limit(3000),
      db.from("sync_jobs").select("*").order("requested_at", { ascending: false }).limit(300),
      db.from("posts").select("*").order("scheduled_at", { ascending: true }).limit(3000),
      db.from("tiktok_connections").select("account_id,open_id,creator_username,creator_nickname,avatar_url,scope,access_expires_at,connected_at,updated_at"),
    ]);

    for (const result of [profiles, accounts, slots, videos, jobs, posts, tiktokConnections]) {
      if (result.error) throw result.error;
    }

    const storageBytes = (videos.data ?? []).reduce((sum: number, video: { storage_path?: string | null; status?: string; file_size_bytes?: number | null }) => {
      if (!video.storage_path || video.status !== "uploaded") return sum;
      return sum + Math.max(0, Number(video.file_size_bytes) || 0);
    }, 0);
    const storageLimitBytes = Math.max(1, Number(process.env.SUPABASE_STORAGE_SOFT_LIMIT_BYTES) || 1_000_000_000);

    return NextResponse.json({
      profiles: profiles.data ?? [],
      accounts: accounts.data ?? [],
      slots: slots.data ?? [],
      videos: videos.data ?? [],
      jobs: jobs.data ?? [],
      posts: posts.data ?? [],
      tiktokConnections: tiktokConnections.data ?? [],
      storageBytes,
      storageLimitBytes,
      publisher: process.env.PUBLISH_PROVIDER === "buffer" ? "buffer" : "tiktok",
      bufferConfigured: bufferConfigured(),
      publisherConfigured: process.env.PUBLISH_PROVIDER === "buffer" ? bufferConfigured() : Boolean(
        process.env.TIKTOK_CLIENT_KEY &&
        process.env.TIKTOK_CLIENT_SECRET &&
        process.env.TIKTOK_REDIRECT_URI &&
        process.env.TIKTOK_TOKEN_ENCRYPTION_KEY &&
        process.env.TIKTOK_MEDIA_BASE_URL &&
        process.env.PUBLISH_CRON_SECRET &&
        process.env.TIKTOK_URL_VERIFY_FILENAME &&
        process.env.TIKTOK_URL_VERIFY_CONTENT
      ),
      tiktokAudited: process.env.TIKTOK_CLIENT_AUDITED === "true",
      serverTime: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const denied = verifyStudioRequest(request);
  if (denied) return denied;

  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "");
    const db = getSupabaseAdmin();

    if (action === "create_source") {
      const profile = profileFromUrl(body.url);
      const { data, error } = await db.from("source_profiles").upsert({
        ...profile,
        is_active: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "username" }).select("*").single();
      if (error) throw error;
      return NextResponse.json({ ok: true, profile: data });
    }

    if (action === "queue_sync") {
      const profileId = String(body.profileId ?? "");
      if (!profileId) throw new Error("Perfil nao informado.");

      const storageLimit = Math.max(1, Number(process.env.SUPABASE_STORAGE_SOFT_LIMIT_BYTES) || 1_000_000_000);
      const stored = await db.from("videos").select("file_size_bytes,storage_path,status");
      if (stored.error) throw stored.error;
      const usedBytes = (stored.data ?? []).reduce((sum: number, item: { storage_path?: string | null; status?: string; file_size_bytes?: number | null }) => item.storage_path && item.status === "uploaded" ? sum + Math.max(0, Number(item.file_size_bytes) || 0) : sum, 0);
      if (usedBytes >= storageLimit * 0.85) throw new Error("Storage acima de 85% do limite configurado. Publique ou libere espaco antes de iniciar nova sincronizacao.");

      const existing = await db.from("sync_jobs")
        .select("*")
        .eq("source_profile_id", profileId)
        .in("status", ["pending", "running", "waiting_user"])
        .order("requested_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data) return NextResponse.json({ ok: true, job: existing.data, reused: true });

      const { data, error } = await db.from("sync_jobs").insert({ source_profile_id: profileId, status: "pending" }).select("*").single();
      if (error) throw error;
      const update = await db.from("source_profiles").update({ sync_status: "pending", updated_at: new Date().toISOString() }).eq("id", profileId);
      if (update.error) throw update.error;
      return NextResponse.json({ ok: true, job: data, reused: false });
    }

    if (action === "save_account") {
      const id = typeof body.id === "string" ? body.id : "";
      const username = cleanUsername(body.username);
      const label = String(body.label ?? "").trim().slice(0, 100) || username;
      const timezone = String(body.timezone ?? "America/Sao_Paulo").trim().slice(0, 80) || "America/Sao_Paulo";
      const weekdays = validWeekdays(body.weekdays);
      const times = validTimes(body.times);
      const now = new Date().toISOString();

      let accountId = id;
      if (id) {
        const { error } = await db.from("publishing_accounts").update({ username, label, timezone, updated_at: now }).eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await db.from("publishing_accounts").insert({ username, label, timezone, is_active: true }).select("id").single();
        if (error) throw error;
        accountId = data.id;
      }

      const removed = await db.from("schedule_slots").delete().eq("account_id", accountId);
      if (removed.error) throw removed.error;
      const rows = weekdays.flatMap((weekday) => times.map((time_local) => ({ account_id: accountId, weekday, time_local, is_active: true })));
      const inserted = await db.from("schedule_slots").insert(rows);
      if (inserted.error) throw inserted.error;
      return NextResponse.json({ ok: true, accountId });
    }

    if (action === "toggle_account") {
      const id = String(body.id ?? "");
      const isActive = Boolean(body.isActive);
      const { error } = await db.from("publishing_accounts").update({ is_active: isActive, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === "disconnect_tiktok") {
      const accountId = String(body.accountId ?? "");
      if (!accountId) throw new Error("Conta nao informada.");
      await disconnectTikTokAccount(accountId);
      return NextResponse.json({ ok: true });
    }

    if (action === "tiktok_creator_info") {
      const accountId = String(body.accountId ?? "");
      if (!accountId) throw new Error("Conta nao informada.");
      const { accessToken } = await getFreshTikTokAccessToken(accountId);
      const creator = await queryCreatorInfo(accessToken);
      return NextResponse.json({ ok: true, creator });
    }

    if (action === "create_posts") {
      const accountId = String(body.accountId ?? "");
      const items = Array.isArray(body.items) ? body.items : [];
      if (!accountId || !items.length || items.length > 500) throw new Error("Agenda invalida.");

      const account = await db.from("publishing_accounts").select("id,is_active").eq("id", accountId).single();
      if (account.error) throw account.error;
      if (!account.data.is_active) throw new Error("A conta esta pausada.");

      const rows = items.map((item) => {
        const value = item as Record<string, unknown>;
        const videoId = String(value.videoId ?? "");
        const scheduledAt = String(value.scheduledAt ?? "");
        const date = new Date(scheduledAt);
        if (!videoId || Number.isNaN(date.getTime())) throw new Error("Item de agenda invalido.");
        return {
          account_id: accountId,
          video_id: videoId,
          scheduled_at: date.toISOString(),
          status: "scheduled",
          brand_content_toggle: false,
          brand_organic_toggle: false,
          is_aigc: false,
          rights_confirmed: false,
          approved_at: null,
        };
      });

      const { data, error } = await db.from("posts").insert(rows).select("*");
      if (error) throw error;
      return NextResponse.json({ ok: true, count: data?.length ?? rows.length });
    }

    if (action === "approve_post") {
      const id = String(body.id ?? "");
      const title = String(body.title ?? "").trim().slice(0, 2200);
      const privacyLevel = String(body.privacyLevel ?? "");
      const rightsConfirmed = body.rightsConfirmed === true;
      const consentConfirmed = body.consentConfirmed === true;
      if (!id || !privacyLevel) throw new Error("Selecione a privacidade da publicacao.");
      if (!rightsConfirmed) throw new Error("Confirme que voce possui os direitos/permissao para publicar o conteudo.");
      if (!consentConfirmed) throw new Error("Confirme o consentimento para envio ao TikTok no horario agendado.");

      const post = await db.from("posts").select("id,account_id").eq("id", id).single();
      if (post.error) throw post.error;
      const { accessToken } = await getFreshTikTokAccessToken(post.data.account_id);
      const creator = await queryCreatorInfo(accessToken);
      if (!creator.privacy_level_options.includes(privacyLevel)) throw new Error("Opcao de privacidade indisponivel para esta conta.");
      if (process.env.TIKTOK_CLIENT_AUDITED !== "true" && privacyLevel !== "SELF_ONLY") {
        throw new Error("Cliente TikTok ainda nao auditado: selecione SELF_ONLY para testes privados.");
      }

      const allowComment = Boolean(body.allowComment);
      const allowDuet = Boolean(body.allowDuet);
      const allowStitch = Boolean(body.allowStitch);
      const brandContentToggle = Boolean(body.brandContentToggle);
      const brandOrganicToggle = Boolean(body.brandOrganicToggle);
      const isAigc = Boolean(body.isAigc);
      if (allowComment && creator.comment_disabled) throw new Error("Comentarios estao desativados nessa conta.");
      if (allowDuet && creator.duet_disabled) throw new Error("Dueto esta desativado nessa conta.");
      if (allowStitch && creator.stitch_disabled) throw new Error("Stitch esta desativado nessa conta.");
      if (brandContentToggle && privacyLevel === "SELF_ONLY") throw new Error("Conteudo de parceria paga nao pode ser publicado como Somente eu.");

      const { error } = await db.from("posts").update({
        title,
        privacy_level: privacyLevel,
        allow_comment: allowComment,
        allow_duet: allowDuet,
        allow_stitch: allowStitch,
        brand_content_toggle: brandContentToggle,
        brand_organic_toggle: brandOrganicToggle,
        is_aigc: isAigc,
        rights_confirmed: true,
        approved_at: new Date().toISOString(),
        error_message: null,
        updated_at: new Date().toISOString(),
      }).eq("id", id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === "update_post") {
      const id = String(body.id ?? "");
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      const allowed = ["draft", "scheduled", "publishing", "published", "failed", "cancelled"];
      if (typeof body.status === "string") {
        if (!allowed.includes(body.status)) throw new Error("Status invalido.");
        patch.status = body.status;
        if (body.status === "published") patch.published_at = new Date().toISOString();
      }
      if (typeof body.scheduledAt === "string") {
        const d = new Date(body.scheduledAt);
        if (Number.isNaN(d.getTime())) throw new Error("Data invalida.");
        patch.scheduled_at = d.toISOString();
      }
      const { error } = await db.from("posts").update(patch).eq("id", id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    throw new Error("Acao nao reconhecida.");
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 400 });
  }
}
