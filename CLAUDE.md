# Workbench — multi-agent orchestrator

## What this is
A terminal-based tool for running multiple AI coding agents (Claude Code, OpenCode)
in parallel, each in its own git worktree or devcontainer, orchestrated via Zellij.

## Architecture
- `bin/workbench` — main CLI entry point (start, spawn, list, kill, cleanup)
- `bin/wb-status` — orchestrator TUI dashboard (Tab 0 in Zellij)
- `bin/wb-spawn` — creates worktree, generates per-task Zellij layout, launches agent + watcher
- `bin/wb-watch` — per-task diff watcher with fzf file picker and floating diff panes
- `bin/wb-notify` — cross-platform notification helper (terminal-notifier, osascript, notify-send)
- `bin/wb-cleanup` — tears down worktrees, kills agents, cleans state
- `layouts/` — Zellij .kdl layout templates

## Key design decisions
- All state lives in /tmp/workbench/<branch>.json (status, diff stats, PID)
- Per-task .kdl layouts are generated dynamically with agent + watcher commands baked in
- Visual notifications: alert bar, event log, animated spinners, row flashing — all in-terminal
- Native OS notifications via wb-notify as a bonus layer, not the primary feedback
- Supports both git worktrees (fast, local) and devcontainers (isolated)
- 1-second refresh loop for smooth spinner animation

## Next iteration targets
- Agent state detection: parse Claude Code stdout for prompt markers to distinguish running vs prompting
- Devcontainer integration: test the container mode end-to-end
- Linear integration: spawn tasks from Linear issue IDs
- Config file: ~/.workbench/config.toml for defaults (agent, base branch, editor, etc.)
- Tab naming: ensure Zellij tab names match branch names for go-to-tab-name reliability
