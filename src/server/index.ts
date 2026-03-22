import { createServer, type Server, type Socket } from "net";
import { existsSync, unlinkSync, readFileSync } from "fs";

import { listTasks, type TaskState } from "#lib/state";
import { getFileChanges } from "#lib/git";
import { notify } from "#lib/notify";
import { getNotificationSound, branchToSlug } from "#lib/config";
import { handlers } from "#server/handlers";
import { SERVER_SOCKET_PATH, type Request, type Event } from "#server/types";

export { SERVER_SOCKET_PATH } from "#server/types";

export class WorkbenchServer {
  private server: Server | null = null;
  private clients = new Set<Socket>();
  private intervals: NodeJS.Timeout[] = [];
  private socketPath: string;

  // State tracking for poll loops
  private prevTaskMap = new Map<string, TaskState>();
  private prevFilesJson = new Map<string, string>();
  private broadcastedPrUrls = new Set<string>();

  constructor(socketPath = SERVER_SOCKET_PATH) {
    this.socketPath = socketPath;
  }

  async start(): Promise<void> {
    // Clean up stale socket
    if (existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath);
      } catch {}
    }

    return new Promise((resolve) => {
      this.server = createServer((socket) => {
        this.clients.add(socket);
        let buffer = "";

        socket.on("data", (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop()!;

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const request = JSON.parse(line) as Request;
              this.handleRequest(socket, request);
            } catch {}
          }
        });

        socket.on("close", () => this.clients.delete(socket));
        socket.on("error", () => this.clients.delete(socket));
      });

      this.server.listen(this.socketPath, () => {
        this.startPolling();
        resolve();
      });
    });
  }

  stop(): void {
    for (const id of this.intervals) clearInterval(id);
    this.intervals = [];
    for (const client of this.clients) {
      try {
        client.destroy();
      } catch {}
    }
    this.clients.clear();
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    try {
      unlinkSync(this.socketPath);
    } catch {}
  }

  private async handleRequest(socket: Socket, request: Request): Promise<void> {
    const handler = handlers[request.method];
    if (!handler) {
      this.send(socket, {
        id: request.id,
        ok: false,
        error: { code: "NOT_FOUND", message: `Unknown method: ${request.method}` },
      });
      return;
    }

    try {
      const result = await handler(request.params ?? {});
      this.send(socket, { id: request.id, ok: true, result });
    } catch (err: any) {
      const error = err.code
        ? { code: err.code, message: err.message }
        : { code: "INTERNAL", message: String(err?.message ?? err) };
      this.send(socket, { id: request.id, ok: false, error });
    }
  }

  private send(socket: Socket, msg: Record<string, any>): void {
    if (socket.destroyed) {
      this.clients.delete(socket);
      return;
    }
    try {
      socket.write(JSON.stringify(msg) + "\n");
    } catch {
      this.clients.delete(socket);
    }
  }

  private broadcast(event: Event): void {
    const line = JSON.stringify(event) + "\n";
    for (const client of this.clients) {
      if (client.destroyed) {
        this.clients.delete(client);
        continue;
      }
      try {
        client.write(line);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  private startPolling(): void {
    // Task state: every 1000ms
    this.intervals.push(setInterval(() => this.pollTaskState(), 1000));

    // File changes: every 2000ms
    this.intervals.push(setInterval(() => this.pollFileChanges(), 2000));

    // Sentinels (review, PR): every 500ms
    this.intervals.push(setInterval(() => this.pollSentinels(), 500));

    // Run initial polls
    this.pollTaskState();
    this.pollFileChanges();
  }

  private async pollTaskState(): Promise<void> {
    const tasks = await listTasks();
    const currentMap = new Map(tasks.map((t) => [t.branch, t]));

    // Detect new tasks
    for (const [branch, task] of currentMap) {
      if (!this.prevTaskMap.has(branch)) {
        this.broadcast({ event: "task.created", data: { task } });
      }
    }

    // Detect deleted tasks
    for (const [branch] of this.prevTaskMap) {
      if (!currentMap.has(branch)) {
        this.broadcast({ event: "task.deleted", data: { branch } });
        this.prevFilesJson.delete(branch);
        this.broadcastedPrUrls.delete(branch);
      }
    }

    // Detect updates and transitions
    for (const [branch, task] of currentMap) {
      const prev = this.prevTaskMap.get(branch);
      if (!prev) continue;

      if (JSON.stringify(prev) !== JSON.stringify(task)) {
        this.broadcast({ event: "task.updated", data: { task } });
      }

      if (prev.status !== task.status) {
        this.handleTransition(branch, prev.status, task.status, task);
        this.broadcast({
          event: "task.transition",
          data: { branch, from: prev.status, to: task.status, task },
        });
      }
    }

    this.prevTaskMap = currentMap;
  }

  private handleTransition(branch: string, _from: string, to: string, _task: TaskState): void {
    switch (to) {
      case "done":
        notify(`\u2713 ${branch}`, "Agent finished successfully", getNotificationSound("success"));
        break;
      case "prompting":
        notify(`\u23F3 ${branch}`, "Agent is waiting for input", getNotificationSound("waiting"));
        break;
      case "failed":
        notify(`\u2717 ${branch}`, "Agent failed", getNotificationSound("failure"));
        break;
    }
  }

  private async pollFileChanges(): Promise<void> {
    for (const [branch, task] of this.prevTaskMap) {
      if (task.status === "killing") continue;
      if (!task.worktree || !existsSync(task.worktree)) continue;

      try {
        const files = getFileChanges(task.worktree);
        const serialized = JSON.stringify(files);

        if (this.prevFilesJson.get(branch) !== serialized) {
          this.prevFilesJson.set(branch, serialized);
          this.broadcast({ event: "files.changed", data: { branch, files } });
        }
      } catch {}
    }
  }

  private pollSentinels(): void {
    for (const [branch] of this.prevTaskMap) {
      const slug = branchToSlug(branch);

      // Review sentinel
      const reviewSentinel = `/tmp/workbench/${slug}-review.md.ready`;
      if (existsSync(reviewSentinel)) {
        try {
          unlinkSync(reviewSentinel);
        } catch {}
        this.broadcast({ event: "review.ready", data: { branch } });
      }

      // PR sentinel
      const prSentinel = `/tmp/workbench/${slug}.pr-url`;
      if (existsSync(prSentinel) && !this.broadcastedPrUrls.has(branch)) {
        try {
          const url = readFileSync(prSentinel, "utf8").trim();
          if (url) {
            this.broadcastedPrUrls.add(branch);
            this.broadcast({ event: "pr.created", data: { branch, url } });
          }
        } catch {}
      }
    }
  }
}

/** Check if a server is already listening on the socket. */
export function isServerRunning(socketPath = SERVER_SOCKET_PATH): Promise<boolean> {
  if (!existsSync(socketPath)) return Promise.resolve(false);

  const { Socket: NetSocket } = require("net") as typeof import("net");
  return new Promise((resolve) => {
    const socket = new NetSocket();
    socket.setTimeout(500);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(socketPath);
  });
}
