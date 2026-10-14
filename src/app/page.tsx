"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity, AlertCircle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight,
  Clapperboard, Cloud, CloudUpload, ExternalLink, FileVideo, History, KeyRound,
  LayoutDashboard, Loader2, LogOut, Pause, Pencil, Play, Plus, RefreshCw,
  RotateCcw, Search, Settings, ShieldCheck, Trash2, Users, Video, X,
} from "lucide-react";
import type {
  OnlineVideo, PostRow, PublishingAccountRow, ScheduleSlotRow, SourceProfile,
  StudioSnapshot, SyncJobRow,
} from "@/lib/online-model";

type Tab = "Dashboard" | "Origens" | "Biblioteca" | "Contas" | "Agenda" | "Historico" | "Configuracoes";
type Toast = { kind: "ok" | "error" | "info"; message: string } | null;

const EMPTY: StudioSnapshot = { profiles: [], accounts: [], slots: [], videos: [], jobs: [], posts: [], serverTime: "" };
const ACCESS_STORAGE = "repost-studio-access-key-v06";
const tabs: Array<{ title: Tab; icon: typeof Video }> = [
  { title: "Dashboard", icon: LayoutDashboard },
  { title: "Origens", icon: CloudUpload },
  { title: "Biblioteca", icon: FileVideo },
  { title: "Contas", icon: Users },
  { title: "Agenda", icon: CalendarDays },
  { title: "Historico", icon: History },
  { title: "Configuracoes", icon: Settings },
];
const weekdays = [
  { value: 1, short: "Seg" }, { value: 2, short: "Ter" }, { value: 3, short: "Qua" },
  { value: 4, short: "Qui" }, { value: 5, short: "Sex" }, { value: 6, short: "Sab" }, { value: 0, short: "Dom" },
];
const field = "w-full rounded-xl border border-white/10 bg-[#0b1020] px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-violet-500";
const panel = "rounded-2xl border border-white/10 bg-[#121a2b] p-5 sm:p-6";
const primary = "inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50";
const secondary = "inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50";

function Badge({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "good" | "warn" | "bad" | "violet" }) {
  const map = {
    muted: "bg-slate-500/10 text-slate-300",
    good: "bg-emerald-500/10 text-emerald-300",
    warn: "bg-amber-500/10 text-amber-300",
    bad: "bg-rose-500/10 text-rose-300",
    violet: "bg-violet-500/10 text-violet-300",
  };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${map[tone]}`}>{children}</span>;
}

function Empty({ icon: Icon, title, description }: { icon: typeof Video; title: string; description: string }) {
  return <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 p-6 text-center">
    <Icon size={28} className="text-slate-500" /><p className="font-medium text-slate-300">{title}</p><p className="max-w-md text-sm text-slate-500">{description}</p>
  </div>;
}

function localDateInput() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function localLabel(value: string | null | undefined) {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function accountName(account?: PublishingAccountRow) {
  if (!account) return "Conta removida";
  return account.label ? `${account.label} (@${account.username})` : `@${account.username}`;
}

function jobTone(status: SyncJobRow["status"]): "muted" | "good" | "warn" | "bad" | "violet" {
  if (status === "completed") return "good";
  if (status === "failed" || status === "cancelled") return "bad";
  if (status === "running" || status === "waiting_user" || status === "pending") return "warn";
  return "violet";
}

function postTone(status: PostRow["status"]): "muted" | "good" | "warn" | "bad" | "violet" {
  if (status === "published") return "good";
  if (status === "failed" || status === "cancelled") return "bad";
  if (status === "publishing") return "warn";
  return "violet";
}

function postLabel(status: PostRow["status"]) {
  return { draft: "Rascunho", scheduled: "Agendado", publishing: "Publicando", published: "Publicado", failed: "Erro", cancelled: "Cancelado" }[status];
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("Dashboard");
  const [snapshot, setSnapshot] = useState<StudioSnapshot>(EMPTY);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [accessKey, setAccessKey] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [toast, setToast] = useState<Toast>(null);
  const [profileUrl, setProfileUrl] = useState("");
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);

  const [accountId, setAccountId] = useState("");
  const [accountLabel, setAccountLabel] = useState("");
  const [accountUsername, setAccountUsername] = useState("");
  const [accountTimes, setAccountTimes] = useState("09:00,18:00");
  const [accountDays, setAccountDays] = useState<number[]>([1, 2, 3, 4, 5]);

  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [calendarAnchor, setCalendarAnchor] = useState("");
  const [planLimit, setPlanLimit] = useState(20);

  function notify(message: string, kind: "ok" | "error" | "info" = "ok") { setToast({ message, kind }); }

  useEffect(() => {
    const stored = window.localStorage.getItem(ACCESS_STORAGE) ?? "";
    setAccessKey(stored);
    setKeyInput(stored);
    const today = localDateInput();
    setStartDate(today);
    setCalendarAnchor(today);
    setReady(true);
  }, []);

  async function requestJson(path: string, init: RequestInit = {}, key = accessKey) {
    const headers = new Headers(init.headers);
    headers.set("x-repost-key", key);
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const res = await fetch(path, { ...init, headers, cache: "no-store" });
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : `Erro HTTP ${res.status}`);
    return body;
  }

  async function loadData(key = accessKey, silent = false) {
    if (!key) return;
    if (!silent) setLoading(true);
    try {
      const data = await requestJson("/api/studio", {}, key) as unknown as StudioSnapshot;
      setSnapshot(data);
      if (!selectedAccountId && data.accounts[0]) setSelectedAccountId(data.accounts[0].id);
    } catch (e) {
      if (!silent) notify(e instanceof Error ? e.message : "Falha ao carregar dados online.", "error");
      if (e instanceof Error && e.message.toLowerCase().includes("access key")) setAccessKey("");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    if (!ready || !accessKey) return;
    void loadData(accessKey);
    const timer = window.setInterval(() => void loadData(accessKey, true), 10000);
    return () => window.clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, accessKey]);

  function unlock() {
    const value = keyInput.trim();
    if (!value) return;
    window.localStorage.setItem(ACCESS_STORAGE, value);
    setAccessKey(value);
  }

  function logout() {
    window.localStorage.removeItem(ACCESS_STORAGE);
    setAccessKey("");
    setSnapshot(EMPTY);
  }

  async function action(name: string, payload: Record<string, unknown> = {}) {
    return requestJson("/api/studio", { method: "POST", body: JSON.stringify({ action: name, ...payload }) });
  }

  async function addSource() {
    try {
      await action("create_source", { url: profileUrl });
      setProfileUrl("");
      await loadData(accessKey, true);
      notify("Perfil de origem salvo online.");
    } catch (e) { notify(e instanceof Error ? e.message : "Falha ao salvar origem.", "error"); }
  }

  async function queueSync(profile: SourceProfile) {
    try {
      const result = await action("queue_sync", { profileId: profile.id });
      await loadData(accessKey, true);
      notify(result.reused ? "Ja existe uma sincronizacao aguardando o agente." : "Tarefa enviada ao agente local.", "info");
    } catch (e) { notify(e instanceof Error ? e.message : "Falha ao criar tarefa.", "error"); }
  }

  function normalizeTimes(raw: string) {
    const times = [...new Set(raw.split(",").map((v) => v.trim()).filter(Boolean))];
    if (!times.length || !times.every((v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v))) throw new Error("Use horarios como 09:00,18:30.");
    return times.sort();
  }

  async function saveAccount() {
    try {
      if (!accountDays.length) throw new Error("Escolha pelo menos um dia da semana.");
      const times = normalizeTimes(accountTimes);
      await action("save_account", {
        id: accountId || undefined,
        username: accountUsername,
        label: accountLabel,
        weekdays: accountDays,
        times,
        timezone: "America/Sao_Paulo",
      });
      setAccountId(""); setAccountLabel(""); setAccountUsername(""); setAccountTimes("09:00,18:00"); setAccountDays([1, 2, 3, 4, 5]);
      await loadData(accessKey, true);
      notify("Conta e horarios salvos online.");
    } catch (e) { notify(e instanceof Error ? e.message : "Falha ao salvar conta.", "error"); }
  }

  function editAccount(account: PublishingAccountRow) {
    const slots = snapshot.slots.filter((s) => s.account_id === account.id && s.is_active);
    setAccountId(account.id);
    setAccountLabel(account.label ?? "");
    setAccountUsername(account.username);
    setAccountDays([...new Set(slots.map((s) => s.weekday))]);
    setAccountTimes([...new Set(slots.map((s) => s.time_local.slice(0, 5)))].sort().join(","));
    setTab("Contas");
  }

  async function toggleAccount(account: PublishingAccountRow) {
    try {
      await action("toggle_account", { id: account.id, isActive: !account.is_active });
      await loadData(accessKey, true);
    } catch (e) { notify(e instanceof Error ? e.message : "Falha ao atualizar conta.", "error"); }
  }

  function buildSchedule(account: PublishingAccountRow, count: number) {
    const rules = snapshot.slots.filter((s) => s.account_id === account.id && s.is_active);
    if (!rules.length) throw new Error("A conta nao possui horarios ativos.");
    const byDay = new Map<number, string[]>();
    for (const rule of rules) {
      const list = byDay.get(rule.weekday) ?? [];
      list.push(rule.time_local.slice(0, 5));
      byDay.set(rule.weekday, list);
    }
    for (const [day, list] of byDay) byDay.set(day, [...new Set(list)].sort());

    const usedVideo = new Set(snapshot.posts.filter((p) => p.account_id === account.id).map((p) => p.video_id));
    const available = snapshot.videos.filter((v) => v.status === "uploaded" && !!v.storage_path && !usedVideo.has(v.id));
    if (!available.length) throw new Error("Nao ha novos videos online para essa conta.");

    const requested = Math.min(Math.max(count, 1), 500, available.length);
    const occupied = new Set(snapshot.posts.filter((p) => p.account_id === account.id && p.status !== "cancelled").map((p) => p.scheduled_at));
    const base = new Date(`${startDate}T12:00:00`);
    if (Number.isNaN(base.getTime())) throw new Error("Data inicial invalida.");
    const now = Date.now();
    const items: Array<{ videoId: string; scheduledAt: string }> = [];

    for (let dayOffset = 0; dayOffset < 730 && items.length < requested; dayOffset++) {
      const day = new Date(base.getTime());
      day.setDate(base.getDate() + dayOffset);
      const times = byDay.get(day.getDay()) ?? [];
      for (const time of times) {
        const [hour, minute] = time.split(":").map(Number);
        const when = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0);
        if (when.getTime() <= now) continue;
        const iso = when.toISOString();
        if (occupied.has(iso)) continue;
        items.push({ videoId: available[items.length].id, scheduledAt: iso });
        if (items.length >= requested) break;
      }
    }
    return items;
  }

  async function generatePosts() {
    const account = snapshot.accounts.find((a) => a.id === selectedAccountId);
    if (!account) return notify("Escolha uma conta.", "error");
    if (!account.is_active) return notify("Ative a conta antes de gerar a agenda.", "info");
    try {
      const items = buildSchedule(account, Number(planLimit) || 1);
      await action("create_posts", { accountId: account.id, items });
      await loadData(accessKey, true);
      notify(`${items.length} publicacao(oes) criada(s) online.`);
    } catch (e) { notify(e instanceof Error ? e.message : "Falha ao gerar agenda.", "error"); }
  }

  async function updatePost(post: PostRow, patch: { status?: PostRow["status"]; scheduledAt?: string }) {
    try {
      await action("update_post", { id: post.id, ...patch });
      await loadData(accessKey, true);
    } catch (e) { notify(e instanceof Error ? e.message : "Falha ao atualizar agendamento.", "error"); }
  }

  async function reschedule(post: PostRow) {
    const current = new Date(post.scheduled_at);
    const initial = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}-${String(current.getDate()).padStart(2, "0")} ${String(current.getHours()).padStart(2, "0")}:${String(current.getMinutes()).padStart(2, "0")}`;
    const value = window.prompt("Nova data e hora (AAAA-MM-DD HH:MM)", initial);
    if (!value) return;
    const match = value.match(/^(\d{4}-\d{2}-\d{2})\s+([0-2]\d:[0-5]\d)$/);
    if (!match) return notify("Use AAAA-MM-DD HH:MM.", "error");
    const d = new Date(`${match[1]}T${match[2]}:00`);
    if (Number.isNaN(d.getTime())) return notify("Data invalida.", "error");
    await updatePost(post, { scheduledAt: d.toISOString() });
  }

  async function openVideo(video: OnlineVideo) {
    try {
      const result = await requestJson(`/api/studio/video-url?id=${encodeURIComponent(video.id)}`);
      if (typeof result.url !== "string") throw new Error("URL de video indisponivel.");
      setPreview({ name: video.file_name ?? video.title ?? video.tiktok_video_id, url: result.url });
    } catch (e) { notify(e instanceof Error ? e.message : "Arquivo indisponivel.", "error"); }
  }

  const filteredVideos = useMemo(() => {
    const q = search.trim().toLowerCase();
    return snapshot.videos.filter((v) => !q || [v.title, v.tiktok_video_id, v.source_url, snapshot.profiles.find((p) => p.id === v.source_profile_id)?.username].some((x) => x?.toLowerCase().includes(q)));
  }, [snapshot, search]);

  const week = useMemo(() => {
    if (!calendarAnchor) return [] as Date[];
    const center = new Date(`${calendarAnchor}T12:00:00`);
    const delta = center.getDay() === 0 ? -6 : 1 - center.getDay();
    center.setDate(center.getDate() + delta);
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(center.getTime()); d.setDate(center.getDate() + i); return d; });
  }, [calendarAnchor]);

  function shiftWeek(delta: number) {
    const d = new Date(`${calendarAnchor}T12:00:00`);
    d.setDate(d.getDate() + delta);
    setCalendarAnchor(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }

  const uploaded = snapshot.videos.filter((v) => v.status === "uploaded");
  const upcoming = snapshot.posts.filter((p) => p.status === "scheduled" || p.status === "draft").sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const published = snapshot.posts.filter((p) => p.status === "published");
  const latestJobs = snapshot.jobs.slice(0, 8);

  if (!ready) return <div className="min-h-screen bg-[#090d17] p-10 text-slate-300">Carregando...</div>;

  if (!accessKey) return <div className="flex min-h-screen items-center justify-center bg-[#090d17] p-4 text-slate-100">
    <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#121a2b] p-7">
      <div className="mb-5 flex items-center gap-3"><div className="rounded-xl bg-violet-600 p-3"><KeyRound size={22} /></div><div><h1 className="text-xl font-bold">Repost Studio V0.6</h1><p className="text-sm text-slate-500">Painel online protegido</p></div></div>
      <p className="mb-4 text-sm leading-relaxed text-slate-400">Digite a mesma REPOST_STUDIO_ACCESS_KEY configurada na Vercel. Ela nao e a chave do Supabase.</p>
      <input autoFocus className={field} type="password" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") unlock(); }} placeholder="Chave do Repost Studio" />
      <button className={`${primary} mt-3 w-full`} onClick={unlock}><ShieldCheck size={17} /> Entrar</button>
    </div>
  </div>;

  return <div className="min-h-screen bg-[#090d17] text-slate-100">
    <div className="mx-auto flex min-h-screen max-w-[1800px]">
      <aside className="sticky top-0 hidden h-screen w-[255px] shrink-0 flex-col border-r border-white/[0.08] bg-[#0c1220] px-4 py-7 md:flex">
        <div className="mb-10 flex items-center gap-3 px-2"><div className="rounded-xl bg-violet-600 p-2.5"><Clapperboard size={23} /></div><div><div className="font-bold">Repost Studio</div><div className="text-xs text-slate-500">Online workspace</div></div></div>
        <nav className="space-y-1">{tabs.map(({ title, icon: Icon }) => <button key={title} onClick={() => setTab(title)} className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm ${tab === title ? "bg-violet-600 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}><Icon size={18} />{title}</button>)}</nav>
        <div className="mt-auto rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-4"><div className="flex items-center gap-2 text-sm font-medium text-emerald-300"><Cloud size={16} /> Supabase online</div><p className="mt-2 text-xs leading-relaxed text-slate-500">Dados, agenda e MP4 sincronizados na nuvem.</p></div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b border-white/[0.07] bg-[#090d17]/95 px-4 py-3 backdrop-blur md:hidden"><div className="mb-3 flex items-center gap-2 font-bold"><Clapperboard size={20} className="text-violet-400" />Repost Studio</div><div className="flex gap-2 overflow-x-auto">{tabs.map(({ title }) => <button key={title} className={`shrink-0 rounded-lg px-3 py-1.5 text-xs ${tab === title ? "bg-violet-600" : "bg-white/5 text-slate-400"}`} onClick={() => setTab(title)}>{title}</button>)}</div></header>
        <main className="mx-auto max-w-[1450px] space-y-6 px-4 py-7 sm:px-7 lg:px-10">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="mb-1 text-xs font-semibold uppercase tracking-[.15em] text-violet-400">Repost Studio / {tab}</div><h1 className="text-3xl font-bold sm:text-4xl">{tab}</h1><p className="mt-2 text-sm text-slate-400">Coleta local. Dados e planejamento online.</p></div><div className="flex gap-2"><Badge tone="good"><Cloud size={13} /> V0.6 online</Badge><button className={`${secondary} !px-3 !py-2`} disabled={loading} onClick={() => loadData()}><RefreshCw size={15} className={loading ? "animate-spin" : ""} /></button></div></div>

          {toast && <div className={`flex items-start justify-between gap-3 rounded-xl border p-4 text-sm ${toast.kind === "error" ? "border-rose-500/20 bg-rose-500/10 text-rose-200" : toast.kind === "info" ? "border-amber-500/20 bg-amber-500/10 text-amber-200" : "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"}`}><div className="flex gap-2"><AlertCircle size={17} />{toast.message}</div><button onClick={() => setToast(null)}><X size={17} /></button></div>}

          {tab === "Dashboard" && <>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{[
              ["Origens", snapshot.profiles.length, CloudUpload], ["Videos online", uploaded.length, FileVideo], ["Na fila", upcoming.length, CalendarDays], ["Publicados", published.length, CheckCircle2],
            ].map(([name, value, Icon]) => { const I = Icon as typeof Video; return <div key={String(name)} className={panel}><div className="mb-5 flex items-start justify-between text-sm text-slate-400"><span>{String(name)}</span><I size={19} className="text-violet-400" /></div><div className="text-3xl font-bold">{String(value)}</div></div>; })}</div>
            <div className="grid gap-5 xl:grid-cols-3"><section className={`${panel} xl:col-span-2`}><div className="mb-4 flex items-center justify-between"><div><h2 className="text-lg font-semibold">Proximas publicacoes</h2><p className="text-sm text-slate-500">Agenda consolidada online.</p></div><button className={secondary} onClick={() => setTab("Agenda")}>Abrir agenda</button></div>{!upcoming.length ? <Empty icon={CalendarDays} title="Fila vazia" description="Cadastre uma conta, sincronize videos e gere a agenda." /> : <div className="space-y-2">{upcoming.slice(0, 8).map((p) => { const v = snapshot.videos.find((x) => x.id === p.video_id); const a = snapshot.accounts.find((x) => x.id === p.account_id); return <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 px-4 py-3"><div className="min-w-0"><div className="truncate text-sm font-medium">{v?.title ?? v?.tiktok_video_id ?? "Video"}</div><div className="mt-1 text-xs text-slate-500">{accountName(a)} · {localLabel(p.scheduled_at)}</div></div><Badge tone="violet">Agendado</Badge></div>; })}</div>}</section>
              <section className={panel}><h2 className="text-lg font-semibold">Agente local</h2><p className="mt-1 text-sm text-slate-500">Ultimas tarefas de coleta.</p><div className="mt-4 space-y-3">{!latestJobs.length ? <p className="text-sm text-slate-500">Nenhuma tarefa criada.</p> : latestJobs.map((j) => { const p = snapshot.profiles.find((x) => x.id === j.source_profile_id); return <div key={j.id} className="rounded-xl border border-white/10 p-3"><div className="flex justify-between gap-2"><span className="text-sm">@{p?.username ?? "perfil"}</span><Badge tone={jobTone(j.status)}>{j.status}</Badge></div><div className="mt-2 text-xs text-slate-500">{j.uploaded_count}/{j.found_count} enviados · {j.error_count} erros</div></div>; })}</div></section>
            </div>
          </>}

          {tab === "Origens" && <>
            <section className={panel}><h2 className="text-lg font-semibold">Adicionar perfil de origem</h2><p className="mt-1 text-sm text-slate-400">O painel cria a tarefa; o agente local abre o TikTok, resolve CAPTCHA quando necessario, baixa e envia os MP4.</p><div className="mt-4 flex flex-col gap-3 sm:flex-row"><input className={field} value={profileUrl} onChange={(e) => setProfileUrl(e.target.value)} placeholder="https://www.tiktok.com/@usuario" /><button className={primary} onClick={addSource}><Plus size={16} /> Salvar origem</button></div></section>
            <section className={panel}><div className="mb-4"><h2 className="text-lg font-semibold">Perfis sincronizados</h2><p className="text-sm text-slate-500">Clique em Sincronizar. O computador local precisa estar com o agente V0.6 aberto.</p></div>{!snapshot.profiles.length ? <Empty icon={CloudUpload} title="Nenhuma origem" description="Cadastre o primeiro perfil acima." /> : <div className="space-y-3">{snapshot.profiles.map((p) => { const job = snapshot.jobs.find((j) => j.source_profile_id === p.id); return <div key={p.id} className="rounded-xl border border-white/10 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="font-medium">@{p.username}</div><div className="mt-1 text-xs text-slate-500">Ultima sincronizacao: {localLabel(p.last_sync_at)}</div></div><div className="flex items-center gap-2"><Badge tone={p.sync_status === "completed" ? "good" : p.sync_status === "failed" ? "bad" : p.sync_status === "idle" ? "muted" : "warn"}>{p.sync_status}</Badge><button className={primary} onClick={() => queueSync(p)}><RefreshCw size={15} /> Sincronizar</button></div></div>{job && <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5"><div className="rounded-lg bg-white/[0.03] p-2">{job.found_count}<br /><span className="text-slate-500">encontrados</span></div><div className="rounded-lg bg-white/[0.03] p-2">{job.new_count}<br /><span className="text-slate-500">novos</span></div><div className="rounded-lg bg-white/[0.03] p-2">{job.downloaded_count}<br /><span className="text-slate-500">baixados</span></div><div className="rounded-lg bg-white/[0.03] p-2">{job.uploaded_count}<br /><span className="text-slate-500">online</span></div><div className="rounded-lg bg-white/[0.03] p-2">{job.error_count}<br /><span className="text-slate-500">erros</span></div></div>}</div>; })}</div>}</section>
          </>}

          {tab === "Biblioteca" && <section className={panel}><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Biblioteca online</h2><p className="text-sm text-slate-500">{uploaded.length} MP4 enviados ao Supabase Storage · {snapshot.videos.length} registros</p></div><div className="relative w-full max-w-xs"><Search size={16} className="absolute left-3 top-3 text-slate-500" /><input className={`${field} !py-2.5 !pl-9`} placeholder="Buscar video ou origem" value={search} onChange={(e) => setSearch(e.target.value)} /></div></div>{!filteredVideos.length ? <Empty icon={FileVideo} title="Biblioteca vazia" description="Sincronize um perfil com o agente local." /> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{filteredVideos.map((v) => { const source = snapshot.profiles.find((p) => p.id === v.source_profile_id); return <article key={v.id} className="overflow-hidden rounded-xl border border-white/10 bg-[#0c1322]"><div className="flex aspect-video items-center justify-center bg-gradient-to-br from-violet-950/70 to-slate-900">{v.thumbnail_url ? <img src={v.thumbnail_url} alt="Capa" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : <FileVideo size={38} className="text-violet-400/60" />}</div><div className="space-y-3 p-3"><div className="line-clamp-2 min-h-10 text-sm font-medium">{v.title ?? `Video ${v.tiktok_video_id}`}</div><div className="flex flex-wrap gap-1.5"><Badge tone={v.status === "uploaded" ? "good" : v.status === "failed" ? "bad" : "warn"}>{v.status}</Badge>{source && <Badge>@{source.username}</Badge>}</div><div className="flex gap-2">{v.status === "uploaded" && <button className={`${secondary} !px-3 !py-2`} onClick={() => openVideo(v)}><Play size={14} /> Abrir</button>}<a className={`${secondary} !px-3 !py-2`} href={v.source_url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> TikTok</a></div></div></article>; })}</div>}</section>}

          {tab === "Contas" && <>
            <div className="grid gap-5 xl:grid-cols-5"><section className={`${panel} xl:col-span-2`}><h2 className="text-lg font-semibold">{accountId ? "Editar conta" : "Nova conta"}</h2><div className="mt-4 space-y-3"><input className={field} placeholder="Nome, ex.: Conta Principal" value={accountLabel} onChange={(e) => setAccountLabel(e.target.value)} /><input className={field} placeholder="@usuario" value={accountUsername} onChange={(e) => setAccountUsername(e.target.value)} /><div><div className="mb-2 text-xs text-slate-400">Dias da semana</div><div className="flex flex-wrap gap-2">{weekdays.map((d) => <button key={d.value} className={`rounded-lg border px-3 py-2 text-xs ${accountDays.includes(d.value) ? "border-violet-500 bg-violet-500/15 text-violet-200" : "border-white/10 text-slate-400"}`} onClick={() => setAccountDays((old) => old.includes(d.value) ? old.filter((x) => x !== d.value) : [...old, d.value])}>{d.short}</button>)}</div></div><input className={field} value={accountTimes} onChange={(e) => setAccountTimes(e.target.value)} placeholder="09:00,18:00" /><button className={`${primary} w-full`} onClick={saveAccount}>{accountId ? <Pencil size={16} /> : <Plus size={16} />} {accountId ? "Salvar alteracoes" : "Adicionar conta"}</button>{accountId && <button className={`${secondary} w-full`} onClick={() => { setAccountId(""); setAccountLabel(""); setAccountUsername(""); }}>Cancelar edicao</button>}</div></section>
              <section className={`${panel} xl:col-span-3`}><h2 className="mb-4 text-lg font-semibold">Contas de publicacao</h2>{!snapshot.accounts.length ? <Empty icon={Users} title="Nenhuma conta" description="Cadastre as contas que receberao os videos." /> : <div className="space-y-3">{snapshot.accounts.map((a) => { const slots = snapshot.slots.filter((s) => s.account_id === a.id); return <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 p-4"><div><div className="font-medium">{a.label ?? `@${a.username}`}</div><div className="mt-1 text-xs text-slate-500">@{a.username} · {[...new Set(slots.map((s) => s.time_local.slice(0, 5)))].join(", ")}</div></div><div className="flex items-center gap-2"><Badge tone={a.is_active ? "good" : "warn"}>{a.is_active ? "Ativa" : "Pausada"}</Badge><button className={`${secondary} !px-2.5`} onClick={() => editAccount(a)}><Pencil size={15} /></button><button className={`${secondary} !px-2.5`} onClick={() => toggleAccount(a)}>{a.is_active ? <Pause size={15} /> : <RotateCcw size={15} />}</button></div></div>; })}</div>}</section></div>
          </>}

          {tab === "Agenda" && <>
            <section className={panel}><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Distribuicao automatica</h2><p className="text-sm text-slate-400">Usa somente MP4 online ainda nao utilizados na conta selecionada.</p></div><Badge tone="violet">Online</Badge></div><div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><select className={field} value={selectedAccountId} onChange={(e) => setSelectedAccountId(e.target.value)}><option value="">Escolha uma conta...</option>{snapshot.accounts.map((a) => <option key={a.id} value={a.id}>{a.label ?? `@${a.username}`}{!a.is_active ? " (pausada)" : ""}</option>)}</select><input className={field} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /><input className={field} type="number" min="1" max="500" value={planLimit} onChange={(e) => setPlanLimit(Number(e.target.value))} /><button className={primary} onClick={generatePosts}><CalendarDays size={17} /> Gerar agenda</button></div></section>
            <section className={panel}><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Calendario semanal</h2><p className="text-sm text-slate-500">Todas as contas no mesmo calendario.</p></div><div className="flex gap-2"><button className={`${secondary} !px-3`} onClick={() => shiftWeek(-7)}><ChevronLeft size={16} /></button><button className={secondary} onClick={() => setCalendarAnchor(localDateInput())}>Hoje</button><button className={`${secondary} !px-3`} onClick={() => shiftWeek(7)}><ChevronRight size={16} /></button></div></div><div className="overflow-x-auto"><div className="grid min-w-[950px] grid-cols-7 gap-2">{week.map((day) => { const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`; const items = snapshot.posts.filter((p) => { const d = new Date(p.scheduled_at); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` === key && p.status !== "cancelled"; }).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)); return <div key={key} className="min-h-52 rounded-xl border border-white/10 bg-[#0c1322] p-2"><div className="mb-2 border-b border-white/10 pb-2 text-center"><div className="text-xs text-slate-500">{day.toLocaleDateString("pt-BR", { weekday: "short" })}</div><div className="font-semibold">{day.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</div></div><div className="space-y-2">{items.map((p) => { const d = new Date(p.scheduled_at); const a = snapshot.accounts.find((x) => x.id === p.account_id); return <button key={p.id} onClick={() => reschedule(p)} className="w-full rounded-lg border border-violet-500/15 bg-violet-500/[0.06] p-2 text-left"><div className="text-xs font-semibold text-violet-300">{String(d.getHours()).padStart(2, "0")}:{String(d.getMinutes()).padStart(2, "0")} · {a?.label ?? a?.username}</div><div className="mt-1 text-[11px] text-slate-500">{postLabel(p.status)}</div></button>; })}</div></div>; })}</div></div></section>
            <section className={panel}><h2 className="mb-4 text-lg font-semibold">Fila</h2>{!snapshot.posts.length ? <Empty icon={CalendarDays} title="Nenhum agendamento" description="Gere uma agenda acima." /> : <div className="space-y-2">{[...snapshot.posts].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)).map((p) => { const v = snapshot.videos.find((x) => x.id === p.video_id); const a = snapshot.accounts.find((x) => x.id === p.account_id); return <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 px-4 py-3"><div className="min-w-0"><div className="max-w-xl truncate text-sm font-medium">{v?.title ?? v?.tiktok_video_id ?? "Video"}</div><div className="mt-1 text-xs text-slate-500">{accountName(a)} · {localLabel(p.scheduled_at)}</div></div><div className="flex items-center gap-2"><Badge tone={postTone(p.status)}>{postLabel(p.status)}</Badge><button className={`${secondary} !px-2.5`} onClick={() => reschedule(p)}><Pencil size={15} /></button>{p.status !== "published" && <button className={`${secondary} !px-2.5 text-emerald-300`} onClick={() => updatePost(p, { status: "published" })}><CheckCircle2 size={15} /></button>}{p.status !== "cancelled" ? <button className={`${secondary} !px-2.5 text-rose-300`} onClick={() => updatePost(p, { status: "cancelled" })}><X size={15} /></button> : <button className={`${secondary} !px-2.5`} onClick={() => updatePost(p, { status: "scheduled" })}><RotateCcw size={15} /></button>}</div></div>; })}</div>}</section>
          </>}

          {tab === "Historico" && <><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{snapshot.accounts.map((a) => { const items = snapshot.posts.filter((p) => p.account_id === a.id); return <section key={a.id} className={panel}><div className="flex justify-between gap-2"><div><h2 className="font-semibold">{a.label ?? `@${a.username}`}</h2><p className="text-xs text-slate-500">@{a.username}</p></div><Badge tone={a.is_active ? "good" : "warn"}>{a.is_active ? "Ativa" : "Pausada"}</Badge></div><div className="mt-5 grid grid-cols-2 gap-2 text-center">{[["Publicados", items.filter((p) => p.status === "published").length], ["Fila", items.filter((p) => p.status === "scheduled").length], ["Erros", items.filter((p) => p.status === "failed").length], ["Cancelados", items.filter((p) => p.status === "cancelled").length]].map(([n, v]) => <div key={String(n)} className="rounded-lg bg-white/[0.03] p-3"><div className="text-xl font-semibold">{String(v)}</div><div className="text-[11px] text-slate-500">{String(n)}</div></div>)}</div></section>; })}</div><section className={panel}><h2 className="mb-4 text-lg font-semibold">Sincronizacoes recentes</h2>{!snapshot.jobs.length ? <Empty icon={Activity} title="Sem historico" description="As sincronizacoes do agente aparecerao aqui." /> : <div className="space-y-2">{snapshot.jobs.map((j) => { const p = snapshot.profiles.find((x) => x.id === j.source_profile_id); return <div key={j.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 p-4"><div><div className="text-sm font-medium">@{p?.username ?? "perfil"}</div><div className="mt-1 text-xs text-slate-500">{localLabel(j.requested_at)} · {j.uploaded_count} enviados · {j.error_count} erros</div></div><Badge tone={jobTone(j.status)}>{j.status}</Badge></div>; })}</div>}</section></>}

          {tab === "Configuracoes" && <div className="grid gap-5 xl:grid-cols-2"><section className={panel}><h2 className="flex items-center gap-2 text-lg font-semibold"><Cloud size={20} className="text-violet-400" /> Arquitetura V0.6</h2><div className="mt-4 space-y-3 text-sm leading-relaxed text-slate-400"><p><strong className="text-slate-200">Vercel:</strong> interface e APIs.</p><p><strong className="text-slate-200">Supabase:</strong> banco e Storage privado.</p><p><strong className="text-slate-200">Agente local:</strong> Playwright, CAPTCHA, yt-dlp e upload.</p><p>O computador pode ser desligado depois que a sincronizacao terminar. A biblioteca e a agenda continuam online.</p></div></section><section className={panel}><h2 className="flex items-center gap-2 text-lg font-semibold"><ShieldCheck size={20} className="text-emerald-400" /> Acesso</h2><p className="mt-3 text-sm text-slate-400">O navegador usa apenas a chave do Repost Studio. A chave secreta do Supabase permanece no servidor.</p><button className={`${secondary} mt-5 text-rose-300`} onClick={logout}><LogOut size={16} /> Sair deste navegador</button></section></div>}

          <footer className="pt-3 text-center text-xs text-slate-600">Repost Studio v0.6 · Vercel + Supabase + Agente Local · Publicacao automatica ainda nao habilitada</footer>
        </main>
      </div>
    </div>

    {preview && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"><div className="w-full max-w-3xl rounded-2xl border border-white/15 bg-[#0b1020] p-4"><div className="mb-3 flex items-center justify-between gap-4"><p className="truncate font-medium">{preview.name}</p><button onClick={() => setPreview(null)}><X size={22} /></button></div><video controls autoPlay className="max-h-[75vh] w-full rounded-lg bg-black" src={preview.url} /></div></div>}
  </div>;
}
