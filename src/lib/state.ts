import { existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { basename, resolve } from "path";
import { WORKBENCH_STATE_DIR, getStateFile, getRepoRoot } from "#lib/config";
import { getDiffStats, getCurrentBranch } from "#lib/git";
import { isProcessAlive } from "#lib/process";

export interface TaskState {
  branch: string;
  status: "starting" | "running" | "prompting" | "done" | "failed" | "killing" | "unknown";
  agent: "claude" | "opencode";
  mode: "worktree" | "container";
  worktree: string;
  prompt: string;
  diff_added: number;
  diff_removed: number;
  diff_files: number;
  created_at: string;
  updated_at: string;
  pid: number | null;
  cmux_workspace_id: string | null;
  cmux_agent_surface_id: string | null;
  container_id: string | null;
  devcontainer_config: string | null;
}

export async function readState(branch: string): Promise<TaskState | null> {
  try {
    const file = Bun.file(getStateFile(branch));
    if (!(await file.exists())) return null;
    return (await file.json()) as TaskState;
  } catch {
    return null;
  }
}

export async function writeState(branch: string, state: TaskState): Promise<void> {
  await Bun.write(getStateFile(branch), JSON.stringify(state, null, 2));
}

export async function updateState(branch: string, updates: Partial<TaskState>): Promise<void> {
  const state = await readState(branch);
  if (!state) return;
  const updated = { ...state, ...updates, updated_at: new Date().toISOString() };
  await writeState(branch, updated);
}

export async function listTasks(): Promise<TaskState[]> {
  const { readdirSync } = await import("fs");
  const tasks: TaskState[] = [];
  try {
    const files = readdirSync(WORKBENCH_STATE_DIR);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const branch = f.replace(/\.json$/, "");
      const state = await readState(branch);
      if (state) tasks.push(state);
    }
  } catch {
    // State dir doesn't exist yet
  }
  return tasks;
}

export function newTaskState(opts: {
  branch: string;
  agent: "claude" | "opencode";
  mode: "worktree" | "container";
  worktree: string;
  prompt: string;
}): TaskState {
  const now = new Date().toISOString();
  return {
    branch: opts.branch,
    status: "starting",
    agent: opts.agent,
    mode: opts.mode,
    worktree: opts.worktree,
    prompt: opts.prompt,
    diff_added: 0,
    diff_removed: 0,
    diff_files: 0,
    created_at: now,
    updated_at: now,
    pid: null,
    cmux_workspace_id: null,
    cmux_agent_surface_id: null,
    container_id: null,
    devcontainer_config: null,
  };
}

/**
 * Scan the worktrees directory for existing worktrees that don't have
 * a corresponding state file. Creates state files for orphans so they
 * appear in the dashboard.
 *
 * Also refreshes diff stats and validates PIDs for existing state files.
 */
export async function reconcileWorktrees(): Promise<void> {
  mkdirSync(WORKBENCH_STATE_DIR, { recursive: true });

  let repoRoot: string;
  try {
    repoRoot = getRepoRoot();
  } catch {
    return;
  }

  const repoName = basename(repoRoot);
  const worktreesBase = resolve(repoRoot, "..", ".workbench-worktrees", repoName);

  // 1. Discover orphan worktrees (exist on disk but no state file)
  if (existsSync(worktreesBase)) {
    let entries: string[];
    try {
      entries = readdirSync(worktreesBase);
    } catch {
      entries = [];
    }

    for (const branch of entries) {
      const worktreeDir = resolve(worktreesBase, branch);
      try {
        if (!statSync(worktreeDir).isDirectory()) continue;
        // Must have a .git file to be a real worktree (not a grouping dir like "fn/")
        if (!existsSync(resolve(worktreeDir, ".git"))) continue;
      } catch {
        continue;
      }

      const existing = await readState(branch);
      if (existing) continue;

      // No state file — create one from what we can infer
      const actualBranch = getCurrentBranch(worktreeDir) ?? branch;
      const diff = getDiffStats(worktreeDir);
      const now = new Date().toISOString();
      const state: TaskState = {
        branch: actualBranch,
        status: "unknown",
        agent: "claude",
        mode: "worktree",
        worktree: worktreeDir,
        prompt: "",
        diff_added: diff.added,
        diff_removed: diff.removed,
        diff_files: diff.files,
        created_at: now,
        updated_at: now,
        pid: null,
        cmux_workspace_id: null,
        cmux_agent_surface_id: null,
        container_id: null,
        devcontainer_config: null,
      };
      await writeState(actualBranch, state);
    }
  }

  // 2. Refresh existing state files: update diff stats, validate PIDs
  const tasks = await listTasks();
  for (const task of tasks) {
    const updates: Partial<TaskState> = {};

    // If PID is set but process is dead, clear it and mark status
    if (task.pid && !isProcessAlive(task.pid)) {
      updates.pid = null;
      if (task.status === "running" || task.status === "starting") {
        updates.status = "unknown";
      }
    }

    // Refresh diff stats if the worktree still exists
    if (task.worktree && existsSync(task.worktree)) {
      const diff = getDiffStats(task.worktree);
      updates.diff_added = diff.added;
      updates.diff_removed = diff.removed;
      updates.diff_files = diff.files;
    }

    if (Object.keys(updates).length > 0) {
      await updateState(task.branch, updates);
    }
  }
}
