import { resolve } from "path";
import { writeFileSync, chmodSync, unlinkSync } from "fs";
import { listTasks, readState, updateState } from "../lib/state";
import { getDiffStats, getFileChanges } from "../lib/git";
import { getConfig, getScriptDir, branchToSlug, getDefaultEditor } from "../lib/config";
import {
  selectWorkspace,
  splitPane,
  splitPaneWithIds,
  createSurfaceInPane,
  sendText,
  waitForSurface,
  focusSurface,
  listWorkspaces,
  listSurfaces,
  newWorkspace,
  closeWorkspace,
  cmuxNotify,
} from "../lib/cmux";
import { generatePrCreatorScript } from "../templates/pr-creator";

type Handler = (params: Record<string, any>) => Promise<any>;

function getWorkbenchCommand(args: string[]): string[] {
  // When compiled to a binary, process.execPath IS the workbench binary
  const isCompiled = !process.execPath.endsWith("bun") && !process.execPath.endsWith("node");
  if (isCompiled) {
    return [process.execPath, ...args];
  }
  // Dev mode: run via bun
  const entryPoint = resolve(getScriptDir(), "src/index.tsx");
  const bunPath = Bun.which("bun") ?? "bun";
  return [bunPath, "run", entryPoint, ...args];
}

function runWorkbenchCmd(args: string[]): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolve) => {
    const proc = Bun.spawn(getWorkbenchCommand(args), {
      stdout: "ignore",
      stderr: "pipe",
    });
    proc.exited.then(async (code) => {
      const stderr = await new Response(proc.stderr).text();
      resolve({ ok: code === 0, stderr });
    });
  });
}

export const handlers: Record<string, Handler> = {
  // --- Task management ---

  "task.list": async () => {
    const tasks = await listTasks();
    return { tasks };
  },

  "task.get": async (params) => {
    const task = await readState(params.branch);
    return { task };
  },

  "task.update": async (params) => {
    const { branch, ...updates } = params;
    if (!branch) throw { code: "MISSING_BRANCH", message: "branch is required" };
    await updateState(branch, updates);
    const task = await readState(branch);
    return { task };
  },

  "task.spawn": async (params) => {
    const args = [
      "spawn",
      "-b",
      params.branch,
      "-a",
      params.agent ?? "claude",
      "-m",
      params.mode ?? "worktree",
      "-f",
      params.baseBranch ?? "main",
    ];
    if (params.interactive || !params.prompt) {
      args.push("-i");
    } else {
      args.push("-p", params.prompt);
    }
    const result = await runWorkbenchCmd(args);
    if (!result.ok) {
      const msg = result.stderr.trim().split("\n").pop() ?? "unknown error";
      throw { code: "SPAWN_FAILED", message: msg };
    }
    return { branch: params.branch };
  },

  "task.kill": async (params) => {
    await updateState(params.branch, { status: "killing" });
    const result = await runWorkbenchCmd(["kill", params.branch]);
    if (!result.ok) {
      const msg = result.stderr.trim().split("\n").pop() ?? "unknown error";
      throw { code: "KILL_FAILED", message: msg };
    }
    return { branch: params.branch };
  },

  "task.cleanup": async () => {
    const result = await runWorkbenchCmd(["cleanup"]);
    if (!result.ok) {
      throw { code: "CLEANUP_FAILED", message: "Cleanup failed" };
    }
    return {};
  },

  // --- Git operations ---

  "git.diffStats": async (params) => {
    let worktree = params.worktree;
    if (!worktree && params.branch) {
      const state = await readState(params.branch);
      worktree = state?.worktree;
    }
    if (!worktree) throw { code: "NO_WORKTREE", message: "No worktree found" };
    return getDiffStats(worktree);
  },

  "git.fileChanges": async (params) => {
    let worktree = params.worktree;
    if (!worktree && params.branch) {
      const state = await readState(params.branch);
      worktree = state?.worktree;
    }
    if (!worktree) throw { code: "NO_WORKTREE", message: "No worktree found" };
    return { files: getFileChanges(worktree) };
  },

  "git.stageAll": async (params) => {
    let worktree = params.worktree;
    if (!worktree && params.branch) {
      const state = await readState(params.branch);
      worktree = state?.worktree;
    }
    if (!worktree) throw { code: "NO_WORKTREE", message: "No worktree found" };
    Bun.spawnSync(["git", "add", "-A"], { cwd: worktree });
    return {};
  },

  // --- cmux operations ---

  "cmux.selectWorkspace": async (params) => {
    const ok = await selectWorkspace(params.workspaceId);
    return { ok };
  },

  "cmux.splitPane": async (params) => {
    const surfaceId = await splitPane(params.direction ?? "right", params.workspaceId);
    return { surfaceId };
  },

  "cmux.splitPaneWithIds": async (params) => {
    const result = await splitPaneWithIds(params.direction ?? "down");
    return result;
  },

  "cmux.createSurfaceInPane": async (params) => {
    const surfaceId = await createSurfaceInPane(params.paneId);
    return { surfaceId };
  },

  "cmux.sendText": async (params) => {
    const ok = await sendText(params.text, params.surfaceId);
    return { ok };
  },

  "cmux.waitForSurface": async (params) => {
    const ready = await waitForSurface(params.surfaceId, params.timeoutMs);
    return { ready };
  },

  "cmux.focusSurface": async (params) => {
    const ok = await focusSurface(params.surfaceId);
    return { ok };
  },

  "cmux.listWorkspaces": async () => {
    const workspaces = await listWorkspaces();
    return { workspaces };
  },

  "cmux.listSurfaces": async (params) => {
    const surfaces = await listSurfaces(params.workspaceId);
    return { surfaces };
  },

  "cmux.newWorkspace": async (params) => {
    const workspaceId = await newWorkspace(params.title);
    return { workspaceId };
  },

  "cmux.closeWorkspace": async (params) => {
    const ok = await closeWorkspace(params.workspaceId);
    return { ok };
  },

  "cmux.notify": async (params) => {
    const ok = await cmuxNotify(params.title, params.body);
    return { ok };
  },

  // --- Watcher operations ---

  "watcher.startReview": async (params) => {
    const { worktree, branch, filePath } = params;
    const slug = branchToSlug(branch);
    const reviewFilePath = `/tmp/workbench/${slug}-review.md`;
    const reviewSentinelPath = `${reviewFilePath}.ready`;

    const fileScope = filePath
      ? `Run git diff main -- '${filePath}' to examine the changes in ${filePath}.`
      : `Run git diff main to examine the current changes.`;
    const prompt = `You are an adversarial code reviewer. ${fileScope} Write a thorough review covering: bugs and logic errors, security vulnerabilities, missing edge cases and error handling, performance concerns, and code quality issues. Format as markdown with specific file and line references. Be critical and actionable.`;
    const escaped = prompt.replace(/'/g, "'\\''");

    Bun.spawn(
      [
        "sh",
        "-c",
        `cd '${worktree}' && claude '${escaped}' > '${reviewFilePath}' && touch '${reviewSentinelPath}'`,
      ],
      {
        stdout: "ignore",
        stderr: "ignore",
      },
    );

    return { started: true };
  },

  "watcher.acceptReview": async (params) => {
    const { branch, worktree, agentSurfaceId } = params;
    const slug = branchToSlug(branch);
    const reviewFilePath = `/tmp/workbench/${slug}-review.md`;

    const file = Bun.file(reviewFilePath);
    if (!(await file.exists())) {
      throw { code: "NO_REVIEW", message: "No review found" };
    }

    const content = await file.text();
    await Bun.write(`${worktree}/.workbench-review.md`, content);

    if (agentSurfaceId) {
      await sendText(
        `\nA code review has been saved to .workbench-review.md — please address all the feedback.\n`,
        agentSurfaceId,
      );
    }

    return { accepted: true };
  },

  "watcher.rejectReview": async (params) => {
    const slug = branchToSlug(params.branch);
    const reviewFilePath = `/tmp/workbench/${slug}-review.md`;
    try {
      unlinkSync(reviewFilePath);
    } catch {}
    return { rejected: true };
  },

  "watcher.iterateReview": async (params) => {
    const { branch } = params;
    const slug = branchToSlug(branch);
    const reviewFilePath = `/tmp/workbench/${slug}-review.md`;
    const iteratePrompt = `I have a code review draft that I want to refine with your help. After our discussion, update the file ${reviewFilePath} with the final agreed-upon review using your Write tool.\\n\\nCurrent review:\\n$(cat '${reviewFilePath}' 2>/dev/null || echo "(no review yet)")`;
    return { prompt: iteratePrompt };
  },

  "watcher.generatePrScript": async (params) => {
    const { worktree, branch } = params;
    const slug = branchToSlug(branch);
    const prScript = `/tmp/workbench/${slug}.pr.sh`;
    const scriptContent = generatePrCreatorScript({ worktree, branch, slug });
    writeFileSync(prScript, scriptContent);
    chmodSync(prScript, 0o755);
    return { script: prScript };
  },

  // --- Config ---

  "config.get": async () => {
    return getConfig();
  },

  "config.editor": async () => {
    return { editor: getDefaultEditor() };
  },

  "config.tools": async () => {
    return {
      fzf: Bun.spawnSync(["which", "fzf"]).exitCode === 0,
      lazygit: Bun.spawnSync(["which", "lazygit"]).exitCode === 0,
      delta: Bun.spawnSync(["which", "delta"]).exitCode === 0,
      bat: Bun.spawnSync(["which", "bat"]).exitCode === 0,
      claude: Bun.which("claude") !== null,
      gh: Bun.spawnSync(["which", "gh"]).exitCode === 0,
    };
  },
};
