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
echo "  • Claude Code"
echo "  • Obsidian"
echo "  • Shop OS Vault + Installer"
echo ""
echo "You'll be prompted for your license key after prerequisites are installed."
echo ""

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
  brew install node
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
  brew install git
else
  echo "✓ Git found"
fi

# 3. Check/install Claude Code
if ! [ -d ~/.claude ]; then
  echo "📦 Installing Claude Code..."
  curl -fsSL https://claude.ai/install.sh | bash
else
  echo "✓ Claude Code found"
fi

# 4. Check/install Obsidian
if ! command -v obsidian &> /dev/null && ! [ -d /Applications/Obsidian.app ]; then
  echo "📦 Installing Obsidian via Homebrew..."
  brew install --cask obsidian
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
echo "  2. Open your Shop OS Vault folder in Obsidian"
echo "  3. Type /bp-setup to personalize your vault"
echo ""
echo "Launching Claude Code..."
sleep 1

cd "$VAULT_PATH"
exec claude
