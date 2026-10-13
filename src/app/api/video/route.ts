import { NextRequest, NextResponse } from "next/server";
import { normalizeVideoUrl } from "@/lib/model";


export async function POST(request: NextRequest) {
  try {
    if (Number(request.headers.get("content-length") || 0) > 2048) {
      return NextResponse.json({ error: "Dados excessivos" }, { status: 413 });
    }
    const body = await request.json() as { url?: unknown };
    if (typeof body?.url !== "string" || body.url.length > 260) return NextResponse.json({ error: "URL invalida" }, { status: 400 });
    let video: ReturnType<typeof normalizeVideoUrl>;
    try { video = normalizeVideoUrl(body.url); }
    catch (err) { return NextResponse.json({ error: err instanceof Error ? err.message : "URL invalida" }, { status: 400 }); }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const apiUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(video.url)}`;
      const response = await fetch(apiUrl, { signal: controller.signal, redirect: "manual", cache: "no-store" });
      if (response.ok) {
        const json = await response.json() as Record<string, unknown>;
        return NextResponse.json({
          id: video.id,
          username: video.username,
          url: video.url,
          title: typeof json.title === "string" ? json.title.slice(0, 280) : `Video ${video.id}`,
          thumbnailUrl: typeof json.thumbnail_url === "string" && json.thumbnail_url.startsWith("https://") ? json.thumbnail_url : undefined,
          verified: true,
        }, { headers: { "Cache-Control": "no-store" } });
      }
    } catch { /* Graceful fallback to unverified URL */ }
    finally { clearTimeout(timer); }
    return NextResponse.json({
      id: video.id, username: video.username, url: video.url,
      title: `Video ${video.id}`, verified: false,
      message: "Nao foi possivel confirmar metadados no TikTok; link salvo sem verificacao.",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Nao foi possivel interpretar a solicitacao." }, { status: 400 });
  }
}

