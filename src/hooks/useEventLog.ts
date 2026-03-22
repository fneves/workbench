import { useState, useCallback } from "react";

export interface LogEntry {
  time: string;
  icon: string;
  message: string;
}

export function useEventLog(maxEntries = 8): {
  entries: LogEntry[];
  pushEvent: (icon: string, message: string) => void;
} {
  const [entries, setEntries] = useState<LogEntry[]>([]);

  const pushEvent = useCallback(
    (icon: string, message: string) => {
      const time = new Date().toLocaleTimeString("en-GB", { hour12: false });
      setEntries((prev) => {
        const next = [{ time, icon, message }, ...prev];
        return next.slice(0, maxEntries);
      });
    },
    [maxEntries],
  );

  return { entries, pushEvent };
}
