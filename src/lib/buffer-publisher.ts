import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getBufferPost } from "@/lib/buffer-api";

/** Delete only after Buffer confirmed Sent, and when no other post needs the MP4. */
export async function cleanupBufferVideoIfUnused(videoId: string) {
  const db = getSupabaseAdmin();
  const pending = await db.from("posts").select("id", {count:"exact", head:true})
    .eq("video_id", videoId).in("status", ["draft","scheduled","publishing","failed"]);
  if (pending.error) throw pending.error;
  if ((pending.count ?? 0) > 0) return false;
  const video = await db.from("videos").select("storage_path").eq("id",videoId).single();
  if (video.error || !video.data?.storage_path) return false;
  const removal = await db.storage.from("videos").remove([video.data.storage_path]);
  if (removal.error) throw removal.error;
  const updated = await db.from("videos").update({
    status:"published", storage_path:null, storage_deleted_at:new Date().toISOString(),
    updated_at:new Date().toISOString(),
  }).eq("id",videoId);
  if (updated.error) throw updated.error;
  return true;
}

export async function syncBufferPosts(limit = 10) {
  const db = getSupabaseAdmin();
  const cutoff = new Date(Date.now()-2*60_000).toISOString();
  const previous = new Date(Date.now()-15*60_000).toISOString();
  const pending = await db.from("posts").select("id,video_id,buffer_post_id")
    .eq("status","publishing").not("buffer_post_id","is",null)
    .lte("scheduled_at",cutoff)
    .or(`buffer_last_checked_at.is.null,buffer_last_checked_at.lt.${previous}`)
    .order("scheduled_at",{ascending:true}).limit(limit);
  if (pending.error) throw pending.error;
  let checked=0,sent=0,errors=0;
  for (const post of pending.data ?? []) {
    try {
      const remote = await getBufferPost(post.buffer_post_id);
      const status=remote.status.toLowerCase(), now=new Date().toISOString();
      const patch:Record<string,unknown> = {buffer_status:status,buffer_last_checked_at:now,updated_at:now};
      if (status==="sent") {patch.status="published";patch.published_at=now;patch.error_message=null;sent++;}
      else if (status==="error") {patch.status="failed";patch.error_message="Buffer informou erro. Confira a fila do Buffer.";errors++;}
      const updated=await db.from("posts").update(patch).eq("id",post.id).eq("status","publishing");
      if (updated.error) throw updated.error;
      checked++;
      if (status==="sent") {
        try { await cleanupBufferVideoIfUnused(post.video_id); } catch { /* retry cleanup later; do not alter sent status */ }
      }
    } catch (err) {
      await db.from("posts").update({
        error_message: err instanceof Error?err.message.slice(0,350):"Falha de consulta ao Buffer",
        buffer_last_checked_at:new Date().toISOString(),
      }).eq("id",post.id);
    }
  }
  return {checked,sent,errors};
}
