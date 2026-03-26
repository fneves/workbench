import { describe, expect, it, beforeEach } from "bun:test";

// We test the parsing logic by mocking Bun.spawnSync to return controlled output.
// The sync functions (getDiffStats, getFileChanges) use Bun.spawnSync internally.

// Helper to create a mock spawnSync return value
function mockSpawnResult(stdout: string, exitCode = 0) {
  return {
    exitCode,
    stdout: Buffer.from(stdout),
    stderr: Buffer.from(""),
    success: exitCode === 0,
  };
}

describe("getDiffStats", () => {
  let getDiffStats: typeof import("#lib/git").getDiffStats;

  beforeEach(async () => {
    // Fresh import each time to pick up new mocks
    const mod = await import("#lib/git");
    getDiffStats = mod.getDiffStats;
  });

  it("parses standard shortstat output", () => {
    const original = Bun.spawnSync;
    Bun.spawnSync = (() =>
      mockSpawnResult(" 3 files changed, 42 insertions(+), 10 deletions(-)")) as any;
    try {
      const stats = getDiffStats("/fake/dir");
      expect(stats).toEqual({ files: 3, added: 42, removed: 10 });
    } finally {
      Bun.spawnSync = original;
    }
  });

  it("parses insertions only", () => {
    const original = Bun.spawnSync;
    Bun.spawnSync = (() => mockSpawnResult(" 1 file changed, 5 insertions(+)")) as any;
    try {
      const stats = getDiffStats("/fake/dir");
      expect(stats).toEqual({ files: 1, added: 5, removed: 0 });
    } finally {
      Bun.spawnSync = original;
    }
  });

  it("parses deletions only", () => {
    const original = Bun.spawnSync;
    Bun.spawnSync = (() => mockSpawnResult(" 2 files changed, 8 deletions(-)")) as any;
    try {
      const stats = getDiffStats("/fake/dir");
      expect(stats).toEqual({ files: 2, added: 0, removed: 8 });
    } finally {
      Bun.spawnSync = original;
    }
  });

  it("returns zeros for empty output", () => {
    const original = Bun.spawnSync;
    Bun.spawnSync = (() => mockSpawnResult("")) as any;
    try {
      const stats = getDiffStats("/fake/dir");
      expect(stats).toEqual({ files: 0, added: 0, removed: 0 });
    } finally {
      Bun.spawnSync = original;
    }
  });

  it("returns zeros on command failure", () => {
    const original = Bun.spawnSync;
    Bun.spawnSync = (() => mockSpawnResult("", 1)) as any;
    try {
      const stats = getDiffStats("/fake/dir");
      expect(stats).toEqual({ files: 0, added: 0, removed: 0 });
    } finally {
      Bun.spawnSync = original;
    }
  });
});

describe("getFileChanges — porcelain parsing", () => {
  let getFileChanges: typeof import("#lib/git").getFileChanges;

  beforeEach(async () => {
    const mod = await import("#lib/git");
    getFileChanges = mod.getFileChanges;
  });

  // Helper: mock spawnSync to return different results based on args
  function setupMock(porcelain: string, numstat = "", cachedNumstat = "") {
    const original = Bun.spawnSync;
    Bun.spawnSync = ((args: string[]) => {
      const argsStr = args.join(" ");
      if (argsStr.includes("--porcelain")) {
        return mockSpawnResult(porcelain);
      }
      if (argsStr.includes("--numstat") && argsStr.includes("--cached")) {
        return mockSpawnResult(cachedNumstat);
      }
      if (argsStr.includes("--numstat")) {
        return mockSpawnResult(numstat);
      }
      return mockSpawnResult("", 1);
    }) as any;
    return original;
  }

  it("parses untracked file", () => {
    const original = setupMock("?? newfile.ts");
    try {
      const changes = getFileChanges("/fake/dir");
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({
        path: "newfile.ts",
        status: "untracked",
      });
    } finally {
      Bun.spawnSync = original;
    }
  });

  it("parses staged modification", () => {
    const original = setupMock("M  src/lib/config.ts", "", "10\t2\tsrc/lib/config.ts");
    try {
      const changes = getFileChanges("/fake/dir");
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({
        path: "src/lib/config.ts",
        status: "staged",
        added: 10,
        removed: 2,
      });
    } finally {
      Bun.spawnSync = original;
    }
  });

  it("parses unstaged modification", () => {
    const original = setupMock(" M src/lib/git.ts", "5\t3\tsrc/lib/git.ts");
    try {
      const changes = getFileChanges("/fake/dir");
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({
        path: "src/lib/git.ts",
        status: "unstaged",
        added: 5,
        removed: 3,
      });
    } finally {
      Bun.spawnSync = original;
    }
  });

  it("parses added file", () => {
    const original = setupMock("A  brand-new.ts");
    try {
      const changes = getFileChanges("/fake/dir");
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({
        path: "brand-new.ts",
        status: "added",
      });
    } finally {
      Bun.spawnSync = original;
    }
  });

  it("parses deleted file", () => {
    const original = setupMock("D  old-file.ts");
    try {
      const changes = getFileChanges("/fake/dir");
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({
        path: "old-file.ts",
        status: "deleted",
      });
    } finally {
      Bun.spawnSync = original;
    }
  });

  it("parses conflict", () => {
    const original = setupMock("UU conflicted.ts");
    try {
      const changes = getFileChanges("/fake/dir");
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({
        path: "conflicted.ts",
        status: "conflict",
      });
    } finally {
      Bun.spawnSync = original;
    }
  });

  it("parses renamed file with tab separator", () => {
    const original = setupMock("R  new-name.ts\told-name.ts");
    try {
      const changes = getFileChanges("/fake/dir");
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({
        path: "new-name.ts",
        originalPath: "old-name.ts",
        status: "renamed",
      });
    } finally {
      Bun.spawnSync = original;
    }
  });

  it("parses both staged and unstaged", () => {
    const original = setupMock("MM src/both.ts");
    try {
      const changes = getFileChanges("/fake/dir");
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({
        path: "src/both.ts",
        status: "both",
      });
    } finally {
      Bun.spawnSync = original;
    }
  });

  it("combines line counts from staged and unstaged numstat", () => {
    const original = setupMock(
      "MM src/combined.ts",
      "3\t1\tsrc/combined.ts",
      "7\t2\tsrc/combined.ts",
    );
    try {
      const changes = getFileChanges("/fake/dir");
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({
        path: "src/combined.ts",
        added: 10,
        removed: 3,
      });
    } finally {
      Bun.spawnSync = original;
    }
  });

  it("handles multiple files", () => {
    const porcelain = ["M  staged.ts", " M unstaged.ts", "?? new.ts"].join("\n");
    const original = setupMock(porcelain);
    try {
      const changes = getFileChanges("/fake/dir");
      expect(changes).toHaveLength(3);
      expect(changes.map((c) => c.status)).toEqual(["staged", "unstaged", "untracked"]);
    } finally {
      Bun.spawnSync = original;
    }
  });

  it("returns empty array for no changes", () => {
    const original = setupMock("");
    try {
      const changes = getFileChanges("/fake/dir");
      expect(changes).toEqual([]);
    } finally {
      Bun.spawnSync = original;
    }
  });
});
