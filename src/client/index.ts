import { Socket } from "net";
import { SERVER_SOCKET_PATH, type Response } from "../server/types";

type EventHandler = (data: any) => void;

export class WorkbenchClient {
  private socket: Socket | null = null;
  private pending = new Map<string, { resolve: (r: Response) => void }>();
  private listeners = new Map<string, Set<EventHandler>>();
  private buffer = "";
  private requestId = 0;
  private connected = false;

  get isConnected(): boolean {
    return this.connected;
  }

  connect(socketPath = SERVER_SOCKET_PATH): Promise<boolean> {
    return new Promise((resolve) => {
      this.socket = new Socket();
      this.socket.setTimeout(5000);

      this.socket.on("connect", () => {
        this.connected = true;
        this.socket!.setTimeout(0); // Clear connect timeout
        resolve(true);
      });

      this.socket.on("error", () => {
        if (!this.connected) resolve(false);
        this.connected = false;
      });

      this.socket.on("timeout", () => {
        if (!this.connected) {
          this.socket!.destroy();
          resolve(false);
        }
      });

      this.socket.on("data", (chunk: Buffer) => this.handleData(chunk));

      this.socket.on("close", () => {
        this.connected = false;
        // Reject all pending requests
        for (const [id, { resolve }] of this.pending) {
          resolve({ id, ok: false, error: { code: "DISCONNECTED", message: "Connection closed" } });
        }
        this.pending.clear();
      });

      this.socket.connect(socketPath);
    });
  }

  private handleData(chunk: Buffer): void {
    this.buffer += chunk.toString();
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop()!;

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if ("event" in msg && !("id" in msg)) {
          // Push event
          this.emit(msg.event, msg.data);
        } else if ("id" in msg) {
          // Response
          const pending = this.pending.get(msg.id);
          if (pending) {
            this.pending.delete(msg.id);
            pending.resolve(msg as Response);
          }
        }
      } catch {}
    }
  }

  async request(method: string, params?: Record<string, unknown>): Promise<Response> {
    if (!this.connected || !this.socket) {
      return {
        id: "",
        ok: false,
        error: { code: "NOT_CONNECTED", message: "Not connected to server" },
      };
    }

    const id = `c-${++this.requestId}`;
    const payload = JSON.stringify({ id, method, params }) + "\n";

    return new Promise((resolve) => {
      this.pending.set(id, { resolve });
      this.socket!.write(payload);

      // 30s timeout for long operations (spawn can take a while)
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          resolve({ id, ok: false, error: { code: "TIMEOUT", message: "Request timed out" } });
        }
      }, 30000);
    });
  }

  on(event: string, handler: EventHandler): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
  }

  off(event: string, handler: EventHandler): void {
    this.listeners.get(event)?.delete(handler);
  }

  private emit(event: string, data: unknown): void {
    for (const handler of this.listeners.get(event) ?? []) {
      try {
        handler(data);
      } catch {}
    }
  }

  close(): void {
    this.connected = false;
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.pending.clear();
  }
}
