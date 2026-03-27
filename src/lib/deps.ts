import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";
import { WORKBENCH_DIR } from "#lib/config";

export type PackageManager = "yarn" | "npm" | "pnpm" | "bun";

const LOCKFILE_MAP: Record<string, PackageManager> = {
  "yarn.lock": "yarn",
  "pnpm-lock.yaml": "pnpm",
  "bun.lockb": "bun",
  "bun.lock": "bun",
  "package-lock.json": "npm",
};

const LOCKFILES_TO_COMPARE = [
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "npm-shrinkwrap.json",
] as const;

/**
 * Detect which package manager a repo uses by checking for lockfiles.
 * Returns null if no known lockfile is found.
 */
export function detectPackageManager(repoDir: string): PackageManager | null {
  for (const [lockfile, pm] of Object.entries(LOCKFILE_MAP)) {
    if (existsSync(resolve(repoDir, lockfile))) {
      return pm;
    }
  }
  return null;
}

export function getSourceNodeModules(repoDir: string): string | null {
  const nm = resolve(repoDir, "node_modules");
  return existsSync(nm) ? nm : null;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Write a shell init script into the worktree that wraps package manager
 * commands to remove the node_modules symlink only when they would mutate
 * the dependency tree.
 * This file is sourced by the agent wrapper and can be sourced by
 * any other shell opened in the worktree.
 */
export function writeShellInit(
  worktreeDir: string,
  sourceRepoDir: string,
  pm: PackageManager,
): void {
  const initFile = resolve(worktreeDir, ".workbench-shell-init.sh");

  // All package managers that could mutate node_modules need wrapping.
  // We wrap the detected one plus npm (always present as fallback).
  const pmsToWrap = new Set<string>([pm, "npm", "yarn", "pnpm", "bun"]);

  const shellHelpers = `WORKBENCH_SOURCE_REPO=${shellQuote(sourceRepoDir)}
WORKBENCH_LOCKFILES=(${LOCKFILES_TO_COMPARE.map(shellQuote).join(" ")})

workbench_filter_package_manifests() {
    while IFS= read -r file; do
        if [[ "$file" == "package.json" || "$file" == */package.json ]]; then
            printf '%s\\n' "$file"
        fi
    done
}

workbench_list_tracked_package_manifests() {
    local root="$1"

    [[ -d "$root" ]] || return 1

    git -C "$root" ls-files --cached --full-name 2>/dev/null |
        workbench_filter_package_manifests |
        LC_ALL=C sort
}

workbench_list_worktree_package_manifests() {
    local root="$1"

    [[ -d "$root" ]] || return 1

    {
        git -C "$root" ls-files --cached --full-name 2>/dev/null
        git -C "$root" ls-files --others --exclude-standard --full-name 2>/dev/null
    } |
        workbench_filter_package_manifests |
        LC_ALL=C sort -u
}

workbench_dependency_inputs_differ() {
    local source_root="$WORKBENCH_SOURCE_REPO"
    local worktree_root="\${WORKTREE_DIR:-$PWD}"
    local source_manifests
    local worktree_manifests
    local rel
    local lockfile
    local source_file
    local worktree_file

    source_manifests="$(workbench_list_tracked_package_manifests "$source_root")" || return 0
    worktree_manifests="$(workbench_list_worktree_package_manifests "$worktree_root")" || return 0

    if [[ "$source_manifests" != "$worktree_manifests" ]]; then
        return 0
    fi

    while IFS= read -r rel; do
        [[ -z "$rel" ]] && continue
        source_file="$source_root/$rel"
        worktree_file="$worktree_root/$rel"

        if [[ ! -e "$source_file" || ! -e "$worktree_file" ]]; then
            return 0
        fi

        if ! cmp -s "$source_file" "$worktree_file"; then
            return 0
        fi
    done <<< "$source_manifests"

    for lockfile in "\${WORKBENCH_LOCKFILES[@]}"; do
        source_file="$source_root/$lockfile"
        worktree_file="$worktree_root/$lockfile"

        if [[ ! -e "$source_file" && ! -e "$worktree_file" ]]; then
            continue
        fi

        if [[ ! -e "$source_file" || ! -e "$worktree_file" ]]; then
            return 0
        fi

        if ! cmp -s "$source_file" "$worktree_file"; then
            return 0
        fi
    done

    return 1
}

workbench_has_positional_arg() {
    local arg

    for arg in "$@"; do
        if [[ "$arg" == "--" || "$arg" != -* ]]; then
            return 0
        fi
    done

    return 1
}

workbench_should_unlink_yarn() {
    local cmd="\${1:-install}"

    if [[ $# -gt 0 ]]; then
        shift
    fi

    if [[ "$cmd" == -* ]]; then
        workbench_dependency_inputs_differ
        return $?
    fi

    case "$cmd" in
        add|remove|up|upgrade|upgrade-interactive|dedupe|import)
            return 0
            ;;
        install|i)
            workbench_dependency_inputs_differ
            return $?
            ;;
        *)
            return 1
            ;;
    esac
}

workbench_should_unlink_npm() {
    local cmd="\${1:-}"

    if [[ $# -gt 0 ]]; then
        shift
    fi

    case "$cmd" in
        add|uninstall|remove|rm|update|upgrade|dedupe|prune|ci)
            return 0
            ;;
        install|i)
            if workbench_has_positional_arg "$@"; then
                return 0
            fi

            workbench_dependency_inputs_differ
            return $?
            ;;
        *)
            return 1
            ;;
    esac
}

workbench_should_unlink_pnpm() {
    local cmd="\${1:-}"

    if [[ $# -gt 0 ]]; then
        shift
    fi

    case "$cmd" in
        add|remove|rm|update|up|upgrade|dedupe|prune|import)
            return 0
            ;;
        install|i)
            workbench_dependency_inputs_differ
            return $?
            ;;
        *)
            return 1
            ;;
    esac
}

workbench_should_unlink_bun() {
    local cmd="\${1:-}"

    if [[ $# -gt 0 ]]; then
        shift
    fi

    case "$cmd" in
        add|remove|rm|update|up)
            return 0
            ;;
        install|i)
            workbench_dependency_inputs_differ
            return $?
            ;;
        *)
            return 1
            ;;
    esac
}
`;

  const wrappers = [...pmsToWrap]
    .map(
      (name) => `${name}() {
    local nm="\${WORKTREE_DIR:-$PWD}/node_modules"
    if workbench_should_unlink_${name} "$@" && [[ -L "$nm" ]]; then
        echo -e "\\033[2m   removing node_modules symlink for ${name}...\\033[0m"
        rm "$nm"
    fi
    command ${name} "$@"
}`,
    )
    .join("\n\n");

  writeFileSync(
    initFile,
    `# Auto-generated by workbench — removes node_modules symlink only for dependency-impacting package manager commands
${shellHelpers}

${wrappers}
`,
  );

  // Exclude from git so the agent doesn't commit it
  const excludeFile = resolve(worktreeDir, ".git", "info", "exclude");
  try {
    const existing = existsSync(excludeFile) ? readFileSync(excludeFile, "utf-8") : "";
    if (!existing.includes(".workbench-shell-init.sh")) {
      appendFileSync(excludeFile, "\n.workbench-shell-init.sh\n");
    }
  } catch {
    // .git/info/exclude may not exist in worktrees (they use .git files)
  }
}

const SHELL_HOOK_FILE = resolve(WORKBENCH_DIR, "shell-init.zsh");
const SHELL_HOOK_CONTENT = `# workbench: conditionally source worktree shell init when entering a directory
# Only activates if the directory has a .workbench-shell-init.sh (created by workbench spawn).
# In all other directories, yarn/bun/npm/pnpm remain completely untouched.
_workbench_chpwd() {
    [[ -f "$PWD/.workbench-shell-init.sh" ]] && source "$PWD/.workbench-shell-init.sh"
}
autoload -Uz add-zsh-hook
add-zsh-hook chpwd _workbench_chpwd
_workbench_chpwd  # run on shell startup for initial directory
`;

const ZSHRC_SOURCE_LINE = `source "${SHELL_HOOK_FILE}"`;

/**
 * Ensure the global zsh chpwd hook file exists. Returns whether
 * ~/.zshrc still needs the source line added.
 */
export function ensureShellHook(): { installed: boolean; needsSetup: boolean } {
  mkdirSync(WORKBENCH_DIR, { recursive: true });

  // Always write/update the hook file
  writeFileSync(SHELL_HOOK_FILE, SHELL_HOOK_CONTENT);

  // Check if ~/.zshrc sources it
  const zshrc = resolve(homedir(), ".zshrc");
  try {
    const content = existsSync(zshrc) ? readFileSync(zshrc, "utf-8") : "";
    if (content.includes("shell-init.zsh")) {
      return { installed: true, needsSetup: false };
    }
  } catch {
    // Can't read .zshrc
  }

  return { installed: true, needsSetup: true };
}

/**
 * Append the source line to ~/.zshrc so the chpwd hook is loaded in all shells.
 */
export function installShellHook(): void {
  const zshrc = resolve(homedir(), ".zshrc");
  appendFileSync(
    zshrc,
    `\n# workbench: auto-source worktree shell wrappers on cd\n${ZSHRC_SOURCE_LINE}\n`,
  );
}
