import { useState } from "react"
import { getDiffStat } from "../../lib/git"
import { useInterval } from "../../hooks/useInterval"

export function DiffStat({ worktree }: { worktree: string }) {
  const [stat, setStat] = useState(() => getDiffStat(worktree))

  useInterval(() => {
    setStat(getDiffStat(worktree))
  }, 2000)

  if (!stat) {
    return <text fg="#666">{"  No changes yet"}</text>
  }

  // getDiffStat returns ANSI-colored output which we can't render as-is in OpenTUI.
  // Fall back to plain text by stripping ANSI codes.
  const plain = stat.replace(/\x1b\[[0-9;]*m/g, "")
  const lines = plain.split("\n")

  return (
    <box style={{ flexDirection: "column" }}>
      {lines.map((line, i) => (
        <text key={i}>{"  " + line}</text>
      ))}
    </box>
  )
}
