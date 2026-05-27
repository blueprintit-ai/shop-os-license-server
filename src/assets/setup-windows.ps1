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
  $null = Get-Command $Name -ErrorAction SilentlyContinue
  return $?
}

function Check-WinGet {
  $wingetPath = "C:\Program Files\WindowsApps\Microsoft.DesktopAppInstaller_*_x64__8wekyb3d8bbwe\winget.exe"
  $found = Test-Path (Resolve-Path $wingetPath -ErrorAction SilentlyContinue)
  if (-not $found) {
    $found = Check-Command winget
  }
  return $found
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
if (Check-Command obsidian -ErrorAction SilentlyContinue) {
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
& npx -y @blueprintit/shop-os-install --license "$licenseKey" --vault "$vaultPath" --yes

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "🎉 Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Launching Claude Code..."
Start-Sleep -Seconds 2
Start-Process "Claude Code"

Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Sign in to Claude Code if prompted"
Write-Host "  2. Open your Shop OS Vault folder in Obsidian"
Write-Host "  3. Run /os-setup in Claude Code to personalize your vault"
Write-Host ""
