---
status: superseded
date: 2026-08-26
superseded_by: ADR-0132
reversal: Reversing it means vendoring ~140 TypeScript files and a Node toolchain into every target repo and standing up a sync contract to keep each copy level with this one — the `UPSTREAM.md` obligation this design exists to delete — and any repo already calling the workflows keeps running whatever version it last resolved.
---

# A lane ships as a reusable workflow and a second repo carries a stub that tracks main

A second repo does not get a copy of the machine. Each lane is published here as a reusable workflow and the target carries a caller stub — a trigger and a `uses:`, six lines with nothing in them, so it cannot drift. Stubs name `@main`, never a pinned tag: a stale pin fails silently where `@main` fails red. The lane's code stays here, so a caller checks it out with one read-only fine-grained PAT, bound by the rule that no credential is referenced by a job a pull request can trigger.

**Rejected:** vendoring 140 TypeScript files and a Node toolchain into each repo — `UPSTREAM.md` rebuilt, and five of nine surveyed repos have no Node; publishing the lanes as a package, the fallback if the PAT dies; making this repo public.

**Accepted cost.** This repo becomes the estate's single point of failure.
