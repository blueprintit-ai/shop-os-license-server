#!/bin/bash
set -e

# Shop OS Foundation — macOS Setup Script
# One command to install all prerequisites and Shop OS

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
  sudo -v
fi

# 1. Check/install Homebrew
if ! command -v brew &> /dev/null; then
  echo "📦 Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  eval "$(/opt/homebrew/bin/brew shellenv)"
else
  echo "✓ Homebrew found"
fi

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

# 5. Prompt for license key and vault path
echo ""
echo "=========================================="
echo "✨ Prerequisites complete!"
echo ""

read -p "Enter your Shop OS license key: " LICENSE_KEY < /dev/tty

if [ -z "$LICENSE_KEY" ]; then
  echo "✗ No license key provided. Exiting."
  exit 1
fi

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

# 6. Run Shop OS installer with license key and vault path
# Redirect stdin to /dev/tty so npx doesn't drain the curl|bash pipe
npx -y @blueprintit/shop-os-install@latest --license "$LICENSE_KEY" --vault "$VAULT_PATH" --yes < /dev/tty

echo ""
echo "=========================================="
echo "🎉 Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Sign in to Claude Code if prompted"
echo "  2. Type /bp-setup at the Claude prompt to personalize your vault"
echo ""
echo "Launching Claude Code..."
sleep 1

cd "$VAULT_PATH"
exec claude
