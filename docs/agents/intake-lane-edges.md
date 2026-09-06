# The intake lane, edge by edge

Lane 00, followed end to end. Every **node** is something that executes; every **edge** is the
payload travelling between two nodes — what it is, and who is allowed to have read it.

Lane 00 has no `.github/workflows/*.yml` and no `.ts` state machine the way every other lane does —
nothing fires on an issue being opened at all. Its whole machine is two GitHub-native issue-form
definitions, [`idea.yml`](../../.github/ISSUE_TEMPLATE/idea.yml) and
[`bug.yml`](../../.github/ISSUE_TEMPLATE/bug.yml), plus the template chooser's own
[`config.yml`](../../.github/ISSUE_TEMPLATE/config.yml). GitHub's own hosted platform renders them,
validates the one required field each carries, and applies their labels; none of that is code this
repository ships or runs. What this repo owns is the *shape* of those files, pinned by a test suite
— [`.Workflow/agent-workflows/intake/intake.test.ts`](../../.Workflow/agent-workflows/intake/intake.test.ts),
reading the templates back off disk through
[`issue-forms.fixture.ts`](../../.Workflow/agent-workflows/intake/issue-forms.fixture.ts) — rather
than a stage doing anything with them at run time. `.Workflow/agent-workflows/capture/` (session
transcripts landing in the Knowledge Base, and the `session-captured` dispatch that wakes lane 04's
recompute) turned up in the same tree while researching this lane; it shares no code, no label and
no event with intake and is not part of it.
[ADR-0070](../adr/0070-lane-00-s-door-is-distinguished-by-where-the-owner-is-rather.md) is the design
note behind the two-door split: which door the owner reaches for is decided by *where he is* when the
thought occurs — away from a terminal, filing from a browser or a phone — not by how much context he
happens to be holding. The ADR itself is thin: re-admitted as a `note` (a change record, not a
constraint binding later work), its own text says only that it moved one sentence in `DESIGN.md`'s
door table and built nothing — and `DESIGN.md` no longer exists in this tree at all (deleted in
`a2643a2`, "Delete DESIGN.md so the machine answers to the tracker and the code"). The title is
doing the real work here; the body is a formality.

The worked example this file starts: **issue #412**, filed through the idea door in the owner's own
words, arrives with the `idea` label and nothing else — no sheet, no rulings, no route. Lane 01
(`shape.yml`, [`shape-lane-edges.md`](shape-lane-edges.md)) is what turns it into the decision sheet
that [`spec-lane-edges.md`](spec-lane-edges.md)'s own worked example later reads as an accepted idea
labelled `to-spec`.

Legend: **[stop]** can refuse and end the run. Nothing in this lane is `[model]` — it spends no
model call — or `[wire]` in the sense the rest of this pipeline means it: there is no TypeScript or
shell of this repo's own running here, only GitHub's own form engine and, at Node 02, a human's own
hands on `gh`.

---

## Node 00 — the two doors · [stop]

`.github/ISSUE_TEMPLATE/idea.yml` · `.github/ISSUE_TEMPLATE/bug.yml`

Two single-question issue forms. GitHub's own hosted UI renders each as a form, not a template a
person edits by hand, and stores whatever comes back as the issue body — nothing in this repository
executes when either is submitted.

| | |
|---|---|
| **Door 1 — idea** | `idea.yml`: title prefilled `Idea: `, one required textarea (`id: idea`, label "What's the idea?"), label `idea` applied at creation |
| **Door 2 — bug** | `bug.yml`: title prefilled `Bug: `, one required textarea (`id: bug`, label "What broke?"), label `bug` applied at creation |
| **Which door decides** | The owner's own read of himself, never checked afterward: an **Idea** is "an opinion about what would be better," a **Defect** is "a report of something that broke" — tense, not size (`CONTEXT.md`). Whichever form he opens is the one that wins |
| **Refuses when** | The one textarea is submitted empty — GitHub's own client-side required-field check, before an issue exists at all. Nothing in this tree ever sees this refusal; it never reaches a log a run of this pipeline could read |
| **Who can use them** | Anyone with a browser — the repo is public, same door lane 02 has to gate by `sender.login` because anyone can reach it. Lane 00 gates nobody, because nothing here is a workflow a `sender` field could restrict |
| **Neither field is prefilled with anything but the title** | `attributes.value` is unset on both textareas (`intake.test.ts`'s own assertion) — the box is empty until the owner types into it |

### edge — the issue GitHub creates

```
title:  Idea: The nightly canary should say what it did
labels: [idea]
body:
### What's the idea?

The nightly canary has been dead for eleven days and I found out
by accident, because I happened to open the Actions tab.

I don't want an alerting stack. I want the run itself to say what
it did, in the place I already look.

I'll know it works when I can open the last nightly run and read
its own summary without clicking into a job.

→ https://github.com/collod873/claude-workflow/issues/412
```

The `### What's the idea?` line is GitHub's own synthesis of the form field's `label:`, not
something the owner typed, and nothing strips it back out: `issueBody()`
(`.Workflow/agent-workflows/shared/issue-body.ts`), the one function every later `ownerWords` comes
through, returns whatever `gh issue view --json body` reports, heading included.
[`spec-lane-edges.md`](spec-lane-edges.md)'s own worked example quotes the three paragraphs alone —
a simplification for readability, not evidence the heading isn't really there.

---

## Node 01 — the blank door

`.github/ISSUE_TEMPLATE/config.yml`

`blank_issues_enabled: true` leaves GitHub's stock "Open a blank issue" option live in the chooser
alongside the two forms above — a third way in, carrying no template, no required field, and no
label. No tag applies: nothing executes here beyond GitHub rendering a chooser page, and
`intake.test.ts` pins only that this stays `true`, never what happens after.

An issue filed this way carries none of `pipeline-labels.md`'s four canonical labels and no
`## Acceptance criteria`, which by that doc's own rule is a real, if empty, position: **not yet
judged** — sitting exactly where a hand-typed `gh issue create` would leave it, until whichever
session next reads the tracker runs `~/bin/file-issue ticketify` or applies a label by hand.

---

## Node 02 — the second hand: a bug filed from inside a session

[ADR-0009](../adr/0009-the-machine-may-file-defects-against-itself-but-never-featur.md)

No tag: this is a human action wearing a machine's name, not a wire step, and nothing in the tree
runs it. ADR-0009 states the convention plainly — a run that hits a defect in the machinery "files
it as a `bug` at lane 00," always in **this** repo, whichever repo the run was dispatched into — but
names no tool that does the filing.

| | |
|---|---|
| **The tooling that would enforce it** | None. `~/bin/file-issue`'s `KIND_LABELS` knows `note`, `question`, `ticket`, `spec` — no `bug`. A session types `gh issue create --title "Bug: …" --label bug …` by hand, matching `bug.yml`'s shape on faith, not on a validator the way `file-issue`'s other kinds are checked (`bin/ticket_shape.py`) |
| **Why `bug` needs no seeding** | It is one of GitHub's own stock labels, present on every repository by default — unlike `ticket` and `prd`, which `file-issue` creates on demand the first time either kind is filed |
| **The one automated filer that comes close, and doesn't take this door** | `watchdog/walk-home.ts` (ADR-0135, ADR-0136) attributes a red CI run to this repo or the caller's and machine-defects it here, exactly as ADR-0009 asks — but it never applies `bug` and never enters lane 00 at all. It files straight to `to-build` or `needs-human`, already ticket-shaped (`## Acceptance criteria`, `## Files claimed`), skipping the idea/bug door entirely |

---

## What each stage may touch

| Node | Runs where | Who can trigger it | Sees the owner's words | Writes to the tracker |
|---|---|---|---|---|
| 00 — the two doors | GitHub's own hosted UI | anyone with a browser (repo is public) | is the owner's words | creates the issue, applies `idea` or `bug` |
| 01 — the blank door | GitHub's own hosted UI | anyone with a browser | whatever the filer wrote | creates the issue, no label |
| 02 — hand-filed bug | wherever the session already is | whoever is driving that session | restates it into `gh` argv, doesn't read it back | creates the issue, applies `bug` by hand |

---

## Where it stops

| Cost | Where | Fires when |
|---|---|---|
| free | Node 00's required-field check | The idea/bug textarea is submitted empty — GitHub's own validation, before an issue exists to fail anything against |
| free | nowhere else | Lane 00 checks no sender, no shape, no label existence. `idea` and `bug` are both assumed to already exist on the repo — see *Two things worth knowing* |

Every other refusal a work item can hit — `shape-refused`, `needs-human`, a malformed spec, an
immutable-set claim — belongs to a lane downstream of this one.

---

## Two things worth knowing

**`idea` is a label nothing here seeds.** `bug` comes free with the platform, and `ticket`/`prd` are
created on demand by `file-issue`'s `CREATED_LABELS`. `idea` has no equivalent anywhere in this
tree: GitHub's own issue-form docs say a listed label that doesn't already exist on the repo is
silently **not applied** — the form still submits, the issue still gets filed, it just comes out
with no label at all. If `idea` were ever deleted from the live repo, every idea filed after that
would land unlabelled and lane 01's `shape.yml` (`if: … label.name == 'idea'`) would never wake for
it — a stall with no error anywhere, on the label the entire pipeline's front door depends on.

**"Verbatim" has a comma in it.** `idea.yml` and `bug.yml` both promise "your words, stored as
written," and `CONTEXT.md`'s Idea entry calls it "the owner's own words... never edited afterward."
Both are true of the prose. Neither is true of the whole body: GitHub's own rendering prepends the
field's `label:` text as a heading the owner never typed, and it rides along everywhere `ownerWords`
travels, because `issueBody()` returns the body exactly as stored, unstripped.

---

## Loose ends in the tree

- ADR-0009 describes a filing convention with no code path behind it anywhere in this tree — see
  Node 02. The one automated filer that attributes a defect to this repo (`walk-home.ts`) never
  takes the door ADR-0009 names.
- `readIssueWriterCandidates()` (`intake.test.ts`'s own fixture) walks `.github/workflows`,
  `.Workflow/agent-workflows`, `.claude/hooks` and `bin` for anything that might edit an issue's
  body — but not `.github/actions/`, where `running-label`'s composite action also calls
  `gh issue edit`. It doesn't currently touch `--body` (only `--add-label`/`--remove-label`), so
  nothing is wrong today, but the guarantee "nothing downstream edits the owner's words" is not
  actually checked against that directory.
- The same test's `ISSUE_EDIT` regex slices the call text up to the first `"\n"` or `"])"` to look
  for a `--body` flag on the same statement. A `gh issue edit` argv array that wraps its `--body`
  entry onto a following line would end that slice before reaching it, and would not be caught —
  a latent gap in the check's own reach, not a call known to exploit it.
- `config.yml`'s blank-issue door (Node 01) is pinned open by `intake.test.ts` but described nowhere
  beyond `pipeline-labels.md`'s generic "not yet judged" — there is no doc naming what, if anything,
  is expected to happen to an issue filed through it.
