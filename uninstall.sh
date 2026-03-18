#!/usr/bin/env zsh
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

INSTALL_DIR="${WORKBENCH_INSTALL_DIR:-$HOME/.local/bin}"

# Remove new single binary
BINS=(workbench)
# Also clean up old script symlinks if they exist
OLD_BINS=(wb-status wb-spawn wb-watch wb-cleanup wb-notify)

echo -e "${PURPLE:-\033[0;35m}${BOLD}⚡ workbench uninstaller${NC}"
echo ""

for name in "${BINS[@]}" "${OLD_BINS[@]}"; do
    target="$INSTALL_DIR/$name"
    if [[ -L "$target" ]] || [[ -f "$target" ]]; then
        rm "$target"
        echo -e "  ${RED}✗${NC} removed $target"
    fi
done

echo ""
echo -e "${GREEN}${BOLD}✓ Uninstalled!${NC}"
