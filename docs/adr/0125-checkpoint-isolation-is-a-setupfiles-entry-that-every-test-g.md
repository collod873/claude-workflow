---
status: note
date: 2026-08-31
reversal: Going back to a per-test-file helper means restoring the export and its `beforeEach` call across eighteen test files and removing the `setupFiles` entry — and since `vitest.config.ts` is immutable to every pull request, that edit is the owner's to land by hand, as this one was.
---

# Checkpoint isolation is a setupFiles entry that every test gets, not a helper every test file remembers to call

Re-admitted 2026-08-31 as a **note**: this records an implementation note — how a tool or lane behaves, not a constraint
that binds later work.

The number and filename are kept unchanged because they are cited from issues and
permalinks that cannot be edited from this repo.
