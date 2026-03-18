import {
  getNotificationsEnabled,
  getNotificationSoundsEnabled,
  getNotificationSound,
  getDiffPollSec,
} from "../lib/config"

export function generateAgentWrapper(opts: {
  stateFile: string
  worktreeDir: string
  branch: string
  agent: "claude" | "opencode"
  prompt: string
  interactive: boolean
}): string {
  const notifyEnabled = getNotificationsEnabled()
  const soundsEnabled = getNotificationSoundsEnabled()
  const soundSuccess = soundsEnabled ? getNotificationSound("success") : ""
  const soundFailure = soundsEnabled ? getNotificationSound("failure") : ""
  const diffPollSec = getDiffPollSec()

  const agentCmd = (() => {
    if (opts.agent === "opencode") return "opencode"
    if (opts.interactive || !opts.prompt) return "claude"
    const escaped = opts.prompt.replace(/'/g, "'\\''")
    return `claude '${escaped}'`
  })()

  return `#!/usr/bin/env zsh
set -uo pipefail

STATE_FILE="${opts.stateFile}"
WORKTREE_DIR="${opts.worktreeDir}"
BRANCH="${opts.branch}"

update_state() {
    local key="$1" value="$2"
    local tmp
    tmp="$(mktemp)"
    jq --arg k "$key" --arg v "$value" \\
        '.[$k] = $v | .updated_at = (now | todate)' \\
        "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
}

update_diff_stats() {
    local summary
    summary="$(cd "$WORKTREE_DIR" && git diff --shortstat HEAD 2>/dev/null || echo "")"
    local files=0 added=0 removed=0
    if [[ -n "$summary" ]]; then
        files=$(echo "$summary" | grep -oE '[0-9]+ file'       | grep -oE '[0-9]+' || echo 0)
        added=$(echo "$summary" | grep -oE '[0-9]+ insertion'  | grep -oE '[0-9]+' || echo 0)
        removed=$(echo "$summary" | grep -oE '[0-9]+ deletion' | grep -oE '[0-9]+' || echo 0)
    fi
    local tmp
    tmp="$(mktemp)"
    jq --argjson f "\${files:-0}" --argjson a "\${added:-0}" --argjson r "\${removed:-0}" \\
        '.diff_files = $f | .diff_added = $a | .diff_removed = $r | .updated_at = (now | todate)' \\
        "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
}

notify() {
    local title="$1" body="$2" sound="\${3:-default}"
    # Use cmux notifications if inside cmux
    if [[ -n "\${CMUX_SOCKET_PATH:-}" ]]; then
        local socket="\$CMUX_SOCKET_PATH"
        printf '{"id":"notify","method":"notification.create","params":{"title":"%s","body":"%s"}}\\n' "$title" "$body" | nc -U -w 1 "$socket" 2>/dev/null &
    elif command -v terminal-notifier &>/dev/null; then
        terminal-notifier \\
            -title "$title" \\
            -message "$body" \\
            -group "workbench-$BRANCH" \\
            -sound "$sound" \\
            2>/dev/null &
    elif command -v osascript &>/dev/null; then
        osascript -e "display notification \\"$body\\" with title \\"$title\\" sound name \\"$sound\\"" 2>/dev/null &
    elif command -v notify-send &>/dev/null; then
        notify-send --urgency=normal --app-name="workbench" "$title" "$body" 2>/dev/null &
    fi
    printf "\\a"
}

# --- Background diff stat updater (every ${diffPollSec}s) ---
(
    while true; do
        sleep ${diffPollSec}
        [[ -f "$STATE_FILE" ]] || break
        update_diff_stats
    done
) &
DIFF_PID=$!
trap 'kill $DIFF_PID 2>/dev/null' EXIT

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
`
}
