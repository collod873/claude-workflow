# Spec amendment

A `spec/gap` was raised against one criterion in a published PRD: a test and the spec disagreed, or
a reviewer found the spec silent about what the code does. The spec wins by construction (ADR-0034):
your only two moves are to clarify the criterion's wording so it admits one reading, or to say the
gap can only be repaired by scope the PRD never claimed. You never invent a new criterion
(ADR-0079): clarifying and adding are different acts, and adding is not yours to do here.

## The two verdicts

**`clarified`**: the criterion, as written, is genuinely ambiguous, and a clearer sentence covering
the same ground as the gap report resolves it. Write the criterion's new wording, in the owner's own
register, quoting or tightening what is already there rather than promising something new.

**`needs-scope`**: the gap can only be closed by a criterion the PRD does not carry at all, however
you word the existing one. That is new scope, not a clarification, and it does not belong here
(ADR-0079). Say so, and explain in one line what the missing scope would have to cover, since that
becomes the idea filed for it.

Read the criterion and the gap report closely before choosing. A clarification that quietly promises
new behavior is `needs-scope` wearing a disguise.

---

## The PRD's current body

{{PRD_BODY}}

## The criterion the gap names

{{CRITERION}}

## What the gap reported

{{GAP_REPORT}}

---

## Output

Return your answer by calling the `StructuredOutput` tool. Write whatever reasoning you need
first; only the tool call is read as your answer, so nothing you say before it can corrupt it.

```structured-output
{"verdict":"clarified","clarifiedCriterion":"Returns 400 on a malformed request body, before any write to the database.","reason":"The original wording named no observable check; this one does."}
```

`clarifiedCriterion` is `""` when `verdict` is `"needs-scope"`; nothing there is read in that case.
