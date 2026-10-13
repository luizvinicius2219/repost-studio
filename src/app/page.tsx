"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertCircle, ArrowDownToLine, CalendarDays, Check, CheckCircle2,
  Clapperboard, Clock3, CloudOff, ExternalLink, FileVideo, FolderOpen,
  HardDrive, Info, LayoutDashboard, Link2, ListVideo, Loader2, Play,
  Plus, ScanSearch, Search, Settings, ShieldAlert, Trash2, UploadCloud,
  Users, Video, X,
} from "lucide-react";
import {
  EMPTY_DATA, localTimeLabel, normalizeProfileUrl,
  type Profile, type ScanResult, type StudioData, type VideoItem,
} from "@/lib/model";
import { exportStudio, loadStudio, saveStudio } from "@/lib/studio-store";
import { deleteMedia, fingerprint, getMedia, putMedia } from "@/lib/media-db";

type Tab = "Dashboard" | "Perfis" | "Biblioteca" | "Varreduras" | "Agendamentos" | "Configuracoes";
type Toast = { kind: "ok" | "error" | "info"; message: string } | null;

const navigation = [
  { title: "Dashboard" as Tab, icon: LayoutDashboard },
  { title: "Perfis" as Tab, icon: Users },
  { title: "Biblioteca" as Tab, icon: FolderOpen },
  { title: "Varreduras" as Tab, icon: ScanSearch },
  { title: "Agendamentos" as Tab, icon: CalendarDays },
  { title: "Configuracoes" as Tab, icon: Settings },
];
const field = "w-full rounded-xl border border-white/10 bg-[#0b1020] px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-violet-500";
const panel = "rounded-2xl border border-white/10 bg-[#121a2b] p-5 sm:p-6";
const primary = "inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50";
const secondary = "inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-50";
const shortId = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

function Badge({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "good" | "warn" | "bad" }) {
  const styles = { muted: "bg-slate-500/10 text-slate-300", good: "bg-emerald-500/10 text-emerald-300", warn: "bg-amber-500/10 text-amber-300", bad: "bg-rose-500/10 text-rose-300" };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${styles[tone]}`}>{children}</span>;
}
function Empty({ icon: Icon, title, description }: { icon: typeof Video; title: string; description: string }) {
  return <div className="flex min-h-44 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 p-6 text-center">
    <Icon size={29} className="text-slate-500" /><p className="font-medium text-slate-300">{title}</p><p className="max-w-md text-sm text-slate-500">{description}</p>
  </div>;
}
function dateInput() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }

export default function Home() {
  const [tab, setTab] = useState<Tab>("Dashboard");
  const [data, setData] = useState<StudioData>(EMPTY_DATA);
  const dataRef = useRef<StudioData>(EMPTY_DATA);
  const [ready, setReady] = useState(false);
  const [profileUrl, setProfileUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [busyScan, setBusyScan] = useState<string | null>(null);
  const [busyVideo, setBusyVideo] = useState(false);
  const [busyUpload, setBusyUpload] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<Toast>(null);
  const [startDate, setStartDate] = useState("");
  const [hours, setHours] = useState("09:00,18:00");
  const [planLimit, setPlanLimit] = useState(20);
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);
  const folderRef = useRef<HTMLInputElement | null>(null);
  const filesRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const stored = loadStudio();
    dataRef.current = stored;
    setData(stored);
    setReady(true);
    setStartDate(dateInput());
  }, []);
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview]);

  function update(fn: (current: StudioData) => StudioData) {
    const next = fn(dataRef.current);
    dataRef.current = next;
    setData(next);
    try { saveStudio(next); }
    catch { setToast({ kind: "error", message: "O navegador nao conseguiu salvar os metadados. Libere espaco ou permita armazenamento local." }); }
  }
  function notify(message: string, kind: "ok" | "error" | "info" = "ok") { setToast({ kind, message }); }

  function addProfile(raw = profileUrl) {
    try {
      const value = normalizeProfileUrl(raw);
      const existing = dataRef.current.profiles.find((p) => p.username === value.username);
      if (existing) { notify(`@${value.username} ja esta cadastrado.`, "info"); setTab("Perfis"); return existing.id; }
      const p: Profile = { ...value, id: shortId(), createdAt: nowIso(), scanStatus: "pending" };
      update((old) => ({ ...old, profiles: [p, ...old.profiles] }));
      setProfileUrl(""); setTab("Perfis"); notify(`@${value.username} cadastrado.`);
      return p.id;
    } catch (e) { notify(e instanceof Error ? e.message : "URL invalida", "error"); return null; }
  }

  async function scan(profile: Profile) {
    if (busyScan) return;
    const jobId = shortId();
    setBusyScan(profile.id);
    update((old) => ({ ...old,
      scans: [{ id: jobId, profileId: profile.id, username: profile.username, at: nowIso(), status: "running", found: 0, added: 0, message: "Consultando pagina publica..." }, ...old.scans],
    }));
    try {
      const res = await fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: profile.url }) });
      const result = await res.json() as ScanResult & { error?: string };
      if (!res.ok) throw new Error(result.error || `Erro HTTP ${res.status}`);
      const known = new Set(dataRef.current.videos.filter((v) => v.source === "tiktok").map((v) => v.externalId));
      const additions: VideoItem[] = result.videos.filter((v) => !known.has(v.id)).map((v) => ({
        id: shortId(), source: "tiktok", profileId: profile.id, externalId: v.id,
        title: v.title, originalUrl: v.url, thumbnailUrl: v.thumbnailUrl, createdAt: nowIso(),
      }));
      update((old) => ({ ...old,
        videos: [...additions, ...old.videos],
        profiles: old.profiles.map((p) => p.id === profile.id ? { ...p, lastScanAt: nowIso(), scanStatus: result.status === "partial" || result.status === "completed" ? result.status : "failed" } : p),
        scans: old.scans.map((j) => j.id === jobId ? { ...j, status: result.status, found: result.fetchedCount, added: additions.length, message: result.message } : j),
      }));
      notify(result.message, result.fetchedCount ? "ok" : "info");
      setTab("Varreduras");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Falha desconhecida";
      update((old) => ({ ...old,
        profiles: old.profiles.map((p) => p.id === profile.id ? { ...p, lastScanAt: nowIso(), scanStatus: "failed" } : p),
        scans: old.scans.map((j) => j.id === jobId ? { ...j, status: "failed", message } : j),
      }));
      notify(message, "error");
    } finally { setBusyScan(null); }
  }

  async function addVideoUrl() {
    if (busyVideo) return;
    setBusyVideo(true);
    try {
      const res = await fetch("/api/video", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: videoUrl.trim() }) });
      const item = await res.json() as { error?: string; id: string; username: string; url: string; title: string; thumbnailUrl?: string; verified?: boolean; message?: string };
      if (!res.ok) throw new Error(item.error || "Falha na leitura da URL");
      if (dataRef.current.videos.some((v) => v.externalId === item.id)) throw new Error("Este video ja esta no catalogo.");
      const existing = dataRef.current.profiles.find((p) => p.username === item.username);
      const profileId = existing?.id ?? shortId();
      const newProfile: Profile | undefined = existing ? undefined : { id: profileId, username: item.username, url: `https://www.tiktok.com/@${item.username}`, createdAt: nowIso(), scanStatus: "pending" };
      update((old) => ({ ...old,
        profiles: newProfile ? [newProfile, ...old.profiles] : old.profiles,
        videos: [{ id: shortId(), source: "tiktok", profileId, externalId: item.id, title: item.title, originalUrl: item.url, thumbnailUrl: item.thumbnailUrl, createdAt: nowIso() }, ...old.videos],
      }));
      setVideoUrl(""); notify(item.verified ? "Video catalogado com metadados oficiais de incorporacao." : (item.message || "Link adicionado, nao verificado."), item.verified ? "ok" : "info");
      setTab("Biblioteca");
    } catch (e) { notify(e instanceof Error ? e.message : "Erro ao adicionar video", "error"); }
    finally { setBusyVideo(false); }
  }

  async function importFiles(incoming: FileList | null) {
    if (!incoming?.length || busyUpload) return;
    const selected = [...incoming].filter((f) => /\.mp4$/i.test(f.name) && (f.type === "video/mp4" || f.type === ""));
    if (!selected.length) { notify("Nenhum MP4 selecionado.", "error"); return; }
    setBusyUpload(true);
    let added = 0; let duplicated = 0; let errors = 0;
    try {
      for (const [i, file] of selected.entries()) {
        setUploadMessage(`Importando ${i + 1}/${selected.length}: ${file.name}`);
        try {
          const hash = await fingerprint(file);
          if (dataRef.current.videos.some((v) => v.fingerprint === hash)) { duplicated++; continue; }
          const id = shortId();
          await putMedia(id, file);
          update((old) => ({ ...old, videos: [{ id, fileId: id, source: "upload", title: file.name.replace(/\.mp4$/i, ""), fileName: file.name, fingerprint: hash, fileSize: file.size, createdAt: nowIso() }, ...old.videos] }));
          added++;
        } catch { errors++; }
      }
      notify(`${added} importado(s), ${duplicated} duplicado(s), ${errors} erro(s).`, errors ? "info" : "ok");
      setTab("Biblioteca");
    } finally {
      setBusyUpload(false); setUploadMessage("");
      if (folderRef.current) folderRef.current.value = "";
      if (filesRef.current) filesRef.current.value = "";
    }
  }

  async function previewFile(item: VideoItem) {
    if (!item.fileId) return;
    try {
      const blob = await getMedia(item.fileId);
      if (!blob) throw new Error("Arquivo nao encontrado neste navegador. Importe novamente a pasta.");
      setPreview({ name: item.fileName ?? item.title, url: URL.createObjectURL(blob) });
    } catch (e) { notify(e instanceof Error ? e.message : "Erro ao abrir arquivo", "error"); }
  }
  async function downloadFile(item: VideoItem) {
    if (!item.fileId) return;
    const file = await getMedia(item.fileId);
    if (!file) return notify("Arquivo indisponivel neste navegador.", "error");
    const url = URL.createObjectURL(file);
    const a = document.createElement("a"); a.href = url; a.download = item.fileName || `${item.id}.mp4`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function removeVideo(item: VideoItem) {
    if (!window.confirm(`Excluir '${item.title}' da biblioteca e remover agendamentos vinculados?`)) return;
    if (item.fileId) await deleteMedia(item.fileId);
    update((old) => ({ ...old,
      videos: old.videos.filter((v) => v.id !== item.id),
      schedules: old.schedules.filter((s) => s.videoId !== item.id),
    }));
    notify("Video removido.");
  }
  function removeProfile(profile: Profile) {
    if (!window.confirm(`Excluir @${profile.username} e seus links catalogados? MP4 importados serao mantidos.`)) return;
    const ids = new Set(dataRef.current.videos.filter((v) => v.profileId === profile.id && v.source === "tiktok").map((v) => v.id));
    update((old) => ({ ...old, profiles: old.profiles.filter((p) => p.id !== profile.id),
      videos: old.videos.filter((v) => !ids.has(v.id)),
      schedules: old.schedules.filter((s) => !ids.has(s.videoId)),
    }));
    notify("Perfil removido.");
  }
  function createSchedule() {
    const times = [...new Set(hours.split(",").map((v) => v.trim()))];
    if (!times.length || !times.every((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time))) return notify("Use horarios no formato 09:00,18:00", "error");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || Number.isNaN(new Date(startDate + "T12:00:00").getTime())) return notify("Escolha uma data valida.", "error");
    const taken = new Set(dataRef.current.schedules.map((s) => s.videoId));
    const available = dataRef.current.videos.filter((v) => !!v.fileId && !taken.has(v.id));
    if (!available.length) return notify("Importe arquivos MP4 ainda nao agendados.", "info");
    const limit = Math.min(Math.max(planLimit, 1), 300);
    const planned: StudioData["schedules"] = [];
    const baseDate = new Date(`${startDate}T12:00:00`);
    const now = Date.now();
    for (let day = 0; day < 365 && planned.length < Math.min(limit, available.length); day++) {
      const date = new Date(baseDate.getTime()); date.setDate(baseDate.getDate() + day);
      for (const time of times.sort()) {
        const [h, m] = time.split(":").map(Number);
        const slot = new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m);
        if (slot.getTime() <= now) continue;
        if (planned.length >= Math.min(limit, available.length)) break;
        const occupied = dataRef.current.schedules.some((s) => s.at === slot.toISOString());
        if (occupied) continue;
        planned.push({ id: shortId(), videoId: available[planned.length].id, at: slot.toISOString(), status: "planned", createdAt: nowIso() });
      }
    }
    if (!planned.length) return notify("Nenhum horario futuro encontrado.", "error");
    update((old) => ({ ...old, schedules: [...old.schedules, ...planned] }));
    notify(`${planned.length} publicacoes planejadas. Esta versao NAO posta automaticamente.`);
  }

  const storedFiles = data.videos.filter((v) => !!v.fileId);
  const candidates = data.videos.filter((v) => !!v.externalId);
  const unscheduled = storedFiles.filter((v) => !data.schedules.some((s) => s.videoId === v.id));
  const filtered = useMemo(() => data.videos.filter((v) => [v.title, v.fileName, v.originalUrl, data.profiles.find((p) => p.id === v.profileId)?.username].some((value) => value?.toLowerCase().includes(search.toLowerCase()))), [data, search]);
  const upcoming = [...data.schedules].sort((a, b) => a.at.localeCompare(b.at));
  const kpis = [
    { title: "Perfis cadastrados", value: data.profiles.length, icon: Users },
    { title: "Videos catalogados", value: candidates.length, icon: ListVideo },
    { title: "MP4 na biblioteca", value: storedFiles.length, icon: HardDrive },
    { title: "Publicacoes planejadas", value: upcoming.length, icon: CalendarDays },
  ];
  const tabTitle = tab === "Configuracoes" ? "Configuracoes" : tab;

  return <div className="min-h-screen bg-[#090d17] text-slate-100">
    <div className="mx-auto flex min-h-screen max-w-[1800px]">
      <aside className="sticky top-0 hidden h-screen w-[255px] shrink-0 flex-col border-r border-white/[0.08] bg-[#0c1220] px-4 py-7 md:flex">
        <div className="mb-10 flex items-center gap-3 px-2"><div className="rounded-xl bg-violet-600 p-2.5"><Clapperboard size={23} /></div><div><div className="font-bold tracking-tight">Repost Studio</div><div className="text-xs text-slate-500">Content workspace</div></div></div>
        <nav className="space-y-1">{navigation.map(({ title, icon: Icon }) => <button key={title} onClick={() => setTab(title)} className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm transition ${tab === title ? "bg-violet-600 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}><Icon size={18} />{title}</button>)}</nav>
        <div className="mt-auto rounded-xl border border-violet-500/20 bg-violet-500/[0.07] p-4"><div className="mb-1 flex items-center gap-2 text-sm font-medium text-violet-300"><ShieldAlert size={16} /> MVP individual</div><p className="text-xs leading-relaxed text-slate-400">Dados armazenados neste navegador. Backup periodico recomendado.</p></div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b border-white/[0.07] bg-[#090d17]/95 px-4 py-3 backdrop-blur md:hidden"><div className="mb-3 flex items-center gap-2 font-bold"><Clapperboard size={20} className="text-violet-400"/>Repost Studio</div><div className="flex gap-2 overflow-x-auto pb-1">{navigation.map(({ title }) => <button key={title} className={`shrink-0 rounded-lg px-3 py-1.5 text-xs ${tab === title ? "bg-violet-600" : "bg-white/5 text-slate-400"}`} onClick={() => setTab(title)}>{title}</button>)}</div></header>
        <main className="mx-auto max-w-[1450px] space-y-6 px-4 py-7 sm:px-7 lg:px-10">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="mb-1 text-xs font-semibold uppercase tracking-[.15em] text-violet-400">Repost Studio / {tabTitle}</div><h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{tabTitle}</h1><p className="mt-2 text-sm text-slate-400">Organize seu conteudo antes de publicar.</p></div><Badge tone="good"><Check size={12}/> MVP v0.3</Badge></div>
          {!ready ? <div className={panel}>Carregando dados locais...</div> : <>
            {toast && <div role="status" className={`flex items-start justify-between gap-4 rounded-xl border p-4 text-sm ${toast.kind === "error" ? "border-rose-500/25 bg-rose-500/10 text-rose-200" : toast.kind === "info" ? "border-amber-500/20 bg-amber-500/10 text-amber-200" : "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"}`}><div className="flex items-start gap-2"><AlertCircle size={17} className="mt-0.5 shrink-0"/>{toast.message}</div><button onClick={() => setToast(null)} aria-label="Fechar aviso"><X size={17}/></button></div>}
            {tab === "Dashboard" && <>
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{kpis.map(({ title, value, icon: Icon }) => <div key={title} className={panel}><div className="mb-5 flex items-start justify-between gap-3 text-sm text-slate-400"><span>{title}</span><Icon size={19} className="shrink-0 text-violet-400"/></div><div className="text-3xl font-bold tabular-nums">{value}</div></div>)}</div>
              <div className="grid gap-5 xl:grid-cols-3"><section className={`${panel} xl:col-span-2`}><div className="mb-5 flex items-center gap-3"><div className="rounded-xl bg-violet-500/10 p-3 text-violet-300"><Link2 size={20}/></div><div><h2 className="text-lg font-semibold">Adicionar perfil TikTok</h2><p className="text-sm text-slate-400">Cole a URL para registrar e preparar a consulta.</p></div></div><form onSubmit={(e) => { e.preventDefault(); addProfile(); }} className="flex flex-col gap-3 sm:flex-row"><input className={field} value={profileUrl} onChange={(e) => setProfileUrl(e.target.value)} type="url" placeholder="https://www.tiktok.com/@usuario" required/><button className={`${primary} shrink-0`}><Plus size={17}/> Adicionar perfil</button></form><p className="mt-4 text-xs leading-relaxed text-slate-500">Varredura publica experimental: o TikTok pode bloquear a consulta; nao equivale ao total de videos do perfil.</p></section>
                <section className={panel}><h2 className="mb-5 font-semibold">Estado do sistema</h2><div className="space-y-4 text-sm"><div className="flex justify-between gap-3"><span className="text-slate-400">Interface</span><Badge tone="good">Ativa</Badge></div><div className="flex justify-between gap-3"><span className="text-slate-400">Dados</span><Badge tone="good">Neste navegador</Badge></div><div className="flex justify-between gap-3"><span className="text-slate-400">Consulta TikTok</span><Badge tone="warn">Experimental</Badge></div><div className="flex justify-between gap-3"><span className="text-slate-400">Publicacao</span><Badge>Indisponivel</Badge></div></div></section></div>
              <div className="grid gap-5 lg:grid-cols-2"><section className={panel}><div className="mb-5 flex items-center justify-between"><h2 className="font-semibold">Perfis recentes</h2><button onClick={() => setTab("Perfis")} className="text-xs text-violet-300 hover:underline">Ver todos</button></div>{!data.profiles.length ? <Empty icon={Users} title="Nenhum perfil" description="Cadastre uma URL TikTok para comecar."/> : <div className="space-y-3">{data.profiles.slice(0, 5).map((p) => <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.025] p-3"><span className="truncate text-sm">@{p.username}</span><Badge tone={p.scanStatus === "partial" || p.scanStatus === "completed" ? "good" : "warn"}>{p.scanStatus === "pending" ? "Pendente" : p.scanStatus}</Badge></div>)}</div>}</section>
                <section className={panel}><div className="mb-5 flex items-center justify-between"><h2 className="font-semibold">Proximos agendamentos</h2><button onClick={() => setTab("Agendamentos")} className="text-xs text-violet-300 hover:underline">Ver fila</button></div>{!upcoming.length ? <Empty icon={CalendarDays} title="Fila vazia" description="Importe MP4 e crie um plano de publicacoes."/> : <div className="space-y-3">{upcoming.slice(0, 5).map((s) => <div key={s.id} className="flex justify-between gap-3 rounded-xl bg-white/[0.03] p-3 text-sm"><span className="truncate">{data.videos.find((v) => v.id === s.videoId)?.title ?? "Arquivo ausente"}</span><span className="shrink-0 text-slate-400">{localTimeLabel(s.at)}</span></div>)}</div>}</section></div>
            </>}
            {tab === "Perfis" && <>
              <section className={panel}><h2 className="mb-4 text-lg font-semibold">Cadastrar perfil</h2><form onSubmit={(e) => { e.preventDefault(); addProfile(); }} className="flex flex-col gap-3 sm:flex-row"><input className={field} type="url" required value={profileUrl} placeholder="https://www.tiktok.com/@usuario" onChange={(e) => setProfileUrl(e.target.value)}/><button className={`${primary} shrink-0`}><Plus size={17}/> Adicionar</button></form></section>
              <section className={panel}><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Perfis cadastrados</h2><p className="text-sm text-slate-500">{data.profiles.length} perfil(is)</p></div></div>{!data.profiles.length ? <Empty icon={Users} title="Nenhum perfil cadastrado" description="Adicione o endereco de um perfil TikTok acima."/> : <div className="space-y-3">{data.profiles.map((p) => <div key={p.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4"><div><div className="font-semibold">@{p.username}</div><a className="mt-1 inline-flex items-center gap-1 text-xs text-violet-300 hover:underline" href={p.url} target="_blank" rel="noreferrer">Abrir perfil <ExternalLink size={12}/></a><div className="mt-2 text-xs text-slate-500">Ultima consulta: {p.lastScanAt ? localTimeLabel(p.lastScanAt) : "Nunca"}</div></div><div className="flex flex-wrap items-center gap-2"><Badge tone={p.scanStatus === "partial" || p.scanStatus === "completed" ? "good" : p.scanStatus === "failed" ? "bad" : "warn"}>{p.scanStatus === "pending" ? "Aguardando" : p.scanStatus === "failed" ? "Falhou" : "Parcial"}</Badge><button className={secondary} disabled={!!busyScan} onClick={() => scan(p)}>{busyScan === p.id ? <Loader2 size={16} className="animate-spin"/> : <ScanSearch size={16}/>} Varrer</button><button className={`${secondary} !px-3 text-rose-300`} title="Excluir perfil" onClick={() => removeProfile(p)}><Trash2 size={16}/></button></div></div>)}</div>}</section>
            </>}
            {tab === "Biblioteca" && <>
              <section className={panel}><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Importar arquivos MP4</h2><p className="mt-1 text-sm text-slate-400">Escolha uma pasta ou arquivos do seu computador. Os MP4 ficam guardados apenas neste navegador.</p></div><Badge tone="warn"><CloudOff size={13}/> Local</Badge></div>
                <div className="mt-5 flex flex-wrap gap-3"><input ref={folderRef} className="hidden" type="file" accept="video/mp4,.mp4" multiple onChange={(e) => importFiles(e.target.files)}/><input ref={filesRef} className="hidden" type="file" accept="video/mp4,.mp4" multiple onChange={(e) => importFiles(e.target.files)}/>
                  <button disabled={busyUpload} className={primary} onClick={() => { folderRef.current?.setAttribute("webkitdirectory", ""); folderRef.current?.click(); }}><FolderOpen size={17}/> Selecionar pasta</button><button disabled={busyUpload} className={secondary} onClick={() => filesRef.current?.click()}><UploadCloud size={17}/> Selecionar arquivos</button></div>
                {busyUpload && <p className="mt-4 flex items-center gap-2 text-sm text-violet-300"><Loader2 className="animate-spin" size={16}/>{uploadMessage}</p>}
                <p className="mt-4 text-xs leading-relaxed text-slate-500">Limite MVP: 250 MB por arquivo. Armazenamento sujeito a quota e limpeza do navegador. Backup JSON salva metadados, nao os arquivos MP4.</p>
              </section>
              <section className={panel}><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Catalogo de videos</h2><p className="text-sm text-slate-500">{data.videos.length} videos / {storedFiles.length} com MP4</p></div><div className="relative w-full max-w-xs"><Search className="absolute left-3 top-3 text-slate-500" size={16}/><input className={`${field} !py-2.5 !pl-9`} placeholder="Buscar video ou perfil" value={search} onChange={(e) => setSearch(e.target.value)}/></div></div>
                {!filtered.length ? <Empty icon={FileVideo} title="Nenhum video encontrado" description="Importe MP4 ou adicione links individuais em Varreduras."/> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{filtered.map((v) => <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0c1322]" key={v.id}><div className="relative flex aspect-video items-center justify-center overflow-hidden bg-gradient-to-br from-violet-950/70 to-slate-900">{v.thumbnailUrl ? <img src={v.thumbnailUrl} alt="Capa do video" className="h-full w-full object-cover" referrerPolicy="no-referrer"/> : <FileVideo size={38} className="text-violet-400/60"/>}<div className="absolute bottom-2 left-2"><Badge tone={v.fileId ? "good" : "warn"}>{v.fileId ? "MP4 disponivel" : "Somente link"}</Badge></div></div><div className="space-y-3 p-3"><div className="line-clamp-2 min-h-10 break-words text-sm font-medium">{v.title}</div><div className="text-xs text-slate-500">{v.fileName ?? data.profiles.find((p) => p.id === v.profileId)?.username ?? "TikTok"}</div><div className="flex flex-wrap gap-2">{v.fileId ? <><button className={`${secondary} !px-3 !py-2`} onClick={() => previewFile(v)}><Play size={14}/> Abrir</button><button className={`${secondary} !px-3 !py-2`} onClick={() => downloadFile(v)} title="Baixar arquivo local"><ArrowDownToLine size={14}/></button></> : v.originalUrl ? <a className={`${secondary} !px-3 !py-2`} href={v.originalUrl} rel="noreferrer" target="_blank"><ExternalLink size={14}/> TikTok</a> : null}<button onClick={() => removeVideo(v)} className={`${secondary} !px-3 !py-2 text-rose-300`} aria-label="Remover video"><Trash2 size={14}/></button></div></div></div>)}</div>}
              </section>
            </>}
            {tab === "Varreduras" && <>
              <div className="grid gap-5 xl:grid-cols-2"><section className={panel}><div className="mb-4 flex items-center gap-2"><ScanSearch size={20} className="text-violet-400"/><h2 className="text-lg font-semibold">Varredura por URL</h2></div><p className="mb-4 text-sm text-slate-400">A consulta acessa uma unica pagina publica do perfil. Nao baixa MP4 nem garante listar todas as postagens.</p>{data.profiles.length === 0 ? <Empty icon={Users} title="Cadastre primeiro um perfil" description="Na aba Perfis, informe a URL do TikTok."/> : <div className="space-y-2">{data.profiles.map((p) => <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 px-3 py-3" key={p.id}><span className="text-sm">@{p.username}</span><button disabled={!!busyScan} className={`${secondary} !py-2`} onClick={() => scan(p)}>{busyScan === p.id ? <Loader2 size={15} className="animate-spin"/> : <ScanSearch size={15}/>} Analisar</button></div>)}</div>}</section>
                <section className={panel}><div className="mb-4 flex items-center gap-2"><Link2 size={20} className="text-violet-400"/><h2 className="text-lg font-semibold">Adicionar video por URL</h2></div><p className="mb-4 text-sm text-slate-400">Caso a varredura seja bloqueada, salve links de videos individuais. Metadados sao consultados pela interface de incorporacao quando disponiveis.</p><form className="space-y-3" onSubmit={(e) => { e.preventDefault(); addVideoUrl(); }}><input className={field} required type="url" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://www.tiktok.com/@usuario/video/123456..."/><button disabled={busyVideo} className={primary}>{busyVideo ? <Loader2 className="animate-spin" size={16}/> : <Plus size={16}/>} Catalogar link</button></form></section></div>
              <section className={panel}><h2 className="mb-4 text-lg font-semibold">Historico de consultas</h2>{!data.scans.length ? <Empty icon={Activity} title="Sem consultas registradas" description="Inicie a primeira varredura de perfil."/> : <div className="space-y-3">{data.scans.map((j) => <div key={j.id} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div className="font-medium">@{j.username}</div><Badge tone={j.status === "partial" || j.status === "completed" ? "good" : j.status === "running" ? "warn" : "bad"}>{j.status === "partial" ? "Parcial" : j.status === "blocked" ? "Bloqueado" : j.status === "running" ? "Em andamento" : j.status === "completed" ? "Concluido" : "Falha"}</Badge></div><p className="mt-2 break-words text-sm text-slate-400">{j.message}</p><div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500"><span>{localTimeLabel(j.at)}</span><span>{j.found} encontrados</span><span>{j.added} novos</span></div></div>)}</div>}</section>
            </>}
            {tab === "Agendamentos" && <>
              <section className={panel}><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">Gerar fila de publicacoes</h2><p className="mt-1 text-sm text-slate-400">Distribua arquivos MP4 ainda nao planejados em dias e horarios definidos.</p></div><Badge tone="warn"><Clock3 size={14}/> Planejamento apenas</Badge></div><div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><label className="space-y-1.5 text-xs text-slate-400">Data inicial<input className={field} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}/></label><label className="space-y-1.5 text-xs text-slate-400">Horarios (separados por virgula)<input className={field} value={hours} onChange={(e) => setHours(e.target.value)} placeholder="09:00,18:00"/></label><label className="space-y-1.5 text-xs text-slate-400">Quantidade de videos<input className={field} type="number" min="1" max="300" value={planLimit} onChange={(e) => setPlanLimit(Number(e.target.value))}/></label><div className="flex items-end"><button className={`${primary} w-full`} onClick={createSchedule}><CalendarDays size={17}/> Gerar agenda</button></div></div><div className="mt-4 text-xs text-slate-500">{unscheduled.length} MP4 disponiveis para agendar. Nao envia posts ao TikTok e nao executa a fila sozinho.</div></section>
              <section className={panel}><div className="mb-4 flex justify-between gap-3"><h2 className="text-lg font-semibold">Fila planejada</h2><Badge>{upcoming.length} video(s)</Badge></div>{!upcoming.length ? <Empty icon={CalendarDays} title="Nenhum agendamento" description="Importe MP4 e clique em Gerar agenda."/> : <div className="space-y-2">{upcoming.map((s) => { const v = data.videos.find((item) => item.id === s.videoId); return <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 px-4 py-3"><div className="min-w-0"><div className="max-w-md truncate text-sm font-medium">{v?.title ?? "Arquivo removido"}</div><p className="text-xs text-slate-400">{localTimeLabel(s.at)}</p></div><div className="flex items-center gap-2"><Badge tone="warn">Planejado</Badge><button aria-label="Cancelar agendamento" className={`${secondary} !px-2.5 !py-2 text-rose-300`} onClick={() => update((old) => ({ ...old, schedules: old.schedules.filter((item) => item.id !== s.id) }))}><X size={16}/></button></div></div>; })}</div>}</section>
            </>}
            {tab === "Configuracoes" && <>
              <section className={panel}><div className="flex items-center gap-3"><HardDrive size={20} className="text-violet-400"/><h2 className="text-lg font-semibold">Armazenamento local</h2></div><p className="mt-3 text-sm leading-relaxed text-slate-400">Este MVP usa localStorage para perfis, links, historico e agenda, e IndexedDB para MP4. Os dados nao aparecem em outros computadores, navegadores ou perfis. Limpar os dados do site pode eliminar os arquivos.</p><div className="mt-5 flex flex-wrap gap-3"><button className={secondary} onClick={() => exportStudio(data)}><ArrowDownToLine size={16}/> Exportar metadados JSON</button><button className={`${secondary} text-rose-300`} onClick={() => { if (window.confirm("Apagar perfis, links, agendamentos e historico deste navegador? Os MP4 deverao ser excluidos individualmente na Biblioteca.")) { update(() => ({ version: 3, profiles: [], videos: dataRef.current.videos.filter((v) => !!v.fileId), scans: [], schedules: [] })); notify("Metadados de perfis e links removidos; MP4 preservados."); } }}><Trash2 size={16}/> Limpar catalogo de links</button></div></section>
              <section className={panel}><h2 className="mb-3 flex items-center gap-2 text-lg font-semibold"><ShieldAlert size={20} className="text-amber-300"/> Seguranca e limites</h2><div className="space-y-3 text-sm leading-relaxed text-slate-400"><p>Sem login e sem servidor de arquivos nesta etapa. Habilite Deployment Protection na Vercel antes de usar em producao.</p><p>O servidor consulta somente URLs normalizadas de dominio TikTok. Nenhuma chave de API privada fica exposta no navegador.</p><p>O scanner publico pode retornar bloqueios, zero videos ou resultados parciais. A publicacao automatica exigira autorizacao da conta e integracao oficial.</p><p>Importe e publique somente materiais sobre os quais voce tenha direito de reutilizacao.</p></div></section>
            </>}
          </>}
          <footer className="pt-3 text-center text-xs text-slate-600">Repost Studio v0.3 / MVP pessoal / Sem publicacao automatica</footer>
        </main>
      </div>
    </div>
    {preview && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label="Previa de video"><div className="w-full max-w-3xl rounded-2xl border border-white/15 bg-[#0b1020] p-4"><div className="mb-3 flex items-center justify-between gap-4"><p className="truncate font-medium">{preview.name}</p><button onClick={() => setPreview(null)} aria-label="Fechar video"><X size={22}/></button></div><video controls autoPlay className="max-h-[75vh] w-full rounded-lg bg-black" src={preview.url}/></div></div>}
  </div>;
}

