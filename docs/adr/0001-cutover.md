# 0001: This repo reaches the machine through its own caller file

## Context

Until #1220 the machine kept every stage twice: this repo ran its own Build, Fix, Close, Closed,
Slice, Reslice, Research, Done check and Rerun workflows, while every enrolled repo reached
`tickets.yml` and `specs.yml` through one caller file. About 1,000 lines were kept twice, and a fix
to one copy had to be made again in the other or the two drifted: #1206 and #1208 each patched both,
and #1213's retry of specs left marked `asked` landed only in the Done check workflow. The owner
approved moving this repo onto the reusable path once the Lumaria pilot ran start to finish.

## Decision

**Gaps first.** The gaps closed in wave 1: a caller file in this repo counts as home, every run under
a caller file is named for its issue, and the done check starts a size trial through the caller file.
The cutover was wave 2 on its own, one PR: it adds `.github/workflows/machine.yml` exactly as
`bin/enrol` writes it, under the same name, hearing `Check` in place of `CI`, and deletes the nine
stage workflows, their tests moved onto `tickets.yml` and `specs.yml` and their part rows dropped.
The #1213 retry moved into `specs.yml` so this repo keeps it. The caller lands on main in that one
merge, so the closer can dispatch it from the first ticket built after it. The check workflow and
the mark probe stay. A test fails if any other workflow here hears an issue, PR or check event a job
of `tickets.yml` or `specs.yml` hears, or if stage code names a workflow file this repo does not hold.

**No caller, same file.** With the stage workflows gone, a stage run with no caller file, as a run by
hand, reaches the machine through the caller file name `bin/enrol` writes, never a deleted workflow:
`CALLER_FILE` in the post module falls back to it. The closer wakes a builder by dispatching that
file, the done check's size trial starts through it as under Trial through the caller, and the closer
no longer dispatches the re-slice for a ticket it closes, since the caller's own `issues: closed`
starts it. Every other difference between no caller file and a home caller file stays as Home says.

**One checkout.** In this repo the machine's checkout and the target checkout under the job's `tree`
directory are two clones of this repo at main. The reusable path already keeps them apart: the
machine's `bin` runs from the job's workspace and every stage works in the tree, so a build edits and
pushes the tree while the machine it runs stays at main as the job checked it out. Nothing changes
for this beyond Home; the cutover's first runs prove it.

## Consequences

Every machine run here goes through the same path as every enrolled repo, so a machine fix lands
once. Behaviours of the reusable path that differ from the deleted workflows, such as the closer's
close now being heard, apply here too; changing what a stage does was out of scope for the cutover.
