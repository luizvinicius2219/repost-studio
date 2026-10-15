import { NextRequest, NextResponse } from "next/server";
import { verifyStudioRequest } from "@/lib/server-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { bufferConfigured, listTikTokBufferChannels, createScheduledBufferPost } from "@/lib/buffer-api";
import { syncBufferPosts } from "@/lib/buffer-publisher";

const errorText = (error: unknown) => error instanceof Error ? error.message : "Falha na integracao Buffer.";

export async function GET(req: NextRequest) {
  const denied = verifyStudioRequest(req);
  if (denied) return denied;
  if (!bufferConfigured()) return NextResponse.json({ configured: false, channels: [] });
  try {
    return NextResponse.json({ configured: true, channels: await listTikTokBufferChannels() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: errorText(error) }, { status: 400 }); }
}
export async function POST(req: NextRequest) {
  const denied = verifyStudioRequest(req);
  if (denied) return denied;
  try {
    const input = await req.json() as Record<string, unknown>;
    const action = String(input.action ?? "");
    const db = getSupabaseAdmin();
    if (action === "link_channel") {
      const accountId = String(input.accountId ?? "");
      const channelId = String(input.channelId ?? "");
      if (!/^[a-f0-9-]{36}$/i.test(accountId)) throw new Error("Conta invalida.");
      const channel = (await listTikTokBufferChannels()).find(c => c.id === channelId);
      if (!channel) throw new Error("Selecione um canal TikTok conectado no Buffer.");
      const updated = await db.from("publishing_accounts").update({
        buffer_channel_id: channel.id,
        buffer_organization_id: channel.organizationId,
        updated_at: new Date().toISOString(),
      }).eq("id", accountId).select("id").maybeSingle();
      if (updated.error) throw updated.error;
      if (!updated.data) throw new Error("Conta nao encontrada.");
      return NextResponse.json({ ok: true, channel: channel.name });
    }
    if (action === "sync_status") return NextResponse.json({ ok: true, ...await syncBufferPosts(10) });
    if (action === "send_post") {
      if (process.env.PUBLISH_PROVIDER !== "buffer") throw new Error("Configure PUBLISH_PROVIDER=buffer na Vercel.");
      const postId = String(input.postId ?? "");
      if (!/^[a-f0-9-]{36}$/i.test(postId)) throw new Error("Post invalido.");
      if (input.rightsConfirmed !== true || input.consentConfirmed !== true) throw new Error("Confirme direitos e autorizacao do video.");
      const p = await db.from("posts").select("id,status,account_id,video_id,scheduled_at,title,buffer_dispatch_state,buffer_post_id")
        .eq("id",postId).single();
      if (p.error) throw p.error;
      const post = p.data;
      if (post.status !== "scheduled" || post.buffer_dispatch_state !== "not_sent" || post.buffer_post_id)
        throw new Error("Post ja enviado ou em tentativa pendente. Confira o Buffer para evitar duplicidade.");
      const when = new Date(post.scheduled_at).getTime();
      if (!Number.isFinite(when) || when <= Date.now() + 5 * 60_000 || when > Date.now() + 27 * 86_400_000)
        throw new Error("Escolha horario entre 5 minutos e 27 dias no futuro.");
      const a = await db.from("publishing_accounts").select("is_active,buffer_channel_id").eq("id",post.account_id).single();
      if (a.error) throw a.error;
      if (!a.data.is_active || !a.data.buffer_channel_id) throw new Error("Conta ativa e canal Buffer sao necessarios.");
      const v = await db.from("videos").select("storage_path,status,title").eq("id",post.video_id).single();
      if (v.error) throw v.error;
      if (v.data.status !== "uploaded" || !v.data.storage_path) throw new Error("MP4 nao encontrado no Storage.");
      const claimed = await db.from("posts").update({
        buffer_dispatch_state: "sending", rights_confirmed: true, approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id",post.id).eq("status","scheduled").eq("buffer_dispatch_state","not_sent").select("id").maybeSingle();
      if (claimed.error) throw claimed.error;
      if (!claimed.data) throw new Error("Envio ja iniciado.");
      try {
        const ttl = Math.ceil((when - Date.now()) / 1000) + 72 * 3600;
        const signed = await db.storage.from("videos").createSignedUrl(v.data.storage_path, ttl);
        if (signed.error || !signed.data?.signedUrl) throw signed.error ?? new Error("Falha ao assinar video.");
        const caption = String(post.title || v.data.title || "Video autorizado").slice(0,150);
        const result = await createScheduledBufferPost({ channelId: a.data.buffer_channel_id, videoUrl: signed.data.signedUrl, text: caption, dueAt: new Date(when).toISOString() });
        const saved = await db.from("posts").update({
          status:"publishing", buffer_post_id:result.id, buffer_status:result.status,
          buffer_dispatch_state:"submitted", title:caption, publish_started_at:new Date().toISOString(),
          error_message:null, updated_at:new Date().toISOString(),
        }).eq("id",post.id);
        if (saved.error) throw saved.error;
        return NextResponse.json({ ok:true, bufferPostId:result.id, status:result.status });
      } catch (error) {
        await db.from("posts").update({
          buffer_dispatch_state:"uncertain",
          error_message:(errorText(error) + ". Confira o Buffer antes de reenviar.").slice(0,1200),
          updated_at:new Date().toISOString(),
        }).eq("id",post.id);
        throw error;
      }
    }
    throw new Error("Acao desconhecida.");
  } catch (error) { return NextResponse.json({ error: errorText(error) }, { status:400 }); }
}
