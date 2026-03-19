import { useState, useEffect } from "react"
import { useTerminalDimensions } from "@opentui/react"
import { getFileChanges, type FileChange, type FileStatus } from "../../lib/git"
import { useInterval } from "../../hooks/useInterval"

export type { FileChange }

const STATUS_CONFIG: Record<FileStatus, { label: string; color: string }> = {
  staged:    { label: "M", color: "#22c55e" },
  added:     { label: "A", color: "#22c55e" },
  unstaged:  { label: "M", color: "#eab308" },
  both:      { label: "M", color: "#f59e0b" },
  deleted:   { label: "D", color: "#ef4444" },
  renamed:   { label: "R", color: "#06b6d4" },
  untracked: { label: "?", color: "#555555" },
  conflict:  { label: "!", color: "#ef4444" },
}

function FileRow({ file, pathWidth, selected }: { file: FileChange; pathWidth: number; selected: boolean }) {
  const { label, color } = STATUS_CONFIG[file.status]
  const displayPath = file.originalPath ? `${file.originalPath} → ${file.path}` : file.path
  const indicator = selected ? "▸ " : "  "
  const truncated = displayPath.length > pathWidth
    ? "…" + displayPath.slice(-(pathWidth - 1))
    : displayPath

  return (
    <box style={{ flexDirection: "row", gap: 0 }}>
      <text fg={selected ? "#06b6d4" : color} style={{ width: 4 }}>
        {indicator + label + " "}
      </text>
      <text fg={selected ? "#06b6d4" : color} style={{ width: pathWidth }}>
        {truncated}
      </text>
      <text fg="#22c55e" style={{ width: 7 }}>
        {file.added > 0 ? `+${file.added}`.padStart(6) : ""}
      </text>
      <text fg="#ef4444" style={{ width: 7 }}>
        {file.removed > 0 ? `-${file.removed}`.padStart(6) : ""}
      </text>
    </box>
  )
}

interface DiffStatProps {
  worktree: string
  maxFiles?: number
  selectedIdx: number
  onFilesChanged?: (files: FileChange[]) => void
}

export function DiffStat({ worktree, maxFiles, selectedIdx, onFilesChanged }: DiffStatProps) {
  const [files, setFiles] = useState<FileChange[]>(() => getFileChanges(worktree))
  const { width } = useTerminalDimensions()

  useInterval(() => {
    const updated = getFileChanges(worktree)
    setFiles(updated)
  }, 2000)

  useEffect(() => {
    onFilesChanged?.(files)
  }, [files])

  if (files.length === 0) {
    return <text fg="#666">{"  No changes yet"}</text>
  }

  const pathWidth = Math.max(10, width - 4 - 7 - 7)
  const visible = maxFiles != null ? files.slice(0, maxFiles) : files
  const hidden = files.length - visible.length

  return (
    <box style={{ flexDirection: "column" }}>
      <box style={{ flexDirection: "row", gap: 0 }}>
        <text fg="#666" style={{ width: 4 }}>{"  "}</text>
        <text fg="#666" style={{ width: pathWidth }}>{"FILE"}</text>
        <text fg="#666" style={{ width: 7 }}>{"ADDED".padStart(6)}</text>
        <text fg="#666" style={{ width: 7 }}>{"REMOVED".padStart(7)}</text>
      </box>
      {visible.map((file, i) => (
        <FileRow key={file.path} file={file} pathWidth={pathWidth} selected={i === selectedIdx} />
      ))}
      {hidden > 0 && (
        <text fg="#555">{`  … and ${hidden} more  (f to browse all)`}</text>
      )}
    </box>
  )
}
