import { getRepoRoot } from "./config"

function run(args: string[], cwd?: string): { ok: boolean; stdout: string } {
  const result = Bun.spawnSync(args, { cwd })
  return {
    ok: result.exitCode === 0,
    stdout: result.stdout.toString().trim(),
  }
}

/** Like run() but preserves leading whitespace (needed for porcelain parsing). */
function runRaw(args: string[], cwd?: string): { ok: boolean; stdout: string } {
  const result = Bun.spawnSync(args, { cwd })
  return {
    ok: result.exitCode === 0,
    stdout: result.stdout.toString().trimEnd(),
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
  if (result.ok) {
    // Set upstream tracking for existing branches
    run(["git", "-C", worktreeDir, "branch", "--set-upstream-to", `origin/${branch}`])
  }
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

export type FileStatus = "staged" | "unstaged" | "both" | "added" | "deleted" | "renamed" | "untracked" | "conflict"

export interface FileChange {
  path: string
  originalPath?: string
  status: FileStatus
  added: number
  removed: number
}

export function getFileChanges(worktreeDir: string): FileChange[] {
  const statusResult = runRaw(["git", "status", "--porcelain", "-uall"], worktreeDir)
  if (!statusResult.ok || !statusResult.stdout) return []

  // Per-file line counts: combine unstaged (working tree vs index) and staged (index vs HEAD)
  const lineMap = new Map<string, { added: number; removed: number }>()
  const numstatCmds = [
    run(["git", "diff", "--numstat"], worktreeDir),         // unstaged
    run(["git", "diff", "--numstat", "--cached"], worktreeDir), // staged
  ]
  for (const result of numstatCmds) {
    if (!result.ok || !result.stdout) continue
    for (const line of result.stdout.split("\n")) {
      const parts = line.split("\t")
      if (parts.length < 3) continue
      const added = parseInt(parts[0]!, 10)
      const removed = parseInt(parts[1]!, 10)
      const path = parts[2]!
      if (!isNaN(added) && !isNaN(removed) && path) {
        const prev = lineMap.get(path) ?? { added: 0, removed: 0 }
        lineMap.set(path, { added: prev.added + added, removed: prev.removed + removed })
      }
    }
  }

  const changes: FileChange[] = []

  for (const line of statusResult.stdout.split("\n")) {
    if (line.length < 3) continue
    const x = line[0]!
    const y = line[1]!
    const rest = line.slice(3)

    let path = rest
    let originalPath: string | undefined

    // Renames/copies: porcelain v1 uses tab to separate new\told paths
    if ((x === "R" || x === "C") && rest.includes("\t")) {
      const tabIdx = rest.indexOf("\t")
      path = rest.slice(0, tabIdx)
      originalPath = rest.slice(tabIdx + 1)
    }

    let status: FileStatus
    if (x === "?" && y === "?") {
      status = "untracked"
    } else if (x === "U" || y === "U") {
      status = "conflict"
    } else if (x === "R" || x === "C") {
      status = "renamed"
    } else if (x === "A" && y === " ") {
      status = "added"
    } else if (x === "D" || y === "D") {
      status = "deleted"
    } else if (x !== " " && y !== " ") {
      status = "both"
    } else if (x !== " ") {
      status = "staged"
    } else {
      status = "unstaged"
    }

    const lineCount = lineMap.get(path) ?? { added: 0, removed: 0 }
    changes.push({ path, originalPath, status, ...lineCount })
  }

  return changes
}
