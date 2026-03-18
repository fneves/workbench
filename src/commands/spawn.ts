import { mkdirSync, writeFileSync, chmodSync, existsSync } from "fs"
import {
  WORKBENCH_STATE_DIR,
  DEFAULT_AGENT,
  DEFAULT_BASE_BRANCH,
  getWorktreeDir,
  getStateFile,
  getScriptDir,
} from "../lib/config"
import { writeState, updateState, newTaskState } from "../lib/state"
import { createWorktree } from "../lib/git"
import {
  isInsideCmux,
  findWorkspace,
  newWorkspace,
  selectWorkspace,
  splitPane,
  sendText,
  listSurfaces,
  waitForSurface,
} from "../lib/cmux"
import { generateAgentWrapper } from "../templates/agent-wrapper"

const C = {
  red: "\x1b[0;31m",
  green: "\x1b[0;32m",
  yellow: "\x1b[1;33m",
  cyan: "\x1b[0;36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  nc: "\x1b[0m",
}

interface SpawnOpts {
  branch: string
  prompt: string
  agent: "claude" | "opencode"
  mode: "worktree" | "container"
  baseBranch: string
  interactive: boolean
}

export function parseSpawnArgs(args: string[]): SpawnOpts {
  const opts: SpawnOpts = {
    branch: "",
    prompt: "",
    agent: DEFAULT_AGENT,
    mode: "worktree",
    baseBranch: DEFAULT_BASE_BRANCH,
    interactive: false,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    switch (arg) {
      case "-b":
      case "--branch":
        opts.branch = args[++i] ?? ""
        break
      case "-p":
      case "--prompt":
        opts.prompt = args[++i] ?? ""
        break
      case "-a":
      case "--agent":
        opts.agent = (args[++i] ?? "claude") as "claude" | "opencode"
        break
      case "-m":
      case "--mode":
        opts.mode = (args[++i] ?? "worktree") as "worktree" | "container"
        break
      case "-f":
      case "--from":
        opts.baseBranch = args[++i] ?? "main"
        break
      case "-i":
      case "--interactive":
        opts.interactive = true
        break
      case "-h":
      case "--help":
        printSpawnUsage()
        process.exit(0)
      default:
        console.error(`${C.red}Unknown option: ${arg}${C.nc}`)
        printSpawnUsage()
        process.exit(1)
    }
  }

  if (!opts.branch) {
    console.error(`${C.red}Error: --branch is required${C.nc}`)
    printSpawnUsage()
    process.exit(1)
  }

  return opts
}

function printSpawnUsage(): void {
  console.log("Usage: workbench spawn [options]")
  console.log()
  console.log(`  ${C.cyan}-b, --branch${C.nc}       Branch name (required)`)
  console.log(`  ${C.cyan}-p, --prompt${C.nc}       Task prompt for the agent`)
  console.log(`  ${C.cyan}-a, --agent${C.nc}        Agent: claude|opencode (default: claude)`)
  console.log(`  ${C.cyan}-m, --mode${C.nc}         Mode: worktree|container (default: worktree)`)
  console.log(`  ${C.cyan}-f, --from${C.nc}         Base branch (default: main)`)
  console.log(`  ${C.cyan}-i, --interactive${C.nc}  Interactive mode (no prompt)`)
}

export async function cmdSpawn(args: string[]): Promise<void> {
  const opts = parseSpawnArgs(args)
  const { branch, prompt, agent, mode, baseBranch, interactive } = opts

  mkdirSync(WORKBENCH_STATE_DIR, { recursive: true })

  const worktreeDir = getWorktreeDir(branch)
  const stateFile = getStateFile(branch)

  // 1. Create worktree
  if (existsSync(worktreeDir)) {
    console.log(`${C.yellow}Worktree already exists: ${worktreeDir}${C.nc}`)
  } else {
    console.log(`${C.green}Creating worktree: ${branch} (from ${baseBranch})${C.nc}`)
    mkdirSync(worktreeDir, { recursive: true })
    const { rmSync } = await import("fs")
    rmSync(worktreeDir, { recursive: true })

    if (!createWorktree(worktreeDir, branch, baseBranch)) {
      console.error(`${C.red}Failed to create worktree${C.nc}`)
      process.exit(1)
    }
  }

  // 2. Initialize state file
  const state = newTaskState({
    branch,
    agent,
    mode,
    worktree: worktreeDir,
    prompt,
  })
  await writeState(branch, state)

  // 3. Write agent wrapper script
  const wrapperFile = `${WORKBENCH_STATE_DIR}/${branch}.run.sh`
  writeFileSync(
    wrapperFile,
    generateAgentWrapper({
      stateFile,
      worktreeDir,
      branch,
      agent,
      prompt,
      interactive,
    }),
  )
  chmodSync(wrapperFile, 0o755)

  console.log(`${C.dim}Agent:   ${wrapperFile}${C.nc}`)

  // 5. Launch in cmux
  if (!isInsideCmux()) {
    console.log(`${C.yellow}Not inside cmux.${C.nc}`)
    console.log()
    console.log(`  ${C.bold}Option 1:${C.nc} Start workbench first inside cmux`)
    console.log(`    ${C.cyan}workbench start${C.nc}`)
    console.log()
    console.log(`  ${C.bold}Option 2:${C.nc} Run standalone`)
    console.log(`    ${C.cyan}zsh ${wrapperFile}${C.nc}`)
    return
  }

  // Create a new workspace for this task
  const wsName = branch
  console.log(`${C.green}Creating cmux workspace: ${wsName}${C.nc}`)

  let activeWsId = await newWorkspace(wsName)
  if (!activeWsId) {
    console.error(`${C.red}Failed to create cmux workspace${C.nc}`)
    activeWsId = await findWorkspace(wsName)
    if (activeWsId) {
      console.log(`${C.yellow}Workspace already exists, selecting...${C.nc}`)
    } else {
      process.exit(1)
    }
  }
  await selectWorkspace(activeWsId)

  // Store the cmux workspace ID in state for navigation
  await updateState(branch, { cmux_workspace_id: activeWsId })

  // Wait for the workspace's default terminal to be ready
  const surfaces = await listSurfaces()
  const defaultSurface = surfaces.find((s) => s.type === "terminal")
  if (defaultSurface) {
    await waitForSurface(defaultSurface.id)
    await updateState(branch, { cmux_agent_surface_id: defaultSurface.id })
  }

  // Send the agent wrapper command to the new workspace's terminal
  await sendText(`zsh '${wrapperFile}'\n`)

  // Create a right split for the watcher TUI
  const scriptDir = getScriptDir()
  const entryPoint = `${scriptDir}/src/index.tsx`
  const bunPath = Bun.which("bun") ?? "bun"
  const watcherSurfaceId = await splitPane("right")
  if (watcherSurfaceId) {
    // Wait for the new pane's shell to be ready before sending the command
    await waitForSurface(watcherSurfaceId)
    await sendText(`${bunPath} run ${entryPoint} watcher '${worktreeDir}' '${branch}'\n`, watcherSurfaceId)
  }

  console.log()
  console.log(`${C.green}${C.bold}✓ Task spawned: ${branch}${C.nc}`)
  console.log(`  ${C.dim}Worktree:  ${worktreeDir}${C.nc}`)
  console.log(`  ${C.dim}Agent:     ${agent}${C.nc}`)
  console.log(`  ${C.dim}Mode:      ${mode}${C.nc}`)
  console.log(`  ${C.dim}Prompt:    ${prompt ? prompt.slice(0, 80) : "(interactive)"}${C.nc}`)
}
