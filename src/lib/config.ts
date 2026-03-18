import { homedir } from "os"
import { basename, resolve } from "path"

export const WORKBENCH_DIR = process.env.WORKBENCH_DIR ?? `${homedir()}/.workbench`
export const WORKBENCH_STATE_DIR = "/tmp/workbench"
export const WORKBENCH_SESSION = "workbench"  // Used as cmux workspace name prefix
export const DEFAULT_AGENT = (process.env.WORKBENCH_AGENT as "claude" | "opencode") ?? "claude"
export const DEFAULT_BASE_BRANCH = "main"
export const DEFAULT_MODE = "worktree" as const

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
  return resolve(repo, "..", ".workbench-worktrees", name, branch)
}

export function getStateFile(branch: string): string {
  return `${WORKBENCH_STATE_DIR}/${branch}.json`
}


export function getScriptDir(): string {
  return resolve(import.meta.dirname, "../..")
}
