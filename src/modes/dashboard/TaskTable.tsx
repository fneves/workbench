import type { TaskState } from "../../lib/state"
import { Spinner } from "../../components/Spinner"

function StatusIcon({ status }: { status: TaskState["status"] }) {
  switch (status) {
    case "running":
      return <Spinner color="#22c55e" />
    case "prompting":
      return <text fg="#eab308">◉</text>
    case "done":
      return <text fg="#06b6d4">✓</text>
    case "failed":
      return <text fg="#ef4444">✗</text>
    case "starting":
      return <text fg="#3b82f6">◔</text>
    default:
      return <text fg="#666">?</text>
  }
}

const STATUS_COLORS: Record<string, string> = {
  running: "#22c55e",
  prompting: "#eab308",
  done: "#06b6d4",
  failed: "#ef4444",
  starting: "#3b82f6",
  unknown: "#666",
}

function TaskRow({
  task,
  index,
  selected,
}: {
  task: TaskState
  index: number
  selected: boolean
}) {
  const statusColor = STATUS_COLORS[task.status] ?? "#666"
  const branch = task.branch.slice(0, 28)
  const modeBadge = task.mode === "container" ? " [ctr]" : ""

  return (
    <box style={{ flexDirection: "row", gap: 1 }}>
      <text fg={selected ? "white" : undefined}>
        {selected ? "▸" : " "}
      </text>
      <text fg="#666" style={{ width: 3 }}>
        {String(index + 1).padStart(2)}
      </text>
      <text style={{ width: 30 }}>
        {branch + modeBadge}
      </text>
      <box style={{ flexDirection: "row", gap: 0, width: 14 }}>
        <StatusIcon status={task.status} />
        <text fg={statusColor}> {task.status}</text>
      </box>
      <text fg="#22c55e" style={{ width: 7 }}>
        {`+${task.diff_added}`.padStart(6)}
      </text>
      <text fg="#ef4444" style={{ width: 7 }}>
        {`-${task.diff_removed}`.padStart(6)}
      </text>
      <text fg="#666" style={{ width: 6 }}>
        {String(task.diff_files).padStart(5)}
      </text>
      <text fg="#666" style={{ width: 10 }}>
        {task.agent}
      </text>
    </box>
  )
}

export function TaskTable({
  tasks,
  selected,
}: {
  tasks: TaskState[]
  selected: number
}) {
  return (
    <box style={{ flexDirection: "column" }}>
      <text fg="#666">
        {"  "}
        {"#".padEnd(4)}
        {"BRANCH".padEnd(31)}
        {"STATUS".padEnd(15)}
        {"ADDED".padStart(7)}
        {"  "}
        {"REMOVED".padStart(7)}
        {"  "}
        {"FILES".padStart(5)}
        {"  "}
        {"AGENT"}
      </text>
      <text fg="#444">{"  " + "─".repeat(90)}</text>
      {tasks.length === 0 ? (
        <box style={{ paddingTop: 1 }}>
          <text fg="#666">{"  No active tasks. Press "}<span fg="#06b6d4">n</span>{" to spawn one."}</text>
        </box>
      ) : (
        tasks.map((task, i) => (
          <TaskRow
            key={task.branch}
            task={task}
            index={i}
            selected={i === selected}
          />
        ))
      )}
    </box>
  )
}
