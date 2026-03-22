/** Client → Server */
export interface Request {
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

/** Server → Client (response to a request) */
export interface Response {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

/** Server → Client (push event) */
export interface Event {
  event: string;
  data: unknown;
}

export type ServerMessage = Response | Event;

export function isEvent(msg: ServerMessage): msg is Event {
  return "event" in msg && !("id" in msg);
}

export function isResponse(msg: ServerMessage): msg is Response {
  return "id" in msg;
}

export const SERVER_SOCKET_PATH = "/tmp/workbench/server.sock";
