import {
  getNotificationsEnabled,
  getNotificationSoundsEnabled,
  getNotificationSound,
  getDiffPollSec,
} from "../lib/config";
import {
  shellUpdateState,
  shellUpdateDiffStats,
  shellNotify,
  shellDiffPoller,
} from "./shell-helpers";

export function generateAgentWrapper(opts: {
  stateFile: string;
  worktreeDir: string;
  branch: string;
  agent: "claude" | "opencode";
  prompt: string;
  interactive: boolean;
}): string {
  const notifyEnabled = getNotificationsEnabled();
  const soundsEnabled = getNotificationSoundsEnabled();
  const soundSuccess = soundsEnabled ? getNotificationSound("success") : "";
  const soundFailure = soundsEnabled ? getNotificationSound("failure") : "";
  const diffPollSec = getDiffPollSec();

  const agentCmd = (() => {
    if (opts.agent === "opencode") return "opencode";
    if (opts.interactive || !opts.prompt) return "claude";
    const escaped = opts.prompt.replace(/'/g, "'\\''");
    return `claude '${escaped}'`;
  })();

  return `#!/usr/bin/env zsh
set -uo pipefail

STATE_FILE="${opts.stateFile}"
WORKTREE_DIR="${opts.worktreeDir}"
BRANCH="${opts.branch}"
BRANCH_SLUG="\${BRANCH//\\//-}"

${shellUpdateState()}

${shellUpdateDiffStats()}

${shellNotify()}

${shellDiffPoller(diffPollSec)}

# --- Mark as running ---
cd "$WORKTREE_DIR"
update_state "status" "running"
update_state "pid" "$$"

echo ""
echo -e "\\033[0;35m\\033[1m⚡ workbench\\033[0m — $BRANCH"
echo -e "\\033[2m   worktree: $WORKTREE_DIR\\033[0m"
echo ""

${agentCmd}
EXIT_CODE=$?

# --- Finalize ---
update_diff_stats

if [[ $EXIT_CODE -eq 0 ]]; then
    update_state "status" "done"
    ${notifyEnabled ? `notify "✓ $BRANCH" "Agent finished successfully" "${soundSuccess}"` : "# notifications disabled"}
else
    update_state "status" "failed"
    ${notifyEnabled ? `notify "✗ $BRANCH" "Agent exited with code $EXIT_CODE" "${soundFailure}"` : "# notifications disabled"}
fi

echo ""
echo -e "\\033[2mAgent exited ($EXIT_CODE). You're still in the worktree. Ctrl+D to close.\\033[0m"
exec zsh
`;
}
