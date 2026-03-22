import type { LogEntry } from "../../hooks/useEventLog";

export function EventLog({ entries }: { entries: LogEntry[] }) {
  if (entries.length === 0) return <box />;

  return (
    <box style={{ flexDirection: "column", paddingTop: 1 }}>
      <text>{"  Events"}</text>
      {entries.map((entry, i) => (
        <text key={`${entry.time}-${i}`} fg={i === 0 ? undefined : "#666"}>
          {"    "}
          {entry.time} {entry.icon} {entry.message}
        </text>
      ))}
    </box>
  );
}
