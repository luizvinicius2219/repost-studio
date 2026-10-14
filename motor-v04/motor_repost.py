"""Repost Studio V0.4 (motor local experimental).

Fluxo: URL de perfil TikTok -> links publicamente visiveis no navegador ->
URLs persistidas -> downloads MP4 em lote via yt-dlp.

Requer Playwright (navegador visivel) e yt-dlp. Nao acessa perfis privados.
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

BASE = Path(__file__).resolve().parent
DATA = BASE / 'dados'
DOWNLOADS = BASE / 'downloads'
BROWSER_DIR = DATA / 'navegador'
PROFILE_RE = re.compile(r'^/@([A-Za-z0-9._]{2,30})/?$')
VIDEO_RE = re.compile(r'^/@([A-Za-z0-9._]{2,30})/video/(\d{10,25})/?$')
PREFERRED_FORMAT = 'best[ext=mp4][format_id!=download]/best[ext=mp4]/best'


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def profile_name(raw: str) -> str:
    """Somente URLs HTTPS de perfil TikTok; nao seguir URL arbitraria."""
    raw = raw.strip()
    parts = urlsplit(raw)
    if parts.scheme != 'https' or (parts.hostname or '').lower() not in ('www.tiktok.com', 'tiktok.com', 'm.tiktok.com'):
        raise ValueError('Cole uma URL HTTPS do TikTok, como https://www.tiktok.com/@usuario')
    match = PROFILE_RE.fullmatch(parts.path)
    if not match:
        raise ValueError('A URL deve ser de um perfil, e nao de um video individual.')
    username = match.group(1)
    if username.startswith('.') or username.endswith('.') or '..' in username:
        raise ValueError('Nome de perfil invalido.')
    return username


def canonical_video(raw: str, username: str) -> tuple[str, str] | None:
    try:
        parts = urlsplit(raw)
    except ValueError:
        return None
    if parts.scheme != 'https' or (parts.hostname or '').lower() not in ('www.tiktok.com', 'tiktok.com', 'm.tiktok.com'):
        return None
    match = VIDEO_RE.fullmatch(parts.path)
    if not match or match.group(1).lower() != username.lower():
        return None
    video_id = match.group(2)
    return video_id, f'https://www.tiktok.com/@{username}/video/{video_id}'


def store_paths(username: str) -> tuple[Path, Path]:
    folder = DATA / username.lower()
    return folder / 'videos.json', folder / 'urls.txt'


def load_manifest(username: str) -> dict:
    manifest_path, _ = store_paths(username)
    if manifest_path.exists():
        try:
            value = json.loads(manifest_path.read_text(encoding='utf-8'))
            if isinstance(value, dict) and isinstance(value.get('videos'), dict):
                return value
        except (OSError, ValueError):
            raise RuntimeError(f'O historico esta corrompido: {manifest_path}. Faca uma copia antes de corrigir.')
    return {'username': username, 'created_at': utc_now(), 'videos': {}}


def save_manifest(username: str, manifest: dict) -> None:
    path, urls_path = store_paths(username)
    path.parent.mkdir(parents=True, exist_ok=True)
    manifest['updated_at'] = utc_now()
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    os.replace(temporary, path)
    urls_path.write_text('\n'.join(item['url'] for item in manifest['videos'].values()) + '\n', encoding='utf-8')


def add_links(username: str, manifest: dict, links: dict[str, str]) -> int:
    created = 0
    for video_id, url in links.items():
        if video_id not in manifest['videos']:
            manifest['videos'][video_id] = {'url': url, 'discovered_at': utc_now(), 'status': 'discovered', 'attempts': 0}
            created += 1
    if created:
        save_manifest(username, manifest)
    return created


def links_on_page(page, username: str) -> dict[str, str]:
    # Coleta SOMENTE links publicos exibidos no DOM; nao tenta acessar privados.
    anchors = page.eval_on_selector_all(
        'a[href*="/video/"]',
        '(elements) => elements.map(el => el.href)',
    )
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
        raise RuntimeError('Playwright nao instalado. Execute INSTALAR_REPOST.bat.') from exc

    BROWSER_DIR.mkdir(parents=True, exist_ok=True)
    url = f'https://www.tiktok.com/@{username}'
    added_total = 0
    with sync_playwright() as playwright:
        # MS Edge vem instalado na maioria dos computadores Windows.
        # O Chromium do Playwright e o fallback quando o Edge nao estiver disponivel.
        try:
            context = playwright.chromium.launch_persistent_context(
                str(BROWSER_DIR), channel='msedge', headless=False, viewport={'width': 1360, 'height': 850},
            )
        except Exception as edge_error:
            log(f'Edge nao disponivel ({type(edge_error).__name__}); tentando Chromium...')
            context = playwright.chromium.launch_persistent_context(
                str(BROWSER_DIR), headless=False, viewport={'width': 1360, 'height': 850},
            )
        try:
            page = context.pages[0] if context.pages else context.new_page()
            log('Abrindo perfil no navegador. Se aparecer verificacao/login, resolva no navegador aberto.')
            page.goto(url, wait_until='domcontentloaded', timeout=45000)
            page.wait_for_timeout(2000)
            # Janela para a pessoa concluir uma verificacao normal do site.
            # Nao procura nem contorna cookies, captchas ou conteudos privados.
            for attempt in range(30):
                if is_cancelled():
                    break
                found = links_on_page(page, username)
                count = add_links(username, manifest, found)
                added_total += count
                if found:
                    break
                if attempt == 0:
                    log('Aguardando miniaturas publicas aparecerem (ate 45 s).')
                page.wait_for_timeout(1500)
            if not manifest['videos']:
                log('Nenhum link encontrado. O site pode exigir acesso manual ou limitar a automacao.')
                return added_total

            log(f'Links salvos: {len(manifest["videos"])}. Percorrendo a grade de videos...')
            stagnant = 0
            scroll_number = 0
            while not is_cancelled() and (max_scrolls == 0 or scroll_number < max_scrolls) and stagnant < 10:
                try:
                    page.mouse.wheel(0, 1550)
                    page.wait_for_timeout(1650)
                    found = links_on_page(page, username)
                except Exception as exc:
                    log(f'Falha de leitura do navegador: {exc}')
                    break
                new = add_links(username, manifest, found)
                added_total += new
                stagnant = 0 if new else stagnant + 1
                scroll_number += 1
                if new and (scroll_number < 3 or scroll_number % 5 == 0):
                    log(f'Rolagem {scroll_number}: +{new} videos | {len(manifest["videos"])} catalogados')
            if is_cancelled():
                log('Coleta interrompida pelo usuario; links ja salvos foram preservados.')
            elif stagnant >= 10:
                log('Sem novos videos em 10 rolagens. A lista pode estar incompleta se o TikTok limitar o carregamento.')
            elif max_scrolls:
                log(f'Limite configurado de {max_scrolls} rolagens atingido. Reinicie para continuar a verificacao.')
        finally:
            context.close()
    return added_total


def downloaded_file(username: str, video_id: str) -> Path | None:
    folder = DOWNLOADS / username.lower()
    for file in folder.glob(f'{video_id}.*'):
        if file.is_file() and file.suffix.lower() in ('.mp4', '.mkv', '.webm', '.mov') and file.stat().st_size > 0:
            return file
    return None


def download_batch(username: str, manifest: dict, log, is_cancelled) -> tuple[int, int]:
    folder = DOWNLOADS / username.lower()
    folder.mkdir(parents=True, exist_ok=True)
    total = len(manifest['videos'])
    successes = failures = 0
    log(f'Iniciando downloads de {total} links cadastrados. Arquivos existentes serao ignorados.')
    for index, (video_id, item) in enumerate(manifest['videos'].items(), 1):
        if is_cancelled():
            log('Download interrompido; use o mesmo perfil depois para retomar.')
            break
        saved = downloaded_file(username, video_id)
        if saved:
            item.update(status='downloaded', file=str(saved), last_error='')
            successes += 1
            continue
        log(f'[{index}/{total}] Baixando {video_id}...')
        command = [
            sys.executable, '-m', 'yt_dlp',
            '--no-playlist', '--no-overwrites', '--continue',
            '--retries', '2', '--fragment-retries', '2',
            '--socket-timeout', '20', '--sleep-requests', '1',
            '-f', PREFERRED_FORMAT,
            '-P', str(folder), '-o', '%(id)s.%(ext)s',
            '--no-progress', '--newline', item['url'],
        ]
        item['attempts'] = int(item.get('attempts', 0)) + 1
        try:
            result = subprocess.run(command, capture_output=True, text=True, errors='replace', timeout=240)
            saved = downloaded_file(username, video_id)
            if result.returncode == 0 and saved:
                item.update(status='downloaded', file=str(saved), last_error='')
                successes += 1
                log(f'  OK: {saved.name}')
            else:
                error = (result.stderr or result.stdout or f'yt-dlp terminou com codigo {result.returncode}').strip()[-650:]
                item.update(status='failed', last_error=error)
                failures += 1
                log(f'  Falhou: {error}')
        except subprocess.TimeoutExpired:
            item.update(status='failed', last_error='Tempo limite de 240 segundos excedido.')
            failures += 1
            log('  Falhou: o download ultrapassou 240 segundos.')
        except Exception as exc:
            item.update(status='failed', last_error=str(exc))
            failures += 1
            log(f'  Falhou: {exc}')
        save_manifest(username, manifest)
    log(f'Concluido: {successes} arquivos existentes/baixados, {failures} falhas. Pasta: {folder}')
    return successes, failures


class RepostApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.queue: queue.Queue[tuple[str, str]] = queue.Queue()
        self.cancel = threading.Event()
        self.running = False
        self.profile = tk.StringVar(value='https://www.tiktok.com/@futuroinexplicavel')
        self.only_scan = tk.BooleanVar(value=False)
        self.status = tk.StringVar(value='Pronto para iniciar.')
        root.title('Repost Studio V0.4 - Baixar perfil TikTok')
        root.geometry('800x620')
        root.minsize(640, 480)
        wrapper = ttk.Frame(root, padding=18)
        wrapper.pack(fill='both', expand=True)
        ttk.Label(wrapper, text='REPOST STUDIO | MOTOR LOCAL V0.4', font=('Segoe UI', 15, 'bold')).pack(anchor='w')
        ttk.Label(wrapper, text='Cole uma URL de perfil publico. O programa encontra links e baixa os arquivos acessiveis.', wraplength=740).pack(anchor='w', pady=(5, 15))
        ttk.Label(wrapper, text='URL do perfil TikTok:').pack(anchor='w')
        entry = ttk.Entry(wrapper, textvariable=self.profile, font=('Segoe UI', 11))
        entry.pack(fill='x', pady=(4, 10))
        entry.focus_set()
        options = ttk.Frame(wrapper)
        options.pack(fill='x')
        ttk.Checkbutton(options, text='Somente catalogar URLs (sem baixar)', variable=self.only_scan).pack(side='left')
        buttons = ttk.Frame(wrapper)
        buttons.pack(fill='x', pady=(13, 7))
        self.start_btn = ttk.Button(buttons, text='Iniciar varredura + downloads', command=self.start)
        self.start_btn.pack(side='left', padx=(0, 9))
        ttk.Button(buttons, text='Parar apos a etapa atual', command=self.stop).pack(side='left', padx=(0, 9))
        ttk.Button(buttons, text='Abrir pasta de downloads', command=self.open_downloads).pack(side='left')
        ttk.Label(wrapper, textvariable=self.status).pack(anchor='w', pady=(8, 9))
        self.logbox = tk.Text(wrapper, height=18, wrap='word', state='disabled', font=('Consolas', 9))
        self.logbox.pack(fill='both', expand=True)
        ttk.Label(
            wrapper,
            text='Usa navegador Edge/Chromium e yt-dlp. Sem servicos pagos. Nem todos os perfis/videos podem ser acessados; sem garantia de ausencia de marca-d\'agua.',
            wraplength=740,
        ).pack(anchor='w', pady=(10, 0))
        root.after(150, self.poll)

    def log(self, value: str):
        self.queue.put(('log', value))

    def start(self):
        try:
            username = profile_name(self.profile.get())
        except ValueError as exc:
            messagebox.showerror('URL invalida', str(exc))
            return
        if self.running:
            return
        self.cancel.clear()
        self.running = True
        self.start_btn.configure(state='disabled')
        self.status.set(f'Executando varredura de @{username}...')
        self.log(f'=== {utc_now()} | @{username} ===')
        worker = threading.Thread(target=self.work, args=(username, self.only_scan.get()), daemon=True)
        worker.start()

    def work(self, username: str, only_scan: bool):
        try:
            manifest = load_manifest(username)
            already = len(manifest['videos'])
            self.log(f'Historico anterior: {already} videos catalogados.')
            try:
                new = scan_profile(username, manifest, self.log, self.cancel.is_set)
                self.log(f'Varredura finalizada: {new} novos; {len(manifest["videos"])} URLs no historico.')
            except Exception as scan_error:
                self.log(f'Nao foi possivel completar a varredura: {scan_error}')
                if not manifest['videos']:
                    raise RuntimeError('Nenhum video disponivel para baixar. Verifique o perfil no navegador.') from scan_error
                self.log('Usando o historico salvo para continuar os downloads.')
            if not only_scan and not self.cancel.is_set() and manifest['videos']:
                download_batch(username, manifest, self.log, self.cancel.is_set)
            if only_scan:
                self.log('Modo somente catalogacao selecionado: nenhum download realizado.')
            self.queue.put(('finish', f'Finalizado. {len(manifest["videos"])} URLs registradas.'))
        except Exception as exc:
            self.log(f'ERRO: {exc}')
            self.queue.put(('finish', 'Execucao encerrada com erro. Confira o registro.'))

    def stop(self):
        self.cancel.set()
        if self.running:
            self.log('Parada solicitada; encerrando apos a etapa atual...')

    def open_downloads(self):
        DOWNLOADS.mkdir(parents=True, exist_ok=True)
        if os.name == 'nt':
            os.startfile(str(DOWNLOADS))
        else:
            messagebox.showinfo('Downloads', str(DOWNLOADS))

    def poll(self):
        try:
            while True:
                kind, message = self.queue.get_nowait()
                if kind == 'log':
                    self.logbox.configure(state='normal')
                    self.logbox.insert('end', message + '\n')
                    self.logbox.see('end')
                    self.logbox.configure(state='disabled')
                if kind == 'finish':
                    self.status.set(message)
                    self.start_btn.configure(state='normal')
                    self.running = False
        except queue.Empty:
            pass
        self.root.after(150, self.poll)


def main() -> None:
    root = tk.Tk()
    RepostApp(root)
    root.mainloop()


if __name__ == '__main__':
    main()
