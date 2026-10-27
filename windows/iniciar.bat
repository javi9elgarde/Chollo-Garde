@echo off
title CholloGarde - servidor
cd /d "%~dp0..\backend"
echo  CholloGarde en http://localhost:8787  (cierra esta ventana para pararlo)
set OPEN_BROWSER=1
node src\index.js
pause
