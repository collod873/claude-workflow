---
name: standards-pass
description: Opens one issue (and writes nothing else), routing every recurring smell in the batch landed since the last pass to a drafted lint rule or a stated reason no rule can express it, citing the ADR or standard that already decides one where it exists, plus every `CODING_STANDARDS.md` entry a landed rule now mechanises to a proposed retirement. The issue is a ledger `/ratify` decides and the next pass reads, so declined candidates stay declined. Returns no verdict on any diff. Nothing dispatches it: run it, or `/standards`, when you want the standards of everything landed since the last pass written up (ADR-0029).
disable-model-invocation: true
---

# Standards pass

Reads everything landed on the default branch since the last pass through Fowler's twelve smells,
looking for shapes that **recur**, and opens **one issue** (its only write) routing each candidate
to a drafted lint rule, a stated reason no rule can express it, or, for a `CODING_STANDARDS.md`
entry a landed rule now mechanises, a proposed retirement. The tracker is the only thing
it changes: the working tree and branch are identical when it ends, and `CODING_STANDARDS.md` and
the lint config are edited by `/ratify`'s ratification, never by this pass. It returns no
verdict on any diff, and a clean pass is not evidence that any ticket may close; the why is in
[ADR-0003](../docs/adr/0003-the-standards-axis-is-batch-authorship.md); the ledger shape below is
ADR-0023.

## 1. Find the scope and read the ledger

List every prior pass: `gh issue list --label standards-pass --state all --json
number,state,createdAt,body --limit 100 --search "sort:created-desc"`.

**The newest issue is the boundary.** It recorded the commit its batch ended at under its own
`## Batch scope` heading; read that SHA back out.

**Every issue's `## Ratification` is memory.** Read each one. A candidate whose line says
`declined, <reason>` is re-proposed **only if its recurrence grew**: this batch shows a site that
the declined entry's site list did not name. Same slug, same sites: leave it out, it was already
judged. A candidate whose line says `ratified → <file>` is closed business; if the shape shows up
again, that is the lint rule or standard failing to catch it, which is a different finding.

**Close finished predecessors.** Any prior issue still open whose Ratification lines are all filled
(`ratified`, `declined`, or `superseded` on every candidate) is complete, `gh issue close <n>` it
now, before doing anything else. The maintainer may have already closed it by hand; this is the
backstop. A `ratified → <file>, via #n` line is filled only once #n is closed; the spec, not the
line, is what landed the work. A `deferred, needs-human: …` line is never filled; a predecessor
holding one stays open for `/ratify` or the maintainer.

**No predecessor found**: this is the first pass. Its default boundary is the repo's root commit
(`git rev-list --max-parents=0 HEAD`): with nothing read before, everything landed to date is in
scope.

Either way, the scope is commits on the **default branch**, `git log <boundary>..<default-branch>`,
never a feature or drain branch. "Landed" means merged behind the gate to the default branch;
work still on a branch hasn't landed yet and isn't this pass's to read. This is why the scope is
computed by querying the last pass issue rather than by asking what `/drain` just closed: a solo
`/implement` session lands commits with no drain run around it, and those must be read too.

## 2. Read the batch through the smell lens

Walk the commits in scope and read the diffs, not diff-by-diff but as one batch, looking for a
**recurring** shape. The lens is Fowler's twelve (*Refactoring*, ch. 3):

- **Mysterious Name**: a function, variable, or type whose name doesn't reveal what it does or holds.
- **Duplicated Code**: the same logic shape appears in more than one place.
- **Feature Envy**: a method that reaches into another object's data more than its own.
- **Data Clumps**: the same few fields or params keep travelling together.
- **Primitive Obsession**: a primitive or string standing in for a domain concept that deserves its own type.
- **Repeated Switches**: the same `switch`/`if`-cascade on the same type recurs.
- **Shotgun Surgery**: one logical change forces scattered edits across many files.
- **Divergent Change**: one file or module is edited for several unrelated reasons.
- **Speculative Generality**: abstraction, parameters, or hooks added for needs nothing in scope has.
- **Message Chains**: long `a.b().c().d()` navigation the caller shouldn't depend on.
- **Middle Man**: a class or function that mostly just delegates onward.
- **Refused Bequest**: a subclass or implementer that ignores or overrides most of what it inherits.

The lens is **evidence**, not the output. A smell spotted once in the batch is not a candidate; it
is what a per-diff review would already have caught, and this pass exists precisely because per-diff
review can't see recurrence. Only a shape that repeats across two or more commits, files, or
tickets in scope becomes a **candidate**. Every smell instance walked past on the way to one is
scratch work: the issue records candidates and their routing, never a per-commit inventory of
everywhere a smell showed up once.

Each candidate gets a **stable slug**, `<smell>/<short-name>` (e.g. `data-clumps/range-pair`,
`primitive-obsession/sha-string`). The slug is the key the next pass matches against prior
Ratification lines, so pick the name for the shape, not for where it happened to appear this time.

**A second source, outside the smell lens: retirement.** Walk `CODING_STANDARDS.md`'s own entries
against what has landed. An entry reaches **mechanised** (CONTEXT.md's term for a lint rule now
capturing its Red flag in full) the moment a rule doing exactly that sits in the lint config; the
doc's own header rule then calls for the entry's deletion, and that is a candidate too, no less than
a recurring smell. Slug it the same way, `retirement/<entry-short-name>`; it carries no site
list, since there is nothing recurring and the evidence is the entry plus the rule that now covers it, and
its routing is already decided by the check itself: retire, naming the covering rule (file, or lint
slug, and where it landed). A rule reaching only part of an entry's Red flag leaves it **prose**
(CONTEXT.md); that is not a candidate to propose at all, not even a declined one.

## 3. Route every candidate

Before drafting a routing, search this repo's own `docs/adr/`, `CODING_STANDARDS.md`, and
`CONTEXT.md` for the deciding record. The ADR index searched is the repo the pass runs in, never
another repo's: PWPP #357 cited this repo's ADR-0001 for a candidate PWPP never had. Where a
record already decides the candidate, cite it on the routing line instead of drafting fresh
judgement. A candidate an ADR already declines is not a candidate at all; leave it off the ledger
entirely; relitigating a settled ADR is not this pass's job.

For every candidate the record doesn't already decide, route it to exactly one of:

- **Draft the lint rule**: concrete enough that ratifying it means dropping it into the repo's lint
  config as-is (or naming the config key if you don't know the exact syntax the eventual tool wants).
- **State why no rule can express it**: the judgement a rule can't encode (naming quality, "does
  this abstraction pay for itself"), the kind of call `Mysterious Name` or `Speculative Generality`
  usually resolve to). Ratifying one of these is a `CODING_STANDARDS.md` entry.
- **Retire the entry**: only ever from the retirement check above, never from a smell: name the
  rule that now mechanises it.

A refactor routing is valid only when paired with the rule or standard that stops the recurrence:
routing to "just move the sites" with nothing to stop the third copy is not a routing.

A candidate written up with prose and neither a drafted rule, a stated reason, nor a cited record is
a **failed pass**; fix it before publishing, don't publish it as-is.

## 4. Publish the ledger

One issue, always, including a batch with no recurrences. Never a comment on an existing issue,
never a PR, never an edit to any file: a pass that finds nothing must still leave a landmark the
next pass can find, which is the entire reason the output is an issue.

Create the `standards-pass` label if the tracker doesn't have it yet (`gh label list`, then `gh
label create standards-pass --description "A standards-authorship pass, one per run" --color
5319e7` if absent). File it with `~/bin/file-issue note --title "<title>" --body-file <path>`,
the `note` kind carries no shape check and no label, since `standards-pass` isn't in
`file-issue`'s vocabulary, then `gh issue edit <n> --add-label standards-pass`. Body:

```markdown
## Batch scope

<default branch>, <boundary-sha (exclusive)>..<head-sha (inclusive)>. First pass: from the root
commit.

## Recurrences observed

### <smell>/<short-name>

<what the shape is, in a sentence>. Sites:

- <path>:<line> (<short-sha>)
- <path>:<line> (<short-sha>)

<one `###` entry per candidate, or the single word "None." if the batch was clean>

## Routing

<slug>: <the drafted lint rule, or the stated reason no rule can express it>

## Ratification

<slug>:
<one line per candidate, left blank for the maintainer, or "None." if the batch was clean>
```

The **site list is load-bearing**: it is what lets the next pass tell a declined candidate that
merely recurred from one whose recurrence *grew*. Name every site, not a sample. A retirement
candidate (step 2's second source) has none to name: write `Sites: none, retirement not a
recurrence.` in its place.

**Ratification is `/ratify`'s**, filled by editing the issue body; the maintainer only ever hand-edits
a `deferred` line. Each line takes one of:

- `<slug>: ratified → <file>`: the drafted rule went into the lint config, or the stated judgement
  became a `CODING_STANDARDS.md` entry; `<file>` is whichever it was, landed on the default branch.
- `<slug>: ratified → <file>, via #n`: the same verdict, ticketed instead of landed directly.
- `<slug>: declined, <reason>`: the candidate was judged not worth a rule or a standard. The
  reason is what keeps it from being re-proposed.
- `<slug>: superseded → <other-slug>`: a newer ledger's candidate subsumes this one.
- `<slug>: deferred, needs-human: <question> (rec: <answer>)`: one of `/ratify`'s named human
  triggers; the maintainer answers it.

No checkboxes: a checkbox delimits an acceptance criterion, and a Ratification line records a verdict.

**Closing.** A pass issue is closed when every Ratification line is filled; the maintainer closes
it by hand on filling the last one, and step 1 of the next pass closes any it finds complete. A
"None." pass has nothing to ratify, so the step that creates it closes it in the same breath:
`gh issue create ... | xargs gh issue close`, or close by number immediately after. Open pass issues
are therefore exactly the ones with something still awaiting the maintainer.

`<head-sha>` is this pass's own boundary for whoever runs the next one; read it back out in step 1.

This pass drafts; it never ratifies. Hand off to `/ratify`, run in the same fresh session, to decide
the ledger, or run `/standards`, which runs both this pass and `/ratify` in one invocation.
