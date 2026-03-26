import { describe, expect, it } from "bun:test";
import { branchToSlug, getStateFile, WORKBENCH_STATE_DIR } from "#lib/config";

describe("branchToSlug", () => {
  it("replaces slashes with dashes", () => {
    expect(branchToSlug("fn/my-feature")).toBe("fn-my-feature");
  });

  it("handles multiple slashes", () => {
    expect(branchToSlug("user/topic/subtopic")).toBe("user-topic-subtopic");
  });

  it("returns branch unchanged if no slashes", () => {
    expect(branchToSlug("simple-branch")).toBe("simple-branch");
  });

  it("handles empty string", () => {
    expect(branchToSlug("")).toBe("");
  });
});

describe("getStateFile", () => {
  it("returns path under WORKBENCH_STATE_DIR with slug", () => {
    const result = getStateFile("fn/my-feature");
    expect(result).toBe(`${WORKBENCH_STATE_DIR}/fn-my-feature.json`);
  });

  it("handles simple branch names", () => {
    const result = getStateFile("main");
    expect(result).toBe(`${WORKBENCH_STATE_DIR}/main.json`);
  });
});
