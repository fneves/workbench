import { Socket } from "net";

const CMUX_SOCKET =
  process.env.CMUX_SOCKET_PATH ?? `${process.env.HOME}/Library/Application Support/cmux/cmux.sock`;

let requestId = 0;

interface CmuxResponse {
  id: string;
  ok: boolean;
  result?: any;
  error?: { code: string; message: string };
}

function nextId(): string {
  return `wb-${++requestId}`;
}

/**
 * Send a JSON-RPC-style request to cmux via Unix socket (async).
 */
export function cmuxRequest(
  method: string,
  params: Record<string, any> = {},
): Promise<CmuxResponse | null> {
  const id = nextId();
  const payload = JSON.stringify({ id, method, params }) + "\n";

  return new Promise((resolve) => {
    const socket = new Socket();
    let data = "";
    let resolved = false;

    const done = (result: CmuxResponse | null) => {
      if (resolved) {
        return;
      }
      resolved = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(3000);
    socket.on("timeout", () => done(null));
    socket.on("error", () => done(null));
    socket.on("data", (chunk) => {
      data += chunk.toString();
      // Try to parse response as soon as we get data
      for (const line of data.split("\n")) {
        if (!line.trim()) {
          continue;
        }
        try {
          const parsed = JSON.parse(line) as CmuxResponse;
          if (parsed.id === id) {
            done(parsed);
            return;
          }
        } catch {}
      }
    });
    socket.on("end", () => done(null));

    socket.connect(CMUX_SOCKET, () => {
      socket.write(payload);
    });
  });
}

// --- Workspace management ---

export async function listWorkspaces(): Promise<{ id: string; title: string }[]> {
  const res = await cmuxRequest("workspace.list");
  if (!res?.ok) {
    return [];
  }
  return res.result?.workspaces ?? [];
}

export async function findWorkspace(title: string): Promise<string | null> {
  const workspaces = await listWorkspaces();
  const ws = workspaces.find((w) => w.title === title);
  return ws?.id ?? null;
}

export async function createWorkspace(): Promise<string | null> {
  const res = await cmuxRequest("workspace.create");
  if (!res?.ok) {
    return null;
  }
  return res.result?.workspace_id ?? null;
}

export async function renameWorkspace(workspaceId: string, title: string): Promise<boolean> {
  const res = await cmuxRequest("workspace.rename", { workspace_id: workspaceId, title });
  return res?.ok ?? false;
}

/** Create a new workspace with a title (create + rename). */
export async function newWorkspace(title: string): Promise<string | null> {
  const wsId = await createWorkspace();
  if (!wsId) {
    return null;
  }
  await renameWorkspace(wsId, title);
  return wsId;
}

export async function selectWorkspace(workspaceId: string): Promise<boolean> {
  const res = await cmuxRequest("workspace.select", { workspace_id: workspaceId });
  return res?.ok ?? false;
}

export async function closeWorkspace(workspaceId: string): Promise<boolean> {
  const res = await cmuxRequest("workspace.close", { workspace_id: workspaceId });
  return res?.ok ?? false;
}

// --- Surface/pane management ---

export async function splitPane(
  direction: "right" | "left" | "up" | "down" = "right",
  workspaceId?: string,
): Promise<string | null> {
  const params: Record<string, any> = { direction };
  if (workspaceId) {
    params.workspace_id = workspaceId;
  }
  const res = await cmuxRequest("surface.split", params);
  if (!res?.ok) {
    return null;
  }
  return res.result?.surface_id ?? null;
}

/** Split and return both surface and pane IDs. */
export async function splitPaneWithIds(
  direction: "right" | "left" | "up" | "down" = "right",
): Promise<{ surfaceId: string; paneId: string } | null> {
  const res = await cmuxRequest("surface.split", { direction });
  if (!res?.ok) {
    return null;
  }
  const surfaceId = res.result?.surface_id;
  const paneId = res.result?.pane_id;
  if (!surfaceId || !paneId) {
    return null;
  }
  return { surfaceId, paneId };
}

/** Create a new tab (surface) inside an existing pane. */
export async function createSurfaceInPane(paneId: string): Promise<string | null> {
  const res = await cmuxRequest("surface.create", { pane_id: paneId });
  if (!res?.ok) {
    return null;
  }
  return res.result?.surface_id ?? null;
}

export async function closeSurface(surfaceId: string): Promise<boolean> {
  const res = await cmuxRequest("surface.close", { surface_id: surfaceId });
  return res?.ok ?? false;
}

export async function focusSurface(surfaceId: string): Promise<boolean> {
  const res = await cmuxRequest("surface.focus", { surface_id: surfaceId });
  return res?.ok ?? false;
}

// --- Input ---

export async function sendText(text: string, surfaceId?: string): Promise<boolean> {
  const params: Record<string, any> = { text };
  if (surfaceId) {
    params.surface_id = surfaceId;
  }
  const res = await cmuxRequest("surface.send_text", params);
  return res?.ok ?? false;
}

export async function sendKey(key: string, surfaceId?: string): Promise<boolean> {
  const params: Record<string, any> = { key };
  if (surfaceId) {
    params.surface_id = surfaceId;
  }
  const res = await cmuxRequest("surface.send_key", params);
  return res?.ok ?? false;
}

// --- Browser panes ---

const CMUX_CLI =
  process.env.CMUX_CLI_PATH ??
  Bun.which("cmux") ??
  "/Applications/cmux.app/Contents/Resources/bin/cmux";

/** Run a cmux CLI command and return parsed JSON output. */
async function cmuxCli(args: string[]): Promise<Record<string, any> | null> {
  const proc = Bun.spawn([CMUX_CLI, "--json", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) {
    return null;
  }
  try {
    return JSON.parse(stdout.trim());
  } catch {
    return { raw: stdout.trim() };
  }
}

/** Split and create a browser surface showing the given URL. */
export async function splitBrowserPane(
  url: string,
  direction: "right" | "left" | "up" | "down" = "down",
  workspaceId?: string,
): Promise<{ surfaceId: string; paneId: string } | null> {
  const args = ["new-pane", "--type", "browser", "--direction", direction, "--url", url];
  if (workspaceId) {
    args.push("--workspace", workspaceId);
  }
  const result = await cmuxCli(args);
  if (!result) {
    return null;
  }
  return {
    surfaceId: result.surface_id ?? result.raw ?? "",
    paneId: result.pane_id ?? result.raw ?? "",
  };
}

/** Create a browser tab (surface) inside an existing pane. */
export async function createBrowserSurfaceInPane(
  paneId: string,
  url: string,
): Promise<string | null> {
  const args = ["new-surface", "--type", "browser", "--pane", paneId, "--url", url];
  const result = await cmuxCli(args);
  if (!result) {
    return null;
  }
  return result.surface_id ?? result.raw ?? null;
}

// --- Notifications ---

export async function cmuxNotify(title: string, body: string): Promise<boolean> {
  const res = await cmuxRequest("notification.create", { title, body });
  return res?.ok ?? false;
}

// --- Surface readiness ---

interface SurfaceInfo {
  id: string;
  title: string;
  type: string;
  focused: boolean;
}

export async function listSurfaces(workspaceId?: string): Promise<SurfaceInfo[]> {
  const params: Record<string, any> = {};
  if (workspaceId) {
    params.workspace_id = workspaceId;
  }
  const res = await cmuxRequest("surface.list", params);
  if (!res?.ok) {
    return [];
  }
  return res.result?.surfaces ?? [];
}

/**
 * Wait for a surface's shell to be ready by polling surface.list until the
 * surface title changes from "Terminal" (the initial placeholder) to something
 * else, meaning the shell has started and set its title.
 */
export async function waitForSurface(surfaceId: string, timeoutMs = 5000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const surfaces = await listSurfaces();
    const surface = surfaces.find((s) => s.id === surfaceId);
    if (surface && surface.title !== "Terminal") {
      return true;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

// --- Environment detection ---

export function isInsideCmux(): boolean {
  return !!process.env.CMUX_WORKSPACE_ID;
}

export function currentWorkspaceId(): string | null {
  return process.env.CMUX_WORKSPACE_ID ?? null;
}

export function currentSurfaceId(): string | null {
  return process.env.CMUX_SURFACE_ID ?? null;
}
