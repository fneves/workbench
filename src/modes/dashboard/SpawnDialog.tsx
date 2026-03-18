import { useState } from "react"
import { useKeyboard } from "@opentui/react"

export interface SpawnOpts {
  branch: string
  prompt: string
  agent: "claude" | "opencode"
  mode: "worktree" | "container"
  baseBranch: string
  interactive: boolean
}

interface SpawnDialogProps {
  onSpawn: (opts: SpawnOpts) => void
  onCancel: () => void
}

type Step = "branch" | "interactive" | "prompt" | "agent"

const INTERACTIVE_OPTS = [
  { label: "interactive", desc: "agent opens in terminal, no prompt" },
  { label: "with prompt", desc: "provide a task description" },
]

const AGENT_OPTS = [
  { value: "claude" as const, desc: "Anthropic Claude Code" },
  { value: "opencode" as const, desc: "OpenCode CLI" },
]

function SelectList({
  label,
  options,
  selected,
}: {
  label: string
  options: { label?: string; value?: string; desc: string }[]
  selected: number
}) {
  return (
    <box style={{ flexDirection: "column", gap: 0 }}>
      <text fg="#aaaaaa">{label}</text>
      {options.map((opt, i) => {
        const name = opt.label ?? opt.value ?? ""
        return i === selected ? (
          <text key={name}>
            <span fg="#06b6d4">{"▶ "}</span>
            <span fg="#ffffff">{name}</span>
            <span fg="#888888">{"  " + opt.desc}</span>
          </text>
        ) : (
          <text key={name}>
            <span fg="#444444">{"  " + name}</span>
            <span fg="#2a2a2a">{"  " + opt.desc}</span>
          </text>
        )
      })}
      <text fg="#444444">{"↑↓ navigate · enter confirm"}</text>
    </box>
  )
}

export function SpawnDialog({ onSpawn, onCancel }: SpawnDialogProps) {
  const [step, setStep] = useState<Step>("branch")
  const [branch, setBranch] = useState("")
  const [interactive, setInteractive] = useState(0) // 0=interactive, 1=with prompt
  const [prompt, setPrompt] = useState("")
  const [agentIdx, setAgentIdx] = useState(0)

  const stepColor = (s: Step): string => {
    const order: Step[] = ["branch", "interactive", "prompt", "agent"]
    const currentIdx = order.indexOf(step)
    const sIdx = order.indexOf(s)
    if (s === step) return "#ffffff"
    if (sIdx < currentIdx) return "#06b6d4"
    return "#333333"
  }

  useKeyboard((key) => {
    if (step === "interactive") {
      if (key.name === "up") setInteractive((i) => Math.max(0, i - 1))
      else if (key.name === "down") setInteractive((i) => Math.min(1, i + 1))
      else if (key.name === "return") setStep(interactive === 0 ? "agent" : "prompt")
      else if (key.name === "escape") onCancel()
    } else if (step === "agent") {
      if (key.name === "up") setAgentIdx((i) => Math.max(0, i - 1))
      else if (key.name === "down") setAgentIdx((i) => Math.min(AGENT_OPTS.length - 1, i + 1))
      else if (key.name === "return") {
        onSpawn({
          branch: branch.trim(),
          prompt: interactive === 1 ? prompt.trim() : "",
          agent: AGENT_OPTS[agentIdx]!.value,
          mode: "worktree",
          baseBranch: "main",
          interactive: interactive === 0,
        })
      } else if (key.name === "escape") onCancel()
    }
  })

  return (
    <box
      style={{ border: true, borderStyle: "single", padding: 1, flexDirection: "column", gap: 1, width: 62 }}
      title=" New Task "
    >
      {/* Step breadcrumb */}
      <text>
        <span fg={stepColor("branch")}>{"branch"}</span>
        <span fg={stepColor("interactive")}>{" → mode"}</span>
        <span fg={interactive === 1 ? stepColor("prompt") : "#333333"}>{" → prompt"}</span>
        <span fg={stepColor("agent")}>{" → agent"}</span>
      </text>

      {step === "branch" && (
        <box style={{ flexDirection: "column", gap: 0 }}>
          <text fg="#aaaaaa">Branch name:</text>
          <input
            placeholder="e.g. fix-auth-bug"
            onInput={setBranch}
            onSubmit={() => { if (branch.trim()) setStep("interactive") }}
            focused
          />
          <text fg="#444444">{"enter to continue · esc to cancel"}</text>
        </box>
      )}

      {step === "interactive" && (
        <SelectList label="Mode:" options={INTERACTIVE_OPTS} selected={interactive} />
      )}

      {step === "prompt" && (
        <box style={{ flexDirection: "column", gap: 0 }}>
          <text fg="#aaaaaa">Task prompt:</text>
          <input
            placeholder="Describe the task..."
            onInput={setPrompt}
            onSubmit={() => setStep("agent")}
            focused
          />
          <text fg="#444444">{"enter to continue · esc to cancel"}</text>
        </box>
      )}

      {step === "agent" && (
        <SelectList label="Agent:" options={AGENT_OPTS} selected={agentIdx} />
      )}
    </box>
  )
}
