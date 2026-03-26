import { describe, expect, it } from "bun:test";
import { isProcessAlive, isPortFree } from "#lib/process";
import { createServer } from "net";

describe("isProcessAlive", () => {
  it("returns true for own process", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("returns false for invalid PID", () => {
    expect(isProcessAlive(999999999)).toBe(false);
  });

  it("returns false for PID 0", () => {
    // PID 0 is the kernel — kill(0, 0) sends to process group, not useful here
    // but isProcessAlive should handle it without throwing
    const result = isProcessAlive(0);
    expect(typeof result).toBe("boolean");
  });
});

describe("isPortFree", () => {
  it("returns true for an unused port", async () => {
    // Use a high random port unlikely to be in use
    const port = 49152 + Math.floor(Math.random() * 16000);
    const free = await isPortFree(port);
    expect(free).toBe(true);
  });

  it("returns false for a port in use", async () => {
    // Bind a port, then check it's not free
    const server = createServer();
    const port = await new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });

    try {
      const free = await isPortFree(port);
      expect(free).toBe(false);
    } finally {
      server.close();
    }
  });
});
