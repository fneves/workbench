import { useState } from "react";
import { getUntrackedFiles } from "../../lib/git";
import { useInterval } from "../../hooks/useInterval";

export function UntrackedFiles({ worktree }: { worktree: string }) {
  const [files, setFiles] = useState<string[]>([]);

  useInterval(() => {
    setFiles(getUntrackedFiles(worktree));
  }, 3000);

  if (files.length === 0) return <box />;

  return (
    <box style={{ flexDirection: "column", paddingTop: 1 }}>
      <text fg="#eab308">{"  Untracked:"}</text>
      {files.map((f) => (
        <text key={f} fg="#666">
          {"    ? " + f}
        </text>
      ))}
    </box>
  );
}
