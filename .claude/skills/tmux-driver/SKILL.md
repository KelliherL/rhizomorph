---
name: tmux-driver
description: Manage tmux panes for shell interaction. Use when asked to find, list, or interact with tmux sessions, windows, or panes, or invoke /tmux.
---

# Tmux Driver Skill

Control and interact with tmux panes for driving shell interactions.

## Important: resolve the tmux binary first

`tmux` on its own can resolve to a shell function or alias rather than the real
binary. Some plugin setups wrap it, and a non-interactive shell then fails with
something like `command not found: _zsh_tmux_plugin_run`. Resolve the real path
once and reuse it:

```bash
TMUX_BIN=$(command -v tmux)
```

If that gives you a wrapper rather than a binary, set it explicitly. Common
locations:

| Platform | Path |
|---|---|
| macOS, Homebrew on Apple silicon | `/opt/homebrew/bin/tmux` |
| macOS, Homebrew on Intel | `/usr/local/bin/tmux` |
| Linux, package manager | `/usr/bin/tmux` |

Every command below uses `"$TMUX_BIN"`. Set it once per shell and the rest works
unchanged.

## When to Use

Activate when the user:
- Says `/tmux`
- Asks about tmux sessions, windows, or panes
- Wants to send commands to a specific pane
- Needs to monitor output from a background process
- Wants to set up or identify a pane for shell interactions

## Workflow

### 1. Discover Current Environment

First, find all sessions and windows:

```bash
"$TMUX_BIN" list-sessions
```

Then list windows in a session:

```bash
"$TMUX_BIN" list-windows -t <session>
```

### 2. Find All Panes in Current Window

List all panes with their IDs, indices, and current commands:

```bash
"$TMUX_BIN" list-panes -F '#{pane_id} #{pane_index} #{pane_current_command} #{pane_active} #{pane_width}x#{pane_height}'
```

For a specific window:

```bash
"$TMUX_BIN" list-panes -t <session>:<window> -F '#{pane_id} #{pane_index} #{pane_current_command} #{pane_active} #{pane_pid}'
```

### 3. Identify the Target Pane

Look for panes that are suitable for shell interaction:
- Panes running a shell (`zsh`, `bash`, `fish`)
- Panes that are idle (not running a long process)
- Panes marked as the designated "driver" pane

Format specifiers for identification:
```bash
"$TMUX_BIN" list-panes -F '#{pane_id}|idx=#{pane_index}|cmd=#{pane_current_command}|active=#{pane_active}|pid=#{pane_pid}|title=#{pane_title}'
```

### 4. Capture Pane Content

Read the current content/output of a pane:

```bash
# Last 50 lines
"$TMUX_BIN" capture-pane -t <pane_id> -p -S -50

# Entire scrollback
"$TMUX_BIN" capture-pane -t <pane_id> -p -S -
```

### 5. Send Commands to a Pane

Before sending keystrokes, interrupting a process, respawning a pane, or starting/stopping a server, run a destructive-action preflight. This is mandatory for `send-keys`, `C-c`, `respawn-pane`, and any equivalent process-control action.

```bash
"$TMUX_BIN" display-message -p 'current=#{session_name}:#{window_index}.#{pane_index} id=#{pane_id} window=#{window_name} cmd=#{pane_current_command} cwd=#{pane_current_path}'
"$TMUX_BIN" display-message -p -t <target> 'target=#{session_name}:#{window_index}.#{pane_index} id=#{pane_id} window=#{window_name} cmd=#{pane_current_command} cwd=#{pane_current_path}'
```

Then verify:

- The target resolves to the exact session and window the user requested or the current active window the user clearly means by "this window".
- The target pane's `cwd` is the expected repo or worktree path for the task.
- If the user gave a pane index such as `.2`, interpret it only within the verified current/requested window. Do not target a different window with the same pane index.
- If the target window, pane, or `cwd` does not match expectations, stop. Do not `cd`, `C-c`, `respawn-pane`, or start commands there. Report the mismatch and ask for the correct target or inspect read-only until it is resolved.

Send keystrokes to execute a command:

```bash
"$TMUX_BIN" send-keys -t <pane_id> 'your command here'
"$TMUX_BIN" send-keys -t <pane_id> C-m
```

Send without pressing Enter (for partial input):

```bash
"$TMUX_BIN" send-keys -t <pane_id> 'partial text'
```

### 5a. Submission Rule

When sending freeform text to an interactive program inside tmux:

- Never rely on appending `Enter` in the same `send-keys` command as the text.
- Always send the text first.
- Then send a separate `C-m` keystroke to submit it.
- After submission, capture the pane and verify the input actually fired.

Example:

```bash
"$TMUX_BIN" send-keys -t <pane_id> 'run the test suite'
"$TMUX_BIN" send-keys -t <pane_id> C-m
"$TMUX_BIN" capture-pane -t <pane_id> -p -S -20
```

Success signal:

- The pane should move off the `›` input prompt into active execution, such as `Working`, command output, or a changed prompt state.

Failure signal:

- If the text still sits at `›` unchanged, the submission did not fire. Retry with a separate `C-m` and re-check before assuming the agent is working.

### 6. Wait for Command Completion

Poll the pane to check if a command has finished:

```bash
# Check if prompt has returned (customize for your shell)
"$TMUX_BIN" capture-pane -t <pane_id> -p | tail -1
```

## Common Commands Reference

| Action | Command |
|--------|---------|
| List sessions | `"$TMUX_BIN" list-sessions` |
| List windows | `"$TMUX_BIN" list-windows -t <session>` |
| List panes | `"$TMUX_BIN" list-panes -F '#{pane_id} #{pane_index} #{pane_current_command}'` |
| Capture output | `"$TMUX_BIN" capture-pane -t <pane_id> -p -S -50` |
| Send command | `"$TMUX_BIN" send-keys -t <pane_id> 'cmd'` then `"$TMUX_BIN" send-keys -t <pane_id> C-m` |
| Get pane PID | `"$TMUX_BIN" display-message -t <pane_id> -p '#{pane_pid}'` |
| Check pane size | `"$TMUX_BIN" display-message -t <pane_id> -p '#{pane_width}x#{pane_height}'` |

## Pane Selection Strategy

When the user asks you to drive a shell:

1. **List all panes** in the current/specified window
2. **Identify shell panes** - look for `zsh`, `bash`, or `fish` in `pane_current_command`
3. **Prefer inactive panes** - panes where `pane_active=0` are safer to use
4. **Run destructive-action preflight** - print current and target pane identity, window name, command, and cwd before any process-control action
5. **Confirm with user** - before sending commands, confirm which pane to use unless the request is already exact and the preflight matches
6. **Bind the full target** - prefer `session:window.pane` after preflight. Do not carry pane IDs across windows unless the user explicitly gave the pane ID.

## User Commands

| Request | Action |
|---------|--------|
| `/tmux` | List current sessions, windows, and panes |
| `/tmux find shell` | Find panes running a shell |
| `/tmux panes` | List all panes with details |
| `/tmux capture %42` | Show last 50 lines from pane %42 |
| `/tmux send %42 ls -la` | Send `ls -la` to pane %42 |

## Session Binding

When driving a pane throughout a session:

1. **Initial discovery**: Find and confirm the target pane
2. **Store pane ID**: Remember `%<number>` format pane ID
3. **Use consistently**: All subsequent operations target this pane
4. **Re-discover if needed**: If pane closed or user requests different pane

## Tips

- Pane IDs (like `%42`) are stable for the session lifetime
- Pane indices (0, 1, 2...) can change if panes are closed
- Always use full path `"$TMUX_BIN"` to avoid shell stubs
- Use `-t session:window.pane` syntax for precision
- For interactive agent prompts, submit with a separate `C-m` keystroke and then verify the pane state changed

## Error Handling

If tmux commands fail:
- Verify tmux is running: `"$TMUX_BIN" list-sessions`
- Check if inside tmux: `echo $TMUX`
- Verify pane exists: `"$TMUX_BIN" has-session -t <target>`
- **If no sessions found**: Check if you need `-L <socket>` for the GT socket
- **If "no server running"**: The socket may differ — inspect `$TMUX` for the active socket name
