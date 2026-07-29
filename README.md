# worktrees-challenge

Running parallel agents across git worktrees and tmux windows.

The challenge brief is still to be written. What exists so far is the agent
setup: two skills that cover driving tmux by hand and driving `workmux` for
worktree-per-branch workflows.

## Skills layout

Skills live in `.claude/skills/`. `.agent/skills` is a symlink to it, so both
paths resolve to the same directory and either tool convention finds the same
skills:

```
.claude/skills/          <- the real directory
.agent/skills -> ../.claude/skills
```

If the symlink is ever missing, recreate it from the repo root:

```sh
ln -sfn ../.claude/skills .agent/skills
```

Git stores the symlink, so a fresh clone gets it for free. Check with
`ls -l .agent/`.

## Included skills

| Skill | What it covers |
|---|---|
| `tmux-driver` | Finding sessions, windows and panes; capturing output; sending keys to an interactive program and verifying it fired |
| `workmux` | `workmux add/list/merge/remove`, talking to agents in other worktrees, and configuration |

`workmux` is a CLI that must be installed separately; the skill is a reference
for driving it, not a copy of it.

## What was changed from the originals

These skills came from a personal `~/.claude/skills` collection and were
generalised on the way in. Worth knowing, because the originals will drift:

- **tmux binary.** The original hardcoded `/opt/homebrew/bin/tmux` in 36 places.
  Commands now use `"$TMUX_BIN"`, set once with `TMUX_BIN=$(command -v tmux)`,
  with a table of common paths per platform. The reason for not calling `tmux`
  bare is kept: it can resolve to a shell wrapper and fail in a non-interactive
  shell.
- **Gas Town section removed.** About 95 lines of a private multi-agent
  orchestration setup, including a custom tmux socket and named agent sessions.
  Not applicable outside that system.
- **Fundsorter dispatch rule removed.** About 45 lines requiring a specific
  doc-driven development loop, `.etude/project.md`, and bead notes. Repo
  specific.
- **Submodule removal warning kept, script replaced.** The warning matters:
  `workmux` clones submodules into each worktree, so removing a worktree can
  destroy unpushed submodule commits, and a clean superproject pointer does not
  mean the submodule is clean. The original pointed at a script in a personal
  skills directory; it now shows the `git submodule foreach` check inline.
- **Companion skills noted as absent.** The `workmux` skill mentions `/merge`,
  `/rebase`, `/worktree`, `/coordinator` and `/open-pr`, none of which are
  here. That is now stated, with the instruction to do those steps by hand.
- **`disable-model-invocation` dropped** from `workmux`, so an agent can reach
  for the skill when the work obviously calls for it rather than only when it is
  named explicitly.
