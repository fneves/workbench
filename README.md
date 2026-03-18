# Workbench

A terminal-based multi-agent orchestrator that spawns AI coding agents (Claude Code, OpenCode) in isolated git worktrees, with a global dashboard to monitor progress and review diffs.

## Architecture

```
workbench
├── bin/
│   ├── workbench              # Main entry point (launches Zellij session)
│   ├── wb-spawn               # Spawn a new task (worktree + agent)
│   ├── wb-status              # Orchestrator TUI (runs in Tab 0)
│   ├── wb-watch               # Diff watcher for a single worktree
│   └── wb-cleanup             # Tear down worktrees and session
├── src/
│   └── status.ts              # TUI dashboard (Node/Ink)
├── layouts/
│   └── task.kdl               # Zellij layout template for task tabs
├── package.json
└── README.md
```

## Concepts

- **Session**: A Zellij session named `workbench` containing all tabs
- **Task**: A branch name + prompt, executed in its own worktree
- **Agent**: Claude Code or OpenCode running in a worktree
- **Status file**: `/tmp/workbench/<branch>.json` — written by the agent wrapper, read by the orchestrator

## Workflow

1. `workbench start` — starts a Zellij session with the orchestrator tab
2. Press `n` in the orchestrator to spawn a new task
3. Each task gets its own Zellij tab with agent + diff watcher
4. Orchestrator polls status files and shows live stats
5. Press `Enter` on a task to jump to its tab
6. Press `k` to kill a task and clean up the worktree

## Requirements

- Zellij (terminal multiplexer)
- Git
- Claude Code (`claude`) and/or OpenCode (`opencode`)
- Node.js 18+ (for the TUI)
- Optional: delta (better diffs), lazygit, fzf
