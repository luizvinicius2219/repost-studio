@echo off
cd /d "%~dp0"
py motor_repost.py
if errorlevel 1 (
 echo.
 echo O programa nao iniciou. Execute INSTALAR_REPOST.bat.
 pause
)
