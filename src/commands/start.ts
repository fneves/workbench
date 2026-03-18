import { mkdirSync, writeFileSync } from "fs"
import { resolve } from "path"
import {
  WORKBENCH_DIR,
  WORKBENCH_STATE_DIR,
  getRepoRoot,
  getScriptDir,
} from "../lib/config"
import { reconcileWorktrees } from "../lib/state"
import { isInsideCmux } from "../lib/cmux"

const C = {
  purple: "\x1b[0;35m",
  dim: "\x1b[2m",
  green: "\x1b[0;32m",
  red: "\x1b[0;31m",
  bold: "\x1b[1m",
  nc: "\x1b[0m",
}

export async function cmdStart(): Promise<void> {
  mkdirSync(WORKBENCH_DIR, { recursive: true })
  mkdirSync(WORKBENCH_STATE_DIR, { recursive: true })

  const repo = getRepoRoot()

  console.log(`${C.purple}${C.bold}⚡ workbench${C.nc}`)
  console.log(`${C.dim}repo: ${repo}${C.nc}`)
  console.log(`${C.dim}state: ${WORKBENCH_STATE_DIR}${C.nc}`)
  console.log()

  // Store repo path for child processes
  writeFileSync(`${WORKBENCH_STATE_DIR}/.repo`, repo)

  // Reconcile existing worktrees with state files
  await reconcileWorktrees()

  if (!isInsideCmux()) {
    console.log(`${C.red}Error: Must be running inside cmux.${C.nc}`)
    console.log(`${C.dim}Open cmux and run this command from a cmux terminal.${C.nc}`)
    process.exit(1)
  }

  // Launch the dashboard in the current pane (no new workspace created)
  const scriptDir = getScriptDir()
  const entryPoint = resolve(scriptDir, "src/index.tsx")
  const bunPath = Bun.which("bun") ?? "bun"

  console.log(`${C.green}Launching dashboard...${C.nc}`)
  const proc = Bun.spawnSync([bunPath, "run", entryPoint, "dashboard"], {
    stdio: ["inherit", "inherit", "inherit"],
    env: { ...process.env },
  })
  process.exit(proc.exitCode ?? 0)
}
