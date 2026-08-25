# The closing record

What an issue has to carry before it can be closed as completed. This page is the shape; the
reader is `record-grammar.ts`, and there is no second copy of the rule.

The gate fires on `issues.closed` and judges only a close marked **completed**. A close marked
*not planned* or *duplicate* makes no delivery claim, so nothing here applies to one.

## The shape

A comment whose **first line** is `## Closing record`. Most recent wins — post a corrected one
after a refusal rather than editing or deleting the record that was refused.

```md
## Closing record

`<base>..<head>`

- <criterion text> — MET: `<path>:<line>`
- <criterion text> — MET: `<command>` exit 0
```

Or, when the issue carries no commit at all:

```md
## Closing record

No diff.
```

## The rules

- **The range stands on its own line.** Not as a bullet — a leading `- ` would be counted as one.
  Either side may be any git revspec: a sha, a ref, a tag, a slashed branch name.
- **One bullet per acceptance criterion, in the body's order.** The bullet count must equal the
  number of `- [ ]` items under the issue's `## Acceptance criteria` heading. Plain `- ` bullets
  in that section are not criteria.
- **The verdict lives in one slot:** a separator (an em dash, or a spaced hyphen), then `MET`,
  `UNMET` or `NOT MET`, then a colon. It is read from there and nowhere else, so a criterion whose
  own wording contains the word "met" cannot flip its own bullet.
- **One verdict per bullet.** Two that disagree are refused rather than resolved.
- **A `MET` bullet's evidence has to be shaped like evidence:** a `path:line` reference (with a
  slash or a dot in the path — `foo:12` is not one), or a command with an exit status.

## When there is no record at all

A close from a merge keyword (`Closes #12`), a phone, or the web UI arrives with no record by
construction. Before refusing one, the gate spends a single Haiku call to read the issue and the
pull request that closed it and **write the record the closer didn't** — then judges that output
by the identical rules above. The model translates; it never renders a verdict, and it cannot
make a record pass that these rules would refuse.

A record it salvages is posted to the issue as a comment, so the reasoning is on the record and a
later re-close costs no model at all.

## What this does not check

A well-shaped lie passes. This reads the record's structure only — whether the evidence was truly
observed inside the declared range is outside it. In 558 rows of the era-6 log, `unmet-criterion`
fired exactly once. This is an active compliance mechanism and it is not a correctness one; do
not build anything on a claim that it is.
