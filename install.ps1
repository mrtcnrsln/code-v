# CodeV v2 - Windows Installer
# Kullanim: powershell -ExecutionPolicy Bypass -File install.ps1

param(
    [string]$Workspace = "",
    [int]$Port = 3030
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Workspace) { $Workspace = $ScriptDir }
$LogFile = Join-Path $ScriptDir "codev-install.log"
$MinNode = 18

function WInfo  { param($m) Write-Host "  > $m" -ForegroundColor Cyan }
function WOk    { param($m) Write-Host "  v $m" -ForegroundColor Green }
function WWarn  { param($m) Write-Host "  ! $m" -ForegroundColor Yellow }
function WErr   { param($m) Write-Host "  x $m" -ForegroundColor Red }
function WStep  { param($m) Write-Host "`n  ===  $m  ===" -ForegroundColor White }
function WLog   { param($m) Add-Content $LogFile "[$([datetime]::Now.ToString('HH:mm:ss'))] $m" }

function Show-Header {
    Clear-Host
    Write-Host ""
    Write-Host "  +--------------------------------------------+" -ForegroundColor Green
    Write-Host "  |   CodeV v2 -- Collaborative Editor         |" -ForegroundColor Green
    Write-Host "  |   One-Click Installer & Launcher           |" -ForegroundColor Green
    Write-Host "  +--------------------------------------------+" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Log: $LogFile" -ForegroundColor DarkGray
    Write-Host ""
}

function Get-NodeMajor {
    try {
        $v = & node --version 2>$null
        if ($v -match 'v(\d+)') { return [int]$Matches[1] }
    } catch {}
    return 0
}

function Refresh-Path {
    $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machinePath;$userPath"
}

function Install-Node {
    WInfo "Node.js $MinNode kuruluyor..."

    # winget dene
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        try {
            WInfo "winget ile kuruluyor..."
            $result = winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements 2>&1
            $result | Out-File $LogFile -Append
            Refresh-Path
            if ((Get-NodeMajor) -ge $MinNode) {
                return $true
            }
        } catch {
            WLog "winget failed: $_"
        }
    }

    # MSI ile kur
    WWarn "MSI ile kurulum deneniyor..."
    $msi = Join-Path $env:TEMP "node-installer.msi"
    $url = "https://nodejs.org/dist/v${MinNode}.19.0/node-v${MinNode}.19.0-x64.msi"
    try {
        WInfo "Indiriliyor: $url"
        Invoke-WebRequest $url -OutFile $msi -UseBasicParsing
        WInfo "Kuruluyor (yonetici izni gerekebilir)..."
        Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /quiet /norestart" -Wait -Verb RunAs
        Refresh-Path
        Remove-Item $msi -Force -ErrorAction SilentlyContinue
        return $true
    } catch {
        WLog "MSI failed: $_"
        return $false
    }
}

# ---- Basla ----
Show-Header
"" | Out-File $LogFile
WLog "CodeV installer started"
WLog "Workspace: $Workspace | Port: $Port"

Set-Location $ScriptDir

# Adim 1: Node.js
WStep "1/3  Node.js Kontrolu"

Refresh-Path
$ver = Get-NodeMajor

if ($ver -ge $MinNode) {
    WOk "Node.js v$ver mevcut"
} else {
    if ($ver -gt 0) {
        WWarn "Node.js v$ver eski (v$MinNode+ gerekli) - guncelleniyor"
    } else {
        WInfo "Node.js bulunamadi - kuruluyor"
    }

    $ok = Install-Node
    Refresh-Path
    $ver2 = Get-NodeMajor

    if ($ver2 -lt $MinNode) {
        WErr "Otomatik kurulum basarisiz."
        Write-Host ""
        Write-Host "  Lutfen Node.js'i manuel kurun:" -ForegroundColor Yellow
        Write-Host "  https://nodejs.org/en/download/" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "  Kurulumdan sonra PowerShell'i kapayip tekrar acin," -ForegroundColor Yellow
        Write-Host "  sonra bu scripti tekrar calistirin." -ForegroundColor Yellow
        Write-Host ""
        Start-Process "https://nodejs.org/en/download/"
        Read-Host "  Kurulumu tamamladiktan sonra Enter'a basin"
        Refresh-Path
        if ((Get-NodeMajor) -lt $MinNode) {
            WErr "Node.js hala bulunamadi. PowerShell'i kapatip tekrar acin."
            Read-Host "Cikmak icin Enter"
            exit 1
        }
    }
    WOk "Node.js v$(& node --version) kuruldu"
}

# Adim 2: Bagimliliklar
WStep "2/3  Bagimliliklar"

$check = Join-Path $ScriptDir "node_modules\.install-ok"
$pkg   = Join-Path $ScriptDir "package.json"
$needInstall = $true

if ((Test-Path $check) -and (Test-Path $pkg)) {
    if ((Get-Item $check).LastWriteTime -gt (Get-Item $pkg).LastWriteTime) {
        $needInstall = $false
    }
}

if ($needInstall) {
    WInfo "npm install calistiriliyor..."
    $output = & npm install 2>&1
    $output | Out-File $LogFile -Append
    if ($LASTEXITCODE -ne 0) {
        WErr "npm install basarisiz. Detay: $LogFile"
        Read-Host "Cikmak icin Enter"
        exit 1
    }
    New-Item -ItemType File -Force -Path $check | Out-Null
    WOk "Bagimliliklar kuruldu"
} else {
    WOk "Bagimliliklar zaten yuklu"
}

# Adim 3: Baslatma
WStep "3/3  Baslatiliyor"

WInfo "Workspace : $Workspace"
WInfo "Port      : $Port"

# Port kontrolu
$portUsed = $false
try {
    $conn = New-Object System.Net.Sockets.TcpClient
    $conn.Connect("127.0.0.1", $Port)
    $conn.Close()
    $portUsed = $true
} catch {}

if ($portUsed) {
    WWarn "Port $Port dolu, $($Port + 1) deneniyor"
    $Port = $Port + 1
}

# Network IP'leri
$ips = [System.Net.Dns]::GetHostAddresses(
    [System.Net.Dns]::GetHostName()
) | Where-Object {
    $_.AddressFamily -eq 'InterNetwork' -and $_.ToString() -ne '127.0.0.1'
} | Select-Object -ExpandProperty IPAddressToString

Write-Host ""
Write-Host "  +--------------------------------------------+" -ForegroundColor Green
Write-Host "  |  CodeV v2 basladi!                         |" -ForegroundColor Green
Write-Host "  +--------------------------------------------+" -ForegroundColor Green
Write-Host "  |  Yerel  : http://localhost:$Port" -ForegroundColor Cyan
foreach ($ip in $ips) {
    Write-Host "  |  Ekip   : http://${ip}:$Port" -ForegroundColor Cyan
}
Write-Host "  |  Durdurmak icin: Ctrl+C" -ForegroundColor DarkGray
Write-Host "  +--------------------------------------------+" -ForegroundColor Green
Write-Host ""

# Tarayiciyi ac
Start-Sleep -Seconds 1
try { Start-Process "http://localhost:$Port" } catch {}

# Sunucuyu calistir
$env:WORKSPACE = $Workspace
$env:PORT = "$Port"
& node server/index.js
