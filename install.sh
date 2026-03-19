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
check_dep "bun" || MISSING=true
check_dep "git" || MISSING=true
check_dep "cmux" || MISSING=true

echo ""
echo -e "${BOLD}Optional tools:${NC}"
check_dep "jq" false                  # Used by agent wrapper scripts
check_dep "claude" false              # Claude Code CLI
check_dep "opencode" false            # OpenCode CLI
check_dep "docker" false              # Required for container mode
check_dep "devcontainer" false        # Required for container mode (npm i -g @devcontainers/cli)
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
    echo -e "  ${DIM}# Install bun${NC}"
    echo -e "  curl -fsSL https://bun.sh/install | bash"
    echo ""
    echo -e "  ${DIM}# macOS${NC}"
    echo -e "  brew tap manaflow-ai/cmux && brew install --cask cmux"
    echo -e "  brew install fzf git-delta lazygit"
    exit 1
fi

# --- Install npm dependencies ---
echo ""
echo -e "${BOLD}Installing dependencies...${NC}"
(cd "$SCRIPT_DIR" && bun install)

# --- Create wrapper script ---
echo ""
echo -e "${BOLD}Installing to $INSTALL_DIR...${NC}"
mkdir -p "$INSTALL_DIR"

WRAPPER="$INSTALL_DIR/workbench"
cat > "$WRAPPER" <<WRAPPER_EOF
#!/usr/bin/env bash
exec bun "$SCRIPT_DIR/src/index.tsx" "\$@"
WRAPPER_EOF
chmod +x "$WRAPPER"
echo -e "  ${GREEN}→${NC} workbench"

# --- Create default config if missing ---
CONFIG_DIR="$HOME/.workbench"
CONFIG_FILE="$CONFIG_DIR/config.toml"
if [[ ! -f "$CONFIG_FILE" ]]; then
    mkdir -p "$CONFIG_DIR"
    cat > "$CONFIG_FILE" <<'CONFIG_EOF'
# workbench configuration — ~/.workbench/config.toml
# Uncomment and edit any values you want to override.

# Default agent for new tasks
# agent = "claude"            # claude | opencode

# Default base branch when creating worktrees
# base_branch = "main"

# Default task mode
# mode = "worktree"           # worktree | container

# Editor to open with 'e' in the watcher
# Overrides $EDITOR. Falls back to $EDITOR, then code, nvim, vim.
# editor = "code"

# Parent directory for all worktrees ({worktree_dir}/{repo}/{branch})
# worktree_dir = "~/.workbench-worktrees"

# Default devcontainer base image (when repo has no .devcontainer/)
# container_image = "mcr.microsoft.com/devcontainers/base:ubuntu"

# Path to Claude credentials on the host (mounted read-only into containers)
# container_claude_home = "~/.claude"

[notifications]
# enabled = true
# sounds = true
# sound_success = "Glass"     # macOS sound name for task completion
# sound_failure = "Basso"     # macOS sound name for task failure
# sound_waiting = "Ping"      # macOS sound name for waiting for input

[intervals]
# diff_poll_sec = 3           # how often diff stats refresh in the watcher
# dashboard_poll_ms = 1000    # how often the dashboard polls task state
CONFIG_EOF
    echo -e "  ${GREEN}→${NC} ~/.workbench/config.toml"
else
    echo -e "  ${DIM}↷  ~/.workbench/config.toml (already exists, skipped)${NC}"
fi

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
