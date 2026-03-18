import { createCliRenderer } from "@opentui/core"
import { createRoot, useKeyboard } from "@opentui/react"
import { useState, useRef, useEffect } from "react"

import { readState, type TaskState } from "../../lib/state"
import { isInsideCmux, splitPane, sendText } from "../../lib/cmux"
import { exitTui, installTuiCleanup, registerTuiRenderer } from "../../lib/tui"
import { getChangedFiles } from "../../lib/git"
import { useInterval } from "../../hooks/useInterval"

import { StatusBar } from "./StatusBar"
import { DiffStat } from "./DiffStat"
import { UntrackedFiles } from "./UntrackedFiles"

function WatcherApp({ worktree, branch }: { worktree: string; branch: string }) {
  const [status, setStatus] = useState<TaskState["status"]>("unknown")
  const lastStatus = useRef("")

  useInterval(async () => {
    const state = await readState(branch)
    if (state) setStatus(state.status)
  }, 1000)

  // Bell on transition
  useEffect(() => {
    if (lastStatus.current && lastStatus.current !== status) {
      if (status === "done" || status === "prompting" || status === "failed") {
        process.stdout.write("\x07")
      }
    }
    lastStatus.current = status
  }, [status])

  // Detect tools
  const hasFzf = Bun.spawnSync(["which", "fzf"]).exitCode === 0
  const hasLazygit = Bun.spawnSync(["which", "lazygit"]).exitCode === 0
  const hasDelta = Bun.spawnSync(["which", "delta"]).exitCode === 0

  /** Open a command in a new cmux split pane (pane closes when command exits) */
  const openInPane = (cmd: string) => {
    if (isInsideCmux()) {
      splitPane("right").then((surfaceId) => {
        if (surfaceId) sendText(`${cmd}; exit\n`, surfaceId)
      })
    }
  }

  useKeyboard((key) => {
    switch (key.name) {
      case "f":
        if (hasFzf && isInsideCmux()) {
          const files = getChangedFiles(worktree)
          if (files.length > 0) {
            const diffCmd = hasDelta
              ? `git diff HEAD -- {} | delta --paging always`
              : `git diff HEAD --color -- {} | less -R`
            const cmd = `cd '${worktree}' && git diff --name-only HEAD | fzf --preview '${diffCmd}' --preview-window=right:60%:wrap --header='Select file (ESC to cancel)'`
            openInPane(cmd)
          }
        }
        break
      case "d":
        if (isInsideCmux()) {
          const diffCmd = hasDelta
            ? `cd '${worktree}' && git diff HEAD | delta --paging always`
            : `cd '${worktree}' && git diff HEAD --color | less -R`
          openInPane(diffCmd)
        }
        break
      case "e":
        if (isInsideCmux()) {
          const editor = process.env.EDITOR ?? process.env.VISUAL ?? "vim"
          openInPane(`cd '${worktree}' && ${editor} .`)
        }
        break
      case "g":
        if (hasLazygit && isInsideCmux()) {
          openInPane(`cd '${worktree}' && lazygit`)
        }
        break
      case "s":
        Bun.spawnSync(["git", "add", "-A"], { cwd: worktree })
        break
      case "c":
        if (isInsideCmux()) {
          openInPane(
            `cd '${worktree}' && git add -A && echo 'Enter commit message:' && read -r msg && git commit -m "$msg"`,
          )
        }
        break
      case "q":
        exitTui(0)
        break
    }
  })

  const now = new Date().toLocaleTimeString("en-GB", { hour12: false })

  return (
    <box style={{ flexDirection: "column" }}>
      <StatusBar status={status} />
      <text>
        <span fg="#a855f7">{"  watcher"}</span>
        <span fg="#666">{"  ·  "}</span>
        <span fg="#06b6d4">{branch}</span>
      </text>
      <text fg="#666">{"  " + now + " · " + worktree}</text>
      <box style={{ paddingTop: 1 }}>
        <DiffStat worktree={worktree} />
      </box>
      <UntrackedFiles worktree={worktree} />
      <box style={{ paddingTop: 1 }}>
        <text fg="#444">{"  ─────────────────────────────────"}</text>
      </box>
      {hasFzf && (
        <text>
          {"  "}
          <span fg="#06b6d4">f</span>{" file picker    "}
          <span fg="#06b6d4">d</span>{" full diff    "}
          <span fg="#06b6d4">e</span>{" editor"}
        </text>
      )}
      {hasLazygit && (
        <text>
          {"  "}
          <span fg="#06b6d4">g</span>{" lazygit       "}
          <span fg="#06b6d4">s</span>{" stage all    "}
          <span fg="#06b6d4">c</span>{" commit"}
        </text>
      )}
      <text>
        {"  "}
        <span fg="#06b6d4">q</span>{" quit"}
      </text>
    </box>
  )
}

export async function runWatcher(worktree: string, branch: string): Promise<void> {
  if (!branch) {
    const { basename } = await import("path")
    branch = basename(worktree)
  }

  const renderer = await createCliRenderer()
  registerTuiRenderer(renderer)
  installTuiCleanup()
  createRoot(renderer).render(<WatcherApp worktree={worktree} branch={branch} />)
}
