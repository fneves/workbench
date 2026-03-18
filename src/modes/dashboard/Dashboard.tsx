import { createCliRenderer } from "@opentui/core"
import { createRoot, useKeyboard } from "@opentui/react"
import { useState, useCallback, useRef, useEffect } from "react"
import { resolve } from "path"

import { notify } from "../../lib/notify"
import { isInsideCmux, selectWorkspace } from "../../lib/cmux"
import { getScriptDir } from "../../lib/config"
import { exitTui, installTuiCleanup } from "../../lib/tui"
import { reconcileWorktrees } from "../../lib/state"

import { useTaskState } from "../../hooks/useTaskState"
import { useAlert } from "../../hooks/useAlert"
import { useEventLog } from "../../hooks/useEventLog"

import { Header } from "./Header"
import { AlertBar } from "./AlertBar"
import { TaskTable } from "./TaskTable"
import { EventLog } from "./EventLog"
import { SpawnDialog } from "./SpawnDialog"
import { Spinner } from "../../components/Spinner"

/** Run a workbench subcommand as a detached child process (keeps the TUI alive). */
function runWorkbenchCmd(args: string[]): Promise<{ ok: boolean; stderr: string }> {
  const entryPoint = resolve(getScriptDir(), "src/index.tsx")
  const bunPath = Bun.which("bun") ?? "bun"
  return new Promise((resolve) => {
    const proc = Bun.spawn([bunPath, "run", entryPoint, ...args], {
      stdout: "ignore",
      stderr: "pipe",
    })
    proc.exited.then(async (code) => {
      const stderr = await new Response(proc.stderr).text()
      resolve({ ok: code === 0, stderr })
    })
  })
}

function Dashboard() {
  const tasks = useTaskState(1000)
  const { alert, setAlert, dismissAlert } = useAlert()
  const { entries, pushEvent } = useEventLog()
  const [selected, setSelected] = useState(0)
  const [showSpawn, setShowSpawn] = useState(false)
  const [pendingOp, setPendingOp] = useState<string | null>(null)
  const prevStatuses = useRef<Record<string, string>>({})

  // On mount, reconcile existing worktrees with state files
  useEffect(() => {
    reconcileWorktrees()
  }, [])

  // Detect state transitions
  useEffect(() => {
    for (const task of tasks) {
      const prev = prevStatuses.current[task.branch]
      if (prev && prev !== task.status) {
        switch (task.status) {
          case "done":
            pushEvent("✓", `${task.branch} — agent finished`)
            setAlert(`✓ ${task.branch} finished — ready for review`, "#22c55e", 6, true)
            notify(`✓ ${task.branch}`, "Agent finished successfully", "Glass")
            break
          case "prompting":
            pushEvent("◉", `${task.branch} — waiting for input`)
            setAlert(`◉ ${task.branch} needs your attention`, "#eab308", 8, true)
            notify(`⏳ ${task.branch}`, "Agent is waiting for input", "Ping")
            break
          case "failed":
            pushEvent("✗", `${task.branch} — agent failed`)
            setAlert(`✗ ${task.branch} failed`, "#ef4444", 10, true)
            notify(`✗ ${task.branch}`, "Agent failed", "Basso")
            break
          case "running":
            pushEvent("●", `${task.branch} — agent started`)
            break
        }
      }
      prevStatuses.current[task.branch] = task.status
    }
  }, [tasks])

  const handleSpawn = useCallback(
    async (opts: {
      branch: string
      prompt: string
      agent: "claude" | "opencode"
      mode: "worktree" | "container"
      baseBranch: string
      interactive: boolean
    }) => {
      setShowSpawn(false)
      setPendingOp(`spawning ${opts.branch}`)
      setAlert(`◌ Spawning ${opts.branch}...`, "#3b82f6", 0, false)
      const args = ["spawn", "-b", opts.branch, "-a", opts.agent, "-m", opts.mode, "-f", opts.baseBranch]
      if (opts.interactive || !opts.prompt) {
        args.push("-i")
      } else {
        args.push("-p", opts.prompt)
      }
      const result = await runWorkbenchCmd(args)
      setPendingOp(null)
      if (result.ok) {
        pushEvent("+", `Spawned ${opts.branch} (${opts.agent}, ${opts.mode})`)
        setAlert(`✓ Spawned ${opts.branch}`, "#3b82f6", 4, false)
      } else {
        const errMsg = result.stderr.trim().split("\n").pop() ?? "unknown error"
        pushEvent("✗", `Failed: ${errMsg}`)
        setAlert(`✗ Failed to spawn ${opts.branch}`, "#ef4444", 6, false)
      }
    },
    [pushEvent, setAlert],
  )

  const handleKill = useCallback(
    async (branch: string) => {
      setPendingOp(`killing ${branch}`)
      setAlert(`◌ Killing ${branch}...`, "#eab308", 0, false)
      const result = await runWorkbenchCmd(["kill", branch])
      setPendingOp(null)
      if (result.ok) {
        pushEvent("×", `Killed ${branch}`)
        setAlert(`× Killed ${branch}`, "#ef4444", 3, false)
      } else {
        const errMsg = result.stderr.trim().split("\n").pop() ?? "unknown error"
        pushEvent("✗", `Kill failed: ${errMsg}`)
        setAlert(`✗ Failed to kill ${branch}`, "#ef4444", 4, false)
      }
      setSelected(0)
    },
    [pushEvent, setAlert],
  )

  useKeyboard((key) => {
    if (showSpawn) {
      if (key.name === "escape") setShowSpawn(false)
      return
    }

    switch (key.name) {
      case "q":
        exitTui(0)
        break
      case "n":
        if (!pendingOp) setShowSpawn(true)
        break
      case "k":
        if (!pendingOp && tasks.length > 0 && tasks[selected]) {
          handleKill(tasks[selected]!.branch)
        }
        break
      case "x":
        dismissAlert()
        break
      case "up":
        setSelected((s) => Math.max(0, s - 1))
        break
      case "down":
        setSelected((s) => Math.min(tasks.length - 1, s + 1))
        break
      case "return":
        if (isInsideCmux() && tasks[selected]) {
          const wsId = tasks[selected]!.cmux_workspace_id
          if (wsId) selectWorkspace(wsId)
        }
        break
    }
  })

  if (showSpawn) {
    return (
      <box style={{ flexDirection: "column", padding: 1 }}>
        <Header />
        <SpawnDialog onSpawn={handleSpawn} onCancel={() => setShowSpawn(false)} />
      </box>
    )
  }

  return (
    <box style={{ flexDirection: "column", padding: 1 }}>
      <AlertBar alert={alert} />
      <Header />
      <box style={{ paddingTop: 1 }}>
        <TaskTable tasks={tasks} selected={selected} />
      </box>
      <box style={{ paddingTop: 1 }}>
        <text fg="#444">{"  " + "─".repeat(90)}</text>
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
          <span fg="#06b6d4">n</span>{" new   "}
          <span fg="#06b6d4">↑↓</span>{" select   "}
          <span fg="#06b6d4">enter</span>{" jump   "}
          <span fg="#06b6d4">k</span>{" kill   "}
          <span fg="#06b6d4">x</span>{" dismiss   "}
          <span fg="#06b6d4">q</span>{" quit"}
        </text>
      )}
      <EventLog entries={entries} />
    </box>
  )
}

export async function runDashboard(): Promise<void> {
  installTuiCleanup()
  const renderer = await createCliRenderer()
  createRoot(renderer).render(<Dashboard />)
}
