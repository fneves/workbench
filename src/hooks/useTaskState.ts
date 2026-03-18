import { useState, useCallback } from "react"
import { listTasks, type TaskState } from "../lib/state"
import { useInterval } from "./useInterval"

export function useTaskState(pollMs = 1000): TaskState[] {
  const [tasks, setTasks] = useState<TaskState[]>([])

  const poll = useCallback(async () => {
    const current = await listTasks()
    setTasks(current)
  }, [])

  useInterval(() => { poll() }, pollMs)

  return tasks
}
