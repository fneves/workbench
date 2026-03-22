import { useState, useEffect } from "react";
import { useInterval } from "#hooks/useInterval";

export function Header() {
  const [time, setTime] = useState(new Date().toLocaleTimeString("en-GB", { hour12: false }));
  const [repoName, setRepoName] = useState("no repo");

  useInterval(() => {
    setTime(new Date().toLocaleTimeString("en-GB", { hour12: false }));
  }, 1000);

  useEffect(() => {
    const loadRepo = async () => {
      try {
        const file = Bun.file("/tmp/workbench/.repo");
        if (await file.exists()) {
          const path = (await file.text()).trim();
          setRepoName(path.split("/").pop() ?? "no repo");
        }
      } catch {}
    };
    loadRepo();
  }, []);

  const dayStr = new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return (
    <box style={{ flexDirection: "column" }}>
      <text>
        <span fg="#a855f7">{"⚡ workbench"}</span>
        <span fg="#666">{"  orchestrator"}</span>
      </text>
      <text fg="#666">
        {dayStr} {time} · {repoName}
      </text>
    </box>
  );
}
