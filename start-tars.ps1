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

function Get-ListenPid([int]$Port) {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) { return $conn.OwningProcess }
    return $null
}

function Test-BackendHealth {
    try {
        $r = Invoke-RestMethod "http://127.0.0.1:$BackendPort/api/tars/health" -TimeoutSec 2
        if ($r.ok) { return $r }
    } catch { }
    return $null
}

function Test-DashboardHealth {
    try {
        $resp = Invoke-WebRequest $DashboardUrl -TimeoutSec 2 -UseBasicParsing
        if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) { return $true }
    } catch { }
    return $false
}

function Show-LogTail([string]$Path, [int]$Lines = 60) {
    if (-not (Test-Path $Path)) { return }
    Write-Host "  log: $Path" -ForegroundColor DarkGray
    Get-Content $Path -Tail $Lines | ForEach-Object {
        Write-Host "    $_" -ForegroundColor DarkGray
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

$BackendOut = Join-Path $Logs 'backend.out.log'
$BackendErr = Join-Path $Logs 'backend.err.log'
$backendPid = $null
$r = if (-not $Force) { Test-BackendHealth } else { $null }

if ($r) {
    $backendPid = Get-ListenPid $BackendPort
    Write-Host "  backend ja estava OK (PID $backendPid, persona=$($r.persona), modelo=$($r.model), llm_ready=$($r.llm_ready))" -ForegroundColor Green
} else {
    Remove-Item $BackendOut, $BackendErr -ErrorAction SilentlyContinue

    $be = Start-Process `
        -FilePath $Python `
        -ArgumentList 'server.py' `
        -WorkingDirectory $Backend `
        -WindowStyle Hidden `
        -RedirectStandardOutput $BackendOut `
        -RedirectStandardError $BackendErr `
        -PassThru

    $backendPid = $be.Id

    # espera o health responder
    $ok = $false
    for ($i = 0; $i -lt 80; $i++) {
        Start-Sleep -Milliseconds 500
        $r = Test-BackendHealth
        if ($r) { $ok = $true; break }
        $be.Refresh()
        if ($be.HasExited) { break }
    }
    if ($ok) {
        $backendPid = Get-ListenPid $BackendPort
        Write-Host "  backend OK (PID $backendPid, persona=$($r.persona), modelo=$($r.model), llm_ready=$($r.llm_ready))" -ForegroundColor Green
    } else {
        $be.Refresh()
        if ($be.HasExited) {
            Write-Host "  backend saiu antes de responder (PID $($be.Id), exit=$($be.ExitCode))." -ForegroundColor Red
        } else {
            Write-Host "  backend NAO respondeu - confira a porta $BackendPort (use -Force pra liberar)." -ForegroundColor Red
        }
        Show-LogTail $BackendErr
        Show-LogTail $BackendOut 30
        exit 1
    }
}

if ($BackendOnly) {
    Write-Host "`nBackend rodando (PID $backendPid). Health: http://127.0.0.1:$BackendPort/api/tars/health"
    return
}

# ---- dashboard -----------------------------------------------------------
if (-not (Test-Path (Join-Path $Dashboard 'node_modules'))) {
    Write-Host "Instalando deps do dashboard (npm install)..." -ForegroundColor Cyan
    Push-Location $Dashboard; npm install --no-audit --no-fund; Pop-Location
}

$DashboardOut = Join-Path $Logs 'dashboard.out.log'
$DashboardErr = Join-Path $Logs 'dashboard.err.log'
$dashboardPid = $null
$dashboardOk = if (-not $Force) { Test-DashboardHealth } else { $false }

if ($dashboardOk) {
    $dashboardPid = Get-ListenPid $DashboardPort
    Write-Host "  dashboard ja estava OK em $DashboardUrl (PID $dashboardPid)" -ForegroundColor Green
} else {
    Write-Host "Subindo dashboard em http://127.0.0.1:$DashboardPort ..." -ForegroundColor Cyan
    Remove-Item $DashboardOut, $DashboardErr -ErrorAction SilentlyContinue

    $fe = Start-Process `
        -FilePath 'cmd.exe' `
        -ArgumentList '/d', '/s', '/c', 'npm run dev' `
        -WorkingDirectory $Dashboard `
        -WindowStyle Hidden `
        -RedirectStandardOutput $DashboardOut `
        -RedirectStandardError $DashboardErr `
        -PassThru

    $dashboardPid = $fe.Id
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-DashboardHealth) { $dashboardOk = $true; break }
        $fe.Refresh()
        if ($fe.HasExited) { break }
    }
    if ($dashboardOk) {
        $dashboardPid = Get-ListenPid $DashboardPort
    }
}

if ($dashboardOk -and -not (Test-AutoBrowserDisabled)) {
    Start-Process $DashboardUrl
} elseif ($dashboardOk) {
    Write-Host "  browser automatico desativado; dashboard disponivel em $DashboardUrl" -ForegroundColor DarkGray
} else {
    Write-Host "  dashboard NAO respondeu em $DashboardUrl - confira o processo npm/vite (PID $dashboardPid)." -ForegroundColor Red
    Show-LogTail $DashboardErr
    Show-LogTail $DashboardOut 30
    exit 1
}

Write-Host "`nTARS no ar:" -ForegroundColor Green
Write-Host "  backend   : http://127.0.0.1:$BackendPort/api/tars/health  (PID $backendPid)"
Write-Host "  dashboard : $DashboardUrl  (PID $dashboardPid)"
Write-Host "`nPara parar: .\stop-tars.ps1" -ForegroundColor DarkGray
