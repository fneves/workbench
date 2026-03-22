import { useState, useCallback, useEffect } from "react";
import { listTasks, type TaskState } from "../lib/state";
import { useInterval } from "./useInterval";

export function useTaskState(pollMs = 1000): TaskState[] {
  const [tasks, setTasks] = useState<TaskState[]>([]);

  const poll = useCallback(async () => {
    const current = await listTasks();
    setTasks(current);
  }, []);

  useEffect(() => {
    poll();
  }, [poll]);
  useInterval(() => {
    poll();
  }, pollMs);

  return tasks;
}
