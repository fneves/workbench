#!/usr/bin/env bash
set -euo pipefail

# workbench installer — curl -fsSL https://fneves.github.io/workbench/install.sh | sh
# Downloads the right binary, installs dependencies, creates default config.

REPO="fneves/workbench"
INSTALL_DIR="${WORKBENCH_INSTALL_DIR:-$HOME/.local/bin}"

C_BOLD="\033[1m"
C_GREEN="\033[0;32m"
C_YELLOW="\033[1;33m"
C_CYAN="\033[0;36m"
C_RED="\033[0;31m"
C_DIM="\033[2m"
C_NC="\033[0m"

info()  { echo -e "${C_CYAN}→${C_NC} $1"; }
ok()    { echo -e "${C_GREEN}✓${C_NC} $1"; }
warn()  { echo -e "${C_YELLOW}!${C_NC} $1"; }
err()   { echo -e "${C_RED}✗${C_NC} $1"; exit 1; }

echo -e "${C_BOLD}⚡ workbench installer${C_NC}"
echo

# --- Detect platform ---

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$ARCH" in
    x86_64|amd64) ARCH="x64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *) err "Unsupported architecture: $ARCH" ;;
esac

case "$OS" in
    darwin|linux) ;;
    *) err "Unsupported OS: $OS" ;;
esac

ARTIFACT="workbench-${OS}-${ARCH}"
info "Platform: ${OS}/${ARCH}"

# --- Get latest version ---

if command -v curl &>/dev/null; then
    FETCH="curl -fsSL"
elif command -v wget &>/dev/null; then
    FETCH="wget -qO-"
else
    err "Neither curl nor wget found"
fi

info "Fetching latest release..."
LATEST=$($FETCH "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')

if [[ -z "$LATEST" ]]; then
    err "Could not determine latest version. Check https://github.com/${REPO}/releases"
fi

ok "Latest version: ${LATEST}"

# --- Download binary ---

URL="https://github.com/${REPO}/releases/download/${LATEST}/${ARTIFACT}.tar.gz"
info "Downloading ${ARTIFACT}.tar.gz..."

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

$FETCH "$URL" > "$TMPDIR/${ARTIFACT}.tar.gz" || err "Download failed. Check if release exists at:\n  ${URL}"

# --- Extract + install ---

info "Installing to ${INSTALL_DIR}..."
mkdir -p "$INSTALL_DIR"
tar xzf "$TMPDIR/${ARTIFACT}.tar.gz" -C "$TMPDIR"
mv "$TMPDIR/${ARTIFACT}" "$INSTALL_DIR/workbench"
chmod +x "$INSTALL_DIR/workbench"
ok "Installed: ${INSTALL_DIR}/workbench"

# --- Check PATH ---

if ! echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
    echo
    warn "${INSTALL_DIR} is not in your PATH"
    echo -e "  Add it to your shell profile:"
    echo

    SHELL_NAME="$(basename "${SHELL:-bash}")"
    case "$SHELL_NAME" in
        zsh)  echo -e "  ${C_CYAN}echo 'export PATH=\"${INSTALL_DIR}:\$PATH\"' >> ~/.zshrc && source ~/.zshrc${C_NC}" ;;
        bash) echo -e "  ${C_CYAN}echo 'export PATH=\"${INSTALL_DIR}:\$PATH\"' >> ~/.bashrc && source ~/.bashrc${C_NC}" ;;
        fish) echo -e "  ${C_CYAN}fish_add_path ${INSTALL_DIR}${C_NC}" ;;
        *)    echo -e "  ${C_CYAN}export PATH=\"${INSTALL_DIR}:\$PATH\"${C_NC}" ;;
    esac

    echo
fi

# --- Create default config ---

CONFIG_DIR="$HOME/.workbench"
CONFIG_FILE="$CONFIG_DIR/config.toml"
if [[ ! -f "$CONFIG_FILE" ]]; then
    mkdir -p "$CONFIG_DIR"
    cat > "$CONFIG_FILE" <<'CONFIG_EOF'
# workbench configuration — ~/.workbench/config.toml
# Uncomment and edit any values you want to override.

# agent = "claude"            # claude | opencode
# base_branch = "main"
# mode = "worktree"           # worktree | container
# editor = "code"             # overrides $EDITOR

[notifications]
# enabled = true
# sounds = true

[intervals]
# diff_poll_sec = 3
# dashboard_poll_ms = 1000
CONFIG_EOF
    ok "Created: ~/.workbench/config.toml"
else
    ok "Config exists: ~/.workbench/config.toml"
fi

# --- Install dependencies ---

echo
echo -e "${C_BOLD}Checking dependencies...${C_NC}"
echo

install_with_brew() {
    command -v brew &>/dev/null && brew install "$1" 2>/dev/null
}

install_with_apt() {
    command -v apt-get &>/dev/null && sudo apt-get install -y "$1" 2>/dev/null
}

install_pkg() {
    local cmd="$1" brew_pkg="${2:-$1}" apt_pkg="${3:-$1}" required="${4:-false}" desc="${5:-}"

    if command -v "$cmd" &>/dev/null; then
        ok "$cmd"
        return 0
    fi

    local label="optional"
    [[ "$required" == "true" ]] && label="required"
    info "Installing $cmd ($label${desc:+ — $desc})..."

    if [[ "$OS" == "darwin" ]]; then
        install_with_brew "$brew_pkg" && { ok "$cmd installed"; return 0; }
    else
        install_with_apt "$apt_pkg" && { ok "$cmd installed"; return 0; }
    fi

    [[ "$required" == "true" ]] && warn "Could not install $cmd. Install it manually." || warn "$cmd — install manually for $desc"
    return 1
}

install_npm() {
    local cmd="$1" pkg="$2" desc="$3"

    if command -v "$cmd" &>/dev/null; then
        ok "$cmd"
        return 0
    fi

    if command -v npm &>/dev/null; then
        info "Installing $cmd via npm ($desc)..."
        npm install -g "$pkg" 2>/dev/null && { ok "$cmd installed"; return 0; }
    fi

    warn "$cmd not found — install with: npm install -g $pkg"
    return 1
}

ISSUES=0

# Required
install_pkg "git" "git" "git" true || ((ISSUES++))
install_pkg "jq" "jq" "jq" true || ((ISSUES++))

# cmux
if command -v cmux &>/dev/null; then
    ok "cmux"
else
    warn "cmux not found — download from: https://cmux.dev"
    echo -e "  ${C_DIM}cmux is the terminal multiplexer that workbench requires${C_NC}"
    ((ISSUES++))
fi

# Agent
install_npm "claude" "@anthropic-ai/claude-code" "AI agent" || true

# Optional
install_pkg "gh" "gh" "gh" false "PR creation" || true
install_pkg "fzf" "fzf" "fzf" false "file picker" || true
install_pkg "lazygit" "lazygit" "lazygit" false "git TUI" || true
install_pkg "delta" "git-delta" "git-delta" false "diff viewer" || true
install_pkg "bat" "bat" "bat" false "file viewer" || true

echo

# --- Done ---

if [[ $ISSUES -gt 0 ]]; then
    echo -e "${C_YELLOW}${C_BOLD}Installed with ${ISSUES} missing requirement(s).${C_NC}"
    echo -e "Fix the items above, then run: ${C_CYAN}workbench doctor${C_NC}"
else
    echo -e "${C_GREEN}${C_BOLD}Installation complete.${C_NC}"
fi

echo
echo -e "Get started:"
echo -e "  ${C_CYAN}1.${C_NC} Open ${C_CYAN}cmux${C_NC}"
echo -e "  ${C_CYAN}2.${C_NC} Run ${C_CYAN}workbench start${C_NC}"
echo
