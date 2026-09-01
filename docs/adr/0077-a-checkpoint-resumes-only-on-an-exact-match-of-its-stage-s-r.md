---
status: note
date: 2026-08-27
reversal: Changing the resume key means reworking the hash in `shared/stage.ts` and its test; every checkpoint written under the old key simply misses and its stage re-runs, which is the behaviour the ruling already defaults to.
---

# A checkpoint resumes only on an exact match of its stage's resolved prompt and the run's commit, so every other re-run starts clean

Re-admitted 2026-08-31 as a **note**: this records an implementation note — how a tool or lane behaves, not a constraint
that binds later work.

The number and filename are kept unchanged because they are cited from issues and
permalinks that cannot be edited from this repo.
