import { getDiffPollSec } from "#lib/config";
import { shellUpdateState, shellUpdateDiffStats, shellDiffPoller } from "#templates/shell-helpers";

/**
 * Shell script to run Claude Code / OpenCode inside a devcontainer.
 * Headless mode uses `claude -p` (non-interactive). Interactive mode matches host
 * worktree behavior: TTY session, then `exec zsh` so you stay in the worktree.
 *
 * State under /tmp/workbench is bind-mounted from the host; repo edits are the same
 * worktree bind-mount, so the host and container stay in sync.
 */
export function generateContainerAgentWrapper(opts: {
  stateFile: string;
  worktreeDir: string;
  branch: string;
  agent: "claude" | "opencode";
  prompt: string;
  interactive: boolean;
}): string {
  const diffPollSec = getDiffPollSec();
  const escaped = opts.prompt.replace(/'/g, "'\\''");

  const agentCmd = (() => {
    if (opts.agent === "opencode") {
      return "opencode";
    }
    if (opts.interactive || !opts.prompt) {
      return "claude";
    }
    return `claude -p '${escaped}' --dangerously-skip-permissions`;
  })();

  const endShell = opts.interactive
    ? `

echo ""
echo -e "\\033[2mAgent exited ($EXIT_CODE). You're still in the worktree. Ctrl+D to close.\\033[0m"
exec zsh
`
    : `

echo ""
echo -e "\\033[2mAgent exited ($EXIT_CODE).\\033[0m"
exit $EXIT_CODE
`;

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

${agentCmd}
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
${endShell}`;
}
