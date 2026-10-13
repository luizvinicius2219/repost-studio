
"use client";

import { useState } from "react";
import {
  LayoutDashboard,
  Users,
  FolderOpen,
  ScanSearch,
  CalendarDays,
  Settings,
  Clapperboard,
  Plus,
  Link2,
  Video,
  Clock3,
  CheckCircle2,
} from "lucide-react";

type Profile = {
  username: string;
  url: string;
};

const menu = [
  { label: "Dashboard", icon: LayoutDashboard },
  { label: "Perfis", icon: Users },
  { label: "Biblioteca", icon: FolderOpen },
  { label: "Varreduras", icon: ScanSearch },
  { label: "Agendamentos", icon: CalendarDays },
  { label: "Configurações", icon: Settings },
];

export default function Home() {
  const [active, setActive] = useState("Dashboard");
  const [url, setUrl] = useState("");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [error, setError] = useState("");

  function addProfile() {
    try {
      const parsed = new URL(url.trim());

      if (
        !["tiktok.com", "www.tiktok.com"].includes(parsed.hostname)
      ) {
        throw new Error("Domínio inválido");
      }

      const match = parsed.pathname.match(
        /^\/@([a-zA-Z0-9._]+)\/?$/
      );

      if (!match) throw new Error("Perfil inválido");

      const username = match[1];

      if (profiles.some((p) => p.username === username)) {
        setError("Este perfil já foi cadastrado.");
        return;
      }

      setProfiles((old) => [
        ...old,
        {
          username,
          url: `https://www.tiktok.com/@${username}`,
        },
      ]);

      setUrl("");
      setError("");
      setActive("Perfis");
    } catch {
      setError("Informe uma URL válida de perfil TikTok.");
    }
  }

  const cards = [
    { label: "Perfis cadastrados", value: profiles.length, icon: Users },
    { label: "Vídeos catalogados", value: 0, icon: Video },
    { label: "Varreduras realizadas", value: 0, icon: ScanSearch },
    { label: "Publicações agendadas", value: 0, icon: Clock3 },
  ];

  return (
    <div className="flex min-h-screen bg-[#090d17] text-slate-100">
      <aside className="hidden w-64 shrink-0 border-r border-white/10 bg-[#0d1320] p-5 md:block">
        <div className="mb-12 flex items-center gap-3">
          <div className="rounded-xl bg-violet-600 p-2">
            <Clapperboard size={24} />
          </div>
          <div>
            <h1 className="font-bold">Repost Studio</h1>
            <p className="text-xs text-slate-400">Content Management</p>
          </div>
        </div>

        <nav className="space-y-2">
          {menu.map(({ label, icon: Icon }) => (
            <button
              key={label}
              onClick={() => setActive(label)}
              className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm transition ${
                active === label
                  ? "bg-violet-600 text-white"
                  : "text-slate-400 hover:bg-white/5 hover:text-white"
              }`}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 flex-1 p-5 md:p-10">
        <header className="mb-9 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="mb-1 text-sm text-violet-400">
              Repost Studio / {active}
            </p>
            <h2 className="text-3xl font-bold">{active}</h2>
            <p className="mt-2 text-sm text-slate-400">
              Gerencie perfis, vídeos e futuras publicações.
            </p>
          </div>

          <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-4 py-2 text-xs text-violet-300">
            MVP v0.1.0
          </span>
        </header>

        <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map(({ label, value, icon: Icon }) => (
            <div
              key={label}
              className="rounded-2xl border border-white/10 bg-[#111a2b] p-5"
            >
              <div className="mb-5 flex items-center justify-between">
                <span className="text-sm text-slate-400">{label}</span>
                <Icon size={20} className="text-violet-400" />
              </div>
              <div className="text-3xl font-bold">{value}</div>
            </div>
          ))}
        </div>

        <div className="grid gap-6 xl:grid-cols-3">
          <section className="rounded-2xl border border-white/10 bg-[#111a2b] p-6 xl:col-span-2">
            <div className="mb-6 flex items-center gap-3">
              <div className="rounded-xl bg-violet-500/10 p-3 text-violet-400">
                <Link2 size={22} />
              </div>
              <div>
                <h3 className="text-lg font-semibold">
                  Cadastrar perfil TikTok
                </h3>
                <p className="text-sm text-slate-400">
                  Adicione um perfil para preparar sua catalogação.
                </p>
              </div>
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                addProfile();
              }}
              className="flex flex-col gap-3 sm:flex-row"
            >
              <input
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://www.tiktok.com/@usuario"
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#090d17] px-4 py-3 text-sm outline-none focus:border-violet-500"
              />
              <button
                type="submit"
                className="flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 py-3 text-sm font-medium hover:bg-violet-500"
              >
                <Plus size={18} />
                Adicionar perfil
              </button>
            </form>

            {error && (
              <p className="mt-3 text-sm text-red-400">{error}</p>
            )}

            <p className="mt-4 text-xs text-slate-500">
              O cadastro não realiza downloads ou varreduras.
              A integração será adicionada posteriormente.
            </p>
          </section>

          <section className="rounded-2xl border border-white/10 bg-[#111a2b] p-6">
            <h3 className="mb-5 text-lg font-semibold">
              Status do sistema
            </h3>

            <div className="space-y-5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Interface</span>
                <span className="flex items-center gap-2 text-emerald-400">
                  <CheckCircle2 size={16} /> Ativa
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Banco de dados</span>
                <span className="text-amber-400">Não conectado</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">TikTok API</span>
                <span className="text-amber-400">Não conectada</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Agendador</span>
                <span className="text-slate-500">Em desenvolvimento</span>
              </div>
            </div>
          </section>
        </div>

        <section className="mt-6 rounded-2xl border border-white/10 bg-[#111a2b] p-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">
                Perfis cadastrados
              </h3>
              <p className="text-sm text-slate-400">
                Lista temporária desta sessão.
              </p>
            </div>
            <span className="text-xs text-slate-400">
              {profiles.length} perfil(is)
            </span>
          </div>

          {profiles.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-white/10 py-12">
              <Users size={32} className="text-slate-500" />
              <p className="text-sm text-slate-400">
                Nenhum perfil cadastrado.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {profiles.map((profile) => (
                <div
                  key={profile.username}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 p-4"
                >
                  <div>
                    <p className="font-medium">@{profile.username}</p>
                    <a
                      href={profile.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-violet-400 hover:underline"
                    >
                      {profile.url}
                    </a>
                  </div>
                  <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs text-amber-400">
                    Aguardando varredura
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
