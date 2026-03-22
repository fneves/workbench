#!/usr/bin/env bash
set -euo pipefail

# workbench dependency installer
# Detects the platform and installs required + optional dependencies.

C_BOLD="\033[1m"
C_GREEN="\033[0;32m"
C_YELLOW="\033[1;33m"
C_CYAN="\033[0;36m"
C_DIM="\033[2m"
C_RED="\033[0;31m"
C_NC="\033[0m"

info()  { echo -e "${C_CYAN}→${C_NC} $1"; }
ok()    { echo -e "${C_GREEN}✓${C_NC} $1"; }
warn()  { echo -e "${C_YELLOW}!${C_NC} $1"; }
err()   { echo -e "${C_RED}✗${C_NC} $1"; }
dim()   { echo -e "${C_DIM}  $1${C_NC}"; }

echo -e "${C_BOLD}⚡ workbench — dependency installer${C_NC}"
echo

# --- Detect platform + package manager ---

OS="$(uname -s)"
ARCH="$(uname -m)"

if [[ "$OS" == "Darwin" ]]; then
    if ! command -v brew &>/dev/null; then
        err "Homebrew not found. Install it first: https://brew.sh"
        exit 1
    fi
    PKG="brew"
    PKG_INSTALL="brew install"
elif [[ "$OS" == "Linux" ]]; then
    if command -v apt-get &>/dev/null; then
        PKG="apt"
        PKG_INSTALL="sudo apt-get install -y"
    elif command -v dnf &>/dev/null; then
        PKG="dnf"
        PKG_INSTALL="sudo dnf install -y"
    elif command -v pacman &>/dev/null; then
        PKG="pacman"
        PKG_INSTALL="sudo pacman -S --noconfirm"
    else
        err "No supported package manager found (apt, dnf, pacman)"
        exit 1
    fi
else
    err "Unsupported platform: $OS"
    exit 1
fi

info "Platform: $OS $ARCH ($PKG)"
echo

# --- Helper: check + install ---

check_install() {
    local cmd="$1"
    local pkg="${2:-$1}"
    local required="${3:-false}"
    local desc="${4:-}"

    if command -v "$cmd" &>/dev/null; then
        ok "$cmd ${C_DIM}$(command -v "$cmd")${C_NC}"
        return 0
    fi

    if [[ "$required" == "true" ]]; then
        info "Installing $cmd (required)..."
    else
        info "Installing $cmd (optional — $desc)..."
    fi

    $PKG_INSTALL "$pkg" 2>/dev/null && ok "$cmd installed" || warn "Failed to install $cmd — install manually"
}

npm_install() {
    local cmd="$1"
    local pkg="${2:-$1}"
    local desc="${3:-}"

    if command -v "$cmd" &>/dev/null; then
        ok "$cmd ${C_DIM}$(command -v "$cmd")${C_NC}"
        return 0
    fi

    info "Installing $cmd via npm ($desc)..."
    npm install -g "$pkg" 2>/dev/null && ok "$cmd installed" || warn "Failed to install $cmd — run: npm install -g $pkg"
}

# --- Required dependencies ---

echo -e "${C_BOLD}Required${C_NC}"

check_install "git" "git" true
check_install "jq" "jq" true

# cmux — not in standard package managers
if command -v cmux &>/dev/null; then
    ok "cmux ${C_DIM}$(command -v cmux)${C_NC}"
else
    warn "cmux not found — install from: https://github.com/nichochar/cmux"
    dim "cmux is the terminal multiplexer that workbench uses for workspace management"
fi

echo

# --- AI agents (at least one needed) ---

echo -e "${C_BOLD}AI Agents${C_NC} ${C_DIM}(at least one required)${C_NC}"

if command -v claude &>/dev/null; then
    ok "claude ${C_DIM}$(command -v claude)${C_NC}"
else
    npm_install "claude" "@anthropic-ai/claude-code" "Anthropic Claude Code"
fi

if command -v opencode &>/dev/null; then
    ok "opencode ${C_DIM}$(command -v opencode)${C_NC}"
else
    dim "opencode not installed — optional alternative agent"
fi

echo

# --- Optional tools ---

echo -e "${C_BOLD}Optional tools${C_NC} ${C_DIM}(enhanced features)${C_NC}"

check_install "gh" "gh" false "PR creation"
check_install "fzf" "fzf" false "file picker"
check_install "lazygit" "lazygit" false "git TUI"
check_install "delta" "git-delta" false "diff viewer"
check_install "bat" "bat" false "file viewer"

echo

# --- Container mode (fully optional) ---

echo -e "${C_BOLD}Container mode${C_NC} ${C_DIM}(optional)${C_NC}"

if command -v docker &>/dev/null; then
    ok "docker ${C_DIM}$(command -v docker)${C_NC}"
else
    dim "docker not installed — needed for container mode only"
fi

if command -v devcontainer &>/dev/null; then
    ok "devcontainer ${C_DIM}$(command -v devcontainer)${C_NC}"
else
    dim "devcontainer CLI not installed — needed for container mode only"
    dim "Install with: npm install -g @devcontainers/cli"
fi

echo
echo -e "${C_GREEN}${C_BOLD}Done.${C_NC} Run ${C_CYAN}workbench start${C_NC} inside cmux to get started."
