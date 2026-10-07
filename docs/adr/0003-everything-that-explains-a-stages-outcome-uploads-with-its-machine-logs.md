---
status: constraint
date: 2026-10-07
reversal: A stage's outcome could be read only from what its job happened to print, and the owner's audits and the research stage would lose the evidence they read.
---

# Everything that explains a stage's outcome uploads with its machine logs

A stage runs on a runner that is wiped when its job ends, so what is not uploaded is
gone. Every job that runs a stage uploads its machine logs, red or green: the
transcript, each prompt the stage was handed, the check logs and the owner's hook
logs. A new stage, or one that starts writing something new that explains its
outcome, files it under the machine logs, never only in the runner's home or temp
folder.

The owner audits the machine from these uploads, and the research stage reads them
as its evidence, so a gap in them is a gap in both.

**Rejected: keeping only the transcript.** Builds could not show what a stage was
told, why a check went red, or whether a hook fired; settling whether Lumaria's
ui-guard ran meant piecing it together from indirect traces.
