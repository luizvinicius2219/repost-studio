import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { parseMediaToken } from "@/lib/tiktok-crypto";

function verificationResponse(id: string, head = false): Response | null {
  const filename = process.env.TIKTOK_URL_VERIFY_FILENAME ?? "";
  const content = process.env.TIKTOK_URL_VERIFY_CONTENT ?? "";
  if (!filename || !content || id !== filename) return null;
  const body = head ? null : content;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Length": String(Buffer.byteLength(content, "utf8")),
      "Cache-Control": "public, max-age=300",
    },
  });
}

async function loadVideo(request: NextRequest, id: string) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const signed = parseMediaToken(token);
  if (signed.videoId !== id) throw new Error("Media token does not match video.");

  const db = getSupabaseAdmin();
  const row = await db.from("videos").select("storage_path,file_size_bytes,file_name,status").eq("id", id).single();
  if (row.error || !row.data.storage_path || row.data.status !== "uploaded") return null;
  return { db, row: row.data };
}

export async function HEAD(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const verification = verificationResponse(id, true);
    if (verification) return verification;
    const loaded = await loadVideo(request, id);
    if (!loaded) return new Response(null, { status: 404 });
    const headers = new Headers({
      "Content-Type": "video/mp4",
      "Cache-Control": "no-store, max-age=0",
      "Accept-Ranges": "none",
    });
    if (loaded.row.file_size_bytes) headers.set("Content-Length", String(loaded.row.file_size_bytes));
    return new Response(null, { status: 200, headers });
  } catch {
    return new Response(null, { status: 401 });
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const verification = verificationResponse(id);
    if (verification) return verification;

    const loaded = await loadVideo(request, id);
    if (!loaded) return NextResponse.json({ error: "Media unavailable." }, { status: 404 });
    const file = await loaded.db.storage.from("videos").download(loaded.row.storage_path);
    if (file.error) throw file.error;
    const headers = new Headers({
      "Content-Type": "video/mp4",
      "Cache-Control": "no-store, max-age=0",
      "Content-Disposition": `inline; filename="${loaded.row.file_name ?? `${id}.mp4`}"`,
      "Accept-Ranges": "none",
    });
    if (loaded.row.file_size_bytes) headers.set("Content-Length", String(loaded.row.file_size_bytes));
    return new Response(file.data.stream(), { status: 200, headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Media unavailable." }, { status: 401 });
  }
}
