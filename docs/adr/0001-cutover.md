---
status: constraint
date: 2026-10-07
reversal: Every stage would live twice again, once here and once for enrolled repos, and each machine fix would have to land in both.
---

# This repo reaches the machine through its caller file, like every enrolled repo

The machine's stages live once, in `tickets.yml` and `specs.yml`. This repo reaches
them through `.github/workflows/machine.yml`, the caller file exactly as `bin/enrol`
writes it, and a stage run with no caller file goes through that same file name. A
machine fix lands once and reaches every repo, this one included. A test holds the
line: it fails when any other workflow here hears an event a job of `tickets.yml` or
`specs.yml` hears.

New stage behaviour goes into the reusable workflows. When this repo needs something
the reusable path lacks, close that gap on the path, for every repo at once.

**Rejected: this repo keeping its own stage workflows.** About 1,000 lines lived
twice, fixes drifted between the copies, and a retry fix landed in only one of them.
