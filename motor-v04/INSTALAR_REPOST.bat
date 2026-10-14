@echo off
setlocal
cd /d "%~dp0"
echo Instalando bibliotecas gratuitas do Repost Studio V0.6...
py -m pip install -U "yt-dlp[default,curl-cffi]" playwright requests
if errorlevel 1 (
 echo ERRO: instalacao Python falhou.
 pause
 exit /b 1
)
echo.
echo Instalando navegador Chromium de reserva...
py -m playwright install chromium
if errorlevel 1 (
 echo Aviso: Chromium nao instalado. O programa tentara usar Microsoft Edge.
)
echo.
echo Instalacao concluida. Execute INICIAR_REPOST.bat
pause
