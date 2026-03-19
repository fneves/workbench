import { getRepoRoot } from "./config"

function run(args: string[], cwd?: string): { ok: boolean; stdout: string } {
  const result = Bun.spawnSync(args, { cwd })
  return {
    ok: result.exitCode === 0,
    stdout: result.stdout.toString().trim(),
  }
}

export function createWorktree(
  worktreeDir: string,
  branch: string,
  baseBranch: string,
): boolean {
  const repo = getRepoRoot()
  // Try creating new branch from base
  let result = run(
    ["git", "-C", repo, "worktree", "add", worktreeDir, "-b", branch, baseBranch],
  )
  if (result.ok) return true
  // Try checking out existing branch
  result = run(["git", "-C", repo, "worktree", "add", worktreeDir, branch])
  return result.ok
}

export function removeWorktree(worktreeDir: string): boolean {
  const repo = getRepoRoot()
  const result = run(["git", "-C", repo, "worktree", "remove", "--force", worktreeDir])
  if (!result.ok) {
    // Force remove and prune
    const { rmSync } = require("fs") as typeof import("fs")
    try {
      rmSync(worktreeDir, { recursive: true, force: true })
    } catch {}
    run(["git", "-C", repo, "worktree", "prune"])
  }
  return true
}

export interface DiffStats {
  files: number
  added: number
  removed: number
}

export function getDiffStats(worktreeDir: string): DiffStats {
  const result = run(["git", "diff", "--shortstat", "HEAD"], worktreeDir)
  if (!result.ok || !result.stdout) return { files: 0, added: 0, removed: 0 }

  const summary = result.stdout
  const files = parseInt(summary.match(/(\d+) file/)?.[1] ?? "0", 10)
  const added = parseInt(summary.match(/(\d+) insertion/)?.[1] ?? "0", 10)
  const removed = parseInt(summary.match(/(\d+) deletion/)?.[1] ?? "0", 10)
  return { files, added, removed }
}

export function getDiffStat(worktreeDir: string): string {
  const result = run(["git", "diff", "--stat", "--color", "HEAD"], worktreeDir)
  return result.stdout
}

export function getUntrackedFiles(worktreeDir: string): string[] {
  const result = run(
    ["git", "ls-files", "--others", "--exclude-standard"],
    worktreeDir,
  )
  if (!result.ok || !result.stdout) return []
  return result.stdout.split("\n").filter(Boolean)
}

export function getCurrentBranch(worktreeDir: string): string | null {
  const result = run(["git", "rev-parse", "--abbrev-ref", "HEAD"], worktreeDir)
  const branch = result.stdout
  if (!result.ok || !branch || branch === "HEAD") return null
  return branch
}

export function getChangedFiles(worktreeDir: string): string[] {
  const result = run(["git", "diff", "--name-only", "HEAD"], worktreeDir)
  if (!result.ok || !result.stdout) return []
  return result.stdout.split("\n").filter(Boolean)
}
