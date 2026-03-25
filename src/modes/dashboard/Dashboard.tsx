import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { useState, useCallback, useEffect } from "react";

import type { TaskState } from "#lib/state";
import { exitTui, installTuiCleanup, registerTuiRenderer } from "#lib/tui";

import {
  useTaskList,
  useRequest,
  useWorkbenchClient,
  WorkbenchClientContext,
} from "#hooks/useWorkbench";
import { useAlert } from "#hooks/useAlert";
import { useEventLog } from "#hooks/useEventLog";

import { Header } from "#modes/dashboard/Header";
import { AlertBar } from "#modes/dashboard/AlertBar";
import { TaskTable } from "#modes/dashboard/TaskTable";
import { EventLog } from "#modes/dashboard/EventLog";
import { SpawnDialog } from "#modes/dashboard/SpawnDialog";
import { Spinner } from "#components/Spinner";

function Dashboard() {
  const client = useWorkbenchClient();
  const tasks = useTaskList();
  const request = useRequest();
  const { alert, setAlert, dismissAlert } = useAlert();
  const { entries, pushEvent } = useEventLog();
  const [selected, setSelected] = useState(0);
  const [showSpawn, setShowSpawn] = useState(false);
  const [pendingOp, setPendingOp] = useState<string | null>(null);
  const [configDefaults, setConfigDefaults] = useState<{
    agent: "claude" | "opencode";
    baseBranch: string;
  }>({ agent: "claude", baseBranch: "main" });

  // Fetch config defaults on mount
  useEffect(() => {
    request("config.get")
      .then((r: any) => {
        if (r) {
          setConfigDefaults({
            agent: r.agent ?? "claude",
            baseBranch: r.base_branch ?? "main",
          });
        }
      })
      .catch(() => {});
  }, [request]);

  // Subscribe to task transitions for alerts + event log
  useEffect(() => {
    if (!client?.isConnected) {
      return;
    }

    const handler = (data: any) => {
      const { branch, to } = data;
      switch (to) {
        case "done":
          pushEvent("\u2713", `${branch} — agent finished`);
          setAlert(`\u2713 ${branch} finished — ready for review`, "#22c55e", 6, true);
          break;
        case "prompting":
          pushEvent("\u25C9", `${branch} — waiting for input`);
          setAlert(`\u25C9 ${branch} needs your attention`, "#eab308", 8, true);
          break;
        case "failed":
          pushEvent("\u2717", `${branch} — agent failed`);
          setAlert(`\u2717 ${branch} failed`, "#ef4444", 10, true);
          break;
        case "running":
          pushEvent("\u25CF", `${branch} — agent started`);
          break;
      }
    };

    client.on("task.transition", handler);
    return () => client.off("task.transition", handler);
  }, [client, pushEvent, setAlert]);

  const handleSpawn = useCallback(
    async (opts: {
      branch: string;
      prompt: string;
      agent: "claude" | "opencode";
      mode: "worktree" | "container";
      baseBranch: string;
      interactive: boolean;
    }) => {
      setShowSpawn(false);
      setPendingOp(`spawning ${opts.branch}`);
      setAlert(`\u25CC Spawning ${opts.branch}...`, "#3b82f6", 0, false);
      try {
        await request("task.spawn", {
          branch: opts.branch,
          prompt: opts.prompt,
          agent: opts.agent,
          mode: opts.mode,
          baseBranch: opts.baseBranch,
          interactive: opts.interactive,
        });
        pushEvent("+", `Spawned ${opts.branch} (${opts.agent}, ${opts.mode})`);
        setAlert(`\u2713 Spawned ${opts.branch}`, "#3b82f6", 4, false);
      } catch (err: any) {
        pushEvent("\u2717", `Failed: ${err.message}`);
        setAlert(`\u2717 Failed to spawn ${opts.branch}`, "#ef4444", 6, false);
      }
      setPendingOp(null);
    },
    [request, pushEvent, setAlert],
  );

  const handleJump = useCallback(
    async (task: TaskState) => {
      const wsId = task.cmux_workspace_id;
      if (!wsId) {
        return;
      }

      // Check if the workspace still exists in cmux
      try {
        const result = await request("cmux.listWorkspaces");
        const exists = result.workspaces?.some((w: any) => w.id === wsId);

        if (exists) {
          await request("cmux.selectWorkspace", { workspaceId: wsId });
          return;
        }
      } catch {
        return;
      }

      // Workspace was closed — reopen it
      setPendingOp(`reopening ${task.branch}`);
      setAlert(`\u25CC Reopening ${task.branch}...`, "#3b82f6", 0, false);

      try {
        const wsResult = await request("cmux.newWorkspace", { title: task.branch });
        const newWsId = wsResult.workspaceId;
        if (!newWsId) {
          setAlert(`\u2717 Failed to reopen workspace for ${task.branch}`, "#ef4444", 4, false);
          setPendingOp(null);
          return;
        }

        await request("cmux.selectWorkspace", { workspaceId: newWsId });
        await request("task.update", { branch: task.branch, cmux_workspace_id: newWsId });

        const surfaceResult = await request("cmux.listSurfaces", { workspaceId: newWsId });
        const defaultSurface = surfaceResult.surfaces?.find((s: any) => s.type === "terminal");
        if (defaultSurface) {
          await request("cmux.waitForSurface", { surfaceId: defaultSurface.id });
          await request("task.update", {
            branch: task.branch,
            cmux_agent_surface_id: defaultSurface.id,
          });
          await request("cmux.sendText", {
            text: `cd '${task.worktree}'\n`,
            surfaceId: defaultSurface.id,
          });
        }

        // Create a right split for the watcher TUI
        const splitResult = await request("cmux.splitPane", {
          direction: "right",
          workspaceId: newWsId,
        });
        if (splitResult.surfaceId) {
          await request("cmux.waitForSurface", { surfaceId: splitResult.surfaceId });
          await request("cmux.sendText", {
            text: `workbench watcher '${task.worktree}' '${task.branch}'\n`,
            surfaceId: splitResult.surfaceId,
          });
        }

        pushEvent("\u21A9", `Reopened workspace for ${task.branch}`);
        setAlert(`\u2713 Reopened ${task.branch}`, "#3b82f6", 3, false);
      } catch {
        setAlert(`\u2717 Failed to reopen ${task.branch}`, "#ef4444", 4, false);
      }
      setPendingOp(null);
    },
    [request, pushEvent, setAlert],
  );

  const handleKill = useCallback(
    async (branch: string) => {
      setPendingOp(`killing ${branch}`);
      setAlert(`\u25CC Killing ${branch}...`, "#eab308", 0, false);
      try {
        await request("task.kill", { branch });
        pushEvent("\u00D7", `Killed ${branch}`);
        setAlert(`\u00D7 Killed ${branch}`, "#ef4444", 3, false);
      } catch (err: any) {
        pushEvent("\u2717", `Kill failed: ${err.message}`);
        setAlert(`\u2717 Failed to kill ${branch}`, "#ef4444", 4, false);
      }
      setPendingOp(null);
      setSelected(0);
    },
    [request, pushEvent, setAlert],
  );

  useKeyboard((key) => {
    if (showSpawn) {
      if (key.name === "escape") {
        setShowSpawn(false);
      }
      return;
    }

    switch (key.name) {
      case "q":
        exitTui(0);
      case "n":
        if (!pendingOp) {
          setShowSpawn(true);
        }
        break;
      case "k":
        if (!pendingOp && tasks.length > 0 && tasks[selected]) {
          handleKill(tasks[selected]!.branch);
        }
        break;
      case "x":
        dismissAlert();
        break;
      case "up":
        setSelected((s) => Math.max(0, s - 1));
        break;
      case "down":
        setSelected((s) => Math.min(tasks.length - 1, s + 1));
        break;
      case "return":
        if (process.env.CMUX_WORKSPACE_ID && tasks[selected]) {
          handleJump(tasks[selected]!);
        }
        break;
    }
  });

  if (showSpawn) {
    return (
      <box style={{ flexDirection: "column", padding: 1 }}>
        <Header />
        <SpawnDialog
          onSpawn={handleSpawn}
          onCancel={() => setShowSpawn(false)}
          defaultAgent={configDefaults.agent}
          defaultBaseBranch={configDefaults.baseBranch}
        />
      </box>
    );
  }

  return (
    <box style={{ flexDirection: "column", padding: 1 }}>
      <AlertBar alert={alert} />
      <Header />
      <box style={{ paddingTop: 1 }}>
        <TaskTable tasks={tasks} selected={selected} />
      </box>
      <box style={{ paddingTop: 1 }}>
        <text fg="#444">{"  " + "\u2500".repeat(90)}</text>
      </box>
      {pendingOp ? (
        <box style={{ flexDirection: "row", gap: 1 }}>
          <text>{"  "}</text>
          <Spinner color="#3b82f6" />
          <text fg="#3b82f6">{pendingOp + "..."}</text>
        </box>
      ) : (
        <text>
          {"  "}
          <span fg="#06b6d4">n</span>
          {" new   "}
          <span fg="#06b6d4">{"\u2191\u2193"}</span>
          {" select   "}
          <span fg="#06b6d4">enter</span>
          {" jump   "}
          <span fg="#06b6d4">k</span>
          {" kill   "}
          <span fg="#06b6d4">x</span>
          {" dismiss   "}
          <span fg="#06b6d4">q</span>
          {" quit"}
        </text>
      )}
      <EventLog entries={entries} />
    </box>
  );
}

export async function runDashboard(): Promise<void> {
  const { WorkbenchClient } = await import("#client");

  const client = new WorkbenchClient();
  const connected = await client.connect();
  if (!connected) {
    console.error("Failed to connect to workbench server");
    process.exit(1);
  }

  const renderer = await createCliRenderer({ useMouse: false });
  registerTuiRenderer(renderer);
  installTuiCleanup();
  createRoot(renderer).render(
    <WorkbenchClientContext.Provider value={client}>
      <Dashboard />
    </WorkbenchClientContext.Provider>,
  );
}
