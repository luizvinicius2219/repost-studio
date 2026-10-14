import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { createMediaToken } from "@/lib/tiktok-crypto";
import { getFreshTikTokAccessToken } from "@/lib/tiktok-connection";
import { fetchPublishStatus, initializeDirectPostFromUrl, queryCreatorInfo } from "@/lib/tiktok";

function verifyCron(request: NextRequest) {
  const expected = process.env.PUBLISH_CRON_SECRET ?? "";
  const received = request.headers.get("x-publish-secret") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return Boolean(expected && received && received === expected);
}

async function cleanupVideoIfUnused(videoId: string) {
  const db = getSupabaseAdmin();
  const pending = await db.from("posts")
    .select("id", { count: "exact", head: true })
    .eq("video_id", videoId)
    .in("status", ["draft", "scheduled", "publishing", "failed"]);
  if (pending.error) throw pending.error;
  if ((pending.count ?? 0) > 0) return;

  const video = await db.from("videos").select("storage_path").eq("id", videoId).single();
  if (video.error || !video.data.storage_path) return;
  const removed = await db.storage.from("videos").remove([video.data.storage_path]);
  if (removed.error) throw removed.error;
  await db.from("videos").update({
    storage_path: null,
    status: "published",
    storage_deleted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", videoId);
}

async function settlePublishing() {
  const db = getSupabaseAdmin();
  const rows = await db.from("posts")
    .select("id,account_id,video_id,tiktok_publish_id,last_status_check_at")
    .eq("status", "publishing")
    .not("tiktok_publish_id", "is", null)
    .order("last_status_check_at", { ascending: true, nullsFirst: true })
    .limit(5);
  if (rows.error) throw rows.error;

  let completed = 0;
  let failed = 0;
  for (const post of rows.data ?? []) {
    try {
      const { accessToken } = await getFreshTikTokAccessToken(post.account_id);
      const status = await fetchPublishStatus(accessToken, post.tiktok_publish_id);
      const now = new Date().toISOString();
      const postIds = status.publicaly_available_post_id ?? [];
      if (status.status === "PUBLISH_COMPLETE") {
        await db.from("posts").update({
          status: "published",
          published_at: now,
          last_status_check_at: now,
          tiktok_post_id: postIds.length ? String(postIds[0]) : null,
          error_message: null,
          updated_at: now,
        }).eq("id", post.id);
        await cleanupVideoIfUnused(post.video_id);
        completed++;
      } else if (status.status === "FAILED") {
        await db.from("posts").update({
          status: "failed",
          error_message: status.fail_reason ?? "TikTok publishing failed.",
          last_status_check_at: now,
          updated_at: now,
        }).eq("id", post.id);
        failed++;
      } else {
        await db.from("posts").update({ last_status_check_at: now, updated_at: now }).eq("id", post.id);
      }
    } catch (e) {
      await db.from("posts").update({
        error_message: e instanceof Error ? e.message.slice(0, 1200) : "Status check failed.",
        last_status_check_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", post.id);
    }
  }
  return { checked: rows.data?.length ?? 0, completed, failed };
}

async function startDuePosts() {
  const db = getSupabaseAdmin();
  const due = await db.from("posts")
    .select("id,account_id,video_id,scheduled_at,title,privacy_level,allow_comment,allow_duet,allow_stitch,brand_content_toggle,brand_organic_toggle,is_aigc,approved_at,rights_confirmed")
    .eq("status", "scheduled")
    .lte("scheduled_at", new Date().toISOString())
    .not("approved_at", "is", null)
    .eq("rights_confirmed", true)
    .order("scheduled_at", { ascending: true })
    .limit(2);
  if (due.error) throw due.error;

  let started = 0;
  let failed = 0;
  for (const post of due.data ?? []) {
    const now = new Date().toISOString();
    const claim = await db.from("posts").update({
      status: "publishing",
      publish_started_at: now,
      attempt_count: 1,
      updated_at: now,
    }).eq("id", post.id).eq("status", "scheduled").select("id").maybeSingle();
    if (claim.error || !claim.data) continue;

    try {
      if (!post.privacy_level) throw new Error("Privacy level was not approved for this post.");
      const mediaBase = (process.env.TIKTOK_MEDIA_BASE_URL ?? "").replace(/\/$/, "");
      if (!mediaBase) throw new Error("TIKTOK_MEDIA_BASE_URL is not configured.");

      const video = await db.from("videos").select("id,storage_path,status,file_size_bytes").eq("id", post.video_id).single();
      if (video.error || !video.data.storage_path || video.data.status !== "uploaded") throw new Error("Video file is not available in Storage.");

      const { accessToken } = await getFreshTikTokAccessToken(post.account_id);
      const creator = await queryCreatorInfo(accessToken);
      if (!creator.privacy_level_options.includes(post.privacy_level)) throw new Error("The approved privacy level is no longer available for this creator.");
      if (process.env.TIKTOK_CLIENT_AUDITED !== "true" && post.privacy_level !== "SELF_ONLY") throw new Error("Unaudited TikTok clients can only use SELF_ONLY for testing.");
      if (creator.comment_disabled && post.allow_comment) throw new Error("Comments are currently disabled on the TikTok account.");
      if (creator.duet_disabled && post.allow_duet) throw new Error("Duet is currently disabled on the TikTok account.");
      if (creator.stitch_disabled && post.allow_stitch) throw new Error("Stitch is currently disabled on the TikTok account.");

      const token = createMediaToken(video.data.id);
      const videoUrl = `${mediaBase}/${encodeURIComponent(video.data.id)}?token=${encodeURIComponent(token)}`;
      const initialized = await initializeDirectPostFromUrl(accessToken, {
        videoUrl,
        title: String(post.title ?? "").slice(0, 2200),
        privacyLevel: post.privacy_level,
        allowComment: Boolean(post.allow_comment),
        allowDuet: Boolean(post.allow_duet),
        allowStitch: Boolean(post.allow_stitch),
        brandContentToggle: Boolean(post.brand_content_toggle),
        brandOrganicToggle: Boolean(post.brand_organic_toggle),
        isAigc: Boolean(post.is_aigc),
      });
      await db.from("posts").update({
        tiktok_publish_id: initialized.publish_id,
        last_status_check_at: now,
        error_message: null,
        updated_at: now,
      }).eq("id", post.id);
      started++;
    } catch (e) {
      await db.from("posts").update({
        status: "failed",
        error_message: e instanceof Error ? e.message.slice(0, 1200) : "Publish initialization failed.",
        updated_at: new Date().toISOString(),
      }).eq("id", post.id);
      failed++;
    }
  }
  return { due: due.data?.length ?? 0, started, failed };
}

async function run(request: NextRequest) {
  if (!verifyCron(request)) return NextResponse.json({ error: "Invalid publish cron secret." }, { status: 401 });
  try {
    const settled = await settlePublishing();
    const started = await startDuePosts();
    return NextResponse.json({ ok: true, settled, started, at: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Publisher failed." }, { status: 500 });
  }
}

export const POST = run;
export const GET = run;
