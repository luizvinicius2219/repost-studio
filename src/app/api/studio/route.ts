import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { verifyStudioRequest } from "@/lib/server-auth";

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
    const [profiles, accounts, slots, videos, jobs, posts] = await Promise.all([
      db.from("source_profiles").select("*").order("created_at", { ascending: false }),
      db.from("publishing_accounts").select("*").order("created_at", { ascending: false }),
      db.from("schedule_slots").select("*").order("weekday").order("time_local"),
      db.from("videos").select("*").order("discovered_at", { ascending: false }).limit(3000),
      db.from("sync_jobs").select("*").order("requested_at", { ascending: false }).limit(300),
      db.from("posts").select("*").order("scheduled_at", { ascending: true }).limit(3000),
    ]);

    for (const result of [profiles, accounts, slots, videos, jobs, posts]) {
      if (result.error) throw result.error;
    }

    return NextResponse.json({
      profiles: profiles.data ?? [],
      accounts: accounts.data ?? [],
      slots: slots.data ?? [],
      videos: videos.data ?? [],
      jobs: jobs.data ?? [],
      posts: posts.data ?? [],
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
        return { account_id: accountId, video_id: videoId, scheduled_at: date.toISOString(), status: "scheduled" };
      });

      const { data, error } = await db.from("posts").insert(rows).select("*");
      if (error) throw error;
      return NextResponse.json({ ok: true, count: data?.length ?? rows.length });
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
