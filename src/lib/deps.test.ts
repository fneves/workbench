import { afterEach, describe, expect, it } from "bun:test";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  DEPS_MANIFEST_BASENAME,
  discoverDependencyLinks,
  writeDependencyLinksManifest,
  writeShellInit,
} from "#lib/deps";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "workbench-deps-"));
  tempDirs.push(dir);
  return dir;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function runGit(cwd: string, args: string[]): void {
  const result = Bun.spawnSync(["git", ...args], { cwd, stderr: "pipe", stdout: "pipe" });
  expect(result.exitCode).toBe(0);
}

function createExecutable(binDir: string, name: string): void {
  const file = join(binDir, name);
  writeFileSync(file, '#!/bin/zsh\nprintf \'%s\\n\' "$0 $*" >> "$WB_LOG_FILE"\n');
  chmodSync(file, 0o755);
}

function setupWorktree(pm: "yarn" | "npm" | "pnpm" | "bun") {
  const root = makeTempDir();
  const sourceRepoDir = join(root, "source");
  const worktreeDir = join(root, "worktree");
  const binDir = join(root, "bin");
  const logFile = join(root, "command.log");
  const sourcePackagesDir = join(sourceRepoDir, "packages", "app");
  const worktreePackagesDir = join(worktreeDir, "packages", "app");

  mkdirSync(sourceRepoDir, { recursive: true });
  mkdirSync(worktreeDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  mkdirSync(join(sourceRepoDir, "node_modules"), { recursive: true });
  mkdirSync(join(sourcePackagesDir, "node_modules"), { recursive: true });
  mkdirSync(sourcePackagesDir, { recursive: true });
  mkdirSync(worktreePackagesDir, { recursive: true });

  writeJson(join(sourceRepoDir, "package.json"), { private: true, workspaces: ["packages/*"] });
  writeJson(join(worktreeDir, "package.json"), { private: true, workspaces: ["packages/*"] });
  writeJson(join(sourcePackagesDir, "package.json"), { name: "app", version: "1.0.0" });
  writeJson(join(worktreePackagesDir, "package.json"), { name: "app", version: "1.0.0" });
  writeFileSync(join(sourceRepoDir, ".gitignore"), ".cache/\n");
  writeFileSync(join(worktreeDir, ".gitignore"), ".cache/\n");
  writeFileSync(join(sourceRepoDir, "yarn.lock"), "lockfile\n");
  writeFileSync(join(worktreeDir, "yarn.lock"), "lockfile\n");

  runGit(sourceRepoDir, ["init"]);
  runGit(worktreeDir, ["init"]);
  runGit(sourceRepoDir, ["add", "."]);
  runGit(worktreeDir, ["add", "."]);

  for (const name of ["yarn", "npm", "pnpm", "bun"]) {
    createExecutable(binDir, name);
  }

  writeDependencyLinksManifest(worktreeDir, sourceRepoDir);
  writeShellInit(worktreeDir, pm);

  return {
    binDir,
    logFile,
    sourceRepoDir,
    sourcePackagesDir,
    worktreeDir,
    worktreePackagesDir,
  };
}

function runWrappedCommand(
  worktreeDir: string,
  binDir: string,
  logFile: string,
  pm: string,
  args: string[],
): { stdout: string; stderr: string } {
  const command = [
    "export PATH=" + JSON.stringify(`${binDir}:${process.env.PATH ?? ""}`),
    `export WORKTREE_DIR=${JSON.stringify(worktreeDir)}`,
    `export WB_LOG_FILE=${JSON.stringify(logFile)}`,
    `cd ${JSON.stringify(worktreeDir)}`,
    `source ${JSON.stringify(join(worktreeDir, ".workbench-shell-init.sh"))}`,
    [pm, ...args].map((part) => JSON.stringify(part)).join(" "),
  ].join("\n");

  const result = Bun.spawnSync(["zsh", "-c", command], {
    env: { ...process.env },
    stderr: "pipe",
    stdout: "pipe",
  });

  expect(result.exitCode).toBe(0);
  return {
    stderr: result.stderr.toString(),
    stdout: result.stdout.toString(),
  };
}

function expectSymlink(path: string): void {
  expect(lstatSync(path).isSymbolicLink()).toBe(true);
}

function expectRemoved(path: string): void {
  expect(existsSync(path)).toBe(false);
}

function expectCommandNotInvoked(logFile: string): void {
  expect(existsSync(logFile)).toBe(false);
}

describe("discoverDependencyLinks", () => {
  it("finds root and nested node_modules next to tracked manifests", () => {
    const root = makeTempDir();
    const repoDir = join(root, "repo");
    mkdirSync(join(repoDir, "packages", "app", "node_modules"), { recursive: true });
    mkdirSync(join(repoDir, "node_modules"), { recursive: true });
    writeJson(join(repoDir, "package.json"), { private: true, workspaces: ["packages/*"] });
    writeJson(join(repoDir, "packages", "app", "package.json"), { name: "app", version: "1.0.0" });

    runGit(repoDir, ["init"]);
    runGit(repoDir, ["add", "."]);

    expect(discoverDependencyLinks(repoDir)).toEqual(["node_modules", "packages/app/node_modules"]);
  });
});

describe("writeShellInit", () => {
  it("creates a dependency manifest with managed links", () => {
    const { sourceRepoDir, worktreeDir } = setupWorktree("yarn");

    const manifestFile = join(worktreeDir, DEPS_MANIFEST_BASENAME);
    const manifestContent = readFileSync(manifestFile, "utf8");

    expect(manifestContent).toContain(sourceRepoDir);
    expect(manifestContent).toContain("node_modules");
    expect(manifestContent).toContain("packages/app/node_modules");
  });

  it("restores root and nested node_modules links when the shell init is sourced", () => {
    const { worktreeDir } = setupWorktree("yarn");

    const shellCommand = [
      `export WORKTREE_DIR=${JSON.stringify(worktreeDir)}`,
      `cd ${JSON.stringify(worktreeDir)}`,
      `source ${JSON.stringify(join(worktreeDir, ".workbench-shell-init.sh"))}`,
    ].join("\n");
    const result = Bun.spawnSync(["zsh", "-c", shellCommand], { stderr: "pipe", stdout: "pipe" });

    expect(result.exitCode).toBe(0);
    expectSymlink(join(worktreeDir, "node_modules"));
    expectSymlink(join(worktreeDir, "packages", "app", "node_modules"));
  });

  it("keeps the links for yarn script commands", () => {
    const { binDir, logFile, worktreeDir } = setupWorktree("yarn");

    runWrappedCommand(worktreeDir, binDir, logFile, "yarn", ["my-script"]);

    expectSymlink(join(worktreeDir, "node_modules"));
    expectSymlink(join(worktreeDir, "packages", "app", "node_modules"));
    expect(readFileSync(logFile, "utf8")).toContain("yarn my-script");
  });

  it("skips yarn install entirely when dependency inputs match", () => {
    const { binDir, logFile, worktreeDir } = setupWorktree("yarn");

    const result = runWrappedCommand(worktreeDir, binDir, logFile, "yarn", ["install"]);

    expectSymlink(join(worktreeDir, "node_modules"));
    expectSymlink(join(worktreeDir, "packages", "app", "node_modules"));
    expect(result.stdout).toContain("skipping yarn install");
    expectCommandNotInvoked(logFile);
  });

  it("skips bare yarn entirely when dependency inputs match", () => {
    const { binDir, logFile, worktreeDir } = setupWorktree("yarn");

    const result = runWrappedCommand(worktreeDir, binDir, logFile, "yarn", []);

    expectSymlink(join(worktreeDir, "node_modules"));
    expectSymlink(join(worktreeDir, "packages", "app", "node_modules"));
    expect(result.stdout).toContain("skipping yarn install");
    expectCommandNotInvoked(logFile);
  });

  it("removes all managed dependency links for yarn install when a workspace manifest differs", () => {
    const { binDir, logFile, worktreeDir, worktreePackagesDir } = setupWorktree("yarn");

    writeJson(join(worktreePackagesDir, "package.json"), { name: "app", version: "2.0.0" });
    runWrappedCommand(worktreeDir, binDir, logFile, "yarn", ["install"]);

    expectRemoved(join(worktreeDir, "node_modules"));
    expectRemoved(join(worktreeDir, "packages", "app", "node_modules"));
    expect(readFileSync(logFile, "utf8")).toContain("yarn install");
  });

  it("keeps the links when only ignored generated manifests exist in the source repo", () => {
    const { binDir, logFile, sourceRepoDir, worktreeDir } = setupWorktree("yarn");

    mkdirSync(join(sourceRepoDir, ".cache", "generated"), { recursive: true });
    writeJson(join(sourceRepoDir, ".cache", "generated", "package.json"), {
      name: "generated-cache",
      private: true,
    });
    const result = runWrappedCommand(worktreeDir, binDir, logFile, "yarn", []);

    expectSymlink(join(worktreeDir, "node_modules"));
    expectSymlink(join(worktreeDir, "packages", "app", "node_modules"));
    expect(result.stdout).toContain("skipping yarn install");
    expectCommandNotInvoked(logFile);
  });

  it("removes all managed links when a new untracked package manifest exists in the worktree", () => {
    const { binDir, logFile, worktreeDir } = setupWorktree("yarn");

    mkdirSync(join(worktreeDir, "packages", "new-package"), { recursive: true });
    writeJson(join(worktreeDir, "packages", "new-package", "package.json"), {
      name: "new-package",
      version: "1.0.0",
    });
    runWrappedCommand(worktreeDir, binDir, logFile, "yarn", []);

    expectRemoved(join(worktreeDir, "node_modules"));
    expectRemoved(join(worktreeDir, "packages", "app", "node_modules"));
    expect(readFileSync(logFile, "utf8")).toContain("yarn ");
  });

  it("removes all managed links for yarn add", () => {
    const { binDir, logFile, worktreeDir } = setupWorktree("yarn");

    runWrappedCommand(worktreeDir, binDir, logFile, "yarn", ["add", "left-pad"]);

    expectRemoved(join(worktreeDir, "node_modules"));
    expectRemoved(join(worktreeDir, "packages", "app", "node_modules"));
    expect(readFileSync(logFile, "utf8")).toContain("yarn add left-pad");
  });

  it("removes all managed links for npm install with package arguments", () => {
    const { binDir, logFile, worktreeDir } = setupWorktree("npm");

    runWrappedCommand(worktreeDir, binDir, logFile, "npm", ["install", "left-pad"]);

    expectRemoved(join(worktreeDir, "node_modules"));
    expectRemoved(join(worktreeDir, "packages", "app", "node_modules"));
    expect(readFileSync(logFile, "utf8")).toContain("npm install left-pad");
  });
});
