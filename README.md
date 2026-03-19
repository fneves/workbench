# Workbench

A terminal-based multi-agent orchestrator that runs AI coding agents (Claude Code, OpenCode) in parallel, each in its own git worktree, with a live dashboard and per-task watcher TUI.

Built with [Bun](https://bun.sh), [OpenTUI React](https://opentui.com), and [cmux](https://cmux.dev).

## How it works

Each task gets its own git worktree and cmux workspace. The agent runs in one pane, a watcher TUI runs alongside it showing live diffs, file status, and shortcuts for common actions.

```
┌─────────────────────────────────┬──────────────────────────────┐
│  Claude Code (agent)            │  Watcher TUI                 │
│                                 │  ⠸ Agent running              │
│  > working on fix...            │    watcher · fn-fix-bug       │
│                                 │                               │
│                                 │    FILE          ADDED REMOVED│
│                                 │  M src/index.ts     +12    -3 │
│                                 │  A lib/utils.ts     +45       │
│                                 │  ? test.txt                   │
│                                 │  ─────────────────────────────│
│                                 │  ↑↓ select    d diff   e edit │
│                                 │  f  picker    g git    t term │
│                                 │  r  review    x run    q quit │
└─────────────────────────────────┴──────────────────────────────┘
```

A global dashboard lets you spawn tasks, monitor all running agents, and jump between workspaces.

## Installation

```bash
# Prerequisites
brew install bun git cmux

# Clone and install
git clone git@github.com:fneves/workbench.git
cd workbench
bun install

# Symlink the CLI
mkdir -p ~/.local/bin
ln -sf "$(pwd)/bin/workbench" ~/.local/bin/workbench
```

## Usage

```bash
# Start the dashboard (must be inside cmux)
workbench start

# Spawn a task
workbench spawn -b fix-auth-bug -p "Fix the authentication timeout issue"

# Spawn interactively (no prompt, opens Claude Code in interactive mode)
workbench spawn -b refactor-api -i

# Spawn from a different base branch
workbench spawn -b feature-x -p "Add feature X" -f develop

# List running tasks
workbench list

# Kill a task
workbench kill fix-auth-bug

# Tear down everything
workbench cleanup
```

## Subcommands

| Command | Description |
|---------|-------------|
| `workbench start` | Create cmux workspace and launch the dashboard |
| `workbench dashboard` | Run the orchestrator dashboard TUI |
| `workbench spawn [opts]` | Create a worktree and launch a task workspace |
| `workbench watcher <worktree> <branch>` | Run the per-task watcher TUI |
| `workbench list` | Print a table of all tasks |
| `workbench kill <branch>` | Kill a single task and clean up |
| `workbench cleanup` | Tear down all tasks, worktrees, and workspaces |

### Spawn options

| Flag | Description |
|------|-------------|
| `-b, --branch` | Branch name (required) |
| `-p, --prompt` | Task prompt for the agent |
| `-a, --agent` | Agent: `claude` or `opencode` (default: `claude`) |
| `-f, --from` | Base branch (default: `main`) |
| `-i, --interactive` | Interactive mode (no prompt) |

## Watcher shortcuts

The per-task watcher TUI supports file selection with arrow keys. When a file is selected, actions scope to that file.

| Key | Action |
|-----|--------|
| `↑↓` | Select file |
| `d` | Diff (selected file or full diff) |
| `e` | Open in editor (selected file or project) |
| `r` | AI code review (selected file or all changes) |
| `f` | File picker (fzf with diff preview) |
| `g` | lazygit |
| `t` | Terminal in worktree |
| `x` | Run `./scripts/start.sh` |
| `s` | Stage all changes |
| `c` | Commit |
| `esc` | Deselect file |
| `q` | Quit |

## Architecture

```
src/
├── index.tsx              # CLI entry point with subcommands
├── commands/              # Imperative subcommands
│   ├── start.ts           #   Create cmux workspace + launch dashboard
│   ├── spawn.ts           #   Create worktree + launch task
│   ├── list.ts            #   Print task table
│   ├── kill.ts            #   Kill a task
│   └── cleanup.ts         #   Tear down everything
├── modes/
│   ├── dashboard/         # Orchestrator dashboard TUI
│   └── watcher/           # Per-task watcher TUI
├── lib/                   # Shared libraries
│   ├── cmux.ts            #   cmux socket client
│   ├── config.ts          #   Config and path helpers
│   ├── git.ts             #   Git operations
│   ├── state.ts           #   Task state management
│   ├── process.ts         #   Process management
│   ├── notify.ts          #   Notifications
│   └── tui.ts             #   TUI lifecycle helpers
├── hooks/                 # Shared React hooks
├── components/            # Shared React components
└── templates/             # Agent wrapper script generators
```

## Requirements

- [Bun](https://bun.sh) (runtime)
- [cmux](https://cmux.dev) (terminal session management)
- Git

### Optional (enhanced experience)

- [delta](https://github.com/dandavison/delta) — better diff rendering
- [lazygit](https://github.com/jesseduffield/lazygit) — git TUI
- [fzf](https://github.com/junegunn/fzf) — file picker
- [bat](https://github.com/sharkdp/bat) — syntax-highlighted file viewer
- [Claude Code](https://claude.ai/claude-code) — AI agent (default)

## License

MIT
