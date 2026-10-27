@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0autoarranque.ps1" -Quitar
call "%~dp0parar.bat"
