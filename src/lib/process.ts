import { createServer } from "net";

const SIGTERM_GRACE_MS = 1000;

/** Send SIGTERM, wait, then SIGKILL if still alive. Awaitable. */
async function terminatePid(pid: number): Promise<boolean> {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return false;
  }

  await new Promise((r) => setTimeout(r, SIGTERM_GRACE_MS));

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Already dead — that's fine
  }
  return true;
}

/** Fire-and-forget kill (SIGTERM then SIGKILL). Use terminatePid when you need to wait. */
export function killProcess(pid: number): boolean {
  try {
    process.kill(pid, "SIGTERM");
    setTimeout(() => {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already dead
      }
    }, SIGTERM_GRACE_MS);
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill a process and all its descendants. Awaits until everything is dead.
 * Tries process-group kill first (requires the process to be a session leader),
 * then falls back to recursive pgrep-based tree walk.
 */
export async function killProcessTree(pid: number): Promise<boolean> {
  // Try killing the entire process group (negative PID).
  // This works when the target was spawned as a session leader (setsid).
  let groupKilled = false;
  try {
    process.kill(-pid, "SIGTERM");
    groupKilled = true;
  } catch {
    // Not a session leader or already dead — fall back to pgrep
  }

  if (groupKilled) {
    await new Promise((r) => setTimeout(r, SIGTERM_GRACE_MS));
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // Already dead
    }
    return true;
  }

  // Recursive fallback: find direct children, kill them depth-first, then parent
  const pgrep = Bun.spawn(["pgrep", "-P", String(pid)], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const output = await new Response(pgrep.stdout).text();
  await pgrep.exited;

  const childPids = output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(Number)
    .filter((n) => !isNaN(n));

  // Recurse into children (handles grandchildren)
  for (const cpid of childPids) {
    await killProcessTree(cpid);
  }

  return terminatePid(pid);
}

/**
 * Kill all processes listening on a given port. Awaits until they're dead.
 */
export async function killPortOccupants(port: number): Promise<void> {
  const proc = Bun.spawn(["lsof", "-i", `:${port}`, "-t"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const output = await new Response(proc.stdout).text();
  await proc.exited;

  const pids = output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(Number)
    .filter((n) => !isNaN(n));

  // Kill all occupants and wait for each to die
  await Promise.all(pids.map((pid) => terminatePid(pid)));
}

/**
 * Check if a TCP port is free by attempting to bind to it.
 * More reliable than lsof — avoids TOCTOU race conditions.
 */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
