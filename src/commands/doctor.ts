import { isInsideCmux } from "../lib/cmux";

const C = {
  green: "\x1b[0;32m",
  yellow: "\x1b[1;33m",
  red: "\x1b[0;31m",
  cyan: "\x1b[0;36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  nc: "\x1b[0m",
};

function check(cmd: string): { found: boolean; path: string | null } {
  const path = Bun.which(cmd);
  return { found: path !== null, path };
}

function ok(label: string, detail = "") {
  console.log(`  ${C.green}✓${C.nc} ${label}${detail ? `  ${C.dim}${detail}${C.nc}` : ""}`);
}

function warn(label: string, detail = "") {
  console.log(`  ${C.yellow}!${C.nc} ${label}${detail ? `  ${C.dim}${detail}${C.nc}` : ""}`);
}

function fail(label: string, detail = "") {
  console.log(`  ${C.red}✗${C.nc} ${label}${detail ? `  ${C.dim}${detail}${C.nc}` : ""}`);
}

export function cmdDoctor(): void {
  let issues = 0;

  console.log(`${C.bold}⚡ workbench doctor${C.nc}`);
  console.log();

  // --- Required ---
  console.log(`${C.bold}Required${C.nc}`);

  const git = check("git");
  if (git.found) ok("git", git.path!);
  else {
    fail("git", "install with: brew install git");
    issues++;
  }

  const jq = check("jq");
  if (jq.found) ok("jq", jq.path!);
  else {
    fail("jq", "install with: brew install jq");
    issues++;
  }

  const cmux = check("cmux");
  if (cmux.found) ok("cmux", cmux.path!);
  else {
    fail("cmux", "https://github.com/nichochar/cmux");
    issues++;
  }

  if (isInsideCmux()) {
    ok("cmux session", `workspace ${process.env.CMUX_WORKSPACE_ID}`);
  } else {
    warn("not inside cmux", "workbench start requires a cmux terminal");
  }

  console.log();

  // --- Agents ---
  console.log(`${C.bold}AI Agents${C.nc}`);

  const claude = check("claude");
  const opencode = check("opencode");

  if (claude.found) ok("claude", claude.path!);
  else warn("claude", "npm install -g @anthropic-ai/claude-code");

  if (opencode.found) ok("opencode", opencode.path!);
  else warn("opencode", "optional alternative agent");

  if (!claude.found && !opencode.found) {
    fail("no agent found", "install at least one: claude or opencode");
    issues++;
  }

  console.log();

  // --- Optional ---
  console.log(`${C.bold}Optional${C.nc}`);

  const optional: [string, string, string][] = [
    ["gh", "brew install gh", "PR creation"],
    ["fzf", "brew install fzf", "file picker"],
    ["lazygit", "brew install lazygit", "git TUI"],
    ["delta", "brew install git-delta", "diff viewer"],
    ["bat", "brew install bat", "file viewer"],
  ];

  for (const [cmd, install, desc] of optional) {
    const result = check(cmd);
    if (result.found) ok(`${cmd}`, `${result.path!}  (${desc})`);
    else warn(`${cmd}`, `${install}  (${desc})`);
  }

  console.log();

  // --- Container mode ---
  console.log(`${C.bold}Container mode${C.nc}`);

  const docker = check("docker");
  if (docker.found) {
    const running = Bun.spawnSync(["docker", "info"], { stdout: "ignore", stderr: "ignore" });
    if (running.exitCode === 0) ok("docker", `${docker.path!}  (running)`);
    else warn("docker", `${docker.path!}  (installed but not running)`);
  } else {
    warn("docker", "needed for container mode only");
  }

  const dc = check("devcontainer");
  if (dc.found) ok("devcontainer", dc.path!);
  else warn("devcontainer", "npm install -g @devcontainers/cli");

  console.log();

  // --- Summary ---
  if (issues === 0) {
    console.log(
      `${C.green}${C.bold}All good.${C.nc} Run ${C.cyan}workbench start${C.nc} inside cmux.`,
    );
  } else {
    console.log(
      `${C.red}${C.bold}${issues} issue${issues > 1 ? "s" : ""} found.${C.nc} Fix the ${C.red}✗${C.nc} items above.`,
    );
    process.exit(1);
  }
}
