---
status: constraint
date: 2026-08-29
reversal: Reversing means moving the drain skill's source into a consumer repository and repointing the installed symlinks, which reintroduces either a checkout `/drain`'s Land step deliberately leaves behind `origin/default` — so the runtime silently reads last-landed content — or a snapshot copy nobody runs; the same rule is stated machine-wide in agent-skills' own CLAUDE.md.
---

# Machine-global agent machinery lives in the agent-skills repo, not vendored into a consumer

The drain skill's installed files are symlinks to sources inside `~/.agents/skills`, a real remote-backed clone of `collod873/agent-skills`, rather than plain files or a copy vendored into a consumer repository. The runtime reads a pointer, never a plain file, so there is no path where an editor's in-place write lands outside version control — which is how #220 closed on an empty `c531deb..c531deb` range with its fix sitting uncommitted in a working tree.

**Rejected:** vendoring into `claude-workflow` and symlinking to it — `/drain`'s Land step deliberately leaves the shared checkout behind `origin/default`, so the runtime would read last-landed content until someone pulled; snapshotting the skill into this repo on change, which is exactly the second copy nobody runs.

**Accepted cost.** `close-ticket`'s empty-range case stays honest and unreadable without a hand-written comment; that is a `close-ticket` behaviour and is not fixed here.
