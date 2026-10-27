@echo off
rem Para el servidor de CholloGarde que esta escuchando en el puerto 8787.
set FOUND=
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8787 " ^| findstr LISTENING') do (
  taskkill /PID %%p /F >nul
  set FOUND=1
)
if defined FOUND (echo  CholloGarde parado.) else (echo  CholloGarde no estaba en marcha.)
timeout /t 3 >nul
