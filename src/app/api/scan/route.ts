import { NextRequest, NextResponse } from "next/server";
import { normalizeProfileUrl, type ScanResult } from "@/lib/model";


// Best-effort per-instance throttle. Protect this route with Vercel Deployment Protection
// when publishing without authentication; serverless instances do not share this map.
const recent = new Map<string, number>();
const MAX_HTML = 2_500_000;

type Item = Record<string, unknown>;
function obj(v: unknown): Item | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Item : undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function scriptJson(html: string, id: string): unknown {
  const re = new RegExp(`<script\\b[^>]*\\bid=["']${id}["'][^>]*>([\\s\\S]*?)<\\/script>`, "i");
  const match = html.match(re);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}
function candidate(raw: Item, username: string): ScanResult["videos"][number] | null {
  const item = obj(raw.itemInfo)?.itemStruct as Item | undefined ?? obj(raw.itemStruct) ?? raw;
  const id = str(item.id) ?? str(item.aweme_id);
  if (!id || !/^\d{10,25}$/.test(id)) return null;
  const author = obj(item.author);
  const handle = (str(author?.uniqueId) ?? str(author?.unique_id) ?? str(item.authorName) ?? "").toLowerCase();
  if (handle && handle !== username.toLowerCase()) return null;
  const video = obj(item.video);
  if (!video && typeof item.desc !== "string" && !obj(item.stats)) return null;
  const thumbnailUrl = str(video?.cover) ?? str(video?.originCover) ?? str(video?.dynamicCover);
  return {
    id,
    title: (str(item.desc) ?? str(item.title) ?? `Video ${id}`).slice(0, 280),
    url: `https://www.tiktok.com/@${username}/video/${id}`,
    ...(thumbnailUrl && /^https:\/\//.test(thumbnailUrl) ? { thumbnailUrl } : {}),
  };
}
function collect(json: unknown, username: string, results: Map<string, ScanResult["videos"][number]>, depth = 0) {
  if (depth > 12 || results.size >= 100) return;
  if (Array.isArray(json)) {
    for (const entry of json.slice(0, 100)) collect(entry, username, results, depth + 1);
    return;
  }
  const node = obj(json);
  if (!node) return;
  const found = candidate(node, username);
  if (found) results.set(found.id, found);
  for (const [key, value] of Object.entries(node).slice(0, 90)) {
    if (key === "comments" || key === "commentList" || key === "recommendations") continue;
    if (value && typeof value === "object") collect(value, username, results, depth + 1);
  }
}

export async function POST(request: NextRequest) {
  try {
    const length = Number(request.headers.get("content-length") || 0);
    if (length > 2048) return NextResponse.json({ error: "Dados excessivos." }, { status: 413 });
    const raw = await request.json() as { url?: unknown };
    if (typeof raw?.url !== "string" || raw.url.length > 240) {
      return NextResponse.json({ error: "Informe uma URL TikTok valida." }, { status: 400 });
    }
    let profile: ReturnType<typeof normalizeProfileUrl>;
    try { profile = normalizeProfileUrl(raw.url); }
    catch (err) { return NextResponse.json({ error: err instanceof Error ? err.message : "URL invalida" }, { status: 400 }); }
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    const now = Date.now();
    if ((recent.get(ip) ?? 0) > now - 15_000) return NextResponse.json({ error: "Aguarde 15 segundos entre varreduras." }, { status: 429 });
    recent.set(ip, now);
    if (recent.size > 500) for (const [k, v] of recent) if (v < now - 60_000) recent.delete(k);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    let res: Response;
    try {
      res = await fetch(profile.url, {
        method: "GET",
        headers: { Accept: "text/html" },
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
      });
    } catch {
      return NextResponse.json({
        username: profile.username, status: "blocked",
        message: "TikTok nao respondeu ao servidor. A consulta de perfis publicos pode ser bloqueada; tente importar URLs individuais ou arquivos MP4.",
        fetchedCount: 0, videos: [], source: "public-page", exhaustive: false,
      } satisfies ScanResult);
    } finally { clearTimeout(timer); }

    if (!res.ok || res.status >= 300) {
      return NextResponse.json({
        username: profile.username, status: "blocked",
        message: `TikTok nao permitiu acesso publico (HTTP ${res.status}). Nenhum video foi inventado ou baixado.`,
        fetchedCount: 0, videos: [], source: "public-page", exhaustive: false,
      } satisfies ScanResult);
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return NextResponse.json({ error: "Resposta inesperada do TikTok." }, { status: 502 });
    const reader = res.body?.getReader();
    if (!reader) return NextResponse.json({ error: "Resposta vazia do TikTok." }, { status: 502 });
    const pieces: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_HTML) { await reader.cancel(); break; }
        pieces.push(value);
      }
    } finally { reader.releaseLock(); }
    const combined = new Uint8Array(pieces.reduce((n, part) => n + part.length, 0));
    let offset = 0;
    for (const part of pieces) { combined.set(part, offset); offset += part.length; }
    const html = new TextDecoder().decode(combined);
    const results = new Map<string, ScanResult["videos"][number]>();
    for (const id of ["SIGI_STATE", "__UNIVERSAL_DATA_FOR_REHYDRATION__"]) {
      collect(scriptJson(html, id), profile.username, results);
    }
    // Visible video links are a fallback when TikTok changes embedded JSON layout.
    const links = html.matchAll(/\/@([A-Za-z0-9._]{2,30})\/video\/(\d{10,25})/g);
    for (const m of links) {
      if (m[1].toLowerCase() !== profile.username || results.has(m[2]) || results.size >= 100) continue;
      results.set(m[2], { id: m[2], title: `Video ${m[2]}`, url: `https://www.tiktok.com/@${profile.username}/video/${m[2]}` });
    }
    const videos = [...results.values()];
    return NextResponse.json({
      username: profile.username,
      status: videos.length ? "partial" : "blocked",
      message: videos.length
        ? `${videos.length} video(s) encontrados nesta pagina publica. Resultado parcial: nao equivale ao historico completo do perfil.`
        : "Pagina acessivel, mas nenhum video pode ser extraido. TikTok pode limitar dados para visitantes nao autenticados.",
      fetchedCount: videos.length,
      videos,
      source: "public-page",
      exhaustive: false,
    } satisfies ScanResult, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Falha ao processar consulta do perfil." }, { status: 500 });
  }
}
