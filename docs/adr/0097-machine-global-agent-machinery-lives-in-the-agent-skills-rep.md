---
status: constraint
date: 2026-08-29
reversal: Reversing means vendoring the drain skill's source into each machine that runs it, which reintroduces either a checkout `/drain`'s Land step deliberately leaves behind `origin/default` — so the runtime silently reads last-landed content — or a snapshot copy nobody runs.
---

# Machine-global agent machinery lives in one dedicated clone, symlinked, never vendored into a consumer

The drain skill's installed files are symlinks into a real remote-backed clone
`bin/link-workstation` maintains, rather than plain files or a copy vendored into a consumer
repository. The runtime reads a pointer, never a plain file, so an editor's in-place write cannot
land outside version control — how #220 closed on an empty `c531deb..c531deb` range, its fix
sitting uncommitted in a working tree.

**Amended 2026-09-09:** this machinery used to live in `collod873/agent-skills`; it has since
moved into `claude-workflow` itself, and agent-skills carries none of it. The ruling — symlink to
a real clone, never a vendored copy — is unchanged; only the repo cloned moved.

**Rejected:** vendoring into a consumer and symlinking to that — `/drain`'s Land step leaves the
shared checkout behind `origin/default`, so the runtime reads last-landed content until someone
pulls.

**Accepted cost.** `close-ticket`'s empty-range case stays unreadable without a hand-written
comment; that is a `close-ticket` behaviour, unfixed here.
