# start-tars.ps1 — sobe o TARS completo (backend 62026 + dashboard 62025).
#
#   Uso:  .\start-tars.ps1            # sobe backend e dashboard
#         .\start-tars.ps1 -BackendOnly
#         .\start-tars.ps1 -Force     # libera as portas antes de subir
#
# Backend  : FastAPI (Python venv) em http://127.0.0.1:62026  -> /api/tars/*
# Dashboard: Vite (React) em http://localhost:62025 (proxy /api -> backend)

param(
    [switch]$BackendOnly,
    [switch]$Force,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$Root      = $PSScriptRoot
$Backend   = Join-Path $Root 'backend'
$Dashboard = Join-Path $Root 'dashboard'
$Logs      = Join-Path $Root 'logs'
$Python    = Join-Path $Backend '.venv\Scripts\python.exe'
$BackendPort   = 62026
$DashboardPort = 62025
$DashboardUrl  = "http://127.0.0.1:$DashboardPort/"

New-Item -ItemType Directory -Force -Path $Logs | Out-Null

function Free-Port([int]$Port) {
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        Write-Host "  liberando porta $Port (PID $($c.OwningProcess))..." -ForegroundColor Yellow
        # /T derruba a árvore (cobre supervisores tipo 'tsx watch')
        taskkill /F /T /PID $c.OwningProcess 2>$null | Out-Null
    }
}

function Test-AutoBrowserDisabled {
    if ($NoBrowser) { return $true }

    $falseValues = @("0", "false", "no", "off")
    $trueValues = @("1", "true", "yes", "on")
    $browser = ([string][Environment]::GetEnvironmentVariable("BROWSER")).Trim().ToLowerInvariant()
    $terminaldeSuppress = ([string][Environment]::GetEnvironmentVariable("TERMINALDE_SUPPRESS_BROWSER")).Trim().ToLowerInvariant()
    $noBrowser = ([string][Environment]::GetEnvironmentVariable("NO_BROWSER")).Trim().ToLowerInvariant()
    $disableOpenBrowser = ([string][Environment]::GetEnvironmentVariable("DISABLE_OPEN_BROWSER")).Trim().ToLowerInvariant()
    $openBrowser = ([string][Environment]::GetEnvironmentVariable("OPEN_BROWSER")).Trim().ToLowerInvariant()
    $launchBrowser = ([string][Environment]::GetEnvironmentVariable("LAUNCH_BROWSER")).Trim().ToLowerInvariant()
    $autoOpenBrowser = ([string][Environment]::GetEnvironmentVariable("AUTO_OPEN_BROWSER")).Trim().ToLowerInvariant()

    if ($browser -eq "none") { return $true }
    if ($terminaldeSuppress -and -not ($falseValues.Contains($terminaldeSuppress))) { return $true }
    if ($noBrowser -and -not ($falseValues.Contains($noBrowser))) { return $true }
    if ($disableOpenBrowser -and -not ($falseValues.Contains($disableOpenBrowser))) { return $true }
    if ($openBrowser -and -not ($trueValues.Contains($openBrowser))) { return $true }
    if ($launchBrowser -and -not ($trueValues.Contains($launchBrowser))) { return $true }
    if ($autoOpenBrowser -and -not ($trueValues.Contains($autoOpenBrowser))) { return $true }

    return $false
}

# ---- venv + deps ---------------------------------------------------------
if (-not (Test-Path $Python)) {
    Write-Host "Criando venv do backend..." -ForegroundColor Cyan
    python -m venv (Join-Path $Backend '.venv')
    & $Python -m pip install --quiet --upgrade pip
    & $Python -m pip install --quiet -r (Join-Path $Backend 'requirements.txt')
}

if ($Force) {
    Free-Port $BackendPort
    if (-not $BackendOnly) { Free-Port $DashboardPort }
    Start-Sleep -Milliseconds 800
}

# ---- backend -------------------------------------------------------------
Write-Host "Subindo backend TARS em http://127.0.0.1:$BackendPort ..." -ForegroundColor Cyan

# Usando .NET diretamente para esconder completamente a janela do console (compatível com todas versões de PS)
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $Python
$psi.Arguments = "server.py"
$psi.WorkingDirectory = $Backend
$psi.CreateNoWindow = $true
$psi.UseShellExecute = $false
$be = [System.Diagnostics.Process]::Start($psi)

# espera o health responder
$ok = $false
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        $r = Invoke-RestMethod "http://127.0.0.1:$BackendPort/api/tars/health" -TimeoutSec 2
        if ($r.ok) { $ok = $true; break }
    } catch { }
}
if ($ok) {
    Write-Host "  backend OK (persona=$($r.persona), modelo=$($r.model), llm_ready=$($r.llm_ready))" -ForegroundColor Green
} else {
    Write-Host "  backend NAO respondeu - confira a porta $BackendPort (use -Force pra liberar)." -ForegroundColor Red
}

if ($BackendOnly) {
    Write-Host "`nBackend rodando (PID $($be.Id)). Health: http://127.0.0.1:$BackendPort/api/tars/health"
    return
}

# ---- dashboard -----------------------------------------------------------
if (-not (Test-Path (Join-Path $Dashboard 'node_modules'))) {
    Write-Host "Instalando deps do dashboard (npm install)..." -ForegroundColor Cyan
    Push-Location $Dashboard; npm install --no-audit --no-fund; Pop-Location
}

Write-Host "Subindo dashboard em http://127.0.0.1:$DashboardPort ..." -ForegroundColor Cyan

$DashboardOut = Join-Path $Logs 'dashboard.out.log'
$DashboardErr = Join-Path $Logs 'dashboard.err.log'
Remove-Item $DashboardOut, $DashboardErr -ErrorAction SilentlyContinue

$fe = Start-Process `
    -FilePath 'cmd.exe' `
    -ArgumentList '/d', '/s', '/c', 'npm run dev' `
    -WorkingDirectory $Dashboard `
    -WindowStyle Hidden `
    -RedirectStandardOutput $DashboardOut `
    -RedirectStandardError $DashboardErr `
    -PassThru

$dashboardOk = $false
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        $resp = Invoke-WebRequest $DashboardUrl -TimeoutSec 2 -UseBasicParsing
        if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) { $dashboardOk = $true; break }
    } catch { }
}

if ($dashboardOk -and -not (Test-AutoBrowserDisabled)) {
    Start-Process $DashboardUrl
} elseif ($dashboardOk) {
    Write-Host "  browser automatico desativado; dashboard disponivel em $DashboardUrl" -ForegroundColor DarkGray
} else {
    Write-Host "  dashboard NAO respondeu em $DashboardUrl - confira o processo npm/vite (PID $($fe.Id))." -ForegroundColor Red
    Write-Host "  logs: $DashboardOut / $DashboardErr" -ForegroundColor DarkGray
}

Write-Host "`nTARS no ar:" -ForegroundColor Green
Write-Host "  backend   : http://127.0.0.1:$BackendPort/api/tars/health  (PID $($be.Id))"
Write-Host "  dashboard : $DashboardUrl  (PID $($fe.Id))"
Write-Host "`nPara parar: .\stop-tars.ps1" -ForegroundColor DarkGray
