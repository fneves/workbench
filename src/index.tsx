#!/usr/bin/env bun
export {};

const C = {
  purple: "\x1b[0;35m",
  cyan: "\x1b[0;36m",
  red: "\x1b[0;31m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  nc: "\x1b[0m",
};

function usage(): void {
  console.log(`${C.bold}workbench${C.nc} — multi-agent orchestrator`);
  console.log();
  console.log(
    `  ${C.cyan}workbench start${C.nc}       Start a new session (or attach to existing)`,
  );
  console.log(`  ${C.cyan}workbench spawn${C.nc}       Spawn a new task`);
  console.log(`  ${C.cyan}workbench list${C.nc}        List active tasks`);
  console.log(`  ${C.cyan}workbench kill${C.nc}        Kill a task and clean up worktree`);
  console.log(`  ${C.cyan}workbench cleanup${C.nc}     Tear down everything`);
  console.log(`  ${C.cyan}workbench doctor${C.nc}      Check dependencies and environment`);
  console.log(`  ${C.cyan}workbench dashboard${C.nc}   TUI dashboard (runs in cmux workspace)`);
  console.log(`  ${C.cyan}workbench watcher${C.nc}     TUI watcher (runs in cmux workspace)`);
  console.log();
  console.log(`  ${C.dim}Environment:${C.nc}`);
  console.log(`  ${C.dim}  WORKBENCH_DIR     Config dir (default: ~/.workbench)${C.nc}`);
  console.log(`  ${C.dim}  WORKBENCH_REPO    Git repo root (default: current git repo)${C.nc}`);
  console.log(
    `  ${C.dim}  WORKBENCH_AGENT   Default agent: claude|opencode (default: claude)${C.nc}`,
  );
}

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case "start": {
    const { cmdStart } = await import("#commands/start");
    await cmdStart();
    break;
  }
  case "spawn": {
    const { cmdSpawn } = await import("#commands/spawn");
    await cmdSpawn(args);
    break;
  }
  case "list": {
    const { cmdList } = await import("#commands/list");
    await cmdList();
    break;
  }
  case "kill": {
    const { cmdKill } = await import("#commands/kill");
    await cmdKill(args[0] ?? "");
    break;
  }
  case "cleanup": {
    const { cmdCleanup } = await import("#commands/cleanup");
    await cmdCleanup();
    break;
  }
  case "doctor": {
    const { cmdDoctor } = await import("#commands/doctor");
    cmdDoctor();
    break;
  }
  case "dashboard": {
    const { reconcileWorktrees } = await import("#lib/state");
    const { runDashboard } = await import("#modes/dashboard/Dashboard");
    await reconcileWorktrees();
    await runDashboard();
    break;
  }
  case "watcher": {
    const { runWatcher } = await import("#modes/watcher/Watcher");
    await runWatcher(args[0] ?? ".", args[1] ?? "");
    break;
  }
  case "-h":
  case "--help":
  case "help":
  case undefined:
    usage();
    break;
  default:
    console.error(`${C.red}Unknown command: ${command}${C.nc}`);
    usage();
    process.exit(1);
}
