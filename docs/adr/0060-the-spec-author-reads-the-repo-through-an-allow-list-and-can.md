---
status: constraint
date: 2026-08-26
reversal: Widening it touches `--allowedTools` in `spec.ts` and `shared/stage.ts` and retires the acceptance tests written against it, and the failure it prevents is silent rather than loud: an author that reaches a second source of intent writes a plausible spec whose premises nobody can trace.
---

# The spec author reads the repo through an allow list and cannot reach a second source of intent

The cloud spec author runs with `--allowedTools Read,Grep,Glob` and nothing else. It may read the repository without limit; it has no Bash, no web, no issue search and no subagent spawner, so the only intent it can see is the Decided context its collector assembled. The bound is on reaching a **second source of intent** — another repo's issues, an unrelated idea, someone else's spec — not on reading code, because an author that cannot read what it specifies against writes a spec nobody can build. An allow list, not a deny list: a deny list names tools, so a tool the CLI gains tomorrow is silently reachable, which is fail-open. `--allowedTools` is the flag to prefer from here.

**Rejected:** prepared context and no tools, as lane 01's shaper has — it produces an unbuildable spec; a deny list; bounding the output instead of the reach.
