# Node.js PATH duzeltici - install.ps1 oncesi calistir
# Kullanim: powershell -ExecutionPolicy Bypass -File fix-path.ps1

Write-Host ""
Write-Host "  Node.js PATH duzeltici" -ForegroundColor Cyan
Write-Host ""

# Olasi Node.js yollari
$nodePaths = @(
    "$env:ProgramFiles\nodejs",
    "$env:ProgramFiles(x86)\nodejs",
    "$env:APPDATA\npm",
    "$env:LOCALAPPDATA\Programs\nodejs"
)

$added = @()
foreach ($p in $nodePaths) {
    if ((Test-Path $p) -and ($env:Path -notlike "*$p*")) {
        $env:Path += ";$p"
        $added += $p
        Write-Host "  + PATH'e eklendi: $p" -ForegroundColor Green
    }
}

# Kontrol
try {
    $v = & node --version 2>$null
    Write-Host ""
    Write-Host "  Node.js bulundu: $v" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Simdi install.ps1 calistiriliyor..." -ForegroundColor Cyan
    Write-Host ""
    & "$PSScriptRoot\install.ps1"
} catch {
    Write-Host ""
    Write-Host "  Node.js hala bulunamadi." -ForegroundColor Red
    Write-Host "  https://nodejs.org adresinden indirip kurun," -ForegroundColor Yellow
    Write-Host "  sonra bilgisayari yeniden baslatip tekrar deneyin." -ForegroundColor Yellow
    Write-Host ""
    Start-Process "https://nodejs.org/en/download/"
    Read-Host "Cikmak icin Enter"
}
