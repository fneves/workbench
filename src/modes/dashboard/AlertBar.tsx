import type { Alert } from "#hooks/useAlert";
import { useTerminalDimensions } from "@opentui/react";

export function AlertBar({ alert }: { alert: Alert | null }) {
  const { width } = useTerminalDimensions();

  if (!alert) {
    return <text>{""}</text>;
  }

  const msg = `  ${alert.message}`;
  const padding = Math.max(0, width - msg.length);

  return (
    <text bg={alert.color} fg="black">
      {msg + " ".repeat(padding)}
    </text>
  );
}
