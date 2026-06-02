# stop-tars.ps1 — derruba o TARS (backend 62026 + dashboard 62025).
foreach ($Port in 62028, 62030) {
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $conns) { Write-Host "porta $Port já livre" -ForegroundColor DarkGray; continue }
    foreach ($c in $conns) {
        Write-Host "parando porta $Port (PID $($c.OwningProcess))..." -ForegroundColor Yellow
        taskkill /F /T /PID $c.OwningProcess 2>$null | Out-Null
    }
}
Write-Host "TARS parado." -ForegroundColor Green
