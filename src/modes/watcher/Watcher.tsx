import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useState, useRef, useEffect, useCallback } from "react";

import { exitTui, installTuiCleanup, registerTuiRenderer } from "#lib/tui";
import { useAlert } from "#hooks/useAlert";
import { useInterval } from "#hooks/useInterval";
import {
  useTask,
  useFileChanges,
  useRequest,
  useWorkbenchClient,
  WorkbenchClientContext,
} from "#hooks/useWorkbench";

import { StatusBar } from "#modes/watcher/StatusBar";
import { DiffStat } from "#modes/watcher/DiffStat";
import { appendFileSync } from "fs";

const VSCODE_LOG = "/tmp/workbench/vscode-debug.log";
function vlog(msg: string) {
  appendFileSync(VSCODE_LOG, `[${new Date().toISOString()}] ${msg}\n`);
}

/** Build a loader page (data URL) that polls the VS Code server and redirects when ready. */
function vsCodeLoaderUrl(targetUrl: string): string {
  const html = `<!DOCTYPE html>
<html><head><style>
body{background:#1e1e1e;color:#ccc;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.wrap{text-align:center}
.spinner{width:40px;height:40px;border:3px solid #333;border-top-color:#0078d4;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 16px}
@keyframes spin{to{transform:rotate(360deg)}}
p{font-size:14px;opacity:0.7}
</style></head><body><div class="wrap">
<div class="spinner"></div>
<p>Starting VS Code...</p>
</div><script>
const target=${JSON.stringify(targetUrl)};
(async()=>{for(let i=0;i<60;i++){try{await fetch(target,{mode:'no-cors'});window.location.replace(target);return}catch(e){}await new Promise(r=>setTimeout(r,500))}
document.querySelector('p').textContent='Server did not respond after 30 s';})();
</script></body></html>`;
  return `data:text/html;base64,${btoa(html)}`;
}

const REVIEW_OPTS = [
  { label: "accept", desc: "write review file + send to agent" },
  { label: "iterate", desc: "open interactive session to refine" },
  { label: "reject", desc: "discard review" },
];

// The watcher runs inside the task's cmux workspace — capture it from env
// since taskState.cmux_workspace_id may be null for orphan/reconciled tasks.
const LOCAL_WORKSPACE_ID = process.env.CMUX_WORKSPACE_ID ?? null;

function WatcherApp({ worktree, branch }: { worktree: string; branch: string }) {
  const { height, width } = useTerminalDimensions();
  const client = useWorkbenchClient();
  const request = useRequest();
  const taskState = useTask(branch);
  const files = useFileChanges(branch);
  const status = taskState?.status ?? "unknown";
  const lastStatus = useRef("");
  const myWorkspaceId = taskState?.cmux_workspace_id ?? LOCAL_WORKSPACE_ID;

  const [showReviewActions, setShowReviewActions] = useState(false);
  const [reviewActionIdx, setReviewActionIdx] = useState(0);
  const [reviewReady, setReviewReady] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [spinnerTick, setSpinnerTick] = useState(0);
  const SPINNER_FRAMES = [
    "\u280B",
    "\u2819",
    "\u2839",
    "\u2838",
    "\u283C",
    "\u2834",
    "\u2826",
    "\u2827",
    "\u2807",
    "\u280F",
  ];
  useInterval(() => {
    if (reviewLoading) {
      setSpinnerTick((t) => (t + 1) % SPINNER_FRAMES.length);
    }
  }, 100);

  const [selectedFileIdx, setSelectedFileIdx] = useState(-1);
  const hasFileSelected = selectedFileIdx >= 0 && selectedFileIdx < files.length;
  const selectedFile = hasFileSelected ? files[selectedFileIdx] : null;

  const { alert, setAlert } = useAlert();

  const [tools, setTools] = useState<Record<string, boolean>>({});
  const [editor, setEditor] = useState("vim");
  const [prUrl, setPrUrl] = useState<string | null>(null);

  // Track the bottom pane so subsequent shortcuts open new tabs instead of new panes
  const bottomPaneId = useRef<string | null>(null);
  const vscodeSurfaceId = useRef<string | null>(null);
  const vsCodeOpening = useRef(false);

  // Restore persisted vscode surface ID from task state
  useEffect(() => {
    if (!vscodeSurfaceId.current && taskState?.vscode_surface_id) {
      vscodeSurfaceId.current = taskState.vscode_surface_id;
    }
  }, [taskState?.vscode_surface_id]);

  /** Open a command in the bottom pane, creating it if needed. Surface closes when command exits. */
  const openInBottomPane = useCallback(
    async (cmd: string) => {
      let surfaceId: string | null = null;
      const workspaceId = myWorkspaceId ?? undefined;

      if (bottomPaneId.current) {
        try {
          const result = await request("cmux.createSurfaceInPane", {
            paneId: bottomPaneId.current,
          });
          surfaceId = result?.surfaceId ?? null;
        } catch {
          bottomPaneId.current = null;
        }
      }

      if (!surfaceId) {
        try {
          const result = await request("cmux.splitPaneWithIds", {
            direction: "down",
            workspaceId,
          });
          if (!result) {
            return;
          }
          surfaceId = result.surfaceId;
          bottomPaneId.current = result.paneId;
        } catch {
          return;
        }
      }

      await request("cmux.waitForSurface", { surfaceId });
      await request("cmux.focusSurface", { surfaceId });
      await request("cmux.sendText", { text: `${cmd}; exit\n`, surfaceId });
    },
    [request, myWorkspaceId],
  );

  /** Open the review file in the bottom pane for reading. */
  const openReviewInPane = useCallback(async () => {
    const slug = branch.replace(/\//g, "-");
    const reviewFilePath = `/tmp/workbench/${slug}-review.md`;
    const viewCmd = tools.bat
      ? `bat --paging always --style=plain '${reviewFilePath}'`
      : `less '${reviewFilePath}'`;
    await openInBottomPane(
      `[ -f '${reviewFilePath}' ] && ${viewCmd} || echo 'No review yet — press r to run a review first'`,
    );
  }, [openInBottomPane, tools, branch]);

  // Fetch tool availability and editor on mount
  useEffect(() => {
    request("config.tools")
      .then((r: any) => setTools(r ?? {}))
      .catch(() => {});
    request("config.editor")
      .then((r: any) => setEditor(r?.editor ?? "vim"))
      .catch(() => {});
  }, [request]);

  // Subscribe to review.ready events
  useEffect(() => {
    if (!client?.isConnected) {
      return;
    }
    const handler = (data: any) => {
      if (data.branch === branch) {
        setReviewLoading(false);
        setReviewReady(true);
        openReviewInPane();
        setReviewActionIdx(0);
        setShowReviewActions(true);
      }
    };
    client.on("review.ready", handler);
    return () => client.off("review.ready", handler);
  }, [client, branch, openReviewInPane]);

  // Subscribe to pr.created events
  useEffect(() => {
    if (!client?.isConnected) {
      return;
    }
    const handler = (data: any) => {
      if (data.branch === branch) {
        setPrUrl(data.url);
      }
    };
    client.on("pr.created", handler);
    return () => client.off("pr.created", handler);
  }, [client, branch]);

  // Bell on transition
  useEffect(() => {
    if (lastStatus.current && lastStatus.current !== status) {
      if (status === "done" || status === "prompting" || status === "failed") {
        process.stdout.write("\x07");
      }
    }
    lastStatus.current = status;
  }, [status]);

  const handleReviewAccept = useCallback(async () => {
    try {
      const state = await request("task.get", { branch });
      await request("watcher.acceptReview", {
        branch,
        worktree,
        agentSurfaceId: state?.task?.cmux_agent_surface_id,
      });
    } catch {
      setAlert("No review found \u2014 press r to run a review first", "#f59e0b");
    }
    setShowReviewActions(false);
  }, [request, branch, worktree, setAlert]);

  const handleReviewReject = useCallback(() => {
    request("watcher.rejectReview", { branch }).catch(() => {});
    setReviewReady(false);
    setShowReviewActions(false);
  }, [request, branch]);

  const handleReviewIterate = useCallback(async () => {
    setShowReviewActions(false);
    try {
      const result = await request("watcher.iterateReview", { branch });
      const escaped = (result.prompt as string).replace(/'/g, "'\\''");
      await openInBottomPane(`cd '${worktree}' && claude '${escaped}'`);
    } catch {}
  }, [request, branch, worktree, openInBottomPane]);

  useKeyboard((key) => {
    if (showReviewActions) {
      switch (key.name) {
        case "escape":
          handleReviewReject();
          break;
        case "up":
          setReviewActionIdx((i) => (i + REVIEW_OPTS.length - 1) % REVIEW_OPTS.length);
          break;
        case "down":
          setReviewActionIdx((i) => (i + 1) % REVIEW_OPTS.length);
          break;
        case "return":
          if (reviewActionIdx === 0) {
            handleReviewAccept();
          } else if (reviewActionIdx === 1) {
            handleReviewIterate();
          } else {
            handleReviewReject();
          }
          break;
      }
      return;
    }

    switch (key.name) {
      case "up":
        setSelectedFileIdx((i) => {
          if (i <= 0) {
            return files.length - 1;
          }
          return i - 1;
        });
        break;
      case "down":
        setSelectedFileIdx((i) => {
          if (i >= files.length - 1) {
            return 0;
          }
          return i + 1;
        });
        break;
      case "escape":
        setSelectedFileIdx(-1);
        break;
      case "f":
        if (tools.fzf) {
          if (files.length > 0) {
            const diffCmd = tools.delta
              ? `git diff HEAD -- {} | delta --paging always`
              : `git diff HEAD --color -- {} | less -R`;
            const cmd = `cd '${worktree}' && git diff --name-only HEAD | fzf --preview '${diffCmd}' --preview-window=right:60%:wrap --header='Select file (ESC to cancel)'`;
            openInBottomPane(cmd);
          }
        }
        break;
      case "d": {
        if (selectedFile) {
          const diffCmd = tools.delta
            ? `cd '${worktree}' && git diff HEAD -- '${selectedFile.path}' | delta --paging always`
            : `cd '${worktree}' && git diff HEAD --color -- '${selectedFile.path}' | less -R`;
          openInBottomPane(diffCmd);
        } else {
          const diffCmd = tools.delta
            ? `cd '${worktree}' && git diff HEAD | delta --paging always`
            : `cd '${worktree}' && git diff HEAD --color | less -R`;
          openInBottomPane(diffCmd);
        }
        break;
      }
      case "e":
        if (selectedFile) {
          openInBottomPane(`cd '${worktree}' && ${editor} '${selectedFile.path}'`);
        } else {
          openInBottomPane(`cd '${worktree}' && ${editor} .`);
        }
        break;
      case "g":
        if (tools.lazygit) {
          openInBottomPane(`cd '${worktree}' && lazygit`);
        }
        break;
      case "r":
        if (tools.claude && !reviewLoading) {
          setReviewLoading(true);
          setReviewReady(false);
          request("watcher.startReview", {
            worktree,
            branch,
            filePath: selectedFile?.path,
          }).catch(() => {
            setReviewLoading(false);
          });
        }
        break;
      case "return":
        openReviewInPane();
        setReviewActionIdx(0);
        setShowReviewActions(true);
        break;
      case "s":
        request("git.stageAll", { worktree }).catch(() => {});
        break;
      case "C":
        openInBottomPane(
          `cd '${worktree}' && git add -A && echo 'Enter commit message:' && read -r msg && git commit -m "$msg"`,
        );
        break;
      case "P":
        openInBottomPane(`cd '${worktree}' && git push`);
        break;
      case "p":
        if (tools.gh) {
          request("watcher.generatePrScript", { worktree, branch })
            .then((result: any) => {
              if (result?.script) {
                openInBottomPane(`zsh '${result.script}'`);
              }
            })
            .catch(() => {});
        }
        break;
      case "t":
        openInBottomPane(`cd '${worktree}' && exec $SHELL`);
        break;
      case "x":
        openInBottomPane(`cd '${worktree}' && ./scripts/start.sh`);
        break;
      case "v":
        if (tools.code && !vsCodeOpening.current) {
          vsCodeOpening.current = true;
          (async () => {
            try {
              // If we already have a browser surface, select workspace and focus it
              if (vscodeSurfaceId.current) {
                const workspaceId = myWorkspaceId;
                if (workspaceId) {
                  await request("cmux.selectWorkspace", { workspaceId });
                }
                const focused = await request("cmux.focusSurface", {
                  surfaceId: vscodeSurfaceId.current,
                });
                if (focused?.ok) {
                  vlog(`vscode focus ok surface=${vscodeSurfaceId.current}`);
                  return;
                }
                vlog(`vscode focus failed surface=${vscodeSurfaceId.current}, reopening`);
                vscodeSurfaceId.current = null;
                request("task.update", { branch, vscode_surface_id: null }).catch(() => {});
              }

              // Start code serve-web (idempotent) — get port immediately
              const result = await request("vscode.start", { branch, worktree });
              if (!result?.port) {
                setAlert("VS Code server failed to start", "red");
                return;
              }

              const targetUrl = `http://127.0.0.1:${result.port}?folder=${encodeURIComponent(worktree)}`;

              // If already running, open directly
              const url = result.alreadyRunning ? targetUrl : vsCodeLoaderUrl(targetUrl);

              // Try to add browser tab in existing bottom pane, fall back to new split
              let surfaceId: string | null = null;
              if (bottomPaneId.current) {
                try {
                  const r = await request("cmux.createBrowserSurfaceInPane", {
                    paneId: bottomPaneId.current,
                    url,
                  });
                  surfaceId = r?.surfaceId ?? null;
                } catch {
                  // Pane no longer exists — clear and fall through to split
                  bottomPaneId.current = null;
                }
              }

              if (!surfaceId) {
                const workspaceId = myWorkspaceId ?? undefined;
                const r = await request("cmux.splitBrowserPane", {
                  url,
                  direction: "down",
                  workspaceId,
                });
                if (!r) {
                  setAlert("Failed to create browser pane", "red");
                  return;
                }
                surfaceId = r.surfaceId;
                bottomPaneId.current = r.paneId;
              }

              vscodeSurfaceId.current = surfaceId;
              vlog(`vscode opened surface=${surfaceId} port=${result.port} workspace=${myWorkspaceId ?? "none"}`);
              if (surfaceId) {
                // Persist surface ID so it survives watcher restarts
                request("task.update", { branch, vscode_surface_id: surfaceId }).catch((err) =>
                  vlog(`task.update failed: ${err?.message ?? err}`),
                );
                // Ensure this workspace is active, then focus the browser surface
                const workspaceId = myWorkspaceId;
                if (workspaceId) {
                  await request("cmux.selectWorkspace", { workspaceId });
                }
                await request("cmux.focusSurface", { surfaceId });
              }
            } finally {
              vsCodeOpening.current = false;
            }
          })().catch((err) => {
            vsCodeOpening.current = false;
            setAlert(`VS Code error: ${err?.message ?? err}`, "red");
          });
        }
        break;
      case "q":
        exitTui(0);
    }
  });

  const now = new Date().toLocaleTimeString("en-GB", { hour12: false });

  if (showReviewActions) {
    return (
      <box style={{ flexDirection: "column" }}>
        <StatusBar status={status} />
        <text>
          <span fg="#a855f7">{"  watcher"}</span>
          <span fg="#666">{"  \u00B7  "}</span>
          <span fg="#06b6d4">{branch}</span>
        </text>
        <box style={{ paddingTop: 1, paddingLeft: 2 }}>
          <text fg="#e2e8f0">{"Review ready \u2014 what would you like to do?"}</text>
        </box>
        <box style={{ paddingTop: 1 }}>
          {REVIEW_OPTS.map((opt, i) => (
            <text key={opt.label}>
              {"  "}
              {i === reviewActionIdx ? (
                <span fg="#06b6d4">{"\u203A "}</span>
              ) : (
                <span fg="#444">{"  "}</span>
              )}
              <span fg={i === reviewActionIdx ? "#e2e8f0" : "#888"}>{opt.label}</span>
              <span fg="#444">{"  "}</span>
              <span fg="#666">{opt.desc}</span>
            </text>
          ))}
        </box>
        <box style={{ paddingTop: 1 }}>
          <text fg="#444">
            {
              "  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"
            }
          </text>
        </box>
        <text>
          {"  "}
          <span fg="#06b6d4">{"\u2191\u2193"}</span>
          {" select    "}
          <span fg="#06b6d4">enter</span>
          {" confirm    "}
          <span fg="#06b6d4">esc</span>
          {" reject"}
        </text>
        {alert && (
          <box style={{ paddingTop: 1 }}>
            <text fg={alert.color}>{"  " + alert.message}</text>
          </box>
        )}
      </box>
    );
  }

  return (
    <box style={{ flexDirection: "column" }}>
      <StatusBar status={status} />
      <text>
        <span fg="#a855f7">{"  watcher"}</span>
        <span fg="#666">{"  \u00B7  "}</span>
        <span fg="#06b6d4">{branch}</span>
      </text>
      <text fg="#666">
        {"  " +
          now +
          " \u00B7 " +
          (worktree.length > width - 16 ? "\u2026" + worktree.slice(-(width - 17)) : worktree)}
      </text>
      <box style={{ paddingTop: 1 }}>
        <DiffStat files={files} maxFiles={Math.max(3, height - 13)} selectedIdx={selectedFileIdx} />
      </box>
      <box style={{ paddingTop: 1 }}>
        <text fg="#444">
          {
            "  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"
          }
        </text>
      </box>
      <box style={{ flexDirection: "row", gap: 0 }}>
        <text style={{ width: 20 }}>
          {"  "}
          <span fg="#06b6d4">{"\u2191\u2193"}</span>
          {" select"}
        </text>
        <text style={{ width: 20 }}>
          {"  "}
          <span fg="#06b6d4">d</span>
          {selectedFile ? " file diff" : " full diff"}
        </text>
        <text style={{ width: 20 }}>
          {"  "}
          <span fg="#06b6d4">e</span>
          {selectedFile ? " edit file" : " editor"}
        </text>
      </box>
      <box style={{ flexDirection: "row", gap: 0 }}>
        <text style={{ width: 20 }}>
          {"  "}
          <span fg="#06b6d4">f</span>
          {" file picker"}
        </text>
        <text style={{ width: 20 }}>
          {"  "}
          <span fg="#06b6d4">g</span>
          {" lazygit"}
        </text>
      </box>
      <box style={{ flexDirection: "row", gap: 0 }}>
        <text style={{ width: 20 }}>
          {"  "}
          <span fg="#06b6d4">s</span>
          {" stage all"}
        </text>
        <text style={{ width: 20 }}>
          {"  "}
          <span fg="#06b6d4">C</span>
          {" commit"}
        </text>
        <text style={{ width: 20 }}>
          {"  "}
          <span fg="#06b6d4">P</span>
          {" push"}
        </text>
      </box>
      <box style={{ flexDirection: "row", gap: 0 }}>
        <text style={{ width: 20 }}>
          {"  "}
          <span fg="#06b6d4">p</span>
          {" pull request"}
        </text>
        <text style={{ width: 20 }}>
          {"  "}
          <span fg="#06b6d4">x</span>
          {" run app"}
        </text>
        <text style={{ width: 20 }}>
          {"  "}
          <span fg="#06b6d4">t</span>
          {" terminal"}
        </text>
        {tools.code && (
          <text style={{ width: 20 }}>
            {"  "}
            <span fg="#06b6d4">v</span>
            {" vscode"}
          </text>
        )}
      </box>
      {tools.claude && (
        <box style={{ flexDirection: "row", gap: 0 }}>
          <text style={{ width: 20 }}>
            {"  "}
            <span fg="#06b6d4">r</span>
            {selectedFile ? " review file" : " review all"}
          </text>
          {reviewLoading ? (
            <text fg="#a855f7">{`  ${SPINNER_FRAMES[spinnerTick]} reviewing\u2026`}</text>
          ) : null}
          {!reviewLoading && reviewReady ? (
            <text fg="#22c55e">{"  \u2713 review ready"}</text>
          ) : null}
          {!reviewLoading && reviewReady ? (
            <text>
              {"  "}
              <span fg="#06b6d4">enter</span>
              {" review actions"}
            </text>
          ) : null}
        </box>
      )}
      <box style={{ flexDirection: "row", gap: 0 }}>
        {selectedFile ? (
          <text style={{ width: 20 }}>
            {"  "}
            <span fg="#06b6d4">esc</span>
            {" deselect"}
          </text>
        ) : null}
        <text style={{ width: 20 }}>
          {"  "}
          <span fg="#06b6d4">q</span>
          {" quit"}
        </text>
      </box>
      {prUrl && (
        <box style={{ paddingTop: 1 }}>
          <text>
            {"  "}
            <span fg="#22c55e">{"PR "}</span>
            <span fg="#06b6d4">{prUrl}</span>
          </text>
        </box>
      )}
      {alert && (
        <box style={{ paddingTop: 1 }}>
          <text fg={alert.color}>{"  " + alert.message}</text>
        </box>
      )}
    </box>
  );
}

export async function runWatcher(worktree: string, branch: string): Promise<void> {
  if (!branch) {
    const { basename } = await import("path");
    branch = basename(worktree);
  }

  const { WorkbenchClient } = await import("#client");

  const client = new WorkbenchClient();
  const connected = await client.connect();
  if (!connected) {
    console.error("Warning: Could not connect to workbench server. Some features may not work.");
  }

  const renderer = await createCliRenderer({ useMouse: false });
  registerTuiRenderer(renderer);
  installTuiCleanup();
  createRoot(renderer).render(
    <WorkbenchClientContext.Provider value={client}>
      <WatcherApp worktree={worktree} branch={branch} />
    </WorkbenchClientContext.Provider>,
  );
}
