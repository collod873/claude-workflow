# Clone gate

**A clone gate reports duplication across a repo's own source. What makes one trustworthy is not
which detector it runs — it is that a passing run cannot mean "I read nothing."**

This doc is the policy. The runner is per-repo and chosen by toolchain: a repo with a
`package.json` runs jscpd through its own npm script; a repo without one runs
`bin/clone-check`, the stdlib-only Python detector `setup-matt-pocock-skills` seeds. Either
satisfies the six rules below, or it is not a gate — it is a number nobody can act on.

## Why the rules are about coverage, not detection

Setup-time intelligence does not survive. A `format` list, a root list, an exclude list are all
correct the day they are written and wrong a few commits later, and the banner reads the same
either way — a gate that has gone blind prints a pass, not an error. That failure has now happened
twice in one repo under a green scan: a `format` naming only `ts`/`tsx` while the scanned roots had
filled with `.mjs`, and a hand-kept root list that never gained `bin/`. Both were somebody's
careful guess at setup time.

So the load-bearing rules are the ones that make the gate re-derive its own scope on every run and
refuse to guess. A seeder that guesses well once cannot substitute for them.

## The six rules

1. **Root-scanned by default.** The gate scans the whole repo from the root. Excluding a path is
   allowed and requires a stated reason, recorded next to the pattern — not in a commit message,
   not in someone's memory. A hand-kept list of directories to *include* is the shape that goes
   blind; there is no such list.

2. **Every language present is declared.** Each file surviving the path rules is either covered by
   the gate's `format` (the languages it reads) or named in an ignore list with a stated reason.
   The same rule as (1), one axis over: leaving code out of scope is allowed, doing it silently is
   not.

3. **The gate self-audits coverage on every run, and fails loud.** Before scanning, it buckets
   every file under the roots and refuses to run at all if a bucket is covered by neither rule (2)
   half. The message names each undeclared bucket, its file count, an example path, and both ways
   to resolve it. This is the rule that catches (1) and (2) going stale, and it is why a repo can
   trust the number: the alternative to a loud failure is a vacuous pass, and a vacuous pass is
   indistinguishable from a clean one.

   A **nested repository** is the one entry that is neither a file to scan nor a bucket to refuse.
   `git ls-files` reports another repo's checkout as its directory with a trailing slash — CI checks
   the private corpus repo into `knowledge-base/`, so the entry exists on the runner and in no local
   tree, which is how a refusal there survived every local run green. Its files belong to that
   repository's index, and scanning them here would report its duplication as this repo's. So it is
   skipped — and, because rule 3 is about the skip being *visible*, the run prints the directory it
   skipped. Read on punctuation alone that guard would be the vacuous pass again, so the entry has
   to actually carry a `.git`; a trailing slash over anything else still refuses.

4. **It prints how many files it actually scanned.** A count is what makes a vacuous pass visible
   to a human reading CI output, and what makes "the gate stopped seeing `bin/`" a reviewable
   one-line diff rather than an archaeology exercise.

5. **Absolute by default; a baseline must ratchet to empty.** A new gate ships with no baseline,
   no grandfather list and no warn tier. A repo turning one on over existing debt may carry a
   baseline of what was already there, and then the baseline only ever shrinks — every entry
   removed is permanent, and the gate is not done until the file is gone.

   One growth is permitted, and only to the acceptance lane at its push to `main`: a clone whose
   every location is under `tests/acceptance/`. Those files are in the immutable set, so no other
   lane may ever dedupe them, and a ratchet nobody can turn is not a ratchet — it was a red `main`
   that lane 05 got blamed for, four times in one week (`acceptance/land-gate.ts`, ADR-0114).

6. **It runs in `test` and `all`, and in CI. Never in `stop`.** Token-window matching across a few
   hundred files takes seconds, not the sub-second budget the turn-end gate reserves (ADR-0022).
   The contract slots are where the gate belongs; the turn-end gate is where it would only ever be
   a tax.

## Turning one on in a repo that has none

The gate goes red before it goes green, and that is the point — the first run is a measurement of
debt nobody had numbers for. Fix the duplication it finds, or record a baseline under rule (5) and
start shrinking it. Never widen an exclude to make the first run pass: that is the vacuous pass,
arrived at deliberately.

A repo that already has a working gate keeps it. Audit it against these six rules and report the
gaps; a working gate is never replaced by a seeded one.
