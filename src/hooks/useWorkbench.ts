import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { WorkbenchClient } from "#client";
import type { TaskState } from "#lib/state";
import type { FileChange } from "#lib/git";
import type { Response } from "#server/types";

// --- Context ---

export const WorkbenchClientContext = createContext<WorkbenchClient | null>(null);

export function useWorkbenchClient(): WorkbenchClient | null {
  return useContext(WorkbenchClientContext);
}

// --- Request helper ---

export function useRequest(): (method: string, params?: Record<string, unknown>) => Promise<any> {
  const client = useWorkbenchClient();

  return useCallback(
    async (method: string, params?: Record<string, unknown>) => {
      if (!client?.isConnected) {
        throw new Error("Not connected to server");
      }
      const response: Response = await client.request(method, params);
      if (!response.ok) {
        throw new Error(response.error?.message ?? "Request failed");
      }
      return response.result;
    },
    [client],
  );
}

// --- Task hooks ---

export function useTaskList(): TaskState[] {
  const client = useWorkbenchClient();
  const [tasks, setTasks] = useState<TaskState[]>([]);

  useEffect(() => {
    if (!client?.isConnected) return;

    // Initial fetch
    client.request("task.list").then((res) => {
      const r = res.result as any;
      if (res.ok && r?.tasks) setTasks(r.tasks);
    });

    const onCreated = (data: any) => {
      setTasks((prev) => {
        // Avoid duplicates
        if (prev.some((t) => t.branch === data.task.branch)) return prev;
        return [...prev, data.task];
      });
    };

    const onUpdated = (data: any) => {
      setTasks((prev) => {
        const idx = prev.findIndex((t) => t.branch === data.task.branch);
        if (idx < 0) return [...prev, data.task];
        const next = [...prev];
        next[idx] = data.task;
        return next;
      });
    };

    const onDeleted = (data: any) => {
      setTasks((prev) => prev.filter((t) => t.branch !== data.branch));
    };

    client.on("task.created", onCreated);
    client.on("task.updated", onUpdated);
    client.on("task.deleted", onDeleted);

    return () => {
      client.off("task.created", onCreated);
      client.off("task.updated", onUpdated);
      client.off("task.deleted", onDeleted);
    };
  }, [client]);

  return tasks;
}

export function useTask(branch: string): TaskState | null {
  const client = useWorkbenchClient();
  const [task, setTask] = useState<TaskState | null>(null);

  useEffect(() => {
    if (!client?.isConnected) return;

    // Initial fetch
    client.request("task.get", { branch }).then((res) => {
      const r = res.result as any;
      if (res.ok && r?.task) setTask(r.task);
    });

    const onUpdated = (data: any) => {
      if (data.task?.branch === branch) setTask(data.task);
    };

    const onCreated = (data: any) => {
      if (data.task?.branch === branch) setTask(data.task);
    };

    const onDeleted = (data: any) => {
      if (data.branch === branch) setTask(null);
    };

    client.on("task.updated", onUpdated);
    client.on("task.created", onCreated);
    client.on("task.deleted", onDeleted);

    return () => {
      client.off("task.updated", onUpdated);
      client.off("task.created", onCreated);
      client.off("task.deleted", onDeleted);
    };
  }, [client, branch]);

  return task;
}

export function useFileChanges(branch: string): FileChange[] {
  const client = useWorkbenchClient();
  const [files, setFiles] = useState<FileChange[]>([]);

  useEffect(() => {
    if (!client?.isConnected) return;

    // Initial fetch
    client.request("git.fileChanges", { branch }).then((res) => {
      const r = res.result as any;
      if (res.ok && r?.files) setFiles(r.files);
    });

    const handler = (data: any) => {
      if (data.branch === branch) setFiles(data.files);
    };

    client.on("files.changed", handler);
    return () => client.off("files.changed", handler);
  }, [client, branch]);

  return files;
}
