export function killProcess(pid: number): boolean {
  try {
    process.kill(pid, "SIGTERM")
    // Give it a second then force kill
    setTimeout(() => {
      try {
        process.kill(pid, "SIGKILL")
      } catch {
        // Already dead
      }
    }, 1000)
    return true
  } catch {
    return false
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
