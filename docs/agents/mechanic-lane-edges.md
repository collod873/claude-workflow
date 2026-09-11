# The mechanic, edge by edge

Followed end to end. Every **node** is something that executes; every **edge** is the payload
travelling between two nodes — what it is, and who is allowed to have read it.

This is not a numbered lane. It is the third rung of the ladder the reconciler climbs on a ticket
whose runs keep dying ([reconcile-lane-edges.md](reconcile-lane-edges.md), the ladder): the
implementer died, fresh eyes died, and this is the model that gets the dead runs' own logs and the
whole tree instead of the ticket's fence. One reusable workflow,
[`.github/workflows/mechanic.yml`](../../.github/workflows/mechanic.yml) (caller stub
[`mechanic-caller.yml`](../../.github/workflows/mechanic-caller.yml)); state machine
[`mechanic/mechanic.ts`](../../.Workflow/agent-workflows/mechanic/mechanic.ts); prompt
[`mechanic/prompt.md`](../../.Workflow/agent-workflows/mechanic/prompt.md).

The worked example continues the other edge docs' thread: **ticket #421**, whose Implement run
died twice with the same signature.

Legend: **[model]** a model runs here and it costs money · **[wire]** deterministic TypeScript or
shell · **[stop]** can refuse and end the run.

---

## Node 00 — the one door · [stop]

`mechanic-caller.yml` · `repository_dispatch: [mechanic-wanted]`, `run-name: Mechanic #421`

| | |
|---|---|
| **Sent by** | the reconciler alone, `dispatchMechanicWanted()`, when a ticket's strike count is exactly two |
| **Concurrency** | `implement-421`, the same group as lane 05, so the mechanic and an implementer can never hold the ticket at once |
| **The run name** | carries the ticket number, which is how the reconciler reads this run as in flight while it lives and as a strike if it dies |

---

## Node 01 — claim the branch · [wire] [stop]

`claimImplementationBranch()` on `implement/issue-421`, the same claim lane 05 makes. A live claim
(a pull request, commits, or a fresh ref) ends the run as `already-claimed`; a stale one is taken
over.

---

## Node 02 — assemble the brief · [wire]

`assembleMechanicBrief()`

| Section | Read from |
|---|---|
| Ticket | `gh issue view --json title,body` |
| Ticket comments, oldest first | every comment, the strikes included |
| The dead runs' own logs | `gh run view <id> --log-failed` for every run a strike names, last 120 lines each |
| Where things are | the target checkout (every edit lands here) and the machine checkout (readable) |
| Fence | `CODING_STANDARDS.md`, `.claude/contract.json`, the immutable set; never skip a test |
| Coding standards | `CODING_STANDARDS.md` |

No seam manifest, no `## Files claimed` inlined, no nearby-by-path: the point of this rung is that
the fence the first two models worked inside is assumed to be where the cause is not.

---

## Node 03 — the mechanic · [model, opus-5] [stop]

`runStageSession(MECHANIC_PROMPT_PATH, …)`, `claude-opus-5`, brief on stdin, disallowed tools
`MECHANIC_DENIED_TOOLS`: every `git` write, every `gh` write and `gh api`, the web, the scheduler.
`Agent` stays allowed. The push gate then runs on the checkout twice before a red counts, and one
repair round resumes the same session, exactly lane 05's rung one.

### edge — `ImplementerReply` · the same schema as lane 05

`summary` leads with the cause found and its evidence; `declaredEdits` names every path outside the
ticket's claim with a reason.

---

## Node 04 — the fence, read off the diff · [wire] [stop]

| Refusal | Read from | What happens |
|---|---|---|
| `fence-refused` | `changedPaths()` against `MECHANIC_FENCE`, plus `gateGrowth()` | the paths go on the ticket, `needs-human`, the claim is released, exit 1 |
| `skip-refused` | `git diff` added lines matching `.skip(`, `.todo(`, `xit(`, `xdescribe(` | the same |

Either exit is a dead run, so the reconciler reads it as the ticket's third strike and posts the
decision. As in lane 05, the job's last step sends `run-ended` under `if: always()` so the
reconciler is actually woken: this run was bot-started, and GitHub starts nothing from a
bot-started run's `workflow_run: completed` ([reconcile-lane-edges.md](reconcile-lane-edges.md),
node 00).

---

## Node 05 — land it · [wire] [stop]

`landAnswer()`, the same landing as lane 05: rebased onto trunk, pushed with `--no-verify` since
the gate already ran, a pull request whose body is the summary, `implementation-opened` rung for
Verify. Commit subject `Mechanic #421`. A red gate after the repair round still lands and puts
`needs-human` and the gate's tail on the ticket, as lane 05 does.

---

## What it may touch

| | May | May not |
|---|---|---|
| Read | both checkouts, every run log a strike names, the tracker | the web |
| Edit | any file in the target checkout, the ticket's claim or not | `CODING_STANDARDS.md`, `.claude/contract.json`, `vitest.config.ts`, `.github/`, a `test.fails(` test beyond turning it on, any test's presence |
| Write | nothing; the wire commits, pushes, comments | version control, the tracker |

A fix that genuinely needs the fence moved ends in the summary, not the tree: the summary reaches
the owner on the pull request or, if the run died, in the decision the reconciler posts.
