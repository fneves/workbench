#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${1:-$HOME/.local/bin}"

echo -e "${PURPLE:-\033[0;35m}${BOLD}⚡ workbench installer${NC}"
echo ""

# --- Check dependencies ---
echo -e "${BOLD}Checking dependencies...${NC}"

check_dep() {
    local name="$1"
    local required="${2:-true}"
    if command -v "$name" &>/dev/null; then
        echo -e "  ${GREEN}✓${NC} $name"
        return 0
    elif [[ "$required" == "true" ]]; then
        echo -e "  ${RED}✗${NC} $name ${RED}(required)${NC}"
        return 1
    else
        echo -e "  ${YELLOW}○${NC} $name ${DIM}(optional, recommended)${NC}"
        return 0
    fi
}

MISSING=false
check_dep "git" || MISSING=true
check_dep "zellij" || MISSING=true
check_dep "jq" || MISSING=true
check_dep "bash" || MISSING=true

echo ""
echo -e "${BOLD}Optional tools:${NC}"
check_dep "claude" false              # Claude Code CLI
check_dep "opencode" false            # OpenCode CLI
check_dep "fzf" false                 # Fuzzy finder
check_dep "delta" false               # Better diffs
check_dep "lazygit" false             # Git TUI
check_dep "terminal-notifier" false   # Desktop notifications (macOS)
check_dep "notify-send" false         # Desktop notifications (Linux)

if [[ "$MISSING" == true ]]; then
    echo ""
    echo -e "${RED}Missing required dependencies. Install them first.${NC}"
    echo ""
    echo -e "  ${DIM}# macOS${NC}"
    echo -e "  brew install zellij jq fzf git-delta lazygit terminal-notifier"
    echo ""
    echo -e "  ${DIM}# Linux${NC}"
    echo -e "  # See https://zellij.dev/documentation/installation${NC}"
    echo -e "  sudo apt install jq fzf"
    exit 1
fi

# --- Symlink binaries ---
echo ""
echo -e "${BOLD}Installing to $INSTALL_DIR...${NC}"
mkdir -p "$INSTALL_DIR"

for bin in "$SCRIPT_DIR/bin/"*; do
    name="$(basename "$bin")"
    target="$INSTALL_DIR/$name"
    if [[ -L "$target" ]] || [[ -f "$target" ]]; then
        rm "$target"
    fi
    ln -s "$bin" "$target"
    echo -e "  ${GREEN}→${NC} $name"
done

# --- Verify PATH ---
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    echo ""
    echo -e "${YELLOW}Note: $INSTALL_DIR is not in your PATH.${NC}"
    echo -e "${DIM}Add this to your shell profile:${NC}"
    echo ""
    echo -e "  export PATH=\"$INSTALL_DIR:\$PATH\""
fi

echo ""
echo -e "${GREEN}${BOLD}✓ Installed!${NC}"
echo ""
echo -e "  ${CYAN}workbench start${NC}   — launch the orchestrator"
echo -e "  ${CYAN}workbench spawn${NC}   — spawn a task"
echo -e "  ${CYAN}workbench list${NC}    — list tasks"
echo -e "  ${CYAN}workbench --help${NC}  — full usage"
