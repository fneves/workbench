/**
 * Cleanly exit a TUI process by disabling all terminal modes that OpenTUI
 * enables on start. Calling process.exit() directly in Bun skips async
 * cleanup handlers, leaving mouse tracking enabled and flooding the terminal
 * with raw escape sequences on every mouse move.
 */
export function exitTui(code = 0): never {
  process.stdout.write(
    "\x1b[?1000l" + // disable normal mouse tracking
    "\x1b[?1002l" + // disable button-event tracking
    "\x1b[?1003l" + // disable any-event mouse tracking
    "\x1b[?1006l" + // disable SGR extended mouse mode
    "\x1b[?2004l" + // disable bracketed paste
    "\x1b[?25h"   + // restore cursor visibility
    "\x1b[0m",      // reset all attributes
  )
  process.exit(code)
}
