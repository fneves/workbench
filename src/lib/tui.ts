import type { CliRenderer } from "@opentui/core"

const RESET_SEQUENCES =
  "\x1b[?1000l" + // disable normal mouse tracking
  "\x1b[?1002l" + // disable button-event tracking
  "\x1b[?1003l" + // disable any-event mouse tracking
  "\x1b[?1006l" + // disable SGR extended mouse mode
  "\x1b[?2004l" + // disable bracketed paste
  "\x1b[?1049l" + // restore main screen buffer
  "\x1b[?25h"   + // restore cursor visibility
  "\x1b[0m"       // reset all attributes

let tuiCleaned = false
let registeredRenderer: CliRenderer | null = null

/** Register the OpenTUI renderer so exitTui can call its native teardown. */
export function registerTuiRenderer(renderer: CliRenderer): void {
  registeredRenderer = renderer
}

function doCleanup(): void {
  if (tuiCleaned) return
  tuiCleaned = true
  // Force OpenTUI's native teardown (disables mouse, restores screen, etc.)
  // finalizeDestroy bypasses the `rendering` guard that destroy() has.
  if (registeredRenderer) {
    try { (registeredRenderer as any).finalizeDestroy?.() } catch {}
  }
  try { if ((process.stdin as any).setRawMode) (process.stdin as any).setRawMode(false) } catch {}
  try { process.stdin.pause() } catch {}
  process.stdout.write(RESET_SEQUENCES)
}

/**
 * Cleanly exit a TUI process by disabling all terminal modes that OpenTUI
 * enables on start.
 */
export function exitTui(code = 0): never {
  doCleanup()
  process.exit(code)
}

/**
 * Install signal handlers so that SIGINT (Ctrl-C), SIGTERM, and process exit
 * all reset terminal state. Call this once at TUI startup.
 */
export function installTuiCleanup(): void {
  process.on("SIGINT", () => { doCleanup(); process.exit(130) })
  process.on("SIGTERM", () => { doCleanup(); process.exit(143) })
  process.on("exit", doCleanup)
}
