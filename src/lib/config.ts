import { homedir } from "os"
import { basename, resolve } from "path"
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "fs"

export const WORKBENCH_DIR = process.env.WORKBENCH_DIR ?? `${homedir()}/.workbench`
export const WORKBENCH_STATE_DIR = "/tmp/workbench"
export const WORKBENCH_SESSION = "workbench"

// --- Config schema ---

export interface WorkbenchConfig {
  editor?: string
  agent?: "claude" | "opencode"
  base_branch?: string
  mode?: "worktree" | "container"
  worktree_dir?: string
  notifications?: {
    enabled?: boolean
    sounds?: boolean
    sound_success?: string
    sound_failure?: string
    sound_waiting?: string
  }
  intervals?: {
    diff_poll_sec?: number
    dashboard_poll_ms?: number
  }
}

const CONFIG_FILE = `${WORKBENCH_DIR}/config.toml`

export const CONFIG_TEMPLATE = `# workbench configuration — ~/.workbench/config.toml
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

[notifications]
# enabled = true
# sounds = true
# sound_success = "Glass"     # macOS sound name for task completion
# sound_failure = "Basso"     # macOS sound name for task failure
# sound_waiting = "Ping"      # macOS sound name for waiting for input

[intervals]
# diff_poll_sec = 3           # how often diff stats refresh in the watcher
# dashboard_poll_ms = 1000    # how often the dashboard polls task state
`

let _config: WorkbenchConfig | null = null

export function getConfig(): WorkbenchConfig {
  if (_config) return _config

  if (!existsSync(CONFIG_FILE)) {
    _config = {}
    return _config
  }

  try {
    const raw = readFileSync(CONFIG_FILE, "utf8")
    _config = Bun.TOML.parse(raw) as WorkbenchConfig
  } catch {
    _config = {}
  }

  return _config
}

/** Write the default config template if the config file does not yet exist. */
export function ensureConfigFile(): void {
  if (existsSync(CONFIG_FILE)) return
  mkdirSync(WORKBENCH_DIR, { recursive: true })
  writeFileSync(CONFIG_FILE, CONFIG_TEMPLATE)
}

// --- Getters ---

export function getDefaultEditor(): string {
  return getConfig().editor
    ?? process.env.EDITOR
    ?? (Bun.which("code") ? "code" : null)
    ?? (Bun.which("nvim") ? "nvim" : null)
    ?? "vim"
}

export function getDefaultAgent(): "claude" | "opencode" {
  return (process.env.WORKBENCH_AGENT as "claude" | "opencode")
    ?? getConfig().agent
    ?? "claude"
}

export function getDefaultBaseBranch(): string {
  return getConfig().base_branch ?? "main"
}

export function getDefaultMode(): "worktree" | "container" {
  return getConfig().mode ?? "worktree"
}

export function getNotificationsEnabled(): boolean {
  return getConfig().notifications?.enabled ?? true
}

export function getNotificationSoundsEnabled(): boolean {
  return getConfig().notifications?.sounds ?? true
}

export function getNotificationSound(type: "success" | "failure" | "waiting"): string {
  const n = getConfig().notifications
  switch (type) {
    case "success": return n?.sound_success ?? "Glass"
    case "failure": return n?.sound_failure ?? "Basso"
    case "waiting": return n?.sound_waiting ?? "Ping"
  }
}

export function getDiffPollSec(): number {
  return getConfig().intervals?.diff_poll_sec ?? 3
}

export function getDashboardPollMs(): number {
  return getConfig().intervals?.dashboard_poll_ms ?? 1000
}

// --- Legacy constants (backwards compat) ---
export const DEFAULT_AGENT = getDefaultAgent()
export const DEFAULT_BASE_BRANCH = getDefaultBaseBranch()
export const DEFAULT_MODE = getDefaultMode()

// --- Repo helpers ---

export function getRepoRoot(): string {
  if (process.env.WORKBENCH_REPO) return process.env.WORKBENCH_REPO

  const result = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"])
  const root = result.stdout.toString().trim()
  if (!root || result.exitCode !== 0) {
    console.error("Error: Not in a git repository. Set WORKBENCH_REPO or cd into a repo.")
    process.exit(1)
  }
  return root
}

export function getRepoName(): string {
  return basename(getRepoRoot())
}

export function getWorktreeDir(branch: string): string {
  const repo = getRepoRoot()
  const name = basename(repo)
  const configDir = getConfig().worktree_dir?.replace(/^~/, homedir())
  const parent = configDir ?? resolve(repo, "..", ".workbench-worktrees")
  return resolve(parent, name, branch)
}

export function getStateFile(branch: string): string {
  return `${WORKBENCH_STATE_DIR}/${branch}.json`
}

export function getScriptDir(): string {
  return resolve(import.meta.dirname, "../..")
}
