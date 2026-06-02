# Instala o comando "tars" globalmente (mesmo padrão do Kamui / Yume / Maestro)
# Cria shim em %USERPROFILE%\.local\bin\tars.cmd que chama start.cmd

$TarsDir   = Split-Path -Parent $PSScriptRoot
$BinTarget = Join-Path $env:USERPROFILE ".local\bin"

if (-not (Test-Path $BinTarget)) {
    New-Item -ItemType Directory -Path $BinTarget -Force | Out-Null
    Write-Host "Criado $BinTarget."
}

# Garante que está no PATH do usuário
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -split ";" -notcontains $BinTarget) {
    $newPath = if ($userPath) { "$userPath;$BinTarget" } else { $BinTarget }
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    $env:Path = "$env:Path;$BinTarget"
    Write-Host "PATH atualizado com $BinTarget."
} else {
    Write-Host "PATH já contém $BinTarget."
}

# Cria/atualiza o shim
$ShimPath = Join-Path $BinTarget "tars.cmd"
$StartCmd = Join-Path $TarsDir "start.cmd"

$content = @"
@echo off
call "$StartCmd" %*
exit /b %ERRORLEVEL%
"@

Set-Content -Path $ShimPath -Value $content -Encoding ASCII

Write-Host ""
Write-Host "Comando 'tars' instalado com sucesso!"
Write-Host "Teste em qualquer terminal (mesmo já aberto):"
Write-Host "  tars"
Write-Host "  tars -Force"
Write-Host "  tars -BackendOnly"
Write-Host "  tars start     (se você evoluir o start.cmd no futuro)"
