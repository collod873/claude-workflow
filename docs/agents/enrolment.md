# Enrolment

Enrolment is a repository topic, not a command. Tag a repository with the topic
`claude-workflow-enrolled` and the next enrol pass — a push to this repository's `main` that
changes the stub set, or a `workflow_dispatch` run — brings it up to date. There is no `bin/install`
([ADR-0133](../adr/0133-enrolment-is-a-repository-topic-and-an-enrol-lane-writes-stu.md)): a command
has to be remembered per repository and per lane change, and the topic-driven pass does not.

`.github/workflows/enrol.yml` is the one lane with no caller stub of its own — every enrolled
repository runs the lanes this machine ships, and none of them enrols anyone else — and it is the
only place the fine-grained `ENROL_PAT` is referenced. `GET /search/repositories?q=topic:…` is the
whole enumeration; no file on either side names a target repository.

## What an enrolled repository receives

Four writes, in the same pass, under the same `ENROL_PAT`, each derived from this repository's own
state rather than enumerated anywhere:

1. **The caller stubs.** Every `*-caller.yml` under this repository's `.github/workflows` — a
   trigger and a `uses:` pointing at the matching reusable workflow, six lines, naming no
   credential of its own. A caller carries no secret because this repository is public and
   `actions/checkout` reads it anonymously
   ([ADR-0132](../adr/0132-a-caller-checks-out-the-machine-with-no-credential-at-all-be.md)). Stub
   writes and deletes for one repository land as a single commit, so a first enrolment does not
   spend one CI run per file.

2. **This repository's own label set.** Read live from this repository's labels — name, color,
   description — and created or corrected on the target to match. A label the target already
   carries under a different name is left alone; GitHub seeds every new repository with a stock
   set, and deleting it is not this lane's business. Nothing here is a hard-coded list: the
   vocabulary is prose in `docs/agents/pipeline-labels.md` and `docs/agents/issue-tracker.md`,
   describing labels that already exist on this repository, and a second copy in code would be
   exactly the enumerated manifest that
   [ADR-0057](../adr/0057-the-installer-derives-every-list-it-acts-on-and-overwrites-o.md) rejected.

3. **The ADR-0093 repository setting.** `PUT /repos/{owner}/{repo}/actions/permissions/workflow`
   with `can_approve_pull_request_reviews: true`, read back and verified rather than trusted, because
   [ADR-0093](../adr/0093-a-lane-that-opens-a-pull-request-depends-on-a-repository-set.md) exists
   precisely because this setting is not recorded in any file and is off on every new repository.
   Without it, a lane that opens a pull request fails with *GitHub Actions is not permitted to
   create or approve pull requests* on a repository whose every `permissions:` block is otherwise
   correct.

4. **The secrets the lanes spend.** Derived by scanning this repository's own workflow files for
   `secrets.<NAME>` references, minus `GITHUB_TOKEN` (ambient in every repository already) and minus
   `ENROL_PAT` itself (the credential this lane reaches outward on, which no enrolled repository may
   hold). Today that derivation yields `CLAUDE_CODE_OAUTH_TOKEN` and `KNOWLEDGE_BASE_DEPLOY_KEY`; a
   lane that starts spending a third secret is picked up on the next push with nothing in the enrol
   lane's own source edited — only `enrol.yml`'s `env:` needs the new name, because GitHub Actions has
   no API letting a job read a secret's value without being handed it by name first. A secret's value
   cannot be read back once written, so this write is unconditional: it lands on every pass, and the
   report says written, never changed.

## What an enrolled repository owes its own test runner

Nothing from the target's own CI reaches a contract slot. The machine's Verify runs
`.claude/contract.json`'s `test` command from `bin/gauntlet`, not from the target's `ci.yml`, so an
`env:` declared there — a worker width, say — is absent on every run the machine makes. A test
runner sized by a constant in its config runs that wide on a two-core runner; Lumaria's ran twelve
workers there and manufactured two timeouts out of contention (#333, #343).

What the gauntlet does say is the box: every slot runs with `GAUNTLET_CORES` set to the core
count the gauntlet itself scheduled by ([ADR-0140](../adr/0140-a-venue-s-budget-is-its-own-last-green-time-plus-a-margin-ne.md)).
A target maps that to its runner's width in its own config — as a fallback before any constant,
after any override its own CI sets — and the number is then true wherever the suite runs. The
machine never sets a tool's own variable: a slot is a command the contract names, never a tool the
machine knows ([ADR-0056](../adr/0056-bin-gauntlet-runs-the-check-contract-instead-of-three-hardco.md)).

## Failure isolation

Each of the four writes is attempted independently, per repository. A repository whose label sync
fails is still worth the ADR-0093 setting and the secrets; a repository with no commit yet to build a
stub commit on is still worth all three of the others, since none of them touches git history. A
failure anywhere is reported against that repository and the pass continues over the rest of the
topic — but the run still exits non-zero, because the estate is now inconsistent on that one axis and
the run's own conclusion is the only thing that can say so.

## Enrolling a new repository

`gh repo edit <owner>/<repo> --add-topic claude-workflow-enrolled`, then dispatch `enrol.yml` by hand
for that first pass — adding the topic is an event on the target repository, which this machine has
no way to see, so the very first enrolment of a newly-topicked repository is not automatic.

## A red run in an enrolled repository

An enrolled repository runs lanes it does not own and may not edit in place
([ADR-0009](../adr/0009-the-machine-may-file-defects-against-itself-but-never-featur.md)), so a red
run there has two possible authors and only the run itself can tell them apart.
[ADR-0135](../adr/0135-a-red-run-in-a-caller-is-routed-by-its-failing-path-the-mach.md) makes the
failing path the answer: every reusable lane here checks the machine out at the workspace root and
the calling repository's own tree at `target/`
([`shared/checkout-pair.fixture.ts`](../../.Workflow/agent-workflows/shared/checkout-pair.fixture.ts)),
so a failing step whose log names a path inside the machine checkout is this repository's own
defect, and a failing path inside `target/` is the caller's.

`.github/workflows/walk-home.yml` is what acts on that routing. Like `enrol.yml`, it is the other
lane with no caller stub — it runs only here, walking every repository the enrolment topic
enumerates on the `session-captured` dispatch, reading each failed run's failing step and routing by
path: a machine-side failure files a ticket-shaped issue **here**, labelled `to-build` so lane 09's
next recompute starts an implementer against it without the spec chain, carrying the machine SHA,
the run URL and the log tail; a caller-side failure files into that repository's own tracker
instead. [ADR-0136](../adr/0136-a-caller-s-red-run-is-swept-from-here-under-enrol-pat-never.md)
settles who does the filing — this lane runs here, under `ENROL_PAT`, the same credential `enrol.yml`
already sends to every enrolled repository, rather than shipping a second outward-reaching secret
that would let a compromised caller file against the machine every other one runs.

The sweep stores no cursor and no ledger: whether a run has already been walked home is derived from
the marker on its own filed issue, so a second sweep over unchanged state writes nothing. A failure
against one enrolled repository is reported and the sweep continues over the rest, but the run still
exits non-zero.
