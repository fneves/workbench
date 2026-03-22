/**
 * Shared shell function snippets used by both the host agent wrapper
 * and the container agent wrapper.
 */

/** Shell function that updates a single key in the JSON state file via jq. */
export function shellUpdateState(): string {
  return `update_state() {
    local key="$1" value="$2"
    local tmp
    tmp="$(mktemp)"
    jq --arg k "$key" --arg v "$value" \\
        '.[$k] = $v | .updated_at = (now | todate)' \\
        "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
}`;
}

/** Shell function that refreshes diff_files / diff_added / diff_removed in state. */
export function shellUpdateDiffStats(): string {
  return `update_diff_stats() {
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
}`;
}

/**
 * Shell function that sends a notification via cmux socket, terminal-notifier,
 * osascript, or notify-send (in that priority order).
 */
export function shellNotify(): string {
  return `notify() {
    local title="$1" body="$2" sound="\${3:-default}"
    # Use cmux notifications if inside cmux
    if [[ -n "\${CMUX_SOCKET_PATH:-}" ]]; then
        local socket="\$CMUX_SOCKET_PATH"
        printf '{"id":"notify","method":"notification.create","params":{"title":"%s","body":"%s"}}\\n' "$title" "$body" | nc -U -w 1 "$socket" 2>/dev/null &
    elif command -v terminal-notifier &>/dev/null; then
        terminal-notifier \\
            -title "$title" \\
            -message "$body" \\
            -group "workbench-$BRANCH_SLUG" \\
            -sound "$sound" \\
            2>/dev/null &
    elif command -v osascript &>/dev/null; then
        osascript -e "display notification \\"$body\\" with title \\"$title\\" sound name \\"$sound\\"" 2>/dev/null &
    elif command -v notify-send &>/dev/null; then
        notify-send --urgency=normal --app-name="workbench" "$title" "$body" 2>/dev/null &
    fi
    printf "\\a"
}`;
}

/**
 * Shell snippet for the background diff-stat updater loop.
 * Polls every `intervalSec` seconds and updates the state file.
 */
export function shellDiffPoller(intervalSec: number): string {
  return `# --- Background diff stat updater (every ${intervalSec}s) ---
(
    while true; do
        sleep ${intervalSec}
        [[ -f "$STATE_FILE" ]] || break
        update_diff_stats
    done
) &
DIFF_PID=$!
trap 'kill $DIFF_PID 2>/dev/null' EXIT`;
}
