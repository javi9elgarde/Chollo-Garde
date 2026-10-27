# Crea (o quita con -Quitar) el arranque automatico de CholloGarde y el acceso directo del escritorio.
param([switch]$Quitar)

$startup = [Environment]::GetFolderPath('Startup')
$lnk = Join-Path $startup 'CholloGarde.lnk'
$url = Join-Path ([Environment]::GetFolderPath('Desktop')) 'CholloGarde.url'

if ($Quitar) {
  Remove-Item $lnk, $url -ErrorAction SilentlyContinue
  Write-Host ' Arranque automatico y acceso directo quitados.'
  exit 0
}

$vbs = Join-Path $PSScriptRoot 'iniciar-oculto.vbs'
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($lnk)
$s.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$s.Arguments = '"' + $vbs + '"'
$s.WorkingDirectory = $PSScriptRoot
$s.Description = 'CholloGarde: rastreador de precios'
$s.Save()

Set-Content -Path $url -Value "[InternetShortcut]`r`nURL=http://localhost:8787/" -Encoding ASCII
Write-Host ' Arranque automatico configurado (carpeta Inicio de Windows).'
