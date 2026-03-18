import type { TaskState } from "../../lib/state"
import { Spinner } from "../../components/Spinner"
import { useTerminalDimensions } from "@opentui/react"

const STATUS_CONFIG: Record<
  string,
  { icon: string; label: string; bg: string }
> = {
  running: { icon: "", label: "Agent running", bg: "#22c55e" },
  prompting: {
    icon: "◉",
    label: "AGENT NEEDS INPUT — switch to agent pane",
    bg: "#eab308",
  },
  done: { icon: "✓", label: "Agent finished — review changes below", bg: "#22c55e" },
  failed: { icon: "✗", label: "Agent failed", bg: "#ef4444" },
  starting: { icon: "◔", label: "Agent starting...", bg: "#22c55e" },
}

export function StatusBar({ status }: { status: TaskState["status"] }) {
  const { width } = useTerminalDimensions()
  const config = STATUS_CONFIG[status]

  if (!config) {
    return <text fg="#666">{"  ? Agent: " + status}</text>
  }

  const useSpinner = status === "running"

  return (
    <box style={{ flexDirection: "row", width, backgroundColor: config.bg }}>
      {useSpinner ? (
        <box style={{ flexDirection: "row", gap: 1 }}>
          <text bg={config.bg} fg="black">{"  "}</text>
          <Spinner color="black" />
          <text bg={config.bg} fg="black">{config.label}</text>
        </box>
      ) : (
        <text bg={config.bg} fg="black">{"  " + config.icon + " " + config.label}</text>
      )}
    </box>
  )
}
