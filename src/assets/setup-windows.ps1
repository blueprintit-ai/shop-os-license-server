# Shop OS Foundation — Windows Setup Script
# One command to install all prerequisites and Shop OS

$ErrorActionPreference = "Stop"

Write-Host "🚀 Shop OS Foundation — Windows Setup" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "This script will install:"
Write-Host "  • Node.js"
Write-Host "  • Claude Code"
Write-Host "  • Obsidian"
Write-Host "  • Shop OS Vault + Installer"
Write-Host ""
Write-Host "You will be prompted for your license key after prerequisites are installed."
Write-Host ""

# Helper function
function Check-Command {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Check-WinGet {
  $wingetPath = "C:\Program Files\WindowsApps\Microsoft.DesktopAppInstaller_*_x64__8wekyb3d8bbwe\winget.exe"
  if (Test-Path $wingetPath) { return $true }
  return (Check-Command winget)
}

# 1. Check WinGet
if (-not (Check-WinGet)) {
  Write-Host "⚠️  WinGet not found. Installing WinGet..." -ForegroundColor Yellow
  Write-Host ""
  Write-Host "WinGet is required. Download and install it from:"
  Write-Host "https://github.com/microsoft/winget-cli/releases"
  Write-Host ""
  Write-Host "Or use Windows Package Manager from the Microsoft Store (recommended)."
  Write-Host ""
  exit 1
}
Write-Host "✓ WinGet found" -ForegroundColor Green

# 2. Check/install Node.js
Write-Host ""
if (Check-Command node) {
  Write-Host "✓ Node.js found" -ForegroundColor Green
} else {
  Write-Host "📦 Installing Node.js via WinGet..." -ForegroundColor Yellow
  & winget install --id OpenJS.NodeJS --scope user --silent --accept-package-agreements --accept-source-agreements
}

# 3. Check/install Claude Code
Write-Host ""
if (Test-Path $env:USERPROFILE\.claude) {
  Write-Host "✓ Claude Code found" -ForegroundColor Green
} else {
  Write-Host "📦 Installing Claude Code..." -ForegroundColor Yellow
  $claudeInstallScript = @"
  # Temporary inline install script for Claude Code
  Write-Host "Downloading Claude Code installer..."
  `$url = "https://claude.ai/install.ps1"
  `$outfile = "`$env:TEMP\claude-install.ps1"
  Invoke-WebRequest -Uri `$url -OutFile `$outfile -UseBasicParsing
  & `$outfile
  Remove-Item `$outfile -Force
"@
  Invoke-Expression $claudeInstallScript
}

# 4. Check/install Obsidian
Write-Host ""
if (Check-Command obsidian) {
  Write-Host "✓ Obsidian found" -ForegroundColor Green
} else {
  Write-Host "📦 Installing Obsidian via WinGet..." -ForegroundColor Yellow
  & winget install --id Obsidian.Obsidian --scope user --silent --accept-package-agreements --accept-source-agreements
}

# 5. Prompt for license key and vault path
Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "✨ Prerequisites complete!" -ForegroundColor Green
Write-Host ""

$licenseKey = Read-Host "Enter your Shop OS license key"
if ([string]::IsNullOrWhiteSpace($licenseKey)) {
  Write-Host "✗ No license key provided. Exiting." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "A folder picker will open. Navigate to where you want Shop OS installed."
Write-Host "(Examples: your home folder, Dropbox, Documents)"
Write-Host ""

Add-Type -AssemblyName System.Windows.Forms
$picker = New-Object System.Windows.Forms.FolderBrowserDialog
$picker.Description = "Choose where to install Shop OS"
$picker.RootFolder = "MyComputer"
$picker.ShowNewFolderButton = $true
$result = $picker.ShowDialog()

if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
  Write-Host "✗ No folder selected. Exiting." -ForegroundColor Red
  exit 1
}

$parentDir = $picker.SelectedPath
$vaultName = Read-Host "Name your vault folder [Shop OS Vault]"
if ([string]::IsNullOrWhiteSpace($vaultName)) { $vaultName = "Shop OS Vault" }

$vaultPath = Join-Path $parentDir $vaultName

Write-Host ""
Write-Host "Installing Shop OS to: $vaultPath" -ForegroundColor Cyan
Write-Host ""

# 6. Run Shop OS installer with license key and vault path
& npx -y @blueprintit/shop-os-install@latest --license "$licenseKey" --vault "$vaultPath" --yes

# Poll for the vault folder to exist. PowerShell's & operator on npx.cmd can
# return before its grandchildren (cmd.exe -> node.exe) finish writing files,
# so a defensive wait prevents Set-Location from racing the installer.
$deadline = [DateTime]::Now.AddSeconds(60)
while (-not (Test-Path -LiteralPath $vaultPath) -and [DateTime]::Now -lt $deadline) {
  Start-Sleep -Milliseconds 250
}

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "🎉 Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Sign in to Claude Code if prompted"
Write-Host "  2. Open your Shop OS Vault folder in Obsidian"
Write-Host "  3. Type /bp-setup to personalize your vault"
Write-Host ""
Write-Host "Launching Claude Code..." -ForegroundColor Cyan
Start-Sleep -Seconds 1

# Refresh PATH so freshly-installed `claude` is found in this session
$env:PATH = [Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [Environment]::GetEnvironmentVariable("PATH","User")

if (-not (Test-Path -LiteralPath $vaultPath)) {
  Write-Host "✗ Vault folder not found at: $vaultPath" -ForegroundColor Red
  Write-Host "Installer reported success but the folder is missing. Open it manually." -ForegroundColor Yellow
  exit 1
}

Set-Location -LiteralPath $vaultPath
claude
