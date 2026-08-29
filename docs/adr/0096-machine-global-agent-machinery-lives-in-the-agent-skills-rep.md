# Machine-global agent machinery lives in the agent-skills repo, not vendored into a consumer

Recorded 2026-08-29.

The drain skill (`~/.agents/skills/drain/`, symlinked to `~/.claude/skills/drain/`) is a
`git`-tracked file inside `~/.agents/skills`, which is a real, remote-backed clone of
`github.com/collod873/agent-skills` — not the untracked pair of files [#221](https://github.com/collod873/claude-workflow/issues/221)
found. `#220` still closed on an empty `c531deb..c531deb` range, because its fix reached the
working tree without ever being committed: nothing about a plain file at that path forced the
edit through git. That gap, not an absent repository, is what this rules on.

The installed files (`drain/SKILL.md`, `drain/WORKER-PROMPT.md`) are now symlinks to
`drain/src/SKILL.md` and `drain/src/WORKER-PROMPT.md` in the same already-versioned repo. The
runtime reads a pointer, never a plain file, so there is no path left where an editor's in-place
write can land outside git the way #220's did.

## Considered options

- **Vendor into this repository (`claude-workflow`) and symlink the installed location to it.**
  Rejected: `/drain`'s own Land step deliberately leaves the shared checkout's local default
  branch behind `origin/default` after every landing (nobody fast-forwards a tree someone else has
  checked out for them). A symlink into that checkout would go stale on every single landed batch
  until someone remembered to pull it — the exact grooming this project's C4 rules out — and until
  then the runtime would silently read last-landed content, not current.
- **Make `~/.agents/` a repository of its own.** Moot: `~/.agents/skills` already is one, with
  history back past #220. The real gap was narrower than "no version control" — it was an
  uncommitted edit sitting on top of a repo that already existed.
- **Snapshot the skill into `claude-workflow` on change.** Rejected outright, per #221: a copy
  nobody runs is exactly the second copy this ruling exists to prevent.

## Consequences

`close-ticket`'s empty-range case (`<sha>..<sha>`) is technically honest and still unreadable
without a hand-written comment, as #220 needed. That is a `close-ticket` behavior, not a version-
control gap, and is not changed here.
