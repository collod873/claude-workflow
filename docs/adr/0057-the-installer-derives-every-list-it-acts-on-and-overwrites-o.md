---
status: superseded
date: 2026-08-26
superseded_by: ADR-0133
reversal: Reversing it means an installer that enumerates rather than derives — the drift obligation back in executable form, in a file nobody audits because it looks like code — plus a merge policy for owned paths, and any repo already installed under the overwrite contract may hold hand edits a merge model cannot reconstruct.
---

# The installer derives every list it acts on and overwrites only what it generated

Installing the pipeline into a second repo is one command, and it **derives** every list it acts on from the state of this repo and the target — stubs by globbing this repo's reusable workflows, copies from one marked directory, the check contract by probing the target — never from a list written inside the script. A script that enumerates what to copy is a manifest with a shebang on it: add a lane, forget the script, and it installs an incomplete system in silence. It owns a set of paths, overwrites them unconditionally, never merges, and reports what it changed; `.claude/settings.json` is owned by entry rather than whole. It refuses everything already distributed by a working mechanism, and this repo's own record.

**Accepted cost.** A hand edit to an owned path is unsupported, and re-running is the whole update path — no version, no migration.
