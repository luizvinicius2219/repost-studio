"""Repost Studio V0.6 - agente local.

Responsabilidades locais:
- abrir perfis publicos do TikTok com Playwright;
- permitir que o usuario resolva verificacoes normais no navegador;
- coletar URLs publicas exibidas na grade;
- baixar MP4 com yt-dlp;
- enviar MP4 diretamente ao Supabase Storage usando URL assinada criada pela API Vercel.

O agente NAO recebe a chave secreta do Supabase.
"""

from __future__ import annotations

import json
import os
import queue
import re
import subprocess
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
import tkinter as tk
from tkinter import messagebox, ttk

import requests

BASE = Path(__file__).resolve().parent
DATA = BASE / "dados"
DOWNLOADS = BASE / "downloads"
BROWSER_DIR = DATA / "navegador"
CONFIG_PATH = DATA / "config.json"
PROFILE_RE = re.compile(r"^/@([A-Za-z0-9._]{2,30})/?$")
VIDEO_RE = re.compile(r"^/@([A-Za-z0-9._]{2,30})/video/(\d{10,25})/?$")
PREFERRED_FORMAT = "best[ext=mp4][format_id!=download]/best[ext=mp4]/best"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def profile_name(raw: str) -> str:
    raw = raw.strip()
    parts = urlsplit(raw)
    if parts.scheme != "https" or (parts.hostname or "").lower() not in ("www.tiktok.com", "tiktok.com", "m.tiktok.com"):
        raise ValueError("Cole uma URL HTTPS do TikTok, como https://www.tiktok.com/@usuario")
    match = PROFILE_RE.fullmatch(parts.path)
    if not match:
        raise ValueError("A URL deve ser de um perfil, e nao de um video individual.")
    username = match.group(1)
    if username.startswith(".") or username.endswith(".") or ".." in username:
        raise ValueError("Nome de perfil invalido.")
    return username


def canonical_video(raw: str, username: str) -> tuple[str, str] | None:
    try:
        parts = urlsplit(raw)
    except ValueError:
        return None
    if parts.scheme != "https" or (parts.hostname or "").lower() not in ("www.tiktok.com", "tiktok.com", "m.tiktok.com"):
        return None
    match = VIDEO_RE.fullmatch(parts.path)
    if not match or match.group(1).lower() != username.lower():
        return None
    video_id = match.group(2)
    return video_id, f"https://www.tiktok.com/@{username}/video/{video_id}"


def store_paths(username: str) -> tuple[Path, Path]:
    folder = DATA / username.lower()
    return folder / "videos.json", folder / "urls.txt"


def load_manifest(username: str) -> dict:
    manifest_path, _ = store_paths(username)
    if manifest_path.exists():
        try:
            value = json.loads(manifest_path.read_text(encoding="utf-8"))
            if isinstance(value, dict) and isinstance(value.get("videos"), dict):
                return value
        except (OSError, ValueError) as exc:
            raise RuntimeError(f"Historico corrompido: {manifest_path}") from exc
    return {"username": username, "created_at": utc_now(), "videos": {}}


def save_manifest(username: str, manifest: dict) -> None:
    path, urls_path = store_paths(username)
    path.parent.mkdir(parents=True, exist_ok=True)
    manifest["updated_at"] = utc_now()
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, path)
    urls_path.write_text("\n".join(item["url"] for item in manifest["videos"].values()) + "\n", encoding="utf-8")


def add_links(username: str, manifest: dict, links: dict[str, str]) -> int:
    created = 0
    for video_id, url in links.items():
        if video_id not in manifest["videos"]:
            manifest["videos"][video_id] = {
                "url": url,
                "discovered_at": utc_now(),
                "status": "discovered",
                "attempts": 0,
            }
            created += 1
    if created:
        save_manifest(username, manifest)
    return created


def links_on_page(page, username: str) -> dict[str, str]:
    anchors = page.eval_on_selector_all("a[href*=\"/video/\"]", "(elements) => elements.map(el => el.href)")
    found: dict[str, str] = {}
    for href in anchors:
        result = canonical_video(href, username)
        if result:
            video_id, url = result
            found[video_id] = url
    return found


def scan_profile(username: str, manifest: dict, log, is_cancelled, max_scrolls: int = 0) -> int:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise RuntimeError("Playwright nao instalado. Execute INSTALAR_REPOST.bat.") from exc

    BROWSER_DIR.mkdir(parents=True, exist_ok=True)
    url = f"https://www.tiktok.com/@{username}"
    added_total = 0
    with sync_playwright() as playwright:
        try:
            context = playwright.chromium.launch_persistent_context(
                str(BROWSER_DIR), channel="msedge", headless=False, viewport={"width": 1360, "height": 850}
            )
        except Exception as edge_error:
            log(f"Edge indisponivel ({type(edge_error).__name__}); tentando Chromium...")
            context = playwright.chromium.launch_persistent_context(
                str(BROWSER_DIR), headless=False, viewport={"width": 1360, "height": 850}
            )
        try:
            page = context.pages[0] if context.pages else context.new_page()
            log("Abrindo perfil. Se aparecer CAPTCHA, idade ou verificacao, resolva no navegador aberto.")
            page.goto(url, wait_until="domcontentloaded", timeout=45000)
            page.wait_for_timeout(2000)
            for attempt in range(40):
                if is_cancelled():
                    break
                found = links_on_page(page, username)
                count = add_links(username, manifest, found)
                added_total += count
                if found:
                    break
                if attempt == 0:
                    log("Aguardando a grade de videos aparecer (ate 60 s)...")
                page.wait_for_timeout(1500)
            if not manifest["videos"]:
                log("Nenhum link encontrado. Verifique o navegador e tente novamente.")
                return added_total

            log(f"Links salvos: {len(manifest['videos'])}. Percorrendo a grade...")
            stagnant = 0
            scroll_number = 0
            while not is_cancelled() and (max_scrolls == 0 or scroll_number < max_scrolls) and stagnant < 10:
                try:
                    page.mouse.wheel(0, 1550)
                    page.wait_for_timeout(1650)
                    found = links_on_page(page, username)
                except Exception as exc:
                    log(f"Falha de leitura do navegador: {exc}")
                    break
                new = add_links(username, manifest, found)
                added_total += new
                stagnant = 0 if new else stagnant + 1
                scroll_number += 1
                if new and (scroll_number < 3 or scroll_number % 5 == 0):
                    log(f"Rolagem {scroll_number}: +{new} videos | {len(manifest['videos'])} catalogados")
            if stagnant >= 10:
                log("Sem novos videos em 10 rolagens. Finalizando a coleta desta rodada.")
        finally:
            context.close()
    return added_total


def downloaded_file(username: str, video_id: str) -> Path | None:
    folder = DOWNLOADS / username.lower()
    for file in folder.glob(f"{video_id}.*"):
        if file.is_file() and file.suffix.lower() in (".mp4", ".mkv", ".webm", ".mov") and file.stat().st_size > 0:
            return file
    return None


def download_one(username: str, video_id: str, item: dict, log) -> Path | None:
    existing = downloaded_file(username, video_id)
    if existing:
        item.update(status="downloaded", file=str(existing), last_error="")
        return existing

    folder = DOWNLOADS / username.lower()
    folder.mkdir(parents=True, exist_ok=True)
    command = [
        sys.executable, "-m", "yt_dlp",
        "--no-playlist", "--no-overwrites", "--continue",
        "--retries", "2", "--fragment-retries", "2",
        "--socket-timeout", "20", "--sleep-requests", "1",
        "-f", PREFERRED_FORMAT,
        "-P", str(folder), "-o", "%(id)s.%(ext)s",
        "--no-progress", "--newline", item["url"],
    ]
    item["attempts"] = int(item.get("attempts", 0)) + 1
    try:
        result = subprocess.run(command, capture_output=True, text=True, errors="replace", timeout=240)
        saved = downloaded_file(username, video_id)
        if result.returncode == 0 and saved:
            item.update(status="downloaded", file=str(saved), last_error="")
            return saved
        error = (result.stderr or result.stdout or f"yt-dlp terminou com codigo {result.returncode}").strip()[-700:]
        item.update(status="failed", last_error=error)
        log(f"Falha no download {video_id}: {error}")
    except Exception as exc:
        item.update(status="failed", last_error=str(exc))
        log(f"Falha no download {video_id}: {exc}")
    return None


def download_batch(username: str, manifest: dict, log, is_cancelled) -> tuple[int, int]:
    successes = failures = 0
    total = len(manifest["videos"])
    for index, (video_id, item) in enumerate(manifest["videos"].items(), 1):
        if is_cancelled():
            break
        log(f"[{index}/{total}] {video_id}")
        saved = download_one(username, video_id, item, log)
        if saved:
            successes += 1
        else:
            failures += 1
        save_manifest(username, manifest)
    log(f"Downloads concluidos: {successes} OK, {failures} falhas.")
    return successes, failures


def load_config() -> dict:
    if CONFIG_PATH.exists():
        try:
            raw = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                return raw
        except Exception:
            pass
    return {"server_url": "https://repost-studio.vercel.app", "access_key": "", "auto_monitor": True}


def save_config(config: dict) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(config, indent=2), encoding="utf-8")


class OnlineClient:
    def __init__(self, server_url: str, access_key: str):
        self.server_url = server_url.strip().rstrip("/")
        self.access_key = access_key.strip()
        if not self.server_url.startswith("https://") and not self.server_url.startswith("http://localhost"):
            raise ValueError("Use a URL HTTPS do Repost Studio ou localhost para testes.")
        if not self.access_key:
            raise ValueError("Informe a REPOST_STUDIO_ACCESS_KEY.")

    def call(self, action: str, **payload):
        response = requests.post(
            self.server_url + "/api/agent",
            json={"action": action, **payload},
            headers={"x-repost-key": self.access_key},
            timeout=45,
        )
        try:
            body = response.json()
        except ValueError as exc:
            raise RuntimeError(f"Resposta invalida do painel: HTTP {response.status_code}") from exc
        if not response.ok:
            raise RuntimeError(body.get("error") or f"HTTP {response.status_code}")
        return body

    def progress(self, job_id: str, status: str, message: str, counts: dict):
        return self.call("progress", jobId=job_id, status=status, message=message, **counts)

    def upload(self, job_id: str, username: str, video_id: str, item: dict, file: Path):
        if file.suffix.lower() != ".mp4":
            raise RuntimeError(f"{file.name}: Storage V0.6 aceita MP4. Arquivo local nao e MP4.")
        prepared = self.call(
            "prepare_video",
            jobId=job_id,
            videoId=video_id,
            sourceUrl=item["url"],
            title=item.get("title") or f"Video {video_id}",
            fileName=file.name,
            fileSize=file.stat().st_size,
        )
        video_db_id = prepared["videoDbId"]
        try:
            with file.open("rb") as handle:
                result = requests.put(
                    prepared["signedUrl"],
                    data=handle,
                    headers={
                        "Content-Type": "video/mp4",
                        "cache-control": "max-age=3600",
                        "x-upsert": "true",
                    },
                    timeout=300,
                )
            if not result.ok:
                raise RuntimeError(f"Storage HTTP {result.status_code}: {result.text[-500:]}")
            self.call("complete_video", videoDbId=video_db_id)
        except Exception as exc:
            try:
                self.call("video_failed", videoDbId=video_db_id, error=str(exc))
            except Exception:
                pass
            raise


class RepostApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.queue: queue.Queue[tuple[str, str]] = queue.Queue()
        self.cancel = threading.Event()
        self.running = False
        config = load_config()
        self.server_url = tk.StringVar(value=str(config.get("server_url") or "https://repost-studio.vercel.app"))
        self.access_key = tk.StringVar(value=str(config.get("access_key") or ""))
        self.auto_monitor = tk.BooleanVar(value=bool(config.get("auto_monitor", True)))
        self.profile = tk.StringVar(value="https://www.tiktok.com/@futuroinexplicavel")
        self.only_scan = tk.BooleanVar(value=False)
        self.status = tk.StringVar(value="Pronto.")

        root.title("Repost Studio V0.6 - Agente Local")
        root.geometry("900x760")
        root.minsize(700, 560)
        wrapper = ttk.Frame(root, padding=18)
        wrapper.pack(fill="both", expand=True)
        ttk.Label(wrapper, text="REPOST STUDIO | AGENTE LOCAL V0.6", font=("Segoe UI", 15, "bold")).pack(anchor="w")
        ttk.Label(wrapper, text="O painel online cria tarefas. Este agente abre o TikTok, baixa os MP4 e envia os arquivos para o Storage.", wraplength=840).pack(anchor="w", pady=(5, 14))

        cloud = ttk.LabelFrame(wrapper, text="Conexao com o painel online", padding=10)
        cloud.pack(fill="x", pady=(0, 12))
        ttk.Label(cloud, text="URL do Repost Studio").grid(row=0, column=0, sticky="w")
        ttk.Label(cloud, text="Chave de acesso").grid(row=0, column=1, sticky="w", padx=(10, 0))
        ttk.Entry(cloud, textvariable=self.server_url).grid(row=1, column=0, sticky="ew")
        ttk.Entry(cloud, textvariable=self.access_key, show="*").grid(row=1, column=1, sticky="ew", padx=(10, 0))
        cloud.columnconfigure(0, weight=2)
        cloud.columnconfigure(1, weight=1)
        actions = ttk.Frame(cloud)
        actions.grid(row=2, column=0, columnspan=2, sticky="ew", pady=(9, 0))
        ttk.Button(actions, text="Salvar conexao", command=self.save_connection).pack(side="left", padx=(0, 8))
        ttk.Button(actions, text="Processar fila online agora", command=self.start_online).pack(side="left", padx=(0, 8))
        ttk.Checkbutton(actions, text="Monitorar automaticamente a cada 15 s", variable=self.auto_monitor, command=self.save_connection).pack(side="left")

        manual = ttk.LabelFrame(wrapper, text="Teste/manual", padding=10)
        manual.pack(fill="x", pady=(0, 12))
        ttk.Label(manual, text="URL do perfil TikTok").pack(anchor="w")
        ttk.Entry(manual, textvariable=self.profile).pack(fill="x", pady=(4, 7))
        row = ttk.Frame(manual)
        row.pack(fill="x")
        ttk.Checkbutton(row, text="Somente catalogar URLs", variable=self.only_scan).pack(side="left")
        ttk.Button(row, text="Executar perfil manualmente", command=self.start_manual).pack(side="left", padx=(14, 8))
        ttk.Button(row, text="Parar", command=self.stop).pack(side="left", padx=(0, 8))
        ttk.Button(row, text="Abrir downloads", command=self.open_downloads).pack(side="left")

        ttk.Label(wrapper, textvariable=self.status).pack(anchor="w", pady=(0, 8))
        self.logbox = tk.Text(wrapper, height=22, wrap="word", state="disabled", font=("Consolas", 9))
        self.logbox.pack(fill="both", expand=True)
        ttk.Label(wrapper, text="Nenhuma chave secreta do Supabase fica neste programa. O upload usa autorizacoes temporarias geradas pela API.", wraplength=840).pack(anchor="w", pady=(9, 0))

        root.after(150, self.poll)
        root.after(3000, self.auto_poll)

    def log(self, value: str):
        self.queue.put(("log", value))

    def save_connection(self):
        save_config({"server_url": self.server_url.get().strip(), "access_key": self.access_key.get().strip(), "auto_monitor": self.auto_monitor.get()})
        self.status.set("Conexao salva localmente.")

    def client(self) -> OnlineClient:
        return OnlineClient(self.server_url.get(), self.access_key.get())

    def start_online(self):
        if self.running:
            return
        try:
            client = self.client()
        except ValueError as exc:
            messagebox.showerror("Configuracao", str(exc))
            return
        self.save_connection()
        self.cancel.clear()
        self.running = True
        self.status.set("Consultando fila online...")
        threading.Thread(target=self.work_online, args=(client,), daemon=True).start()

    def work_online(self, client: OnlineClient):
        try:
            response = client.call("next_job")
            job = response.get("job")
            profile = response.get("profile")
            if not job or not profile:
                self.queue.put(("finish", "Fila online vazia."))
                return
            job_id = job["id"]
            username = profile["username"]
            self.log(f"=== Tarefa online {job_id} | @{username} ===")
            counts = {"foundCount": 0, "newCount": 0, "downloadedCount": 0, "uploadedCount": 0, "errorCount": 0}
            client.progress(job_id, "waiting_user", "Navegador local aberto. Resolva CAPTCHA/idade se aparecer.", counts)
            manifest = load_manifest(username)
            before = len(manifest["videos"])
            try:
                new = scan_profile(username, manifest, self.log, self.cancel.is_set)
            except Exception as exc:
                self.log(f"Falha de varredura: {exc}")
                if not manifest["videos"]:
                    client.progress(job_id, "failed", f"Varredura falhou: {exc}", counts)
                    self.queue.put(("finish", "Tarefa online falhou na varredura."))
                    return
                new = 0
                self.log("Usando URLs preservadas no historico local.")
            counts["foundCount"] = len(manifest["videos"])
            counts["newCount"] = max(new, len(manifest["videos"]) - before)
            client.progress(job_id, "running", "Varredura concluida. Baixando e enviando MP4.", counts)

            total = len(manifest["videos"])
            for index, (video_id, item) in enumerate(manifest["videos"].items(), 1):
                if self.cancel.is_set():
                    client.progress(job_id, "partial", "Interrompido pelo usuario; progresso preservado.", counts)
                    self.queue.put(("finish", "Tarefa interrompida; progresso preservado."))
                    return
                self.log(f"[{index}/{total}] {video_id}: verificando download...")
                file = download_one(username, video_id, item, self.log)
                save_manifest(username, manifest)
                if not file:
                    counts["errorCount"] += 1
                    client.progress(job_id, "running", f"Falha ao baixar {video_id}.", counts)
                    continue
                counts["downloadedCount"] += 1
                try:
                    self.log(f"  Enviando {file.name} para o Storage...")
                    client.upload(job_id, username, video_id, item, file)
                    counts["uploadedCount"] += 1
                    item["online_status"] = "uploaded"
                    self.log("  Online: OK")
                except Exception as exc:
                    counts["errorCount"] += 1
                    item["online_status"] = "failed"
                    item["online_error"] = str(exc)
                    self.log(f"  Upload falhou: {exc}")
                save_manifest(username, manifest)
                client.progress(job_id, "running", f"Processando {index}/{total}.", counts)

            final_status = "completed" if counts["errorCount"] == 0 else "partial"
            final_message = f"Finalizado: {counts['uploadedCount']} online, {counts['errorCount']} falhas."
            client.progress(job_id, final_status, final_message, counts)
            self.queue.put(("finish", final_message))
        except Exception as exc:
            self.log(f"ERRO ONLINE: {exc}")
            self.queue.put(("finish", "Falha na conexao ou processamento online. Confira o log."))

    def start_manual(self):
        try:
            username = profile_name(self.profile.get())
        except ValueError as exc:
            messagebox.showerror("URL invalida", str(exc))
            return
        if self.running:
            return
        self.cancel.clear()
        self.running = True
        self.status.set(f"Executando @{username}...")
        threading.Thread(target=self.work_manual, args=(username, self.only_scan.get()), daemon=True).start()

    def work_manual(self, username: str, only_scan: bool):
        try:
            manifest = load_manifest(username)
            new = scan_profile(username, manifest, self.log, self.cancel.is_set)
            self.log(f"Varredura: {new} novos; {len(manifest['videos'])} no historico.")
            if not only_scan and not self.cancel.is_set():
                download_batch(username, manifest, self.log, self.cancel.is_set)
            self.queue.put(("finish", "Execucao manual finalizada."))
        except Exception as exc:
            self.log(f"ERRO: {exc}")
            self.queue.put(("finish", "Execucao manual encerrada com erro."))

    def stop(self):
        self.cancel.set()
        if self.running:
            self.log("Parada solicitada...")

    def open_downloads(self):
        DOWNLOADS.mkdir(parents=True, exist_ok=True)
        if os.name == "nt":
            os.startfile(str(DOWNLOADS))
        else:
            messagebox.showinfo("Downloads", str(DOWNLOADS))

    def auto_poll(self):
        if self.auto_monitor.get() and not self.running and self.access_key.get().strip():
            self.start_online()
        self.root.after(15000, self.auto_poll)

    def poll(self):
        try:
            while True:
                kind, message = self.queue.get_nowait()
                if kind == "log":
                    self.logbox.configure(state="normal")
                    self.logbox.insert("end", message + "\n")
                    self.logbox.see("end")
                    self.logbox.configure(state="disabled")
                elif kind == "finish":
                    self.status.set(message)
                    self.running = False
        except queue.Empty:
            pass
        self.root.after(150, self.poll)


def main() -> None:
    root = tk.Tk()
    RepostApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
