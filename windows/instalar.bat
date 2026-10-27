@echo off
setlocal
title CholloGarde - instalacion
cd /d "%~dp0..\backend"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  No encuentro Node.js. Instala la version LTS desde https://nodejs.org/es
  echo  y vuelve a ejecutar este archivo.
  start "" https://nodejs.org/es
  pause
  exit /b 1
)
for /f "tokens=1 delims=v." %%v in ('node -v') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 20 (
  echo  Tu Node.js es demasiado antiguo. Necesitas la version 20 o superior: https://nodejs.org/es
  pause
  exit /b 1
)

echo  Instalando dependencias...
call npm install --omit=dev --no-audit --no-fund
if errorlevel 1 (
  echo  Fallo npm install. Revisa tu conexion e intentalo de nuevo.
  pause
  exit /b 1
)
if not exist .env copy .env.example .env >nul

echo  Configurando el arranque automatico al encender el PC...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0autoarranque.ps1"

echo  Arrancando CholloGarde en segundo plano...
wscript.exe "%~dp0iniciar-oculto.vbs"
timeout /t 4 /nobreak >nul
start "" http://localhost:8787/

echo.
echo  Listo. CholloGarde se abrira solo cada vez que enciendas el PC.
echo  Panel: http://localhost:8787  (tienes un acceso directo en el escritorio)
echo  Configura Telegram, Discord y correo en la seccion Notificaciones del panel.
pause
