# Finding what goes wrong: the space, the coverage, and the holes

Unprompted: no issue preceded this note

_Written 2026-08-21._

> **Status: mixed.** Source reads and volume measurements are real and cited. The
> classification of Lumaria's 42 findings is quoted from a prior session, not independently
> verified. Everything under "Architecture" and "Build order" is reasoned, not run.
>
> - Session: `6db8c40b-5112-4488-b0ab-e0e1851a4494`
> - Repos read: `~/.agents/skills`, `~/Claude Projects/Lumaria`

---

## The question we started with

Lumaria runs two things that look like they overlap: the `/standards` chain (this repo's
skills, seeded there) and a `decision-inbox` SessionEnd hook (local to Lumaria). Four weeks
of inbox data existed. The opening question was whether to merge them into the global skills
repo.

The question we ended on is different and better: **what is the complete space of things
worth finding in a repo, what carries the evidence for each, and where is nothing looking?**

---

## Part 1: What each system actually is

### The standards chain (this repo)

Four edges, invoked as `/standards`:

```
/standards-pass  → one ledger issue, its only write
/ratify          → decides every candidate, lands small edits, files one spec
/to-tickets      → slices the spec
/drain           → lands the tickets
```

Key properties, from the skill sources:

- **The ledger is the inbox.** One issue per pass, always, even a clean one, so a pass that
  finds nothing still leaves a landmark the next pass can find.
- **Scope is a SHA range**, computed from the last ledger's `## Batch scope`, never from what
  a drain just closed. Solo `/implement` work has always had to be swept with no drain around
  it.
- **Ratification is memory.** `declined, <reason>` is re-proposed only if recurrence *grew*
  The site list is what tells "recurred again" from "grew".
- **A candidate needs two or more sites.** CONTEXT.md: *"A smell seen once is not one."*
- **`/ratify` re-verifies against HEAD** and has a `Resolved → declined, resolved by <sha>`
  class. Nothing routed through it can go stale.
- **`/ratify` already runs autonomously.** ADR-0027 ("flagged, not deferred") ruled that five
  named sensitive shapes get decided on the verifier's recommendation and *reported after the
  fact*, never held before it.

### ADR-0029, recorded the same day as this session

The chain used to fire at the end of every `/drain`. ADR-0029 removed the trigger, with data:

| | Pipeline machinery | Capability | Machinery share |
|---|---|---|---|
| July 2026 | 161 | 94 | 63% |
| August 2026 | 334 | 72 | **82%** |

The 8/20 batch: 20 of 92 commits were `ratify <slug>` verdicts *against the hook harness that
exists to enforce the standards*. A chain that fires on every landing is guaranteed a supply
of its own output to read, and recurrence is what it is built to find in it.

The ADR explicitly **rejected a periodic cadence**: *"It is still work the maintainer did not
ask for, only less often; the defect being fixed is the unasked trigger, not its frequency."*

### The decision-inbox hook (Lumaria), read from source

`.claude/hooks/decision-capture.sh` + `decision-capture.mjs` + `lib/decision-capture-core.mjs`
+ `lib/decision-capture-prompt.md`.

| | |
|---|---|
| Event | `SessionEnd`, matcher `clear\|logout\|other` (deliberately not `prompt_input_exit`) |
| Dispatch | reads stdin sync, hands off to a fully detached, disowned Node process |
| Model | `claude -p --model sonnet`, `--tools ""`, `--setting-sources ""` |
| Transcript | flattened to `ROLE: text`, **tool calls and results already stripped** |
| Excerpt cap | `MAX_EXCERPT_CHARS = 150_000`, `.slice(-maxChars)`, keeping the **tail** |
| Skip filter | `shouldSkip` = no source file touched **AND** excerpt < 3,000 chars |
| Touched files | from `Edit\|Write\|MultiEdit` `tool_use` entries, not from git |
| Diff | **`git diff HEAD`, the working tree** |
| Cap | `MAX_BLOCKS = 5` |
| Output | appends to gitignored `docs/decision-inbox.md`, under a lock |
| Failure | fail open at every step |

Four lenses: VIOLATION (written rule broken, unenforced by any linter), PROPOSED (rule-worthy
decision not written down), COMPOSITION (pattern fit/shape miss), SEAM (layering conformance).
Every block cites `file:line`, is phrased as a question, and PROPOSED blocks end with a
**`Suggested CODING_STANDARDS.md line:`**.

**The engineering is good. The inputs are wrong.** Three defects:

1. **`git diff HEAD` is the working tree.** The prompt itself admits *"may be empty if the
   session committed everything"*, which is most `/implement` and `/drain` sessions. For
   committed work the auditor gets a transcript and **no diff**, and judges code it never saw.
   This is the `appointments.ts` false positive: it inferred a missing transaction from
   conversation alone.
2. **No commit anchor.** Entries carry a date and a session id. Nothing can rejoin a finding
   to a SHA, so nothing can re-verify it, so it goes stale by construction.
3. **The skip filter is inverted.** A long conversation that changed nothing still buys a
   model call, and those are exactly the sessions with no evidence available.

Plus: the tail-slice discards the *beginning* of a long session, which is where the decision
usually got made; and `touchedFiles` misses anything changed through Bash (`sed`, `git apply`,
a script).

---

## Part 2: What the four weeks of data actually said

The prior session's classification of 42 findings across 28 sessions:

| | count | share |
|---|---|---|
| Actually **wrong** | 1 | **2%** |
| Correct but **stale**, already fixed before it was read | ~18 | 43% |
| Correct, live, **valuable** | ~11 | 26% |
| Correct but **worthless**, a one-off proposed as a rule | ~12 | 29% |

**The "40% dead" number is a staleness measurement, not a quality one.** The auditor was
wrong once in 42, while reading an empty diff most of the time.

### Why it was stale: overlap, not neglect

`/standards-pass` reads `git log <boundary>..main`. The inbox reads the transcript. **They
sweep the same territory**, and the sweep is far faster:

- ADR 0051 landed 7/26; the hook wrote the finding at session end **the same day**. Stale
  before it hit disk.
- `availableParallelism()` landed 8/19, was reverted 8/19, and `/ratify` shipped the *opposite*
  rule on 8/20. The entry was **wrong within 24 hours** of being written.
- "Build ahead if discoverable": flagged 8/15, ratified 8/16.

Every `docs: ratify` commit on Lumaria's `CODING_STANDARDS.md` traces to a ledger: #602, #607,
#640, #682, #684, #701, #711, plus grill batches #616/#618.

**And roughly half of everything that closed, closed with nobody running anything.** ADRs
0051, 0055, 0056, 0057 came out of ordinary ticket work: someone hit the problem and fixed it
properly. The diff-producing territory is covered *twice*, and the faster of the two covers it
in about a day.

### The genuinely unique yield

Of the ~8 "worth ratifying", the prior session's own qualifier was *"mostly things a range
sweep would miss **or hasn't reached yet**."* Sorting them:

**Invisible to any sweep, because no diff exists:**
- The archetype-catalog finding (the agent arguing to wait for a second consumer), pure
  conversation, and a stance Collin's standards explicitly reject)
- Two agent-conduct gotchas (a deps commit landed on main off a local check)
- "Fail-closed hooks get owner review, never drain workers": process, not code

**Sweep-reachable, just ahead of an open ledger (#711):**
- `server/records/<entity>` as canonical shape
- Cross-slice references store a trusted id at write time
- Audit trails ride the domain event
- The consolidation-ownership rule, the warn-tier wording rule

**Real unique yield: roughly 3–4 findings across 28 sessions and four weeks**, all in one
class: things that were *said* and never became a diff.

---

## Part 3: Volume and cost, measured

From `~/.claude/projects` on 2026-08-21:

```
1,832 transcripts, 1.2 GB, 72 project dirs
  826 top-level sessions in 30 days   ≈ 28/day, bursting to 108 (8/15)
1,006 subagent transcripts             (drain workers, checkers, machinery)
median transcript   452 KB
p90                 1.5 MB
max                  52 MB   ← does not fit in any context window
cleanupPeriodDays: 30        ← hard horizon on any pass-time transcript read
```

Sampling 25 transcripts and measuring the **conversation spine** (user turns + assistant text,
no tool traffic):

```
raw                34.2 MB
user turns          233 KB    0.66%
assistant text      223 KB    0.64%
─────────────────────────────────────
spine               456 KB    1.30%     avg 18.2 KB/session
```

**98.7% of a transcript is tool traffic.** The spine is ~5k tokens and is flat regardless of
session size; the 52 MB session has a normal spine. Lumaria's hook already strips tool
traffic, so this confirms its approach rather than improving on it; the practical consequence
is that **per-session transcript reading is cheap enough that cost is not a design
constraint** (~$0.01–0.02/session, ~$13/month at 28/day, and it is plan-included headless
anyway).

The 30-day prune is why a **pass-time** transcript scan is unsafe: a pass run six weeks after
the last one silently loses the first two weeks and reports a clean sweep. Any transcript
signal must be captured at session time and stored durably.

---

## Part 4: The reframe, the space of findable things

Stop asking "which of the two tools is better." Ask **where the evidence lives**, because that
determines what mechanism can possibly see it. If no artifact carries it, nothing finds it.

| # | Evidence lives in | What it reveals | Covered today by |
|---|---|---|---|
| 1 | The tree at HEAD | syntax, types, banned shapes | `bin/lint`, tsc, eslint |
| 2 | A single diff | this change is wrong | the checker |
| 3 | Recurrence across diffs | this shape keeps happening | `/standards-pass` |
| 4 | The transcript | what was decided, argued, waived | decision-capture (badly) |
| 5 | The runtime | correctness, regressions | tests, CI |
| 6 | The tracker | promised vs. delivered | close-gate (structure only) |
| 7 | **Absence** | the thing that should exist and doesn't | **nothing** |
| 8 | **Drift over time** | this was true and stopped being | **nothing** |
| 9 | **Your behavior** | you corrected it, reverted it, asked twice | **nothing** |
| 10 | **Across repos** | this isn't a repo rule, it's a rule | **nothing** |

Rows 1–6 are covered, several of them twice. Rows 7–10 have no mechanism at all.

### The inversion

Every uncovered hole is **countable**:

- **Drift**: does each standard, rail, and hook ever actually fire? Counting.
- **Reverts**: `availableParallelism` landed and was deleted the same day. A same-day
  reversal is a *labeled failure sitting in git*. `git log`.
- **Absence**: only detectable by comparison: this slice has `records/`, that one doesn't.
  File-tree diff.
- **Cross-repo**: a slug appearing in two ledgers. String matching.

Meanwhile `/standards-pass` spends a model reading every diff through twelve smells, and
decision-capture spends a model on every transcript.

**The current system spends models on everything it already covers and counts nothing in the
places it doesn't.** The dreamboat is not more model passes.

### The uncomfortable counter

CONTEXT.md already states the principle, applied only to hooks:

> "Only **exposed stops** count toward a hook's record... A hook that cannot say whether a stop
> was exposed cannot be audited."

Nothing applies it to the checker, the gates, or the standards. **Nothing audits the
auditors.** `~/.claude/close-gate.log` already exists, so count the UNMET rate. If it is near
zero across hundreds of closes, the verification record is theater and everything built on top
of it is decorative.

---

## Part 5: Architecture

```
  EVIDENCE      normalize to observations anchored to a SHA / rail / entry
                git notes (refs/notes/standards), commit-keyed, own ref,
                zero working-tree contention, pushes and fetches independently
        │
  LENSES        ranked by cost; the free ones run always
        │
        ├─ free ──  rail fired?       standard exposed?    checker UNMET rate?
        │           revert detector   structural parity    cross-repo slugs
        │           recurrence counting
        │
        └─ model ── the transcript: what was decided or waived
                    (the only thing counting cannot reach)
        │
  LEDGER        the issue that already exists.
                recurrence → routing → verdicts → /ratify
```

Three properties the current setup lacks:

- **Free lenses can run on every push** without ADR-0029's problem: counting produces no
  commits and cannot feed itself.
- **Nothing goes stale**, because a count is recomputed, never stored as a claim.
- **The system shrinks itself.** Today a standards entry has one exit (mechanisation), which
  is rare, so growth is monotonic; Lumaria's went 194 → 225 *while the finding about its size
  aged in the inbox*. Exposure counting adds a second exit.

### The trigger

Not time, since bursty work makes a cadence meaningless. Not per-landing, since ADR-0029 measured what
that costs. **The second site.** A candidate comes into existence the moment a shape appears at
a second site; that is an event, it is the event the system is already built around, and it
self-paces to output with no clock in it.

### The autonomy line

Already written in CONTEXT.md, and it is the right line:

> **Mechanised**: a lint rule now captures the entry's full judgement.
> **Prose**: "enforced by nothing but a reviewer's judgement."

| | Proof available | Disposition |
|---|---|---|
| New lint rule, zero hits, suite green | CI | **auto-merge** |
| Retire an entry a rule now mechanises | the rule already passes | **auto-merge** |
| Rule + refactor to clear its hits | CI proves green, not *right* | PR, waits |
| A new prose standard | none possible, by definition | PR, waits |
| Anything in the flag-trigger set | n/a | PR, waits, labeled |

**Agent consensus is not proof.** Three agents agreeing is three samples from one distribution
with correlated errors: the `appointments.ts` false positive would survive any number of
verifiers, because they would all read the same empty diff. CI is a *different kind* of
evidence, not more of the same kind. It is the only thing that should earn an unattended merge.

### Overlap with in-flight work

The machinery writes to exactly two places: `refs/notes/standards` and PR branches. Neither
collides with a working tree. A rule that auto-merges has **zero hits on main**, so it cannot
break an in-flight branch unless that branch introduces the first violation, which is what
the rule exists to catch.

---

## Part 6: Ideas raised and where they landed

| Idea | Verdict |
|---|---|
| Have `/ratify` delete inbox entries it decides | **Rejected.** Patches the wrong layer: keeps two inboxes and makes one clean the other. |
| Transcript evidence as a third source into the ledger | **Kept, narrowed.** Only for what commits cannot show. |
| A second inbox file with its own drain command | **Rejected.** Lumaria proved an inbox with no consumer decays. |
| `Exposed when:` predicate on every standards entry | **Kept.** Turns "was this relevant" into a grep; gates spend; forces every entry to answer "what would falsify you?" at birth. |
| Retire a standard never exposed across K passes | **Kept**, with flag-trigger entries exempt (a rule governing auth is *supposed* to be silent). |
| Exclude the chain's own exhaust from pass scope | **Kept.** One filter breaks the self-feeding the 82% came from. |
| Record review status (checker-verified vs ad-hoc) per candidate site | **Kept.** All-ad-hoc sites mean "this wanted a checker", not "this wants a new rule". |
| Anchor observations to the session's SHA range | **Kept.** Fixes the empty-diff defect and the staleness defect with one change. |
| Delete the `Suggested CODING_STANDARDS.md line:` field | **Kept.** It is a verdict wearing a question mark; it manufactured 30 of the 42. |
| Capture Collin's *corrections* as the primary transcript signal | **Kept.** Densest available signal, free, and a human already did the judging. |
| Gate the model call on a correction heuristic | **Rejected.** Circular: detecting a correction *is* the judgment being paid for. CONTEXT.md's Router definition names this mistake. |
| Anchor observation on the **close** rather than the session | **Rejected.** Misses ad-hoc commit-and-move-on entirely; the commit is the anchor, and `/standards-pass` already knew that. |
| A per-commit close meter and a per-batch drain meter | **Rejected.** Redundant: git holds all of it durably and better. |
| SessionStart line showing pending-candidate counts | **Kept**, above a threshold only. Removes ADR-0029's accepted "debt accrues silently" cost without touching its trigger. |
| A PreToolUse router injecting *unratified* candidates at edit time | **Demoted.** Premise was that learn-to-apply latency is weeks; measured, it is 1–2 days for anything that lands as code. Only has value in the no-diff class. |
| Full transcript, gated | **Rejected.** 98.7% is tool traffic; the spine is 1.3% and flat. |
| Pass-time transcript scan instead of a hook | **Rejected.** 30-day prune makes a long-gap pass silently vacuous. |
| GitHub Actions as the engine, PR as the inbox, CI as the merge authority | **Kept as the end state**, but only worth building once the signal is proven. |
| Cross-repo recurrence → the seeded `coding-standards.md` | **Kept as the stretch.** Turns per-repo hygiene into a practice that compounds. |
| The four-channel lifecycle as a single big build | **Rejected.** Channels 1 and 3 already work; channel 2's diff-half is redundant with a faster reader. |

---

## Part 7: What is genuinely out of reach

Named so that "covers everything" has a boundary:

- A design that is internally coherent and wrong for the business
- A missing feature nobody asked for
- A first-of-its-kind slice: no comparison class, so absence is undetectable
- Intent never expressed in code, conversation, or a ticket

No mechanism reaches these. They need Collin, and always will.

---

## Part 8: Build order

Three free counters and one audit before any model work. Steps 1–4 cover three of the four
holes without a token spent.

1. **The auditor audit.** UNMET rate from `close-gate.log`; fire-vs-exposed rates from the hook
   logs. One afternoon. Either validates the apparatus or reveals the verification layer is
   decorative, which changes everything downstream.
2. **The revert detector.** `git log` for same-day add/delete and explicit reverts. Every hit
   is a failure already labeled by the person who reverted it.
3. **Exposure counting.** Add `Exposed when:` per standard, then count. Gives the doc its
   second exit.
4. **Structural parity.** Sibling-unit shape comparison. Covers absence.
5. **The transcript lens, narrowed to conduct only.** One model call, pointed exclusively at
   the blind spot: stances settled in conversation, rails waived, and Collin's corrections.
   Lenses VIOLATION / COMPOSITION / SEAM are dropped: all three read the diff, which
   `/standards-pass` does better and faster.
6. **Cross-repo slug matching.** Free once 1–5 emit structured slugs.

**Immediately, independent of all of the above:** patch Lumaria's `gitDiff` to use the
session's SHA range instead of `git diff HEAD`, and stamp the range into each entry. It is a
small change, it fixes the defect responsible for the one outright false positive, and it
starts the measurement clock on the only number that matters, whether the wrongness rate
stays near 2% once the auditor can see real code.

---

## Part 9: Corrections made during the session

Recorded because the corrections *are* the learning:

- **"40% dead" was mis-read as a quality number.** It is a staleness number. Actual wrongness
  was 1 in 42.
- **Staleness was mis-diagnosed as a consumer problem** ("nothing re-verified it"). The deeper
  cause is *overlap*: `/standards-pass` had already caught those findings, usually within a
  day. Routing the overlap into the ledger would route duplicates.
- **The spine insight was not new.** Lumaria's hook already strips tool traffic. The
  measurement stands; the framing that Lumaria fed whole transcripts was wrong.
- **The `appointments.ts` false positive was mis-explained** as "saw the diff, missed the
  parameter threading." It almost certainly saw *no* diff.
- **Anchoring observation on the close was wrong**: it misses untracked commit-and-move-on
  work, which `/standards-pass` step 1 already handles by anchoring on a SHA range.
- **The router's latency premise was wrong** for diff-producing work: 1–2 days, not weeks.
- **The session escalated into an elaborate multi-layer engine**: lifecycle, Actions, PR
  auto-merge, cross-repo, on top of a gap the evidence sizes at 3–4 findings a month. That is
  precisely the failure ADR-0029 measured, committed in a conversation about ADR-0029. The
  taxonomy in Part 4 is the recovery: it points at holes with *no* coverage rather than adding
  a third reader to territory already covered twice.

---

Moved from collod873/agent-skills on 2026-09-10 (claude-workflow#427), with the rest of the machine (#392). ADR numbers above refer to agent-skills' corpus, except ADR-0166 and ADR-0168, which are this repo's imports of that corpus's 0012 and 0026.
