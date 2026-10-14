import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { verifyStudioRequest } from "@/lib/server-auth";

export async function GET(request: NextRequest) {
  const denied = verifyStudioRequest(request);
  if (denied) return denied;

  try {
    const id = request.nextUrl.searchParams.get("id") ?? "";
    if (!id) return NextResponse.json({ error: "Video nao informado." }, { status: 400 });

    const db = getSupabaseAdmin();
    const video = await db.from("videos").select("storage_path,file_name,status").eq("id", id).single();
    if (video.error) throw video.error;
    if (!video.data.storage_path || video.data.status !== "uploaded") {
      return NextResponse.json({ error: "Arquivo ainda nao esta disponivel online." }, { status: 409 });
    }

    const signed = await db.storage.from("videos").createSignedUrl(video.data.storage_path, 3600, {
      download: false,
    });
    if (signed.error) throw signed.error;

    return NextResponse.json({ url: signed.data.signedUrl, fileName: video.data.file_name });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao gerar URL." }, { status: 500 });
  }
}
