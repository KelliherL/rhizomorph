# worktrees-challenge

Running parallel agents across git worktrees and tmux windows.

Two skills ship with this repo: driving tmux by hand, and driving `workmux` for
worktree-per-branch workflows. See below for how they are wired in.

## What you are building

**Anything you want.** There is no prescribed product this time. Pick something
you would find satisfying to have built by the end of the day.

**This one is solo.** No pair, no shared fork, nobody reviewing your PRs. The
last two days were about working with another person; this one is about working
with several agents at once, which is a different skill and needs your full
attention on the orchestration rather than on a partner.

**Docs first, exactly as in the Next.js challenge.** Follow Part 1 of
[`nextjs-project`](https://github.com/launchpad-26/nextjs-project): write
`docs/prd0.md` and then `docs/architecture.md`, in that order, before the agent
writes any code, and feed both into every prompt afterwards. Add a
`docs/vision.md` first if blahing at the AI helps you find the idea. What you are
building shapes how you should build it, so deciding the stack first means
choosing for an app you have not decided on yet.

Then the part that is new today:

1. **Build a backlog.** Turn `prd0.md` into issues, as you did before.
2. **Groom it.** This is the step that earns its keep once you are running
   several agents. Which issues can be worked at the same time without touching
   the same files? Which ones block others? Make the dependencies explicit and
   say which files each issue will touch. An ungroomed backlog with three agents
   on it produces three conflicting branches.
3. **Get multiple agents working through it.** One worktree per issue, one agent
   per worktree, running at once. Keep grooming as you go, because the backlog
   changes shape once work starts landing.

The point of the day is not the app. It is finding out how many agents you can
actually keep useful at once, and what breaks first when you try.

## Steps

### 1. Install the tools and set up your tmux keys

**tmux:**

```sh
brew install tmux      # macOS
sudo apt install tmux  # Debian/Ubuntu
```

**workmux** lives at
[github.com/raine/workmux](https://github.com/raine/workmux). Install it from
there, following that README. Come back when `workmux --version` prints
something.

**tmux keys.** Out of the box, tmux gives you `C-b` as a prefix and no pane
navigation worth using. Put this in `~/.tmux.conf`:

```tmux
# optional JV prefers Ctrl-space
unbind C-b
set -g prefix C-space
bind Space send-prefix

set -g mouse on

# Move between panes with Ctrl-h/j/k/l, no prefix needed.
# The is_vim guard passes the key through to vim when vim has focus,
# so the same keys move between vim splits and tmux panes.
# See github.com/christoomey/vim-tmux-navigator
is_vim="ps -o state= -o comm= -t '#{pane_tty}' \
    | grep -iqE '^[^TXZ ]+ +(\\S+\\/)?g?(view|n?vim?x?)(diff)?$'"
bind-key -n 'C-h' if-shell "$is_vim" 'send-keys C-h' 'select-pane -L'
bind-key -n 'C-j' if-shell "$is_vim" 'send-keys C-j' 'select-pane -D'
bind-key -n 'C-k' if-shell "$is_vim" 'send-keys C-k' 'select-pane -U'
bind-key -n 'C-l' if-shell "$is_vim" 'send-keys C-l' 'select-pane -R'

# New panes and windows open in the current pane's directory rather than
# wherever you started tmux. Matters once you are in a worktree.
bind-key '"' split-window -v -c '#{pane_current_path}'
bind-key % split-window -h -c '#{pane_current_path}'
bind-key c new-window -c '#{pane_current_path}'
```

Reload without restarting:

```sh
tmux source-file ~/.tmux.conf
```

Then check it works: split a pane with `C-space %`, move between the two with
`C-h` and `C-l`, and confirm the new pane opened in the same directory.

Once you have worktrees running, these are the workmux keys worth adding. They
only make sense with agents in several worktrees at once, so leave them until
then:

```tmux
bind-key -T prefix C-s display-popup -h 30 -w 100 -E "workmux dashboard"
bind-key -T prefix Tab run-shell "workmux last-agent"
bind-key -n M-j run-shell "workmux sidebar next"
bind-key -n M-k run-shell "workmux sidebar prev"
bind-key -n M-1 run-shell "workmux sidebar jump 1"
bind-key -n M-2 run-shell "workmux sidebar jump 2"
bind-key -n M-3 run-shell "workmux sidebar jump 3"
```

### Steps 2 onward

To be written.

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
