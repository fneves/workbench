# Workbench — multi-agent orchestrator

## What this is
A terminal-based tool for running multiple AI coding agents (Claude Code, OpenCode)
in parallel, each in its own git worktree or devcontainer, orchestrated via cmux.

## Tech stack
- **Runtime:** Bun (TypeScript)
- **TUI:** OpenTUI React (`@opentui/react` + `@opentui/core`)
- **Session management:** cmux (native macOS terminal with socket API)
- **State:** JSON files in `/tmp/workbench/`

## Architecture
- `src/index.tsx` — single CLI entry point with subcommands
- `src/lib/` — shared libraries (config, state, git, cmux, process, notify)
- `src/commands/` — imperative subcommands (start, spawn, list, kill, cleanup)
- `src/modes/dashboard/` — OpenTUI React dashboard TUI (runs in cmux workspace)
- `src/modes/watcher/` — OpenTUI React per-task watcher TUI (runs in each task workspace)
- `src/components/` — shared React components (Spinner)
- `src/hooks/` — shared React hooks (useInterval, useTaskState, useAlert, useEventLog)
- `src/templates/` — generators for agent wrapper scripts

## Subcommands
```
workbench start                          # Create cmux workspace + launch dashboard
workbench dashboard                      # TUI: orchestrator dashboard (runs in cmux)
workbench watcher <worktree> <branch>    # TUI: per-task diff watcher (runs in cmux)
workbench spawn [opts]                   # Create worktree + launch task workspace
workbench list                           # Print task table
workbench kill <branch>                  # Kill single task
workbench cleanup                        # Tear down everything
```

## Key design decisions
- All state lives in /tmp/workbench/<branch>.json (status, diff stats, PID)
- Only `dashboard` and `watcher` use OpenTUI React rendering; other commands are imperative
- Agent wrapper stays as a generated shell script (needs `exec`, traps, background diff updater)
- Each task gets its own cmux workspace (created via Unix socket API at /tmp/cmux.sock)
- Interactive tools (fzf, lazygit, editor) use cmux split panes
- Notifications use cmux native notifications (with OS-native fallback)
- Single symlink install: `~/.local/bin/workbench` → wrapper that runs `bun src/index.tsx`
- Dependencies: bun, git, cmux (jq still needed by agent wrapper scripts)

## cmux integration
- Communication via JSON over Unix socket (`/tmp/cmux.sock`)
- `src/lib/cmux.ts` — socket client with sync and async request methods
- Environment detection: `CMUX_WORKSPACE_ID`, `CMUX_SURFACE_ID`
- Workspaces map to tasks (one workspace per branch)
- Split panes used for interactive tools (diff viewer, editor, lazygit, commit)

## Next iteration targets
- Agent state detection: parse Claude Code stdout for prompt markers to distinguish running vs prompting
- Devcontainer integration: test the container mode end-to-end
- Linear integration: spawn tasks from Linear issue IDs
- Config file: ~/.workbench/config.toml for defaults (agent, base branch, editor, etc.)
