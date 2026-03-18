#!/usr/bin/env zsh
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${0}")" && pwd)"
INSTALL_DIR="${WORKBENCH_INSTALL_DIR:-$HOME/.local/bin}"

# Scripts to install (relative to repo root)
BINS=(workbench wb-status wb-spawn wb-watch wb-cleanup wb-notify)

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
if [[ "$(uname)" == "Darwin" ]]; then
    check_dep "terminal-notifier" false   # Desktop notifications (macOS)
else
    check_dep "notify-send" false         # Desktop notifications (Linux)
fi

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

for name in "${BINS[@]}"; do
    src="$SCRIPT_DIR/$name"
    target="$INSTALL_DIR/$name"
    if [[ ! -f "$src" ]]; then
        echo -e "  ${YELLOW}○${NC} $name ${DIM}(not found, skipping)${NC}"
        continue
    fi
    chmod +x "$src"
    if [[ -L "$target" ]] || [[ -f "$target" ]]; then
        rm "$target"
    fi
    ln -s "$src" "$target"
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
echo ""
echo -e "  ${DIM}To uninstall: ./uninstall.sh${NC}"
