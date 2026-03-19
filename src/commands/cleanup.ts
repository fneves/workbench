import { existsSync, rmSync, unlinkSync } from "fs"
import { WORKBENCH_STATE_DIR, getStateFile, branchToSlug } from "../lib/config"
import { readState, listTasks } from "../lib/state"
import { removeWorktree } from "../lib/git"
import { killProcess, isProcessAlive } from "../lib/process"
import { listWorkspaces, closeWorkspace, currentWorkspaceId } from "../lib/cmux"
import { stopContainer, cleanupAllContainers } from "../lib/container"

const C = {
  red: "\x1b[0;31m",
  green: "\x1b[0;32m",
  yellow: "\x1b[1;33m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  nc: "\x1b[0m",
}

export async function doCleanupTask(branch: string): Promise<void> {
  console.log(`${C.yellow}Cleaning up: ${branch}${C.nc}`)

  const state = await readState(branch)

  // Kill agent process if running
  if (state?.pid && isProcessAlive(state.pid)) {
    console.log(`  ${C.dim}Killing agent (PID ${state.pid})${C.nc}`)
    killProcess(state.pid)
  }

  // Stop container if this was a container task
  if (state?.mode === "container") {
    const slug = branchToSlug(branch)
    console.log(`  ${C.dim}Stopping container: workbench=${slug}${C.nc}`)
    stopContainer(slug)

    // Remove generated devcontainer config dir
    const dcConfigDir = `${WORKBENCH_STATE_DIR}/${slug}.devcontainer`
    if (existsSync(dcConfigDir)) {
      rmSync(dcConfigDir, { recursive: true, force: true })
    }

    // Remove sentinel notification file
    const sentinelFile = `${WORKBENCH_STATE_DIR}/${slug}.notify`
    try { unlinkSync(sentinelFile) } catch {}
  }

  // Close cmux workspace for this task
  const workspaces = await listWorkspaces()
  const ws = workspaces.find((w) => w.title === branch)
  if (ws) {
    console.log(`  ${C.dim}Closing cmux workspace: ${branch}${C.nc}`)
    await closeWorkspace(ws.id)
  }

  // Remove worktree
  const worktreeDir = state?.worktree
  if (worktreeDir && existsSync(worktreeDir)) {
    console.log(`  ${C.dim}Removing worktree: ${worktreeDir}${C.nc}`)
    removeWorktree(worktreeDir)
  }

  // Clean up state files
  const stateFile = getStateFile(branch)
  const slug = branchToSlug(branch)
  const wrapperFile = `${WORKBENCH_STATE_DIR}/${slug}.run.sh`
  const watcherFile = `${WORKBENCH_STATE_DIR}/${slug}.watch.sh`

  for (const f of [stateFile, wrapperFile, watcherFile]) {
    try { unlinkSync(f) } catch {}
  }

  console.log(`  ${C.green}✓ Done${C.nc}`)
}

export async function cmdCleanup(): Promise<void> {
  console.log(`${C.bold}Cleaning up all tasks...${C.nc}`)
  console.log()

  const tasks = await listTasks()
  for (const task of tasks) {
    await doCleanupTask(task.branch)
  }

  // Remove all workbench-labelled containers
  console.log(`${C.yellow}Removing all workbench containers...${C.nc}`)
  cleanupAllContainers()

  // Close the orchestrator workspace too, but not the one running this command
  const currentWsId = currentWorkspaceId()
  const allWorkspaces = await listWorkspaces()
  for (const ws of allWorkspaces) {
    if (ws.id === currentWsId) continue
    if (ws.title.includes("workbench") || ws.title.includes("⚡")) {
      console.log(`${C.yellow}Closing cmux workspace: ${ws.title}${C.nc}`)
      await closeWorkspace(ws.id)
    }
  }

  // Clean state dir
  if (existsSync(WORKBENCH_STATE_DIR)) {
    rmSync(WORKBENCH_STATE_DIR, { recursive: true, force: true })
  }

  console.log()
  console.log(`${C.green}${C.bold}✓ All cleaned up${C.nc}`)
}
