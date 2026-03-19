import { unlinkSync } from "fs"
import { createCliRenderer } from "@opentui/core"
import { createRoot, useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useState, useRef, useEffect } from "react"

import { readState, type TaskState } from "../../lib/state"
import { isInsideCmux, splitPaneWithIds, createSurfaceInPane, sendText, waitForSurface, focusSurface } from "../../lib/cmux"
import { exitTui, installTuiCleanup, registerTuiRenderer } from "../../lib/tui"
import { getDefaultEditor, branchToSlug } from "../../lib/config"
import { getChangedFiles } from "../../lib/git"
import { useInterval } from "../../hooks/useInterval"
import { useAlert } from "../../hooks/useAlert"

import { StatusBar } from "./StatusBar"
import { DiffStat } from "./DiffStat"

const REVIEW_OPTS = [
  { label: "accept", desc: "write review file + send to agent" },
  { label: "iterate", desc: "open interactive session to refine" },
  { label: "reject", desc: "discard review" },
]

function WatcherApp({ worktree, branch }: { worktree: string; branch: string }) {
  const { height, width } = useTerminalDimensions()
  const [status, setStatus] = useState<TaskState["status"]>("unknown")
  const lastStatus = useRef("")

  const [showReviewActions, setShowReviewActions] = useState(false)
  const [reviewActionIdx, setReviewActionIdx] = useState(0)
  const [reviewReady, setReviewReady] = useState(false)
  const [reviewLoading, setReviewLoading] = useState(false)
  const [spinnerTick, setSpinnerTick] = useState(0)
  const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
  useInterval(() => { if (reviewLoading) setSpinnerTick((t) => (t + 1) % SPINNER_FRAMES.length) }, 100)

  const { alert, setAlert } = useAlert()

  const reviewFilePath = `/tmp/workbench/${branchToSlug(branch)}-review.md`
  const reviewSentinelPath = `${reviewFilePath}.ready`
  const hasClaudeReview = Bun.which("claude") !== null

  useInterval(async () => {
    const state = await readState(branch)
    if (state) setStatus(state.status)
  }, 1000)

  // Poll for review sentinel — fires when background review agent finishes
  useInterval(async () => {
    if (showReviewActions) return
    const sentinel = Bun.file(reviewSentinelPath)
    if (await sentinel.exists()) {
      try { unlinkSync(reviewSentinelPath) } catch {}
      setReviewLoading(false)
      setReviewReady(true)
      await openReviewInPane()
      setReviewActionIdx(0)
      setShowReviewActions(true)
    }
    // Keep reviewReady in sync with file existence
    const reviewFile = Bun.file(reviewFilePath)
    setReviewReady(await reviewFile.exists())
  }, 500)

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
  const hasBat = Bun.spawnSync(["which", "bat"]).exitCode === 0

  // Track the bottom pane so subsequent shortcuts open new tabs instead of new panes
  const bottomPaneId = useRef<string | null>(null)

  /** Open a command in the bottom pane, creating it if needed. Surface closes when command exits. */
  const openInBottomPane = async (cmd: string) => {
    if (!isInsideCmux()) return

    let surfaceId: string | null = null

    if (bottomPaneId.current) {
      // Try to add a new tab in the existing bottom pane
      surfaceId = await createSurfaceInPane(bottomPaneId.current)
      if (!surfaceId) {
        // Pane was closed by the user — reset and fall through to re-create
        bottomPaneId.current = null
      }
    }

    if (!surfaceId) {
      // No bottom pane yet (or it was closed): split down
      const result = await splitPaneWithIds("down")
      if (!result) return
      surfaceId = result.surfaceId
      bottomPaneId.current = result.paneId
    }

    await waitForSurface(surfaceId)
    await focusSurface(surfaceId)
    await sendText(`${cmd}; exit\n`, surfaceId)
  }

  /** Open the review file in the bottom pane for reading. */
  const openReviewInPane = async () => {
    if (!isInsideCmux()) return
    const viewCmd = hasBat
      ? `bat --paging always --style=plain '${reviewFilePath}'`
      : `less '${reviewFilePath}'`
    await openInBottomPane(
      `[ -f '${reviewFilePath}' ] && ${viewCmd} || echo 'No review yet — press r to run a review first'`,
    )
  }

  const handleReviewAccept = async () => {
    let content: string
    try {
      const file = Bun.file(reviewFilePath)
      if (!(await file.exists())) {
        setAlert("No review found — press r to run a review first", "#f59e0b")
        return
      }
      content = await file.text()
    } catch {
      setAlert("No review found — press r to run a review first", "#f59e0b")
      return
    }

    await Bun.write(`${worktree}/.workbench-review.md`, content)

    const state = await readState(branch)
    await sendText(
      `\nA code review has been saved to .workbench-review.md — please address all the feedback.\n`,
      state?.cmux_agent_surface_id ?? undefined,
    )

    setShowReviewActions(false)
  }

  const handleReviewReject = () => {
    try { unlinkSync(reviewFilePath) } catch {}
    setReviewReady(false)
    setShowReviewActions(false)
  }

  const handleReviewIterate = async () => {
    setShowReviewActions(false)
    const iteratePrompt = `I have a code review draft that I want to refine with your help. After our discussion, update the file ${reviewFilePath} with the final agreed-upon review using your Write tool.\\n\\nCurrent review:\\n$(cat '${reviewFilePath}' 2>/dev/null || echo "(no review yet)")`
    const escaped = iteratePrompt.replace(/'/g, "'\\''")
    await openInBottomPane(`cd '${worktree}' && claude '${escaped}'`)
  }

  useKeyboard((key) => {
    if (showReviewActions) {
      switch (key.name) {
        case "escape":
          handleReviewReject()
          break
        case "up":
          setReviewActionIdx((i) => (i + REVIEW_OPTS.length - 1) % REVIEW_OPTS.length)
          break
        case "down":
          setReviewActionIdx((i) => (i + 1) % REVIEW_OPTS.length)
          break
        case "return":
          if (reviewActionIdx === 0) handleReviewAccept()
          else if (reviewActionIdx === 1) handleReviewIterate()
          else handleReviewReject()
          break
      }
      return
    }

    switch (key.name) {
      case "f":
        if (hasFzf && isInsideCmux()) {
          const files = getChangedFiles(worktree)
          if (files.length > 0) {
            const diffCmd = hasDelta
              ? `git diff HEAD -- {} | delta --paging always`
              : `git diff HEAD --color -- {} | less -R`
            const cmd = `cd '${worktree}' && git diff --name-only HEAD | fzf --preview '${diffCmd}' --preview-window=right:60%:wrap --header='Select file (ESC to cancel)'`
            openInBottomPane(cmd)
          }
        }
        break
      case "d":
        if (isInsideCmux()) {
          const diffCmd = hasDelta
            ? `cd '${worktree}' && git diff HEAD | delta --paging always`
            : `cd '${worktree}' && git diff HEAD --color | less -R`
          openInBottomPane(diffCmd)
        }
        break
      case "e":
        if (isInsideCmux()) {
          openInBottomPane(`cd '${worktree}' && ${getDefaultEditor()} .`)
        }
        break
      case "g":
        if (hasLazygit && isInsideCmux()) {
          openInBottomPane(`cd '${worktree}' && lazygit`)
        }
        break
      case "r":
        if (hasClaudeReview && !reviewLoading) {
          setReviewLoading(true)
          setReviewReady(false)
          const prompt = `You are an adversarial code reviewer. Run git diff HEAD to examine the current changes. Write a thorough review covering: bugs and logic errors, security vulnerabilities, missing edge cases and error handling, performance concerns, and code quality issues. Format as markdown with specific file and line references. Be critical and actionable.`
          const escaped = prompt.replace(/'/g, "'\\''")
          Bun.spawn(["sh", "-c", `cd '${worktree}' && claude '${escaped}' > '${reviewFilePath}' && touch '${reviewSentinelPath}'`], {
            stdout: "ignore",
            stderr: "ignore",
          })
        }
        break
      case "return":
        // Manual re-trigger: open review in pane + show actions
        openReviewInPane()
        setReviewActionIdx(0)
        setShowReviewActions(true)
        break
      case "s":
        Bun.spawnSync(["git", "add", "-A"], { cwd: worktree })
        break
      case "c":
        if (isInsideCmux()) {
          openInBottomPane(
            `cd '${worktree}' && git add -A && echo 'Enter commit message:' && read -r msg && git commit -m "$msg"`,
          )
        }
        break
      case "q":
        exitTui(0)
    }
  })

  const now = new Date().toLocaleTimeString("en-GB", { hour12: false })

  if (showReviewActions) {
    return (
      <box style={{ flexDirection: "column" }}>
        <StatusBar status={status} />
        <text>
          <span fg="#a855f7">{"  watcher"}</span>
          <span fg="#666">{"  ·  "}</span>
          <span fg="#06b6d4">{branch}</span>
        </text>
        <box style={{ paddingTop: 1, paddingLeft: 2 }}>
          <text fg="#e2e8f0">{"Review ready — what would you like to do?"}</text>
        </box>
        <box style={{ paddingTop: 1 }}>
          {REVIEW_OPTS.map((opt, i) => (
            <text key={opt.label}>
              {"  "}
              {i === reviewActionIdx ? (
                <span fg="#06b6d4">{"› "}</span>
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
          <text fg="#444">{"  ─────────────────────────────────"}</text>
        </box>
        <text>
          {"  "}
          <span fg="#06b6d4">↑↓</span>{" select    "}
          <span fg="#06b6d4">enter</span>{" confirm    "}
          <span fg="#06b6d4">esc</span>{" reject"}
        </text>
        {alert && (
          <box style={{ paddingTop: 1 }}>
            <text fg={alert.color}>{"  " + alert.message}</text>
          </box>
        )}
      </box>
    )
  }

  return (
    <box style={{ flexDirection: "column" }}>
      <StatusBar status={status} />
      <text>
        <span fg="#a855f7">{"  watcher"}</span>
        <span fg="#666">{"  ·  "}</span>
        <span fg="#06b6d4">{branch}</span>
      </text>
      <text fg="#666">{"  " + now + " · " + (worktree.length > width - 16 ? "…" + worktree.slice(-(width - 17)) : worktree)}</text>
      <box style={{ paddingTop: 1 }}>
        <DiffStat worktree={worktree} maxFiles={Math.max(3, height - 13)} />
      </box>
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
      {hasClaudeReview && (
        <text>
          {"  "}
          <span fg="#06b6d4">r</span>{" review"}
          {reviewLoading ? <span fg="#a855f7">{`  ${SPINNER_FRAMES[spinnerTick]} reviewing…`}</span> : null}
          {!reviewLoading && reviewReady ? <span fg="#22c55e">{"  ✓ review ready"}</span> : null}
          {!reviewLoading && reviewReady ? <span>{"    "}<span fg="#06b6d4">enter</span>{" review actions"}</span> : null}
        </text>
      )}
      <text>
        {"  "}
        <span fg="#06b6d4">q</span>{" quit"}
      </text>
      {alert && (
        <box style={{ paddingTop: 1 }}>
          <text fg={alert.color}>{"  " + alert.message}</text>
        </box>
      )}
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
