"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertCircle, ArrowDownToLine, CalendarDays, Check, CheckCircle2,
  ChevronLeft, ChevronRight, Clapperboard, Clock3, ExternalLink, FileVideo,
  FolderOpen, HardDrive, History, LayoutDashboard, Link2, ListVideo, Loader2,
  Pause, Pencil, Play, Plus, RotateCcw, ScanSearch, Search, Settings,
  ShieldAlert, Trash2, UploadCloud, UserPlus, Users, Video, X,
} from "lucide-react";
import {
  EMPTY_DATA, localTimeLabel, normalizeProfileUrl,
  type Profile, type PublishingAccount, type ScanResult, type ScheduleItem,
  type ScheduleStatus, type StudioData, type VideoItem,
} from "@/lib/model";
import {
  WEEKDAYS, accountDisplay, availableVideosForAccount, buildFutureSlots,
  isoDateLocal, normalizeTimes, weekDates,
} from "@/lib/planner";
import { exportStudio, loadStudio, saveStudio } from "@/lib/studio-store";
import { deleteMedia, fingerprint, getMedia, putMedia } from "@/lib/media-db";

type Tab = "Dashboard" | "Contas" | "Biblioteca" | "Varreduras" | "Agenda" | "Historico" | "Configuracoes";
type Toast = { kind: "ok" | "error" | "info"; message: string } | null;

const navigation = [
  { title: "Dashboard" as Tab, icon: LayoutDashboard },
  { title: "Contas" as Tab, icon: Users },
  { title: "Biblioteca" as Tab, icon: FolderOpen },
  { title: "Varreduras" as Tab, icon: ScanSearch },
  { title: "Agenda" as Tab, icon: CalendarDays },
  { title: "Historico" as Tab, icon: History },
  { title: "Configuracoes" as Tab, icon: Settings },
];

const field = "w-full rounded-xl border border-white/10 bg-[#0b1020] px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-violet-500";
const panel = "rounded-2xl border border-white/10 bg-[#121a2b] p-5 sm:p-6";
const primary = "inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50";
const secondary = "inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50";
const shortId = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

function Badge({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "good" | "warn" | "bad" | "violet" }) {
  const styles = {
    muted: "bg-slate-500/10 text-slate-300",
    good: "bg-emerald-500/10 text-emerald-300",
    warn: "bg-amber-500/10 text-amber-300",
    bad: "bg-rose-500/10 text-rose-300",
    violet: "bg-violet-500/10 text-violet-300",
  };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${styles[tone]}`}>{children}</span>;
}

function Empty({ icon: Icon, title, description }: { icon: typeof Video; title: string; description: string }) {
  return <div className="flex min-h-44 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 p-6 text-center">
    <Icon size={29} className="text-slate-500" />
    <p className="font-medium text-slate-300">{title}</p>
    <p className="max-w-md text-sm text-slate-500">{description}</p>
  </div>;
}

function dateInput() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function statusLabel(status: ScheduleStatus) {
  return {
    draft: "Rascunho",
    scheduled: "Agendado",
    published: "Publicado",
    error: "Erro",
    canceled: "Cancelado",
  }[status];
}

function statusTone(status: ScheduleStatus): "muted" | "good" | "warn" | "bad" | "violet" {
  if (status === "published") return "good";
  if (status === "error" || status === "canceled") return "bad";
  if (status === "scheduled") return "violet";
  return "warn";
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("Dashboard");
  const [data, setData] = useState<StudioData>(EMPTY_DATA);
  const dataRef = useRef<StudioData>(EMPTY_DATA);
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState<Toast>(null);

  const [profileUrl, setProfileUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [busyScan, setBusyScan] = useState<string | null>(null);
  const [busyVideo, setBusyVideo] = useState(false);

  const [busyUpload, setBusyUpload] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);
  const folderRef = useRef<HTMLInputElement | null>(null);
  const filesRef = useRef<HTMLInputElement | null>(null);

  const [accountName, setAccountName] = useState("");
  const [accountUsername, setAccountUsername] = useState("");
  const [accountTimes, setAccountTimes] = useState("09:00,18:00");
  const [accountDays, setAccountDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [accountNotes, setAccountNotes] = useState("");
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);

  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [planLimit, setPlanLimit] = useState(20);
  const [calendarAnchor, setCalendarAnchor] = useState("");
  const [agendaAccountFilter, setAgendaAccountFilter] = useState("all");
  const [agendaStatusFilter, setAgendaStatusFilter] = useState("all");

  useEffect(() => {
    const stored = loadStudio();
    dataRef.current = stored;
    setData(stored);
    setReady(true);
    const today = dateInput();
    setStartDate(today);
    setCalendarAnchor(today);
    if (stored.accounts[0]) setSelectedAccountId(stored.accounts[0].id);
  }, []);

  useEffect(() => () => {
    if (preview?.url) URL.revokeObjectURL(preview.url);
  }, [preview]);

  function update(fn: (current: StudioData) => StudioData) {
    const next = fn(dataRef.current);
    dataRef.current = next;
    setData(next);
    try {
      saveStudio(next);
    } catch {
      setToast({ kind: "error", message: "O navegador nao conseguiu salvar os dados. Libere espaco ou permita armazenamento local." });
    }
  }

  function notify(message: string, kind: "ok" | "error" | "info" = "ok") {
    setToast({ kind, message });
  }

  function resetAccountForm() {
    setEditingAccountId(null);
    setAccountName("");
    setAccountUsername("");
    setAccountTimes("09:00,18:00");
    setAccountDays([1, 2, 3, 4, 5]);
    setAccountNotes("");
  }

  function saveAccount() {
    const name = accountName.trim();
    if (!name) return notify("Informe um nome para identificar a conta.", "error");
    if (!accountDays.length) return notify("Escolha pelo menos um dia da semana.", "error");

    let times: string[];
    try {
      times = normalizeTimes(accountTimes);
    } catch (e) {
      return notify(e instanceof Error ? e.message : "Horarios invalidos.", "error");
    }

    const username = accountUsername.trim().replace(/^@/, "").toLowerCase();
    if (username && !/^[A-Za-z0-9._]{2,30}$/.test(username)) return notify("O @usuario informado nao parece valido.", "error");

    if (editingAccountId) {
      update((old) => ({
        ...old,
        accounts: old.accounts.map((a) => a.id === editingAccountId ? {
          ...a,
          name,
          username: username || undefined,
          rule: { weekdays: [...accountDays].sort(), times },
          notes: accountNotes.trim() || undefined,
        } : a),
      }));
      notify("Conta atualizada.");
      resetAccountForm();
      return;
    }

    if (username && dataRef.current.accounts.some((a) => a.username === username)) return notify("Esse @usuario ja esta cadastrado nas contas de publicacao.", "info");
    const id = shortId();
    const account: PublishingAccount = {
      id,
      name,
      username: username || undefined,
      status: "active",
      rule: { weekdays: [...accountDays].sort(), times },
      notes: accountNotes.trim() || undefined,
      createdAt: nowIso(),
    };
    update((old) => ({ ...old, accounts: [account, ...old.accounts] }));
    if (!selectedAccountId) setSelectedAccountId(id);
    notify("Conta de publicacao criada.");
    resetAccountForm();
  }

  function editAccount(account: PublishingAccount) {
    setEditingAccountId(account.id);
    setAccountName(account.name);
    setAccountUsername(account.username ?? "");
    setAccountTimes(account.rule.times.join(","));
    setAccountDays(account.rule.weekdays);
    setAccountNotes(account.notes ?? "");
    setTab("Contas");
  }

  function toggleAccount(account: PublishingAccount) {
    update((old) => ({
      ...old,
      accounts: old.accounts.map((a) => a.id === account.id ? { ...a, status: a.status === "active" ? "paused" : "active" } : a),
    }));
  }

  function deleteAccount(account: PublishingAccount) {
    const linked = dataRef.current.schedules.some((s) => s.accountId === account.id);
    if (linked) return notify("Essa conta possui agenda/historico. Pause a conta para preservar os registros.", "info");
    if (!window.confirm(`Excluir a conta '${account.name}'?`)) return;
    update((old) => ({ ...old, accounts: old.accounts.filter((a) => a.id !== account.id) }));
    if (selectedAccountId === account.id) setSelectedAccountId("");
    notify("Conta removida.");
  }

  function toggleDay(day: number) {
    setAccountDays((current) => current.includes(day) ? current.filter((d) => d !== day) : [...current, day]);
  }

  function addProfile(raw = profileUrl) {
    try {
      const value = normalizeProfileUrl(raw);
      const existing = dataRef.current.profiles.find((p) => p.username === value.username);
      if (existing) {
        notify(`@${value.username} ja esta cadastrado.`, "info");
        setTab("Varreduras");
        return existing.id;
      }
      const p: Profile = { ...value, id: shortId(), createdAt: nowIso(), scanStatus: "pending" };
      update((old) => ({ ...old, profiles: [p, ...old.profiles] }));
      setProfileUrl("");
      notify(`@${value.username} cadastrado como origem.`);
      return p.id;
    } catch (e) {
      notify(e instanceof Error ? e.message : "URL invalida", "error");
      return null;
    }
  }

  async function scan(profile: Profile) {
    if (busyScan) return;
    const jobId = shortId();
    setBusyScan(profile.id);
    update((old) => ({
      ...old,
      scans: [{ id: jobId, profileId: profile.id, username: profile.username, at: nowIso(), status: "running", found: 0, added: 0, message: "Consultando pagina publica..." }, ...old.scans],
    }));

    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: profile.url }),
      });
      const result = await res.json() as ScanResult & { error?: string };
      if (!res.ok) throw new Error(result.error || `Erro HTTP ${res.status}`);

      const known = new Set(dataRef.current.videos.filter((v) => v.source === "tiktok").map((v) => v.externalId));
      const additions: VideoItem[] = result.videos
        .filter((v) => !known.has(v.id))
        .map((v) => ({
          id: shortId(),
          source: "tiktok",
          profileId: profile.id,
          externalId: v.id,
          title: v.title,
          originalUrl: v.url,
          thumbnailUrl: v.thumbnailUrl,
          createdAt: nowIso(),
        }));

      update((old) => ({
        ...old,
        videos: [...additions, ...old.videos],
        profiles: old.profiles.map((p) => p.id === profile.id ? {
          ...p,
          lastScanAt: nowIso(),
          scanStatus: result.status === "partial" || result.status === "completed" ? result.status : "failed",
        } : p),
        scans: old.scans.map((j) => j.id === jobId ? {
          ...j,
          status: result.status,
          found: result.fetchedCount,
          added: additions.length,
          message: result.message,
        } : j),
      }));
      notify(result.message, result.fetchedCount ? "ok" : "info");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Falha desconhecida";
      update((old) => ({
        ...old,
        profiles: old.profiles.map((p) => p.id === profile.id ? { ...p, lastScanAt: nowIso(), scanStatus: "failed" } : p),
        scans: old.scans.map((j) => j.id === jobId ? { ...j, status: "failed", message } : j),
      }));
      notify(message, "error");
    } finally {
      setBusyScan(null);
    }
  }

  async function addVideoUrl() {
    if (busyVideo) return;
    setBusyVideo(true);
    try {
      const res = await fetch("/api/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: videoUrl.trim() }),
      });
      const item = await res.json() as { error?: string; id: string; username: string; url: string; title: string; thumbnailUrl?: string; verified?: boolean; message?: string };
      if (!res.ok) throw new Error(item.error || "Falha na leitura da URL");
      if (dataRef.current.videos.some((v) => v.externalId === item.id)) throw new Error("Este video ja esta no catalogo.");

      const existing = dataRef.current.profiles.find((p) => p.username === item.username);
      const profileId = existing?.id ?? shortId();
      const newProfile: Profile | undefined = existing ? undefined : {
        id: profileId,
        username: item.username,
        url: `https://www.tiktok.com/@${item.username}`,
        createdAt: nowIso(),
        scanStatus: "pending",
      };

      update((old) => ({
        ...old,
        profiles: newProfile ? [newProfile, ...old.profiles] : old.profiles,
        videos: [{
          id: shortId(), source: "tiktok", profileId, externalId: item.id,
          title: item.title, originalUrl: item.url, thumbnailUrl: item.thumbnailUrl, createdAt: nowIso(),
        }, ...old.videos],
      }));
      setVideoUrl("");
      notify(item.verified ? "Video catalogado." : (item.message || "Link adicionado, nao verificado."), item.verified ? "ok" : "info");
      setTab("Biblioteca");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Erro ao adicionar video", "error");
    } finally {
      setBusyVideo(false);
    }
  }

  async function importFiles(incoming: FileList | null) {
    if (!incoming?.length || busyUpload) return;
    const selected = [...incoming].filter((f) => /\.mp4$/i.test(f.name) && (f.type === "video/mp4" || f.type === ""));
    if (!selected.length) return notify("Nenhum MP4 selecionado.", "error");

    setBusyUpload(true);
    let added = 0;
    let duplicated = 0;
    let errors = 0;
    try {
      for (const [i, file] of selected.entries()) {
        setUploadMessage(`Importando ${i + 1}/${selected.length}: ${file.name}`);
        try {
          const hash = await fingerprint(file);
          if (dataRef.current.videos.some((v) => v.fingerprint === hash)) {
            duplicated++;
            continue;
          }
          const id = shortId();
          await putMedia(id, file);
          update((old) => ({
            ...old,
            videos: [{
              id,
              fileId: id,
              source: "upload",
              title: file.name.replace(/\.mp4$/i, ""),
              fileName: file.name,
              fingerprint: hash,
              fileSize: file.size,
              createdAt: nowIso(),
            }, ...old.videos],
          }));
          added++;
        } catch {
          errors++;
        }
      }
      notify(`${added} importado(s), ${duplicated} duplicado(s), ${errors} erro(s).`, errors ? "info" : "ok");
      setTab("Biblioteca");
    } finally {
      setBusyUpload(false);
      setUploadMessage("");
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
    } catch (e) {
      notify(e instanceof Error ? e.message : "Erro ao abrir arquivo", "error");
    }
  }

  async function downloadFile(item: VideoItem) {
    if (!item.fileId) return;
    const file = await getMedia(item.fileId);
    if (!file) return notify("Arquivo indisponivel neste navegador.", "error");
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = item.fileName || `${item.id}.mp4`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function removeVideo(item: VideoItem) {
    if (!window.confirm(`Excluir '${item.title}' da biblioteca e remover seus agendamentos?`)) return;
    if (item.fileId) await deleteMedia(item.fileId);
    update((old) => ({
      ...old,
      videos: old.videos.filter((v) => v.id !== item.id),
      schedules: old.schedules.filter((s) => s.videoId !== item.id),
    }));
    notify("Video removido.");
  }

  function removeProfile(profile: Profile) {
    if (!window.confirm(`Excluir @${profile.username} das origens catalogadas? MP4 importados serao mantidos.`)) return;
    const ids = new Set(dataRef.current.videos.filter((v) => v.profileId === profile.id && v.source === "tiktok" && !v.fileId).map((v) => v.id));
    update((old) => ({
      ...old,
      profiles: old.profiles.filter((p) => p.id !== profile.id),
      videos: old.videos.filter((v) => !ids.has(v.id)),
      schedules: old.schedules.filter((s) => !ids.has(s.videoId)),
    }));
    notify("Perfil de origem removido.");
  }

  function generateSchedule() {
    const account = dataRef.current.accounts.find((a) => a.id === selectedAccountId);
    if (!account) return notify("Escolha uma conta de publicacao.", "error");
    if (account.status !== "active") return notify("Ative a conta antes de gerar novos agendamentos.", "info");

    const available = availableVideosForAccount(dataRef.current.videos, dataRef.current.schedules, account.id);
    if (!available.length) return notify("Nao ha MP4 novos para essa conta. Importe mais videos ou use outra conta.", "info");

    const requested = Math.min(Math.max(Number(planLimit) || 1, 1), 500, available.length);
    let slots: string[];
    try {
      slots = buildFutureSlots({
        account,
        schedules: dataRef.current.schedules,
        startDate,
        count: requested,
        nowMs: Date.now(),
      });
    } catch (e) {
      return notify(e instanceof Error ? e.message : "Nao foi possivel montar os horarios.", "error");
    }
    if (!slots.length) return notify("Nenhum slot futuro livre foi encontrado.", "error");

    const createdAt = nowIso();
    const planned: ScheduleItem[] = slots.map((at, index) => ({
      id: shortId(),
      videoId: available[index].id,
      accountId: account.id,
      at,
      status: "scheduled",
      createdAt,
    }));
    update((old) => ({ ...old, schedules: [...old.schedules, ...planned] }));
    notify(`${planned.length} publicacao(oes) criada(s) para ${account.name}.`);
  }

  function setScheduleStatus(item: ScheduleItem, status: ScheduleStatus) {
    const stamp = nowIso();
    update((old) => ({
      ...old,
      schedules: old.schedules.map((s) => s.id === item.id ? {
        ...s,
        status,
        updatedAt: stamp,
        publishedAt: status === "published" ? stamp : s.publishedAt,
      } : s),
    }));
  }

  function reschedule(item: ScheduleItem) {
    const current = new Date(item.at);
    const local = Number.isNaN(current.getTime()) ? "" : `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}-${String(current.getDate()).padStart(2, "0")} ${String(current.getHours()).padStart(2, "0")}:${String(current.getMinutes()).padStart(2, "0")}`;
    const answer = window.prompt("Nova data e hora (AAAA-MM-DD HH:MM):", local);
    if (!answer) return;
    const match = answer.trim().match(/^(\d{4}-\d{2}-\d{2})\s+([0-2]\d:[0-5]\d)$/);
    if (!match) return notify("Use o formato AAAA-MM-DD HH:MM.", "error");
    const [hour, minute] = match[2].split(":").map(Number);
    if (hour > 23) return notify("Horario invalido.", "error");
    const parsed = new Date(`${match[1]}T${match[2]}:00`);
    if (Number.isNaN(parsed.getTime())) return notify("Data invalida.", "error");

    const conflict = dataRef.current.schedules.some((s) => s.id !== item.id && s.accountId === item.accountId && s.status !== "canceled" && s.at === parsed.toISOString());
    if (conflict) return notify("Essa conta ja possui uma publicacao nesse horario.", "error");

    update((old) => ({
      ...old,
      schedules: old.schedules.map((s) => s.id === item.id ? { ...s, at: parsed.toISOString(), status: s.status === "canceled" ? "scheduled" : s.status, updatedAt: nowIso() } : s),
    }));
    notify("Agendamento atualizado.");
  }

  function shiftCalendar(days: number) {
    if (!calendarAnchor) return;
    const d = new Date(`${calendarAnchor}T12:00:00`);
    d.setDate(d.getDate() + days);
    setCalendarAnchor(isoDateLocal(d));
  }

  const storedFiles = data.videos.filter((v) => !!v.fileId);
  const candidates = data.videos.filter((v) => !!v.externalId);
  const activeAccounts = data.accounts.filter((a) => a.status === "active");
  const published = data.schedules.filter((s) => s.status === "published");
  const openSchedules = data.schedules.filter((s) => s.status === "scheduled" || s.status === "draft");

  const filteredVideos = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return data.videos.filter((v) => !needle || [
      v.title,
      v.fileName,
      v.originalUrl,
      data.profiles.find((p) => p.id === v.profileId)?.username,
    ].some((value) => value?.toLowerCase().includes(needle)));
  }, [data, search]);

  const selectedAccount = data.accounts.find((a) => a.id === selectedAccountId);
  const selectedAvailableCount = selectedAccount ? availableVideosForAccount(data.videos, data.schedules, selectedAccount.id).length : 0;
  const calendarDays = calendarAnchor ? weekDates(calendarAnchor) : [];

  const filteredAgenda = data.schedules
    .filter((s) => agendaAccountFilter === "all" || s.accountId === agendaAccountFilter)
    .filter((s) => agendaStatusFilter === "all" || s.status === agendaStatusFilter)
    .sort((a, b) => a.at.localeCompare(b.at));

  const latestActivity = [...data.schedules]
    .filter((s) => s.status !== "scheduled" && s.status !== "draft")
    .sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt));

  const kpis = [
    { title: "Contas ativas", value: activeAccounts.length, icon: Users },
    { title: "MP4 na biblioteca", value: storedFiles.length, icon: HardDrive },
    { title: "Na fila", value: openSchedules.length, icon: CalendarDays },
    { title: "Publicados", value: published.length, icon: CheckCircle2 },
  ];

  return <div className="min-h-screen bg-[#090d17] text-slate-100">
    <div className="mx-auto flex min-h-screen max-w-[1800px]">
      <aside className="sticky top-0 hidden h-screen w-[255px] shrink-0 flex-col border-r border-white/[0.08] bg-[#0c1220] px-4 py-7 md:flex">
        <div className="mb-10 flex items-center gap-3 px-2">
          <div className="rounded-xl bg-violet-600 p-2.5"><Clapperboard size={23} /></div>
          <div><div className="font-bold tracking-tight">Repost Studio</div><div className="text-xs text-slate-500">Publishing workspace</div></div>
        </div>
        <nav className="space-y-1">
          {navigation.map(({ title, icon: Icon }) => <button key={title} onClick={() => setTab(title)} className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm transition ${tab === title ? "bg-violet-600 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}><Icon size={18} />{title}</button>)}
        </nav>
        <div className="mt-auto rounded-xl border border-violet-500/20 bg-violet-500/[0.07] p-4">
          <div className="mb-1 flex items-center gap-2 text-sm font-medium text-violet-300"><ShieldAlert size={16} /> MVP local</div>
          <p className="text-xs leading-relaxed text-slate-400">Agenda e biblioteca ficam neste navegador. A publicacao ainda nao e automatica.</p>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b border-white/[0.07] bg-[#090d17]/95 px-4 py-3 backdrop-blur md:hidden">
          <div className="mb-3 flex items-center gap-2 font-bold"><Clapperboard size={20} className="text-violet-400" />Repost Studio</div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {navigation.map(({ title }) => <button key={title} className={`shrink-0 rounded-lg px-3 py-1.5 text-xs ${tab === title ? "bg-violet-600" : "bg-white/5 text-slate-400"}`} onClick={() => setTab(title)}>{title}</button>)}
          </div>
        </header>

        <main className="mx-auto max-w-[1450px] space-y-6 px-4 py-7 sm:px-7 lg:px-10">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-[.15em] text-violet-400">Repost Studio / {tab}</div>
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{tab}</h1>
              <p className="mt-2 text-sm text-slate-400">Organize contas, conteudo e horarios antes de publicar.</p>
            </div>
            <Badge tone="good"><Check size={12} /> MVP v0.5</Badge>
          </div>

          {!ready ? <div className={panel}>Carregando dados locais...</div> : <>
            {toast && <div role="status" className={`flex items-start justify-between gap-4 rounded-xl border p-4 text-sm ${toast.kind === "error" ? "border-rose-500/25 bg-rose-500/10 text-rose-200" : toast.kind === "info" ? "border-amber-500/20 bg-amber-500/10 text-amber-200" : "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"}`}>
              <div className="flex items-start gap-2"><AlertCircle size={17} className="mt-0.5 shrink-0" />{toast.message}</div>
              <button onClick={() => setToast(null)} aria-label="Fechar aviso"><X size={17} /></button>
            </div>}

            {tab === "Dashboard" && <>
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                {kpis.map(({ title, value, icon: Icon }) => <div key={title} className={panel}><div className="mb-5 flex items-start justify-between gap-3 text-sm text-slate-400"><span>{title}</span><Icon size={19} className="shrink-0 text-violet-400" /></div><div className="text-3xl font-bold tabular-nums">{value}</div></div>)}
              </div>

              <div className="grid gap-5 xl:grid-cols-3">
                <section className={`${panel} xl:col-span-2`}>
                  <div className="mb-5 flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Proximas publicacoes</h2><p className="text-sm text-slate-400">Fila consolidada de todas as contas.</p></div><button className={secondary} onClick={() => setTab("Agenda")}><CalendarDays size={16} /> Abrir agenda</button></div>
                  {!openSchedules.length ? <Empty icon={CalendarDays} title="Fila vazia" description="Cadastre uma conta e gere a primeira agenda." /> : <div className="space-y-2">{[...openSchedules].sort((a, b) => a.at.localeCompare(b.at)).slice(0, 8).map((s) => {
                    const account = data.accounts.find((a) => a.id === s.accountId);
                    const video = data.videos.find((v) => v.id === s.videoId);
                    return <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3"><div className="min-w-0"><div className="truncate text-sm font-medium">{video?.title ?? "Video removido"}</div><div className="mt-1 text-xs text-slate-500">{accountDisplay(account)} · {localTimeLabel(s.at)}</div></div><Badge tone="violet">Agendado</Badge></div>;
                  })}</div>}
                </section>

                <section className={panel}>
                  <h2 className="text-lg font-semibold">Resumo operacional</h2>
                  <div className="mt-5 space-y-4 text-sm">
                    <div className="flex items-center justify-between"><span className="text-slate-400">Perfis de origem</span><strong>{data.profiles.length}</strong></div>
                    <div className="flex items-center justify-between"><span className="text-slate-400">Links catalogados</span><strong>{candidates.length}</strong></div>
                    <div className="flex items-center justify-between"><span className="text-slate-400">Contas pausadas</span><strong>{data.accounts.filter((a) => a.status === "paused").length}</strong></div>
                    <div className="flex items-center justify-between"><span className="text-slate-400">Erros de publicacao</span><strong>{data.schedules.filter((s) => s.status === "error").length}</strong></div>
                  </div>
                  <div className="mt-6 rounded-xl border border-violet-500/20 bg-violet-500/[0.06] p-4 text-sm text-slate-300">
                    <p className="font-medium text-violet-300">Fluxo sugerido</p>
                    <p className="mt-2 leading-relaxed text-slate-400">Baixe os videos no motor local, importe a pasta em Biblioteca, configure as contas e gere a agenda.</p>
                  </div>
                </section>
              </div>
            </>}

            {tab === "Contas" && <>
              <div className="grid gap-5 xl:grid-cols-5">
                <section className={`${panel} xl:col-span-2`}>
                  <div className="mb-5 flex items-center gap-3"><div className="rounded-xl bg-violet-500/10 p-3 text-violet-300"><UserPlus size={20} /></div><div><h2 className="text-lg font-semibold">{editingAccountId ? "Editar conta" : "Nova conta de publicacao"}</h2><p className="text-sm text-slate-400">Defina a rotina de postagem dessa conta.</p></div></div>
                  <div className="space-y-4">
                    <label className="block space-y-1.5 text-xs text-slate-400">Nome interno<input className={field} value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="Ex.: Motivacao 01" /></label>
                    <label className="block space-y-1.5 text-xs text-slate-400">@usuario TikTok <span className="text-slate-600">(opcional no MVP)</span><input className={field} value={accountUsername} onChange={(e) => setAccountUsername(e.target.value)} placeholder="@minhaconta" /></label>
                    <div><div className="mb-2 text-xs text-slate-400">Dias de publicacao</div><div className="flex flex-wrap gap-2">{WEEKDAYS.map((day) => <button type="button" key={day.value} onClick={() => toggleDay(day.value)} className={`rounded-lg border px-3 py-2 text-xs font-medium ${accountDays.includes(day.value) ? "border-violet-500/50 bg-violet-500/15 text-violet-200" : "border-white/10 bg-white/[0.03] text-slate-500"}`}>{day.short}</button>)}</div></div>
                    <label className="block space-y-1.5 text-xs text-slate-400">Horarios<input className={field} value={accountTimes} onChange={(e) => setAccountTimes(e.target.value)} placeholder="09:00,13:00,18:00" /></label>
                    <label className="block space-y-1.5 text-xs text-slate-400">Observacoes<textarea className={`${field} min-h-24 resize-y`} value={accountNotes} onChange={(e) => setAccountNotes(e.target.value)} placeholder="Tema, objetivo, observacoes da conta..." /></label>
                    <div className="flex flex-wrap gap-2"><button className={primary} onClick={saveAccount}>{editingAccountId ? <Pencil size={16} /> : <Plus size={16} />}{editingAccountId ? "Salvar alteracoes" : "Criar conta"}</button>{editingAccountId && <button className={secondary} onClick={resetAccountForm}><X size={16} /> Cancelar</button>}</div>
                  </div>
                </section>

                <section className={`${panel} xl:col-span-3`}>
                  <div className="mb-5"><h2 className="text-lg font-semibold">Contas cadastradas</h2><p className="text-sm text-slate-500">{data.accounts.length} conta(s) · {activeAccounts.length} ativa(s)</p></div>
                  {!data.accounts.length ? <Empty icon={Users} title="Nenhuma conta cadastrada" description="Crie a primeira conta e defina seus dias e horarios." /> : <div className="grid gap-4 md:grid-cols-2">{data.accounts.map((account) => {
                    const accountSchedules = data.schedules.filter((s) => s.accountId === account.id);
                    const queue = accountSchedules.filter((s) => s.status === "scheduled" || s.status === "draft").length;
                    const done = accountSchedules.filter((s) => s.status === "published").length;
                    const available = availableVideosForAccount(data.videos, data.schedules, account.id).length;
                    return <div key={account.id} className="rounded-xl border border-white/10 bg-[#0c1322] p-4">
                      <div className="flex items-start justify-between gap-3"><div><div className="font-semibold">{account.name}</div><div className="mt-1 text-xs text-slate-500">{account.username ? `@${account.username}` : "Sem @usuario vinculado"}</div></div><Badge tone={account.status === "active" ? "good" : "warn"}>{account.status === "active" ? "Ativa" : "Pausada"}</Badge></div>
                      <div className="mt-4 flex flex-wrap gap-1.5">{WEEKDAYS.filter((d) => account.rule.weekdays.includes(d.value)).map((d) => <Badge key={d.value}>{d.short}</Badge>)}{account.rule.times.map((time) => <Badge key={time} tone="violet"><Clock3 size={11} />{time}</Badge>)}</div>
                      <div className="mt-4 grid grid-cols-3 gap-2 text-center"><div className="rounded-lg bg-white/[0.03] p-2"><div className="text-lg font-semibold">{queue}</div><div className="text-[11px] text-slate-500">na fila</div></div><div className="rounded-lg bg-white/[0.03] p-2"><div className="text-lg font-semibold">{done}</div><div className="text-[11px] text-slate-500">publicados</div></div><div className="rounded-lg bg-white/[0.03] p-2"><div className="text-lg font-semibold">{available}</div><div className="text-[11px] text-slate-500">disponiveis</div></div></div>
                      {account.notes && <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-slate-500">{account.notes}</p>}
                      <div className="mt-4 flex flex-wrap gap-2"><button className={`${secondary} !px-3 !py-2`} onClick={() => editAccount(account)}><Pencil size={14} /> Editar</button><button className={`${secondary} !px-3 !py-2`} onClick={() => toggleAccount(account)}>{account.status === "active" ? <Pause size={14} /> : <RotateCcw size={14} />}{account.status === "active" ? "Pausar" : "Ativar"}</button><button className={`${secondary} !px-3 !py-2 text-rose-300`} onClick={() => deleteAccount(account)}><Trash2 size={14} /></button></div>
                    </div>;
                  })}</div>}
                </section>
              </div>
            </>}

            {tab === "Biblioteca" && <>
              <section className={panel}>
                <input ref={folderRef} className="hidden" type="file" accept="video/mp4,.mp4" multiple {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)} onChange={(e) => importFiles(e.target.files)} />
                <input ref={filesRef} className="hidden" type="file" accept="video/mp4,.mp4" multiple onChange={(e) => importFiles(e.target.files)} />
                <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">Importar arquivos MP4</h2><p className="mt-1 text-sm text-slate-400">Selecione a pasta <strong className="text-slate-300">downloads</strong> do motor local ou arquivos avulsos.</p></div><Badge tone="warn">Armazenamento local</Badge></div>
                <div className="mt-5 flex flex-wrap gap-3"><button className={primary} disabled={busyUpload} onClick={() => folderRef.current?.click()}><FolderOpen size={17} /> Selecionar pasta</button><button className={secondary} disabled={busyUpload} onClick={() => filesRef.current?.click()}><UploadCloud size={17} /> Selecionar arquivos</button></div>
                {busyUpload && <p className="mt-4 flex items-center gap-2 text-sm text-violet-300"><Loader2 className="animate-spin" size={16} />{uploadMessage}</p>}
                <p className="mt-4 text-xs leading-relaxed text-slate-500">A importacao detecta arquivos duplicados por SHA-256. O mesmo MP4 pode ser agendado em contas diferentes, mas nao se repete na mesma conta.</p>
              </section>

              <section className={panel}>
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Catalogo de videos</h2><p className="text-sm text-slate-500">{data.videos.length} videos · {storedFiles.length} com MP4</p></div><div className="relative w-full max-w-xs"><Search className="absolute left-3 top-3 text-slate-500" size={16} /><input className={`${field} !py-2.5 !pl-9`} placeholder="Buscar video ou perfil" value={search} onChange={(e) => setSearch(e.target.value)} /></div></div>
                {!filteredVideos.length ? <Empty icon={FileVideo} title="Nenhum video encontrado" description="Importe a pasta de downloads do motor local." /> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{filteredVideos.map((v) => {
                  const useItems = data.schedules.filter((s) => s.videoId === v.id && s.status !== "canceled");
                  const accountUses = new Set(useItems.map((s) => s.accountId)).size;
                  return <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0c1322]" key={v.id}>
                    <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-gradient-to-br from-violet-950/70 to-slate-900">{v.thumbnailUrl ? <img src={v.thumbnailUrl} alt="Capa do video" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : <FileVideo size={38} className="text-violet-400/60" />}<div className="absolute bottom-2 left-2"><Badge tone={v.fileId ? "good" : "warn"}>{v.fileId ? "MP4 disponivel" : "Somente link"}</Badge></div></div>
                    <div className="space-y-3 p-3"><div className="line-clamp-2 min-h-10 break-words text-sm font-medium">{v.title}</div><div className="flex flex-wrap gap-1.5 text-xs"><Badge>{accountUses} conta(s)</Badge><Badge>{useItems.length} uso(s)</Badge></div><div className="text-xs text-slate-500">{v.fileName ?? data.profiles.find((p) => p.id === v.profileId)?.username ?? "TikTok"}</div><div className="flex flex-wrap gap-2">{v.fileId ? <><button className={`${secondary} !px-3 !py-2`} onClick={() => previewFile(v)}><Play size={14} /> Abrir</button><button className={`${secondary} !px-3 !py-2`} onClick={() => downloadFile(v)} title="Baixar arquivo local"><ArrowDownToLine size={14} /></button></> : v.originalUrl ? <a className={`${secondary} !px-3 !py-2`} href={v.originalUrl} rel="noreferrer" target="_blank"><ExternalLink size={14} /> TikTok</a> : null}<button onClick={() => removeVideo(v)} className={`${secondary} !px-3 !py-2 text-rose-300`} aria-label="Remover video"><Trash2 size={14} /></button></div></div>
                  </div>;
                })}</div>}
              </section>
            </>}

            {tab === "Varreduras" && <>
              <section className={panel}>
                <div className="mb-5"><h2 className="text-lg font-semibold">Perfis de origem</h2><p className="text-sm text-slate-400">Esses perfis sao fontes de conteudo e nao as contas onde voce pretende publicar.</p></div>
                <form onSubmit={(e) => { e.preventDefault(); addProfile(); }} className="flex flex-col gap-3 sm:flex-row"><input className={field} value={profileUrl} onChange={(e) => setProfileUrl(e.target.value)} type="url" placeholder="https://www.tiktok.com/@usuario" /><button className={primary}><Plus size={16} /> Adicionar origem</button></form>
              </section>
              <div className="grid gap-5 xl:grid-cols-2">
                <section className={panel}><div className="mb-4 flex items-center gap-2"><ScanSearch size={20} className="text-violet-400" /><h2 className="text-lg font-semibold">Scanner web</h2></div><p className="mb-4 text-sm text-slate-400">O scanner do site pode ser limitado pelo TikTok. Para coleta e download em lote, continue usando o motor local V0.4 que voce ja validou.</p>{!data.profiles.length ? <Empty icon={Users} title="Nenhuma origem" description="Adicione a URL de um perfil acima." /> : <div className="space-y-2">{data.profiles.map((p) => <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 px-3 py-3" key={p.id}><div><div className="text-sm">@{p.username}</div><div className="text-xs text-slate-600">{p.lastScanAt ? `Ultima consulta: ${localTimeLabel(p.lastScanAt)}` : "Ainda nao consultado"}</div></div><div className="flex gap-2"><button disabled={!!busyScan} className={`${secondary} !py-2`} onClick={() => scan(p)}>{busyScan === p.id ? <Loader2 size={15} className="animate-spin" /> : <ScanSearch size={15} />} Analisar</button><button className={`${secondary} !px-2.5 !py-2 text-rose-300`} onClick={() => removeProfile(p)}><Trash2 size={15} /></button></div></div>)}</div>}</section>
                <section className={panel}><div className="mb-4 flex items-center gap-2"><Link2 size={20} className="text-violet-400" /><h2 className="text-lg font-semibold">Adicionar video por URL</h2></div><p className="mb-4 text-sm text-slate-400">Opcional para catalogar um link especifico sem importar o MP4.</p><form className="space-y-3" onSubmit={(e) => { e.preventDefault(); addVideoUrl(); }}><input className={field} required type="url" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://www.tiktok.com/@usuario/video/123456..." /><button disabled={busyVideo} className={primary}>{busyVideo ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />} Catalogar link</button></form></section>
              </div>
              <section className={panel}><h2 className="mb-4 text-lg font-semibold">Historico de consultas</h2>{!data.scans.length ? <Empty icon={Activity} title="Sem consultas registradas" description="As consultas feitas pelo scanner web aparecerao aqui." /> : <div className="space-y-3">{data.scans.map((j) => <div key={j.id} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div className="font-medium">@{j.username}</div><Badge tone={j.status === "partial" || j.status === "completed" ? "good" : j.status === "running" ? "warn" : "bad"}>{j.status === "partial" ? "Parcial" : j.status === "blocked" ? "Bloqueado" : j.status === "running" ? "Em andamento" : j.status === "completed" ? "Concluido" : "Falha"}</Badge></div><p className="mt-2 break-words text-sm text-slate-400">{j.message}</p><div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500"><span>{localTimeLabel(j.at)}</span><span>{j.found} encontrados</span><span>{j.added} novos</span></div></div>)}</div>}</section>
            </>}

            {tab === "Agenda" && <>
              <section className={panel}>
                <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">Distribuicao automatica</h2><p className="mt-1 text-sm text-slate-400">Preencha os proximos horarios livres usando a regra da conta escolhida.</p></div><Badge tone="warn"><Clock3 size={14} /> Planejamento</Badge></div>
                <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><label className="space-y-1.5 text-xs text-slate-400">Conta<select className={field} value={selectedAccountId} onChange={(e) => setSelectedAccountId(e.target.value)}><option value="">Escolha...</option>{data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.status === "paused" ? " (pausada)" : ""}</option>)}</select></label><label className="space-y-1.5 text-xs text-slate-400">Data inicial<input className={field} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label><label className="space-y-1.5 text-xs text-slate-400">Quantidade<input className={field} type="number" min="1" max="500" value={planLimit} onChange={(e) => setPlanLimit(Number(e.target.value))} /></label><div className="flex items-end"><button className={`${primary} w-full`} onClick={generateSchedule}><CalendarDays size={17} /> Gerar agenda</button></div></div>
                <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500"><span>{selectedAvailableCount} MP4 ainda nao usados nessa conta.</span>{selectedAccount && <><span>·</span><span>{selectedAccount.rule.times.join(", ")}</span><span>·</span><span>{WEEKDAYS.filter((d) => selectedAccount.rule.weekdays.includes(d.value)).map((d) => d.short).join(", ")}</span></>}</div>
              </section>

              <section className={panel}>
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Calendario semanal</h2><p className="text-sm text-slate-500">Visualize todas as contas lado a lado por dia.</p></div><div className="flex items-center gap-2"><button className={`${secondary} !px-3`} onClick={() => shiftCalendar(-7)}><ChevronLeft size={16} /></button><button className={secondary} onClick={() => setCalendarAnchor(dateInput())}>Hoje</button><button className={`${secondary} !px-3`} onClick={() => shiftCalendar(7)}><ChevronRight size={16} /></button></div></div>
                <div className="grid min-w-[900px] grid-cols-7 gap-2 overflow-x-auto">{calendarDays.map((day) => {
                  const dayKey = isoDateLocal(day);
                  const items = data.schedules.filter((s) => {
                    const d = new Date(s.at);
                    return !Number.isNaN(d.getTime()) && isoDateLocal(d) === dayKey && s.status !== "canceled";
                  }).sort((a, b) => a.at.localeCompare(b.at));
                  return <div key={dayKey} className="min-h-52 rounded-xl border border-white/10 bg-[#0c1322] p-2"><div className="mb-2 border-b border-white/[0.07] pb-2 text-center"><div className="text-xs font-medium text-slate-400">{day.toLocaleDateString("pt-BR", { weekday: "short" })}</div><div className="text-lg font-semibold">{day.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</div></div><div className="space-y-2">{items.map((s) => { const account = data.accounts.find((a) => a.id === s.accountId); const video = data.videos.find((v) => v.id === s.videoId); const when = new Date(s.at); return <button key={s.id} onClick={() => reschedule(s)} className="w-full rounded-lg border border-violet-500/15 bg-violet-500/[0.06] p-2 text-left"><div className="text-xs font-semibold text-violet-300">{String(when.getHours()).padStart(2, "0")}:{String(when.getMinutes()).padStart(2, "0")} · {account?.name ?? "Conta removida"}</div><div className="mt-1 line-clamp-2 text-[11px] leading-snug text-slate-400">{video?.title ?? "Video removido"}</div></button>; })}</div></div>;
                })}</div>
              </section>

              <section className={panel}>
                <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold">Fila de publicacoes</h2><p className="text-sm text-slate-500">Edite horario, status ou cancele itens individualmente.</p></div><div className="flex flex-wrap gap-2"><select className={`${field} !w-auto !py-2`} value={agendaAccountFilter} onChange={(e) => setAgendaAccountFilter(e.target.value)}><option value="all">Todas as contas</option>{data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select><select className={`${field} !w-auto !py-2`} value={agendaStatusFilter} onChange={(e) => setAgendaStatusFilter(e.target.value)}><option value="all">Todos os status</option><option value="scheduled">Agendado</option><option value="published">Publicado</option><option value="error">Erro</option><option value="canceled">Cancelado</option><option value="draft">Rascunho</option></select></div></div>
                {!filteredAgenda.length ? <Empty icon={CalendarDays} title="Nenhum agendamento" description="Configure uma conta, importe MP4 e gere a agenda." /> : <div className="space-y-2">{filteredAgenda.map((s) => { const v = data.videos.find((item) => item.id === s.videoId); const account = data.accounts.find((a) => a.id === s.accountId); return <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 px-4 py-3"><div className="min-w-0"><div className="max-w-xl truncate text-sm font-medium">{v?.title ?? "Arquivo removido"}</div><p className="mt-1 text-xs text-slate-400">{accountDisplay(account)} · {localTimeLabel(s.at)}</p></div><div className="flex flex-wrap items-center gap-2"><Badge tone={statusTone(s.status)}>{statusLabel(s.status)}</Badge><button className={`${secondary} !px-2.5 !py-2`} onClick={() => reschedule(s)} title="Reagendar"><Pencil size={15} /></button>{s.status !== "published" && <button className={`${secondary} !px-2.5 !py-2 text-emerald-300`} onClick={() => setScheduleStatus(s, "published")} title="Marcar publicado"><CheckCircle2 size={15} /></button>}{s.status !== "error" && s.status !== "published" && <button className={`${secondary} !px-2.5 !py-2 text-amber-300`} onClick={() => setScheduleStatus(s, "error")} title="Marcar erro"><AlertCircle size={15} /></button>}{s.status !== "canceled" ? <button className={`${secondary} !px-2.5 !py-2 text-rose-300`} onClick={() => setScheduleStatus(s, "canceled")} title="Cancelar"><X size={15} /></button> : <button className={`${secondary} !px-2.5 !py-2`} onClick={() => setScheduleStatus(s, "scheduled")} title="Reativar"><RotateCcw size={15} /></button>}</div></div>; })}</div>}
              </section>
            </>}

            {tab === "Historico" && <>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{data.accounts.map((account) => {
                const items = data.schedules.filter((s) => s.accountId === account.id);
                return <section key={account.id} className={panel}><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">{account.name}</h2><p className="mt-1 text-xs text-slate-500">{account.username ? `@${account.username}` : "Sem @usuario"}</p></div><Badge tone={account.status === "active" ? "good" : "warn"}>{account.status === "active" ? "Ativa" : "Pausada"}</Badge></div><div className="mt-5 grid grid-cols-2 gap-2 text-center"><div className="rounded-lg bg-white/[0.03] p-3"><div className="text-xl font-semibold">{items.filter((s) => s.status === "published").length}</div><div className="text-[11px] text-slate-500">publicados</div></div><div className="rounded-lg bg-white/[0.03] p-3"><div className="text-xl font-semibold">{items.filter((s) => s.status === "scheduled" || s.status === "draft").length}</div><div className="text-[11px] text-slate-500">na fila</div></div><div className="rounded-lg bg-white/[0.03] p-3"><div className="text-xl font-semibold">{items.filter((s) => s.status === "error").length}</div><div className="text-[11px] text-slate-500">erros</div></div><div className="rounded-lg bg-white/[0.03] p-3"><div className="text-xl font-semibold">{items.filter((s) => s.status === "canceled").length}</div><div className="text-[11px] text-slate-500">cancelados</div></div></div></section>;
              })}</div>
              {!data.accounts.length && <section className={panel}><Empty icon={Users} title="Sem contas" description="Cadastre uma conta para iniciar o historico." /></section>}
              <section className={panel}><h2 className="mb-4 text-lg font-semibold">Atividade recente</h2>{!latestActivity.length ? <Empty icon={History} title="Nenhuma atividade concluida" description="Marque itens como publicados, erro ou cancelados para formar o historico." /> : <div className="space-y-2">{latestActivity.slice(0, 100).map((s) => { const account = data.accounts.find((a) => a.id === s.accountId); const video = data.videos.find((v) => v.id === s.videoId); return <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 px-4 py-3"><div className="min-w-0"><div className="truncate text-sm font-medium">{video?.title ?? "Video removido"}</div><div className="mt-1 text-xs text-slate-500">{accountDisplay(account)} · previsto {localTimeLabel(s.at)}</div></div><Badge tone={statusTone(s.status)}>{statusLabel(s.status)}</Badge></div>; })}</div>}</section>
            </>}

            {tab === "Configuracoes" && <>
              <section className={panel}><div className="flex items-center gap-3"><HardDrive size={20} className="text-violet-400" /><h2 className="text-lg font-semibold">Armazenamento local</h2></div><p className="mt-3 text-sm leading-relaxed text-slate-400">A V0.5 usa localStorage para contas, regras, perfis, historico e agenda, e IndexedDB para MP4. A primeira abertura migra automaticamente os metadados da V0.3.</p><div className="mt-5 flex flex-wrap gap-3"><button className={secondary} onClick={() => exportStudio(data)}><ArrowDownToLine size={16} /> Exportar backup JSON</button><button className={`${secondary} text-rose-300`} onClick={() => { if (window.confirm("Apagar contas, perfis, agenda e historico? Os MP4 serao preservados na Biblioteca.")) { update(() => ({ version: 5, profiles: [], videos: dataRef.current.videos.filter((v) => !!v.fileId), scans: [], accounts: [], schedules: [] })); setSelectedAccountId(""); notify("Metadados limpos; MP4 preservados."); } }}><Trash2 size={16} /> Limpar planejamento</button></div></section>
              <section className={panel}><h2 className="mb-3 flex items-center gap-2 text-lg font-semibold"><ShieldAlert size={20} className="text-amber-300" /> Escopo desta versao</h2><div className="space-y-3 text-sm leading-relaxed text-slate-400"><p>Contas, horarios, distribuicao, calendario e historico ja funcionam localmente.</p><p>A V0.5 nao faz login nas contas TikTok e nao publica automaticamente. A futura automacao devera usar autorizacao adequada das contas.</p><p>O motor local de download continua separado do site. Depois do download, importe a pasta de MP4 na Biblioteca.</p><p>Use apenas conteudos que voce tenha permissao para baixar, reutilizar e publicar.</p></div></section>
            </>}
          </>}

          <footer className="pt-3 text-center text-xs text-slate-600">Repost Studio v0.5 · Contas + agenda editorial · Sem publicacao automatica</footer>
        </main>
      </div>
    </div>

    {preview && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label="Previa de video"><div className="w-full max-w-3xl rounded-2xl border border-white/15 bg-[#0b1020] p-4"><div className="mb-3 flex items-center justify-between gap-4"><p className="truncate font-medium">{preview.name}</p><button onClick={() => setPreview(null)} aria-label="Fechar video"><X size={22} /></button></div><video controls autoPlay className="max-h-[75vh] w-full rounded-lg bg-black" src={preview.url} /></div></div>}
  </div>;
}
