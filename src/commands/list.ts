import { listTasks } from "#lib/state";

const C = {
  red: "\x1b[0;31m",
  green: "\x1b[0;32m",
  yellow: "\x1b[1;33m",
  cyan: "\x1b[0;36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  nc: "\x1b[0m",
};

export async function cmdList(): Promise<void> {
  const tasks = await listTasks();

  if (tasks.length === 0) {
    console.log(`${C.dim}No active tasks.${C.nc}`);
    return;
  }

  console.log(`${C.bold}Active tasks:${C.nc}`);
  console.log();

  for (const task of tasks) {
    let icon: string;
    switch (task.status) {
      case "running":
        icon = `${C.green}●${C.nc}`;
        break;
      case "prompting":
        icon = `${C.yellow}⏳${C.nc}`;
        break;
      case "done":
        icon = `${C.cyan}✓${C.nc}`;
        break;
      case "failed":
        icon = `${C.red}✗${C.nc}`;
        break;
      default:
        icon = `${C.dim}?${C.nc}`;
        break;
    }

    const branch = task.branch.padEnd(30);
    const status = task.status.padEnd(10);
    const added = `+${task.diff_added}`.padStart(5);
    const removed = `-${task.diff_removed}`.padStart(5);
    const files = `${task.diff_files}`.padStart(4);

    const modeBadge = task.mode === "container" ? ` ${C.cyan}[ctr]${C.nc}` : "";
    console.log(
      `  ${icon} ${branch} ${C.bold}${status}${C.nc}  ${C.green}${added}${C.nc} ${C.red}${removed}${C.nc} ${C.dim}(${files} files)${C.nc}  ${C.dim}[${task.agent}]${C.nc}${modeBadge}`,
    );
  }
}
