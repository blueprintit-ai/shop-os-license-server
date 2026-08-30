#!/bin/bash
set -e

# Shop OS Foundation — macOS Setup Script
# One command to install all prerequisites and Shop OS

# ---- install telemetry (best-effort, mirrors setup-windows.ps1) ----
# Reports where a run stopped to the license server's install-log so failed
# self-installs are visible without a screen share. Never blocks or fails
# the install: 5s timeout, errors swallowed.
WORKER_URL="https://shop-os-license-server.glenn-15d.workers.dev"
CURRENT_STEP="start"
LOG_LICENSE_KEY="unknown"
send_install_log() {
  local err_json=""
  if [ -n "${2:-}" ]; then err_json=",\"error_message\":\"$2\""; fi
  curl -s -m 5 -X POST -H "content-type: application/json" \
    -d "{\"license_key\":\"$LOG_LICENSE_KEY\",\"status\":\"$1\",\"step\":\"$CURRENT_STEP\",\"machine\":{\"os\":\"macOS $(sw_vers -productVersion 2>/dev/null || echo unknown)\",\"source\":\"setup-macos.sh\"}$err_json}" \
    "$WORKER_URL/install-log" >/dev/null 2>&1 || true
}
on_exit() {
  local code=$?
  if [ $code -ne 0 ]; then
    send_install_log error "setup stopped at step $CURRENT_STEP (exit $code)"
  fi
}
trap on_exit EXIT

echo "🚀 Shop OS Foundation — macOS Setup"
echo "=========================================="
echo ""
echo "This script will install:"
echo "  • Homebrew (if needed)"
echo "  • Node.js"
echo "  • Git"
echo "  • Python 3"
echo "  • Claude Code"
echo "  • Obsidian"
echo "  • Shop OS Vault + Installer"
echo ""
echo "You'll be prompted for your license key after prerequisites are installed."
echo ""
echo "⚠️  Mac will ask for your login password in a moment."
echo "    This is normal: Homebrew needs it to install developer tools."
echo "    Type it in (the cursor won't move) and press Enter."
echo ""

# Pre-collect sudo credentials up front so the password prompt happens
# at the very start, not mid-install after Homebrew has already printed
# progress noise. Cached for ~5 minutes, long enough for Homebrew to
# finish without re-prompting.
if ! command -v brew &> /dev/null; then
  if ! sudo -v; then
    echo ""
    echo "✗ This Mac account can't run administrator commands (sudo)."
    echo "  Homebrew needs an administrator account to install developer tools."
    echo "  Log in as an administrator (or have whoever manages this Mac join),"
    echo "  then run this setup again."
    exit 1
  fi
fi

CURRENT_STEP="homebrew_install"
# 1. Check/install Homebrew
if ! command -v brew &> /dev/null; then
  echo "📦 Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Apple Silicon installs to /opt/homebrew, Intel to /usr/local. Put whichever
  # landed on PATH for the rest of this script.
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
  if ! command -v brew &> /dev/null; then
    echo "✗ Homebrew installation failed."
    echo "  Install it from https://brew.sh, then re-run this script."
    exit 1
  fi
else
  echo "✓ Homebrew found"
fi

CURRENT_STEP="node_install"
# 2. Check/install Node.js
if ! command -v node &> /dev/null; then
  echo "📦 Installing Node.js via Homebrew..."
  if ! brew install node; then
    echo "✗ Node.js installation failed."
    echo ""
    echo "Install Node.js manually from https://nodejs.org or Homebrew, then re-run."
    exit 1
  fi
else
  echo "✓ Node.js found"
fi

CURRENT_STEP="git_install"
# 2b. Check/install Git
# The Shop OS npx installer uses git to refresh the plugin marketplace clone
# (~/.claude/plugins/marketplaces/blueprint-skills). On most Macs git arrives
# with the Command Line Tools that Homebrew triggers, but we install it
# explicitly here so a fresh customer never lands in a "no git, silent fail"
# state.
if ! command -v git &> /dev/null; then
  echo "📦 Installing Git via Homebrew..."
  if ! brew install git; then
    echo "✗ Git installation failed."
    echo ""
    echo "Install Git manually from https://git-scm.com or Homebrew, then re-run."
    exit 1
  fi
else
  echo "✓ Git found"
fi

CURRENT_STEP="python_install"
# 2c. Check/install Python 3
# bp-digest uses Python 3 + MarkItDown to read PDFs, Word docs, and spreadsheets
# dropped into the Raw/ inbox. macOS ships Python 3 on recent versions but we
# install explicitly so a fresh or stripped machine never silently fails.
if command -v python3 &> /dev/null; then
  echo "✓ Python 3 found"
else
  echo "📦 Installing Python 3 via Homebrew..."
  if ! brew install python3; then
    echo "✗ Python 3 installation failed."
    echo ""
    echo "Install Python 3 manually from https://www.python.org or Homebrew, then re-run."
    exit 1
  fi
fi

CURRENT_STEP="claude_install"
# 3. Check/install Claude Code
# Detect by binary on PATH, not by ~/.claude folder. The folder is only created
# after first launch, so a PATH check correctly identifies npm/installer/shell installs.
# The installer drops `claude` in ~/.local/bin, which a fresh login shell may not
# have on PATH yet — add it up front so detection, verify, and the final exec all work.
export PATH="$HOME/.local/bin:$PATH"
if command -v claude &> /dev/null; then
  echo "✓ Claude Code found"
else
  echo "📦 Installing Claude Code..."
  curl -fsSL https://claude.ai/install.sh | bash
  # Verify installation succeeded
  if ! command -v claude &> /dev/null; then
    echo "✗ Claude Code installation failed. The \`claude\` command is not available on PATH."
    echo ""
    echo "Check that the installation completed successfully, then re-run this script."
    exit 1
  fi
fi

# Persist ~/.local/bin on PATH so `claude` works in every NEW Terminal window,
# not just this script's session (which prepended it above). The official
# installer usually does this, but not on every shell setup. Idempotent: only
# appends when the profile doesn't already put .local/bin on PATH.
if [ -x "$HOME/.local/bin/claude" ]; then
  PROFILE_FILE="$HOME/.zprofile"
  case "${SHELL:-}" in
    */bash) PROFILE_FILE="$HOME/.bash_profile" ;;
  esac
  if ! grep -qs '\.local/bin' "$PROFILE_FILE"; then
    printf '\n# Added by Shop OS setup: Claude Code lives in ~/.local/bin\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$PROFILE_FILE"
    echo "✓ Added ~/.local/bin to PATH in ${PROFILE_FILE/#$HOME/~} (so 'claude' works in new Terminal windows)"
  fi
fi

CURRENT_STEP="obsidian_install"
# 4. Check/install Obsidian
if ! command -v obsidian &> /dev/null && ! [ -d /Applications/Obsidian.app ]; then
  echo "📦 Installing Obsidian via Homebrew..."
  if ! brew install --cask obsidian; then
    echo "✗ Obsidian installation failed."
    echo ""
    echo "Install Obsidian manually from https://obsidian.md/download, then re-run."
    exit 1
  fi
else
  echo "✓ Obsidian found"
fi

CURRENT_STEP="license_prompt"
# 5. Prompt for license key and vault path
echo ""
echo "=========================================="
echo "✨ Prerequisites complete!"
echo ""

# A personalized self-installer (Install Shop OS.command from the welcome
# email) bakes the customer's key into SHOPOS_LICENSE_KEY so nothing has to
# be typed. Interactive prompt stays as the fallback.
if [ -n "${SHOPOS_LICENSE_KEY:-}" ]; then
  LICENSE_KEY="$SHOPOS_LICENSE_KEY"
  echo "✓ License key loaded from your personalized installer"
else
  read -p "Enter your Shop OS license key: " LICENSE_KEY < /dev/tty
fi

if [ -z "$LICENSE_KEY" ]; then
  echo "✗ No license key provided. Exiting."
  exit 1
fi
LOG_LICENSE_KEY="$LICENSE_KEY"

echo ""
echo "A folder picker will open. Navigate to where you want Shop OS installed."
echo "(Examples: home folder, Dropbox, Documents)"
echo ""

PARENT_DIR=$(osascript -e 'POSIX path of (choose folder with prompt "Choose where to install Shop OS:")')

if [ -z "$PARENT_DIR" ]; then
  echo "✗ No folder selected. Exiting."
  exit 1
fi

read -p "Name your vault folder [Shop OS Vault]: " VAULT_NAME < /dev/tty
VAULT_NAME="${VAULT_NAME:-Shop OS Vault}"

VAULT_PATH="${PARENT_DIR%/}/$VAULT_NAME"

echo ""
echo "Installing Shop OS to: $VAULT_PATH"
echo ""

CURRENT_STEP="npx_installer"
# 6. Run Shop OS installer with license key and vault path
# Redirect stdin to /dev/tty so npx doesn't drain the curl|bash pipe.
# Prefer the npm registry copy; fall back to installing straight from the
# GitHub repo when the registry copy is unavailable (e.g. registry outage or
# a package hold), so the install never depends on npm being reachable.
if npm view @blueprintitai/shop-os-install version >/dev/null 2>&1; then
  npx -y @blueprintitai/shop-os-install@latest --license "$LICENSE_KEY" --vault "$VAULT_PATH" --yes < /dev/tty
else
  echo "npm registry copy unavailable — installing from GitHub instead"
  npx -y --package=github:blueprintit-ai/shop-os-installer shop-os-install --license "$LICENSE_KEY" --vault "$VAULT_PATH" --yes < /dev/tty
fi

echo ""
echo "=========================================="
echo "🎉 Setup complete!"
echo ""
CURRENT_STEP="complete"
send_install_log success
trap - EXIT

# Claude Code loads plugins in the background on its first launch. A second
# launch is required for /bp commands to be available. Launch twice: once to
# sign in and trigger the background sync, then again with all commands ready.
cd "$VAULT_PATH"

echo "Step 1 of 2: Sign in to Claude Code."
echo "After signing in, close Claude Code — it will reopen automatically with all commands ready."
echo ""
sleep 1
claude

echo ""
echo "Relaunching Claude Code with all /bp commands ready..."
sleep 2
exec claude
