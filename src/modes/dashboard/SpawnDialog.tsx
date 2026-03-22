import { useState } from "react";
import { useKeyboard } from "@opentui/react";

export interface SpawnOpts {
  branch: string;
  prompt: string;
  agent: "claude" | "opencode";
  mode: "worktree" | "container";
  baseBranch: string;
  interactive: boolean;
}

interface SpawnDialogProps {
  onSpawn: (opts: SpawnOpts) => void;
  onCancel: () => void;
  defaultAgent?: "claude" | "opencode";
  defaultBaseBranch?: string;
}

type Step = "branch" | "interactive" | "prompt" | "agent";

const MODE_OPTS = [
  { label: "interactive", desc: "agent opens in terminal, no prompt" },
  { label: "with prompt", desc: "provide a task description" },
  { label: "container", desc: "runs autonomously in a devcontainer" },
];

const AGENT_OPTS = [
  { value: "claude" as const, desc: "Anthropic Claude Code" },
  { value: "opencode" as const, desc: "OpenCode CLI" },
];

function SelectList({
  label,
  options,
  selected,
}: {
  label: string;
  options: { label?: string; value?: string; desc: string }[];
  selected: number;
}) {
  return (
    <box style={{ flexDirection: "column", gap: 0 }}>
      <text fg="#aaaaaa">{label}</text>
      {options.map((opt, i) => {
        const name = opt.label ?? opt.value ?? "";
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
        );
      })}
      <text fg="#444444">{"↑↓ navigate · enter confirm"}</text>
    </box>
  );
}

export function SpawnDialog({
  onSpawn,
  onCancel,
  defaultAgent = "claude",
  defaultBaseBranch = "main",
}: SpawnDialogProps) {
  const [step, setStep] = useState<Step>("branch");
  const [branch, setBranch] = useState("");
  const [modeIdx, setModeIdx] = useState(0); // 0=interactive, 1=with prompt, 2=container
  const [prompt, setPrompt] = useState("");
  const defaultAgentIdx = AGENT_OPTS.findIndex((o) => o.value === defaultAgent);
  const [agentIdx, setAgentIdx] = useState(defaultAgentIdx >= 0 ? defaultAgentIdx : 0);

  const stepColor = (s: Step): string => {
    const order: Step[] = ["branch", "interactive", "prompt", "agent"];
    const currentIdx = order.indexOf(step);
    const sIdx = order.indexOf(s);
    if (s === step) return "#ffffff";
    if (sIdx < currentIdx) return "#06b6d4";
    return "#333333";
  };

  useKeyboard((key) => {
    if (step === "interactive") {
      if (key.name === "up") setModeIdx((i) => Math.max(0, i - 1));
      else if (key.name === "down") setModeIdx((i) => Math.min(MODE_OPTS.length - 1, i + 1));
      else if (key.name === "return") setStep(modeIdx === 0 ? "agent" : "prompt");
      else if (key.name === "escape") onCancel();
    } else if (step === "agent") {
      if (key.name === "up") setAgentIdx((i) => Math.max(0, i - 1));
      else if (key.name === "down") setAgentIdx((i) => Math.min(AGENT_OPTS.length - 1, i + 1));
      else if (key.name === "return") {
        onSpawn({
          branch: branch.trim(),
          prompt: modeIdx !== 0 ? prompt.trim() : "",
          agent: AGENT_OPTS[agentIdx]!.value,
          mode: modeIdx === 2 ? "container" : "worktree",
          baseBranch: defaultBaseBranch,
          interactive: modeIdx === 0,
        });
      } else if (key.name === "escape") onCancel();
    }
  });

  return (
    <box
      style={{
        border: true,
        borderStyle: "single",
        padding: 1,
        flexDirection: "column",
        gap: 1,
        width: 62,
      }}
      title=" New Task "
    >
      {/* Step breadcrumb */}
      <text>
        <span fg={stepColor("branch")}>{"branch"}</span>
        <span fg={stepColor("interactive")}>{" → mode"}</span>
        <span fg={modeIdx !== 0 ? stepColor("prompt") : "#333333"}>{" → prompt"}</span>
        <span fg={stepColor("agent")}>{" → agent"}</span>
      </text>

      {step === "branch" && (
        <box style={{ flexDirection: "column", gap: 0 }}>
          <text fg="#aaaaaa">Branch name:</text>
          <input
            placeholder="e.g. fix-auth-bug"
            onInput={setBranch}
            onSubmit={() => {
              if (branch.trim()) setStep("interactive");
            }}
            focused
          />
          <text fg="#444444">{"enter to continue · esc to cancel"}</text>
        </box>
      )}

      {step === "interactive" && (
        <SelectList label="Mode:" options={MODE_OPTS} selected={modeIdx} />
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

      {step === "agent" && <SelectList label="Agent:" options={AGENT_OPTS} selected={agentIdx} />}
    </box>
  );
}
