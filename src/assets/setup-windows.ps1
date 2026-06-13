# Shop OS Foundation — Windows Setup Script
# One command to install all prerequisites and Shop OS

$ErrorActionPreference = "Stop"

# Fresh Windows installs default to ExecutionPolicy Restricted, which blocks
# loading any .ps1 file. Our entry point dodges this via [scriptblock]::Create,
# but downstream installers (Claude Code, etc.) save scripts to disk and run
# them as files. Set Bypass for this process only — does NOT touch system or
# user policy. Wrapped in try/catch in case GPO/AppLocker pins the policy.
try {
  Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
} catch {
  Write-Host "⚠️  Could not set execution policy (may be GPO-locked). Continuing..." -ForegroundColor Yellow
}

# Helper functions must be defined at the top level so they survive into
# nested scriptblocks (e.g. the Claude Code installer).
function Check-Command {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Check-WinGet {
  $wingetPath = "C:\Program Files\WindowsApps\Microsoft.DesktopAppInstaller_*_x64__8wekyb3d8bbwe\winget.exe"
  if (Test-Path $wingetPath) { return $true }
  return (Check-Command winget)
}

# winget returns a NON-ZERO exit code when a package is already installed with no
# applicable upgrade (e.g. -1978335189 / 0x8A15002B) — that is NOT a failure. And
# GUI apps like Obsidian never land on PATH, so Check-Command misses them. These
# helpers verify a package by its real presence so we never abort on a false
# failure. *>$null swallows winget's output; $LASTEXITCODE is still set by it.
function Test-WingetInstalled {
  param([string]$Id)
  try {
    & winget list --id $Id -e --accept-source-agreements *> $null
    return ($LASTEXITCODE -eq 0)
  } catch { return $false }
}

function Test-ObsidianInstalled {
  $paths = @(
    "$env:LOCALAPPDATA\Obsidian\Obsidian.exe",
    "$env:LOCALAPPDATA\Programs\Obsidian\Obsidian.exe",
    "$env:PROGRAMFILES\Obsidian\Obsidian.exe"
  )
  foreach ($p in $paths) { if ($p -and (Test-Path $p)) { return $true } }
  return (Test-WingetInstalled "Obsidian.Obsidian")
}

# Extract HTTP status code and up to 500 chars of response body from a
# web exception so error logs are immediately actionable without a repro.
function Get-WebErrorDetail {
  param($Exception)
  $msg = $Exception.Message
  try {
    $resp = $Exception.Response
    if ($resp) {
      $code = [int]$resp.StatusCode
      $stream = $resp.GetResponseStream()
      if ($stream) {
        $reader = New-Object System.IO.StreamReader($stream)
        $body = $reader.ReadToEnd().Trim()
        $reader.Close()
        if ($body.Length -gt 500) { $body = $body.Substring(0, 500) + "..." }
        $msg += " [HTTP $code]"
        if ($body) { $msg += " | Response: $body" }
      }
    }
  } catch { }
  return $msg
}

# Use $global: so these are readable from functions and the outer catch block
# even when the script runs inside [scriptblock]::Create(), which has no
# formal $script: scope.
$global:ShopOS_WorkerUrl   = "https://shop-os-license-server.glenn-15d.workers.dev"
$global:ShopOS_LicenseKey  = "unknown"
$global:ShopOS_CurrentStep = "start"

function Send-InstallLog {
  param([string]$Status, [string]$ErrorMessage = "")
  try {
    $payload = @{
      license_key   = $global:ShopOS_LicenseKey
      status        = $Status
      step          = $global:ShopOS_CurrentStep
      machine       = @{
        os         = [System.Environment]::OSVersion.VersionString
        ps_version = $PSVersionTable.PSVersion.ToString()
        username   = $env:USERNAME
      }
    }
    if ($ErrorMessage) { $payload.error_message = $ErrorMessage }
    $body = $payload | ConvertTo-Json -Compress -Depth 4
    Invoke-RestMethod -Uri "$($global:ShopOS_WorkerUrl)/install-log" -Method POST `
      -Body $body -ContentType "application/json" `
      -TimeoutSec 5 -ErrorAction SilentlyContinue | Out-Null
  } catch { }
}

# All install logic lives in this function so that `throw` exits cleanly
# without killing the PowerShell process. The outer try/catch below catches
# every throw, logs it, and pauses so the window stays open.
function Invoke-ShopOSInstall {

  Write-Host "🚀 Shop OS Foundation — Windows Setup" -ForegroundColor Cyan
  Write-Host "=========================================" -ForegroundColor Cyan
  Write-Host ""
  Write-Host "This script will install:"
  Write-Host "  • Node.js"
  Write-Host "  • Git"
  Write-Host "  • Python 3"
  Write-Host "  • Claude Code"
  Write-Host "  • Obsidian"
  Write-Host "  • Shop OS Vault + Installer"
  Write-Host ""
  Write-Host "You will be prompted for your license key after prerequisites are installed."
  Write-Host ""

  # 1. Check WinGet
  $global:ShopOS_CurrentStep = "winget_check"
  if (-not (Check-WinGet)) {
    throw "WinGet not found.`n`n  WinGet is required to install prerequisites.`n  Install it from: https://github.com/microsoft/winget-cli/releases`n  (or search 'App Installer' in the Microsoft Store)`n`n  Then re-open PowerShell and run the installer command again."
  }
  Write-Host "✓ WinGet found" -ForegroundColor Green

  # 2. Check/install Node.js
  $global:ShopOS_CurrentStep = "node_install"
  Write-Host ""
  if (Check-Command node) {
    Write-Host "✓ Node.js found" -ForegroundColor Green
  } else {
    Write-Host "📦 Installing Node.js via WinGet..." -ForegroundColor Yellow
    # Install the LTS package. Its default installer is the .msi (built with
    # WiX, so its manifest InstallerType is "wix" — do NOT pass
    # --installer-type msi here, that filter excludes the wix-typed MSI and
    # winget reports "No applicable installer found"). The LTS .msi also avoids
    # the ZIP-based installer that trips Windows Defender (error 0x800700e2) on
    # the current (non-LTS) Node line.
    & winget install --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    $wingetExitCode = $LASTEXITCODE

    if ($wingetExitCode -ne 0) {
      Write-Host "  WinGet install failed (exit code $wingetExitCode). Falling back to direct MSI download..." -ForegroundColor Yellow
      $global:ShopOS_CurrentStep = "node_install_msi_fallback"
      Send-InstallLog -Status "retry" -ErrorMessage "winget OpenJS.NodeJS.LTS failed (exit $wingetExitCode) — trying MSI fallback"

      # Resolve the latest LTS version to a single scalar. -ExpandProperty after
      # -First 1 guarantees a string; validate the shape because a proxy/firewall
      # that disturbs the JSON parse can otherwise yield the whole version array,
      # producing a garbage multi-version URL -> 400 Bad Request.
      $ltsVer = ""
      try {
        $index = Invoke-RestMethod "https://nodejs.org/dist/index.json" -UseBasicParsing -ErrorAction Stop
        $ltsVer = [string]($index | Where-Object { $_.lts } | Select-Object -First 1 -ExpandProperty version)
      } catch { }
      if ($ltsVer -notmatch '^v\d+\.\d+\.\d+$') {
        # Pinned known-good LTS as a last resort if version resolution fails.
        $ltsVer = "v22.20.0"
      }

      $msiUrl = "https://nodejs.org/dist/$ltsVer/node-$ltsVer-x64.msi"
      $msiPath = "$env:TEMP\nodejs-lts.msi"
      Write-Host "  Downloading Node.js $ltsVer MSI..." -ForegroundColor Yellow
      Write-Host "  URL: $msiUrl" -ForegroundColor DarkGray
      try {
        Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath -UseBasicParsing -ErrorAction Stop
      } catch {
        $webErr = Get-WebErrorDetail $_.Exception
        throw "Node.js MSI download failed.`n  Version resolved: $ltsVer`n  URL: $msiUrl`n  Error: $webErr"
      }
      Write-Host "  Installing MSI (this may take a minute)..." -ForegroundColor Yellow
      $msiProc = Start-Process msiexec.exe -Wait -PassThru -ArgumentList "/i `"$msiPath`" /qn ADDLOCAL=ALL"
      Remove-Item $msiPath -ErrorAction SilentlyContinue
      if ($msiProc.ExitCode -ne 0) {
        throw "Node.js MSI installation failed (msiexec exit code $($msiProc.ExitCode)).`n  Version: $ltsVer`n  URL was: $msiUrl"
      }
      Write-Host "✓ Node.js installed via direct MSI" -ForegroundColor Green
    }
  }

  # 2b. Check/install Git
  $global:ShopOS_CurrentStep = "git_install"
  Write-Host ""
  if (Check-Command git) {
    Write-Host "✓ Git found" -ForegroundColor Green
  } else {
    Write-Host "📦 Installing Git via WinGet..." -ForegroundColor Yellow
    & winget install --id Git.Git --scope user --silent --accept-package-agreements --accept-source-agreements
    $gitCode = $LASTEXITCODE
    # Verify by presence, not exit code — winget returns non-zero for "already
    # installed / no upgrade available". Only fail if Git genuinely isn't there.
    if (-not (Check-Command git) -and -not (Test-WingetInstalled "Git.Git")) {
      throw "Git installation failed (winget exit code $gitCode).`n`n  Install Git manually from https://git-scm.com/download/win, then re-run."
    }
  }

  # 2c. Check/install Python 3
  # bp-digest uses Python 3 + MarkItDown to read PDFs, Word docs, and spreadsheets.
  # Windows ships App Execution Alias stubs for python/python3 that write to stderr
  # and exit non-zero when no real Python is installed. With $ErrorActionPreference
  # = Stop, that stderr output becomes a terminating exception, so we probe with
  # EAP set to Continue inside a try/catch and verify via $LASTEXITCODE instead.
  $global:ShopOS_CurrentStep = "python_install"
  Write-Host ""
  $pythonFound = $false
  foreach ($pyCmd in @("python3", "python")) {
    if (-not (Check-Command $pyCmd)) { continue }
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
      $ver = & $pyCmd --version 2>&1
      if ($LASTEXITCODE -eq 0 -and "$ver" -match "Python 3") {
        $pythonFound = $true
        Write-Host "✓ Python 3 found ($ver)" -ForegroundColor Green
        break
      }
    } catch { }
    $ErrorActionPreference = $prevEAP
  }
  $ErrorActionPreference = "Stop"
  if (-not $pythonFound) {
    Write-Host "📦 Installing Python 3 via WinGet..." -ForegroundColor Yellow
    & winget install --id Python.Python.3 --scope user --silent --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
      throw "Python 3 installation failed (winget exit code $LASTEXITCODE).`n`n  Install Python 3 manually from python.org/downloads`n  (check 'Add python.exe to PATH' during install), then re-run."
    }
  }

  # 3. Check/install Claude Code
  # Detect by binary on PATH, not by ~/.claude folder. The folder is only created
  # after first launch, so a PATH check correctly identifies npm/installer/desktop installs.
  $global:ShopOS_CurrentStep = "claude_install"
  Write-Host ""
  if (Check-Command claude) {
    Write-Host "✓ Claude Code found" -ForegroundColor Green
  } else {
    Write-Host "📦 Installing Claude Code..." -ForegroundColor Yellow
    # claude.ai/install.ps1 redirects to a bootstrap script served as
    # application/octet-stream. Invoke-WebRequest returns .Content as a byte[]
    # for non-text content types, and [scriptblock]::Create on a byte[] stringifies
    # it as space-separated decimals ("112 97 114 ...") -> parse errors. Decode to
    # a UTF-8 string first. Guard handles both byte[] and string across PS versions.
    $claudeResp = Invoke-WebRequest -Uri "https://claude.ai/install.ps1" -UseBasicParsing
    $claudeScript = $claudeResp.Content
    if ($claudeScript -is [byte[]]) {
      $claudeScript = [System.Text.Encoding]::UTF8.GetString($claudeScript)
    }
    & ([scriptblock]::Create($claudeScript))

    # Refresh PATH so the freshly-installed claude is visible this session.
    $env:PATH = [Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [Environment]::GetEnvironmentVariable("PATH","User")

    # The native installer drops claude.exe in %USERPROFILE%\.local\bin and updates
    # the user PATH, but that new entry isn't always visible after the env refresh.
    # Add the known location directly as a fallback so detection never false-fails.
    if (-not (Check-Command claude)) {
      $claudeBin = "$env:USERPROFILE\.local\bin"
      if (Test-Path "$claudeBin\claude.exe") {
        $env:PATH = "$claudeBin;" + $env:PATH
        Write-Host "  Located claude at: $claudeBin" -ForegroundColor DarkGray
      }
    }

    if (-not (Check-Command claude)) {
      throw "Claude Code installation failed. The 'claude' command is not available on PATH.`n`n  Check that the installation completed successfully, then re-run this installer."
    }
  }

  # 4. Check/install Obsidian
  $global:ShopOS_CurrentStep = "obsidian_install"
  Write-Host ""
  if (Test-ObsidianInstalled) {
    Write-Host "✓ Obsidian found" -ForegroundColor Green
  } else {
    Write-Host "📦 Installing Obsidian via WinGet..." -ForegroundColor Yellow
    & winget install --id Obsidian.Obsidian --scope user --silent --accept-package-agreements --accept-source-agreements
    $obsCode = $LASTEXITCODE
    # Verify by presence, not exit code — winget returns non-zero (e.g.
    # -1978335189) when Obsidian is already installed with no upgrade available.
    if (-not (Test-ObsidianInstalled)) {
      throw "Obsidian installation failed (winget exit code $obsCode).`n`n  Install Obsidian manually from https://obsidian.md/download, then re-run."
    }
    Write-Host "✓ Obsidian installed" -ForegroundColor Green
  }

  # 5. Prompt for license key and vault path
  $global:ShopOS_CurrentStep = "license_prompt"
  Write-Host ""
  Write-Host "=========================================" -ForegroundColor Cyan
  Write-Host "✨ Prerequisites complete!" -ForegroundColor Green
  Write-Host ""

  $enteredKey = Read-Host "Enter your Shop OS license key"
  if ([string]::IsNullOrWhiteSpace($enteredKey)) {
    throw "No license key provided."
  }
  $global:ShopOS_LicenseKey = $enteredKey

  $global:ShopOS_CurrentStep = "vault_setup"
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
    throw "No folder selected."
  }

  $parentDir = $picker.SelectedPath
  $vaultName = Read-Host "Name your vault folder [Shop OS Vault]"
  if ([string]::IsNullOrWhiteSpace($vaultName)) { $vaultName = "Shop OS Vault" }
  $vaultPath = Join-Path $parentDir $vaultName

  Write-Host ""
  Write-Host "Installing Shop OS to: $vaultPath" -ForegroundColor Cyan
  Write-Host ""

  # Refresh PATH so freshly-installed tools (node, git) are findable. WinGet
  # updates the machine/user PATH but doesn't always bubble that into the current
  # session, so the installer can't see `git` even though it was just installed.
  $env:PATH = [Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [Environment]::GetEnvironmentVariable("PATH","User")

  # WinGet's user-scope Node.js install writes to User PATH but the new entry
  # isn't always visible in the current session after the env var refresh. Search
  # known install locations as a fallback so npx is always findable.
  if (-not (Check-Command npx)) {
    $nodeSearchPaths = @(
      "$env:ProgramFiles\nodejs",
      "${env:ProgramFiles(x86)}\nodejs",
      "$env:LOCALAPPDATA\Programs\nodejs",
      "$env:APPDATA\npm"
    )
    foreach ($p in $nodeSearchPaths) {
      if (Test-Path "$p\npx.cmd") {
        $env:PATH = "$p;" + $env:PATH
        Write-Host "  Located npx at: $p" -ForegroundColor DarkGray
        break
      }
    }
  }

  $global:ShopOS_CurrentStep = "npx_check"
  if (-not (Check-Command npx)) {
    throw "npx not found after Node.js installation.`n`n  Node.js was installed but this terminal cannot see it yet.`n`n  Please close this window, open a new PowerShell, and run the`n  installer command again. Node.js will already be installed."
  }

  # 6. Run Shop OS installer with license key and vault path
  $global:ShopOS_CurrentStep = "npx_installer"
  & npx -y @blueprintit/shop-os-install@latest --license "$($global:ShopOS_LicenseKey)" --vault "$vaultPath" --yes

  # Poll for the vault folder to exist. PowerShell's & operator on npx.cmd can
  # return before its grandchildren (cmd.exe -> node.exe) finish writing files,
  # so a defensive wait prevents Set-Location from racing the installer.
  $deadline = [DateTime]::Now.AddSeconds(60)
  while (-not (Test-Path -LiteralPath $vaultPath) -and [DateTime]::Now -lt $deadline) {
    Start-Sleep -Milliseconds 250
  }

  $global:ShopOS_CurrentStep = "vault_verify"
  if (-not (Test-Path -LiteralPath $vaultPath)) {
    throw "Vault folder not found at: $vaultPath`n  The installer reported success but the folder is missing.`n  Check that Dropbox (or your chosen location) is syncing and try again."
  }

  Write-Host ""
  Write-Host "=========================================" -ForegroundColor Cyan
  Write-Host "🎉 Setup complete!" -ForegroundColor Green
  Write-Host ""
  Write-Host "Next steps:" -ForegroundColor Cyan
  Write-Host "  1. Sign in to Claude Code if prompted"
  Write-Host "  2. Type /bp-setup at the Claude prompt to personalize your vault"
  Write-Host ""
  Write-Host "Launching Claude Code..." -ForegroundColor Cyan
  Start-Sleep -Seconds 1

  # Refresh PATH so freshly-installed `claude` is found in this session
  $env:PATH = [Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [Environment]::GetEnvironmentVariable("PATH","User")

  $global:ShopOS_CurrentStep = "complete"
  Send-InstallLog -Status "success"

  Set-Location -LiteralPath $vaultPath
  claude
}

# Run the installer. Any throw inside Invoke-ShopOSInstall (including ones
# from $ErrorActionPreference = "Stop" on unexpected failures) lands here.
# The window stays open so the customer can read the error.
try {
  Invoke-ShopOSInstall
} catch {
  Send-InstallLog -Status "error" -ErrorMessage $_.Exception.Message
  Write-Host ""
  Write-Host "=========================================" -ForegroundColor Red
  Write-Host "✗ Setup stopped" -ForegroundColor Red
  Write-Host ""
  Write-Host $_.Exception.Message -ForegroundColor Yellow
  Write-Host ""
  Read-Host "Press Enter to close this window"
}
