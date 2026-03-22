import { getDiffPollSec } from "#lib/config";
import { shellUpdateState, shellUpdateDiffStats, shellDiffPoller } from "#templates/shell-helpers";

/**
 * Generate a shell script for running Claude Code headlessly inside a devcontainer.
 *
 * Key differences from the host agent wrapper:
 * - Uses `claude -p "prompt"` (headless, non-interactive)
 * - Working directory: /workspace
 * - No cmux notifications (no socket access from container)
 * - Writes a sentinel file for notification instead
 * - No `exec zsh` at end — clean exit
 */
export function generateContainerAgentWrapper(opts: {
  stateFile: string;
  worktreeDir: string;
  branch: string;
  prompt: string;
}): string {
  const diffPollSec = getDiffPollSec();
  const escaped = opts.prompt.replace(/'/g, "'\\''");

  return `#!/usr/bin/env zsh
set -uo pipefail

STATE_FILE="${opts.stateFile}"
WORKTREE_DIR="${opts.worktreeDir}"
BRANCH="${opts.branch}"
BRANCH_SLUG="\${BRANCH//\\//-}"

${shellUpdateState()}

${shellUpdateDiffStats()}

# Sentinel-based notification (no cmux socket access from container)
notify_sentinel() {
    local task_status="$1" exit_code="\${2:-0}"
    local sentinel="/tmp/workbench/\${BRANCH_SLUG}.notify"
    printf '{"branch":"%s","status":"%s","exit_code":%s,"time":"%s"}\\n' \\
        "$BRANCH" "$task_status" "$exit_code" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \\
        > "$sentinel"
}

${shellDiffPoller(diffPollSec)}

# --- Mark as running ---
cd "$WORKTREE_DIR"
update_state "status" "running"
update_state "pid" "$$"

echo ""
echo -e "\\033[0;35m\\033[1m⚡ workbench [container]\\033[0m — $BRANCH"
echo -e "\\033[2m   worktree: $WORKTREE_DIR\\033[0m"
echo ""

claude -p '${escaped}' --dangerously-skip-permissions
EXIT_CODE=$?

# --- Finalize ---
update_diff_stats

if [[ $EXIT_CODE -eq 0 ]]; then
    update_state "status" "done"
    notify_sentinel "done" "$EXIT_CODE"
else
    update_state "status" "failed"
    notify_sentinel "failed" "$EXIT_CODE"
fi

echo ""
echo -e "\\033[2mAgent exited ($EXIT_CODE).\\033[0m"
exit $EXIT_CODE
`;
}
