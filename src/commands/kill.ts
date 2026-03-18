import { readState } from "../lib/state"
import { doCleanupTask } from "./cleanup"

const C = {
  red: "\x1b[0;31m",
  nc: "\x1b[0m",
}

export async function cmdKill(branch: string): Promise<void> {
  if (!branch) {
    console.error(`${C.red}Usage: workbench kill <branch>${C.nc}`)
    process.exit(1)
  }

  const state = await readState(branch)
  if (!state) {
    console.error(`${C.red}No task found for branch: ${branch}${C.nc}`)
    process.exit(1)
  }

  await doCleanupTask(branch)
}
