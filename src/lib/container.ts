import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { userInfo } from "os";
import {
  WORKBENCH_STATE_DIR,
  branchToSlug,
  getContainerImage,
  getContainerClaudeHome,
  getWorktreesParentDir,
} from "#lib/config";

/**
 * Try to extract the Claude Code API key from the macOS Keychain.
 * Claude Code stores its OAuth-derived key under service "Claude Code".
 */
export function getClaudeKeyFromKeychain(): string | null {
  if (process.platform !== "darwin") {
    return null;
  }
  try {
    const account = userInfo().username;
    const result = Bun.spawnSync(
      ["security", "find-generic-password", "-s", "Claude Code", "-a", account, "-w"],
      { stdout: "pipe", stderr: "ignore" },
    );
    const key = result.stdout.toString().trim();
    return key && result.exitCode === 0 ? key : null;
  } catch {
    return null;
  }
}

/** Check if the `devcontainer` CLI is available on PATH. */
export function isDevcontainerCliAvailable(): boolean {
  return Bun.which("devcontainer") !== null;
}

/** Check if the Docker daemon is running. */
export function isDockerRunning(): boolean {
  const result = Bun.spawnSync(["docker", "info"], {
    stdout: "ignore",
    stderr: "ignore",
  });
  return result.exitCode === 0;
}

/**
 * True when workbench is running inside a container (e.g. devcontainer exec session).
 * In that case we run agents in-process paths and skip devcontainer/docker orchestration.
 */
export function isRunningInsideContainer(): boolean {
  if (process.env.WORKBENCH_IN_CONTAINER === "1") {
    return true;
  }
  if (existsSync("/.dockerenv")) {
    return true;
  }
  if (process.env.REMOTE_CONTAINERS === "true") {
    return true;
  }
  return false;
}

export interface DevcontainerConfig {
  name: string;
  image?: string;
  dockerComposeFile?: string;
  mounts: string[];
  postCreateCommand: string;
  containerEnv: Record<string, string>;
  remoteUser: string;
  [key: string]: unknown;
}

/**
 * Generate a devcontainer config for a workbench task.
 * If the worktree already has a `.devcontainer/devcontainer.json`,
 * merge required mounts/features into it. Otherwise generate a minimal config.
 */
export function generateDevcontainerConfig(
  worktreeDir: string,
  branch: string,
): DevcontainerConfig {
  const slug = branchToSlug(branch);
  const claudeHome = getContainerClaudeHome();

  const homeDir = resolve(claudeHome, "..");
  const claudeJsonPath = resolve(homeDir, ".claude.json");

  const worktreesHostParent = getWorktreesParentDir();
  const worktreesMount = `source=${worktreesHostParent},target=/workbench-worktrees,type=bind`;

  const requiredMounts = [
    `source=/tmp/workbench,target=/tmp/workbench,type=bind`,
    worktreesMount,
    `source=${claudeHome},target=/home/vscode/.claude,type=bind`,
    ...(existsSync(claudeJsonPath)
      ? [`source=${claudeJsonPath},target=/home/vscode/.claude.json,type=bind,readonly`]
      : []),
  ];

  // Resolve API key: env var > macOS Keychain
  const apiKey = process.env.ANTHROPIC_API_KEY ?? getClaudeKeyFromKeychain();

  const requiredEnv: Record<string, string> = {
    CLAUDE_CODE_USE_BEDROCK: "0",
    WORKBENCH_WORKTREES_MOUNT: "/workbench-worktrees",
    WORKBENCH_HOST_WORKTREES_ROOT: worktreesHostParent,
    ...(apiKey ? { ANTHROPIC_API_KEY: apiKey } : {}),
  };

  // Check if the repo has its own devcontainer config
  const repoConfigPath = resolve(worktreeDir, ".devcontainer", "devcontainer.json");
  if (existsSync(repoConfigPath)) {
    try {
      // Strip JSONC comments (// and /* */) before parsing
      const raw = readFileSync(repoConfigPath, "utf8");
      const stripped = raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      const existing = JSON.parse(stripped);

      // Merge mounts
      const existingMounts: string[] = existing.mounts ?? [];
      const mergedMounts = [
        ...existingMounts,
        ...requiredMounts.filter((m) => !existingMounts.includes(m)),
      ];

      // Merge env
      const existingEnv: Record<string, string> = existing.containerEnv ?? {};
      const mergedEnv = { ...existingEnv, ...requiredEnv };

      // Build postCreateCommand: always ensure jq + claude-code are available
      const features = existing.features ?? {};
      const hasClaudeCode = Object.keys(features).some((k) => k.includes("claude-code"));
      const installSteps = [
        "sudo apt-get update && sudo apt-get install -y jq",
        ...(hasClaudeCode ? [] : ["npm install -g @anthropic-ai/claude-code"]),
      ];
      const workbenchPostCreate = installSteps.join(" && ");

      const existingPostCreate: string = existing.postCreateCommand ?? "";
      const mergedPostCreate = existingPostCreate
        ? `${existingPostCreate} && ${workbenchPostCreate}`
        : workbenchPostCreate;

      // Override hostRequirements to sane local defaults
      const localHostRequirements = {
        cpus: Math.min(existing.hostRequirements?.cpus ?? 2, 4),
        memory: "8gb",
      };

      // Filter runArgs: remove --device flags (not available on macOS Docker)
      const existingRunArgs: string[] = existing.runArgs ?? [];
      const filteredRunArgs = existingRunArgs.filter((arg: string) => !arg.startsWith("--device="));

      // Remove Codespaces-only fields
      const { secrets: _s, customizations: _c, updateContentCommand: _u, ...rest } = existing;

      // Remove features that require Codespaces environment
      for (const key of Object.keys(features)) {
        if (key.includes("tailscale") || key.includes("sshd")) {
          delete features[key];
        }
      }

      // Ensure node feature is present if claude-code isn't a feature
      const mergedFeatures = { ...features };
      if (!hasClaudeCode && !Object.keys(features).some((k) => k.includes("/node:"))) {
        mergedFeatures["ghcr.io/devcontainers/features/node:1"] = {};
      }

      return {
        ...rest,
        name: `workbench-${slug}`,
        features: mergedFeatures,
        mounts: mergedMounts,
        containerEnv: mergedEnv,
        postCreateCommand: mergedPostCreate,
        hostRequirements: localHostRequirements,
        runArgs: filteredRunArgs.length > 0 ? filteredRunArgs : undefined,
        remoteUser: existing.remoteUser ?? "vscode",
      };
    } catch {
      // Failed to parse existing config — fall through to generate minimal
    }
  }

  const fullPostCreateCmd =
    "sudo apt-get update && sudo apt-get install -y jq && npm install -g @anthropic-ai/claude-code";

  return {
    name: `workbench-${slug}`,
    image: getContainerImage(),
    features: {
      "ghcr.io/devcontainers/features/node:1": {},
    },
    mounts: requiredMounts,
    postCreateCommand: fullPostCreateCmd,
    containerEnv: requiredEnv,
    remoteUser: "vscode",
  };
}

/**
 * Write a devcontainer config to the workbench temp dir.
 * Returns the path to the written config file.
 */
export function writeDevcontainerConfig(branch: string, config: DevcontainerConfig): string {
  const slug = branchToSlug(branch);
  const configDir = `${WORKBENCH_STATE_DIR}/${slug}.devcontainer`;
  mkdirSync(configDir, { recursive: true });

  const configPath = resolve(configDir, "devcontainer.json");
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  return configPath;
}

/**
 * Run `devcontainer up` to start the container.
 * Returns the container ID on success, or null on failure.
 */
export async function devcontainerUp(
  worktreeDir: string,
  configPath: string,
  slug: string,
): Promise<string | null> {
  const result = Bun.spawnSync(
    [
      "devcontainer",
      "up",
      "--workspace-folder",
      worktreeDir,
      "--config",
      configPath,
      "--id-label",
      `workbench=${slug}`,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString();
    console.error(`devcontainer up failed: ${stderr}`);
    return null;
  }

  // devcontainer up outputs JSON with containerId
  try {
    const output = JSON.parse(result.stdout.toString());
    return output.containerId ?? null;
  } catch {
    return null;
  }
}

/**
 * Run a command inside the devcontainer via `devcontainer exec`.
 */
export function devcontainerExec(
  worktreeDir: string,
  configPath: string,
  slug: string,
  cmd: string[],
): Bun.SyncSubprocess {
  return Bun.spawnSync(
    [
      "devcontainer",
      "exec",
      "--workspace-folder",
      worktreeDir,
      "--config",
      configPath,
      "--id-label",
      `workbench=${slug}`,
      ...cmd,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );
}

/**
 * Stop and remove a container by its workbench label slug.
 */
export function stopContainer(slug: string): boolean {
  // Find containers with the label
  const find = Bun.spawnSync(["docker", "ps", "-aq", "--filter", `label=workbench=${slug}`], {
    stdout: "pipe",
  });

  const ids = find.stdout.toString().trim();
  if (!ids) {
    return true;
  }

  const result = Bun.spawnSync(["docker", "rm", "-f", ...ids.split("\n")], {
    stdout: "ignore",
    stderr: "ignore",
  });
  return result.exitCode === 0;
}

/**
 * Stop and remove ALL containers with any `workbench=*` label.
 */
export function cleanupAllContainers(): boolean {
  const find = Bun.spawnSync(["docker", "ps", "-aq", "--filter", "label=workbench"], {
    stdout: "pipe",
  });

  const ids = find.stdout.toString().trim();
  if (!ids) {
    return true;
  }

  const result = Bun.spawnSync(["docker", "rm", "-f", ...ids.split("\n")], {
    stdout: "ignore",
    stderr: "ignore",
  });
  return result.exitCode === 0;
}
