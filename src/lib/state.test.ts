import { describe, expect, it } from "bun:test";
import { newTaskState } from "#lib/state";

describe("newTaskState", () => {
  it("returns a complete TaskState with defaults", () => {
    const state = newTaskState({
      branch: "fn/my-feature",
      agent: "claude",
      mode: "worktree",
      worktree: "/tmp/worktrees/fn-my-feature",
      prompt: "Fix the bug",
    });

    expect(state.branch).toBe("fn/my-feature");
    expect(state.agent).toBe("claude");
    expect(state.mode).toBe("worktree");
    expect(state.worktree).toBe("/tmp/worktrees/fn-my-feature");
    expect(state.prompt).toBe("Fix the bug");
    expect(state.status).toBe("starting");
  });

  it("initializes numeric fields to zero", () => {
    const state = newTaskState({
      branch: "test",
      agent: "claude",
      mode: "worktree",
      worktree: "/tmp/test",
      prompt: "",
    });

    expect(state.diff_added).toBe(0);
    expect(state.diff_removed).toBe(0);
    expect(state.diff_files).toBe(0);
  });

  it("initializes all nullable fields to null", () => {
    const state = newTaskState({
      branch: "test",
      agent: "opencode",
      mode: "container",
      worktree: "/tmp/test",
      prompt: "test",
    });

    expect(state.pid).toBeNull();
    expect(state.cmux_workspace_id).toBeNull();
    expect(state.cmux_agent_surface_id).toBeNull();
    expect(state.container_id).toBeNull();
    expect(state.devcontainer_config).toBeNull();
    expect(state.vscode_pid).toBeNull();
    expect(state.vscode_port).toBeNull();
    expect(state.vscode_surface_id).toBeNull();
  });

  it("sets created_at and updated_at to ISO timestamps", () => {
    const before = new Date().toISOString();
    const state = newTaskState({
      branch: "test",
      agent: "claude",
      mode: "worktree",
      worktree: "/tmp/test",
      prompt: "",
    });
    const after = new Date().toISOString();

    expect(state.created_at >= before).toBe(true);
    expect(state.created_at <= after).toBe(true);
    expect(state.created_at).toBe(state.updated_at);
  });
});
