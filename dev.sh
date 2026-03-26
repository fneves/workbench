#!/bin/bash
# Dev shim: runs workbench from source via bun (no compile needed)
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")" && pwd)"
exec bun "$SCRIPT_DIR/src/index.tsx" "$@"
