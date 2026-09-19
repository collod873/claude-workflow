---
status: constraint
date: 2026-09-17
reversal: Going back means switching the old lanes on again in this repo, Lumaria and app-starter, and cutting a machine where additions outran removals about 20 to 1 with every shrink forced by the owner.
---

# The machine is rebuilt as a small core in its own folder of this repo, not cut down in place

Cuts in place kept sprawling: the single-ticket path shares 46 modules with other lanes
([#654](https://github.com/collod873/claude-workflow/issues/654), [#663](https://github.com/collod873/claude-workflow/issues/663)).
The core lives in its own folder, whole, reaching outside it for nothing, and a skill and a workflow
call one copy of each check. From its first commit it holds the charter: the general code guards,
plus tests for one-screen length, parts linking a real failure, no timers, no drop in test count,
and every charter rule naming an existing enforcer. It is built by hand until it merges one ticket
itself, then only through itself. Old lanes stay off meanwhile; session hooks keep running,
unchanged. Old parts move over only for a failure the core meets; the old folders are tagged and
deleted after 30 days with nothing ported.

**Rejected: a fresh repo, or cutting in place.** Two repos let skills and workflows drift before; every in-place simplification grew back.
