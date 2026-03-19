import { getDefaultEditor } from "../lib/config"

/**
 * Generate a shell script that handles the full PR creation flow:
 * 1. Commit uncommitted changes (uses claude for semantic commit message)
 * 2. Push branch to remote
 * 3. Generate PR title + description (respects repo's PR template)
 * 4. Open editor for user to review/modify
 * 5. Create PR via gh cli after editor exits
 */
export function generatePrCreatorScript(opts: {
  worktree: string
  branch: string
  slug: string
}): string {
  const editor = getDefaultEditor()

  return `#!/usr/bin/env zsh
set -uo pipefail

WORKTREE="${opts.worktree}"
BRANCH="${opts.branch}"
SLUG="${opts.slug}"
PR_DIR="/tmp/workbench/\${SLUG}.pr"
EDITOR_CMD="${editor}"

RED='\\033[0;31m'
GREEN='\\033[0;32m'
YELLOW='\\033[1;33m'
CYAN='\\033[0;36m'
DIM='\\033[2m'
BOLD='\\033[1m'
NC='\\033[0m'

mkdir -p "$PR_DIR"
cd "$WORKTREE"

# --- Check gh cli ---
if ! command -v gh &>/dev/null; then
    echo -e "\${RED}Error: gh (GitHub CLI) not found. Install with: brew install gh\${NC}"
    exit 1
fi

if ! gh auth status &>/dev/null 2>&1; then
    echo -e "\${RED}Error: Not authenticated with GitHub. Run: gh auth login\${NC}"
    exit 1
fi

# --- Determine base branch ---
BASE_BRANCH="$(gh repo view --json defaultBranchRef -q '.defaultBranchRef.name' 2>/dev/null || echo 'main')"

# --- 1. Commit uncommitted changes ---
if [[ -n "$(git status --porcelain)" ]]; then
    echo -e "\${CYAN}Uncommitted changes detected — generating commit message...\${NC}"

    # Write diff to file for claude to read
    git diff HEAD > "$PR_DIR/commit-diff.txt"
    git diff --cached >> "$PR_DIR/commit-diff.txt"
    git status --porcelain >> "$PR_DIR/commit-diff.txt"

    # Generate commit message via claude
    claude -p "You are a git commit message generator. Based on the diff below, write a concise conventional commit message. Output ONLY the commit message (subject line + optional body separated by a blank line). No markdown fences, no explanation.

$(cat "$PR_DIR/commit-diff.txt")" --dangerously-skip-permissions > "$PR_DIR/commit-msg.txt" 2>/dev/null

    if [[ $? -ne 0 ]] || [[ ! -s "$PR_DIR/commit-msg.txt" ]]; then
        echo -e "\${YELLOW}Could not generate commit message. Using fallback.\${NC}"
        echo "chore: update $BRANCH" > "$PR_DIR/commit-msg.txt"
    fi

    echo -e "\${DIM}Commit message:\${NC}"
    cat "$PR_DIR/commit-msg.txt" | head -5
    echo ""

    git add -A
    git commit -F "$PR_DIR/commit-msg.txt"
    echo ""
fi

# --- 2. Push branch ---
echo -e "\${CYAN}Pushing branch to origin...\${NC}"
git push -u origin "$BRANCH" 2>&1
if [[ $? -ne 0 ]]; then
    echo -e "\${RED}Failed to push branch.\${NC}"
    exit 1
fi
echo ""

# --- 3. Check for existing PR ---
EXISTING_PR="$(gh pr view "$BRANCH" --json url -q '.url' 2>/dev/null)"
if [[ -n "$EXISTING_PR" ]]; then
    echo -e "\${GREEN}PR already exists: $EXISTING_PR\${NC}"
    echo -e "\${DIM}Opening in browser...\${NC}"
    gh pr view "$BRANCH" --web 2>/dev/null
    exit 0
fi

# --- 4. Gather context for PR description ---
echo -e "\${CYAN}Generating PR description...\${NC}"

# Get commit log and diff stat relative to base branch
git log "origin/$BASE_BRANCH..HEAD" --oneline > "$PR_DIR/commits.txt" 2>/dev/null
git diff --stat "origin/$BASE_BRANCH..HEAD" > "$PR_DIR/diffstat.txt" 2>/dev/null
git diff "origin/$BASE_BRANCH..HEAD" > "$PR_DIR/full-diff.txt" 2>/dev/null

# Check for PR template
PR_TEMPLATE=""
for tpl in \\
    .github/pull_request_template.md \\
    .github/PULL_REQUEST_TEMPLATE.md \\
    .github/PULL_REQUEST_TEMPLATE/pull_request_template.md \\
    docs/pull_request_template.md \\
    PULL_REQUEST_TEMPLATE.md; do
    if [[ -f "$tpl" ]]; then
        PR_TEMPLATE="$tpl"
        break
    fi
done

# --- 5. Generate PR title and description via claude ---
TEMPLATE_SECTION=""
if [[ -n "$PR_TEMPLATE" ]]; then
    TEMPLATE_SECTION="Fill in this PR template:\\n\\n$(cat "$PR_TEMPLATE")"
fi

claude -p "Generate a pull request title and description.

Commits on this branch:
$(cat "$PR_DIR/commits.txt")

Diff stats:
$(cat "$PR_DIR/diffstat.txt")

Full diff (may be truncated):
$(head -500 "$PR_DIR/full-diff.txt")

$TEMPLATE_SECTION

Output format (STRICTLY follow this):
Line 1: The PR title (short, under 70 chars, no prefix like 'Title:')
Line 2: empty
Line 3+: The PR body in markdown. Be specific about what changed and why." --dangerously-skip-permissions > "$PR_DIR/pr-raw.txt" 2>/dev/null

if [[ $? -ne 0 ]] || [[ ! -s "$PR_DIR/pr-raw.txt" ]]; then
    echo -e "\${YELLOW}Could not generate PR description. Using defaults.\${NC}"
    echo "$BRANCH" > "$PR_DIR/pr-raw.txt"
    echo "" >> "$PR_DIR/pr-raw.txt"
    echo "## Changes" >> "$PR_DIR/pr-raw.txt"
    echo "" >> "$PR_DIR/pr-raw.txt"
    cat "$PR_DIR/commits.txt" >> "$PR_DIR/pr-raw.txt"
fi

# --- 6. Write editable PR file ---
# Format: first line = title, blank line, rest = body
cat > "$PR_DIR/pr-edit.md" <<'HEADER'
# Edit your PR below. First line = title, rest = body.
# Lines starting with # are comments and will be stripped.
# Save and exit to create the PR. Empty file aborts.
#
HEADER
cat "$PR_DIR/pr-raw.txt" >> "$PR_DIR/pr-edit.md"

# --- 7. Open editor ---
echo -e "\${GREEN}Opening editor — edit the PR title and description, then save and exit.\${NC}"
echo ""
"$EDITOR_CMD" "$PR_DIR/pr-edit.md"

# --- 8. Parse edited file and create PR ---
# Strip comment lines
grep -v '^#' "$PR_DIR/pr-edit.md" | sed '/./,$!d' > "$PR_DIR/pr-final.txt"

if [[ ! -s "$PR_DIR/pr-final.txt" ]]; then
    echo -e "\${YELLOW}PR creation aborted (empty file).\${NC}"
    exit 0
fi

# First non-empty line = title, rest = body
PR_TITLE="$(head -1 "$PR_DIR/pr-final.txt")"
PR_BODY="$(tail -n +3 "$PR_DIR/pr-final.txt")"

if [[ -z "$PR_TITLE" ]]; then
    echo -e "\${RED}No PR title found. Aborting.\${NC}"
    exit 1
fi

echo -e "\${CYAN}Creating PR...\${NC}"
echo -e "\${DIM}Title: $PR_TITLE\${NC}"
echo ""

gh pr create \\
    --draft \\
    --base "$BASE_BRANCH" \\
    --title "$PR_TITLE" \\
    --body "$PR_BODY"

PR_URL="$(gh pr view "$BRANCH" --json url -q '.url' 2>/dev/null)"
if [[ -n "$PR_URL" ]]; then
    echo ""
    echo -e "\${GREEN}\${BOLD}✓ Draft PR created: $PR_URL\${NC}"
    # Write PR URL to sentinel file so the watcher can pick it up
    echo "$PR_URL" > "/tmp/workbench/\${SLUG}.pr-url"
fi

# Cleanup temp files
rm -rf "$PR_DIR"
`
}
