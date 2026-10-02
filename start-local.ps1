$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

$pythonCommands = @(
    (Get-Command python -All -ErrorAction SilentlyContinue),
    (Get-Command python3 -All -ErrorAction SilentlyContinue),
    (Get-Command py -All -ErrorAction SilentlyContinue)
) | Where-Object { $_ } | Where-Object { $_.CommandType -eq 'Application' -and $_.Source -notmatch 'WindowsApps' }

$pythonCommand = $pythonCommands | Select-Object -First 1 -ExpandProperty Source

if (-not $pythonCommand) {
    Write-Host 'No se encontro una instalacion funcional de Python en este equipo.' -ForegroundColor Yellow
    Write-Host 'Instala Python desde python.org o desde Microsoft Store y vuelve a ejecutar este script.' -ForegroundColor Yellow
    Write-Host 'Luego ejecuta: python -m http.server 8000' -ForegroundColor Cyan
    exit 1
}

Write-Host "Sirviendo el proyecto en http://localhost:8000" -ForegroundColor Green
& $pythonCommand -m http.server 8000
