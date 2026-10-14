import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { verifyStudioRequest } from "@/lib/server-auth";

function msg(error: unknown) {
  return error instanceof Error ? error.message : "Falha inesperada.";
}

function cleanVideoId(value: unknown) {
  const id = String(value ?? "");
  if (!/^\d{10,25}$/.test(id)) throw new Error("ID de video invalido.");
  return id;
}

function cleanSourceUrl(value: unknown, username: string, videoId: string) {
  const url = new URL(String(value ?? ""));
  if (url.protocol !== "https:" || !["www.tiktok.com", "tiktok.com", "m.tiktok.com"].includes(url.hostname.toLowerCase())) {
    throw new Error("URL de video invalida.");
  }
  const expected = `/@${username}/video/${videoId}`.toLowerCase();
  if (url.pathname.toLowerCase() !== expected) throw new Error("URL nao pertence ao perfil da tarefa.");
  return `https://www.tiktok.com/@${username}/video/${videoId}`;
}

export async function POST(request: NextRequest) {
  const denied = verifyStudioRequest(request);
  if (denied) return denied;

  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "");
    const db = getSupabaseAdmin();

    if (action === "next_job") {
      const pending = await db.from("sync_jobs")
        .select("*")
        .eq("status", "pending")
        .order("requested_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (pending.error) throw pending.error;
      if (!pending.data) return NextResponse.json({ ok: true, job: null });

      const profile = await db.from("source_profiles").select("*").eq("id", pending.data.source_profile_id).single();
      if (profile.error) throw profile.error;
      if (!profile.data.is_active) {
        await db.from("sync_jobs").update({ status: "cancelled", message: "Perfil de origem pausado.", finished_at: new Date().toISOString() }).eq("id", pending.data.id);
        return NextResponse.json({ ok: true, job: null });
      }

      const now = new Date().toISOString();
      const claimed = await db.from("sync_jobs").update({
        status: "running",
        started_at: pending.data.started_at ?? now,
        message: "Agente local assumiu a tarefa.",
      }).eq("id", pending.data.id).eq("status", "pending").select("*").maybeSingle();
      if (claimed.error) throw claimed.error;
      if (!claimed.data) return NextResponse.json({ ok: true, job: null });
      await db.from("source_profiles").update({ sync_status: "running", updated_at: now }).eq("id", profile.data.id);

      return NextResponse.json({ ok: true, job: claimed.data, profile: profile.data });
    }

    if (action === "progress") {
      const jobId = String(body.jobId ?? "");
      const allowed = ["running", "waiting_user", "completed", "partial", "failed", "cancelled"];
      const status = String(body.status ?? "running");
      if (!jobId || !allowed.includes(status)) throw new Error("Atualizacao de tarefa invalida.");

      const patch: Record<string, unknown> = {
        status,
        message: String(body.message ?? "").slice(0, 1000) || null,
      };
      for (const key of ["found_count", "new_count", "downloaded_count", "uploaded_count", "error_count"] as const) {
        const sourceKey = key.replace("_count", "Count");
        if (body[sourceKey] !== undefined) patch[key] = Math.max(0, Number(body[sourceKey]) || 0);
      }
      if (["completed", "partial", "failed", "cancelled"].includes(status)) patch.finished_at = new Date().toISOString();

      const job = await db.from("sync_jobs").update(patch).eq("id", jobId).select("source_profile_id").single();
      if (job.error) throw job.error;
      const profileStatus = status === "cancelled" ? "failed" : status;
      const profilePatch: Record<string, unknown> = { sync_status: profileStatus, updated_at: new Date().toISOString() };
      if (["completed", "partial"].includes(status)) profilePatch.last_sync_at = new Date().toISOString();
      await db.from("source_profiles").update(profilePatch).eq("id", job.data.source_profile_id);
      return NextResponse.json({ ok: true });
    }

    if (action === "prepare_video") {
      const jobId = String(body.jobId ?? "");
      const videoId = cleanVideoId(body.videoId);
      const fileSize = Math.max(0, Number(body.fileSize) || 0);
      if (!jobId || !fileSize) throw new Error("Arquivo invalido.");

      const storageLimit = Math.max(1, Number(process.env.SUPABASE_STORAGE_SOFT_LIMIT_BYTES) || 1_000_000_000);
      const stored = await db.from("videos").select("file_size_bytes,storage_path,status");
      if (stored.error) throw stored.error;
      const usedBytes = (stored.data ?? []).reduce((sum: number, item: { storage_path?: string | null; status?: string; file_size_bytes?: number | null }) => item.storage_path && item.status === "uploaded" ? sum + Math.max(0, Number(item.file_size_bytes) || 0) : sum, 0);
      if (usedBytes + fileSize > storageLimit) throw new Error("Limite de armazenamento configurado atingido. Publique/remova arquivos antes de enviar novos MP4.");

      const job = await db.from("sync_jobs").select("source_profile_id").eq("id", jobId).single();
      if (job.error) throw job.error;
      const profile = await db.from("source_profiles").select("id,username").eq("id", job.data.source_profile_id).single();
      if (profile.error) throw profile.error;
      const sourceUrl = cleanSourceUrl(body.sourceUrl, profile.data.username, videoId);
      const path = `${profile.data.username}/${videoId}.mp4`;
      const fileName = `${videoId}.mp4`;
      const now = new Date().toISOString();

      const upserted = await db.from("videos").upsert({
        source_profile_id: profile.data.id,
        tiktok_video_id: videoId,
        title: String(body.title ?? `Video ${videoId}`).slice(0, 500),
        source_url: sourceUrl,
        storage_path: path,
        file_name: fileName,
        file_size_bytes: fileSize,
        status: "uploading",
        error_message: null,
        updated_at: now,
      }, { onConflict: "tiktok_video_id" }).select("id,status,storage_path").single();
      if (upserted.error) throw upserted.error;

      const signed = await db.storage.from("videos").createSignedUploadUrl(path, { upsert: true });
      if (signed.error) throw signed.error;
      return NextResponse.json({
        ok: true,
        videoDbId: upserted.data.id,
        path: signed.data.path,
        token: signed.data.token,
        signedUrl: signed.data.signedUrl,
      });
    }

    if (action === "complete_video") {
      const videoDbId = String(body.videoDbId ?? "");
      if (!videoDbId) throw new Error("Video nao informado.");
      const { error } = await db.from("videos").update({
        status: "uploaded",
        uploaded_at: new Date().toISOString(),
        error_message: null,
        updated_at: new Date().toISOString(),
      }).eq("id", videoDbId);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === "video_failed") {
      const videoDbId = String(body.videoDbId ?? "");
      if (!videoDbId) throw new Error("Video nao informado.");
      const { error } = await db.from("videos").update({
        status: "failed",
        error_message: String(body.error ?? "Falha no agente local.").slice(0, 1200),
        updated_at: new Date().toISOString(),
      }).eq("id", videoDbId);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    throw new Error("Acao de agente nao reconhecida.");
  } catch (error) {
    return NextResponse.json({ error: msg(error) }, { status: 400 });
  }
}
