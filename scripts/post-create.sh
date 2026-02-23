#!/usr/bin/env bash
set -euo pipefail

# Dotfiles
DOTFILES_REPO="git@github.com:nickhart/dotfiles.git"
DOTFILES_DIR="$HOME/dotfiles"

if [ ! -d "$DOTFILES_DIR" ]; then
  echo "Cloning dotfiles..."
  git clone "$DOTFILES_REPO" "$DOTFILES_DIR"
else
  echo "Dotfiles already present, pulling latest..."
  git -C "$DOTFILES_DIR" pull
fi

if [ -f "$DOTFILES_DIR/install.sh" ]; then
  echo "Running dotfiles install script..."
  bash "$DOTFILES_DIR/install.sh"
fi

# Fix ownership of Claude Code config volume (Docker creates it as root)
sudo chown -R "$(id -u):$(id -g)" "$HOME/.claude"
# Ensure required subdirectories exist (volume mount starts empty)
mkdir -p "$HOME/.claude/debug" "$HOME/.claude/projects"

# Install Claude CLI (native installer)
echo "Installing Claude CLI..."
curl -fsSL https://claude.ai/install.sh | sh

# Tinybird CLI
echo "Installing Tinybird CLI..."
curl -fsSL https://tinybird.co | sh

# Global npm tools
npm install -g eas-cli

# Git aliases
git config --global alias.pushf 'push origin HEAD --force-with-lease'
git config --global alias.fetchall 'fetch --all --prune'
git config --global alias.sync '!git checkout main && git pull origin main'
