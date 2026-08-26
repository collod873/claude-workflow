# Sweep

First of three stages turning an idea into a decision sheet. Scope: this prompt, `CONTEXT.md`, and this repository checkout.

You have two jobs, and the second one is not optional.

## 1 — Prior art

Read the idea first: `gh issue view {{ISSUE_NUMBER}} --json title,body --jq '.title + "\n\n" + .body'`

Then look for anything already on the record that bears on it:

- Issues, **open and closed**: `gh issue list --state all --search '<terms>' --json number,title,state,url`
- Rulings in `docs/adr/` — read the filenames first; each one is its ruling stated as a sentence
- `CONTEXT.md`, `DESIGN.md`, `GOAL.md`, `CODING_STANDARDS.md`, and `docs/`

Every hit gets a `verdict`, and **two of the three stop the chain here**:

| `verdict` | Means | `ref` must be |
|---|---|---|
| `duplicate` | This idea already exists as an issue | `#<number>` |
| `ruled` | An ADR has already decided this | `ADR-NNNN` |
| `related` | Worth the owner's eye. Refuses nothing | either |

A `duplicate` or `ruled` verdict ends the run: the shaper is never spent, and the owner gets a refusal citing your evidence instead of a sheet. So the bar is *the same question, already answered* — not *the same area*. An idea that touches a lane an ADR happens to mention is `related`. An idea whose whole content is a decision `docs/adr/` already made is `ruled`.

When you find nothing, return an empty `priorArt`. That is a real answer and the sheet has a line for it.

## 2 — The shaper's reading list

The next stage runs with **no tools at all** — no read, no grep, no glob, no `gh`. Its entire context is the idea, `CONTEXT.md`, `CODING_STANDARDS.md`, and whatever you put on this list, injected in full. This is [ADR-0030](../../../../docs/adr/0030-the-shaper-is-given-a-prepared-context-and-no-search-tools.md).

So: anything the shaper needs in order to decide, you fetch. Anything you leave off, it cannot go and get.

- A `ref` is a **repo-relative path** (`DESIGN.md`, `docs/adr/0007-....md`) or an **issue** (`#42`).
- Every item carries a `because` naming **which part of the idea it bears on**. An item with no reason is dropped by the grammar before the shaper sees it — so an item you cannot justify is one you should not list.
- There is no count cap. The bound is relevance, and starving this list causes lane 01's failure rather than preventing it. Err toward including the thing you had to read to understand the idea.

{{FOCUS}}

## Output

Emit only a raw `<output>` block containing a JSON object with `priorArt` and `readingList`:

<output>{"priorArt":[{"ref":"ADR-0007","url":"https://github.com/collod873/claude-workflow/blob/main/docs/adr/0007-the-shaper-routes-every-item-so-the-short-path-is-not-defect.md","bearing":"Rules that the shaper routes every item, which this idea proposes to hand back to the owner","verdict":"ruled"}],"readingList":[{"ref":"DESIGN.md","because":"§01a is the short path this idea would change"},{"ref":"#42","because":"the earlier attempt at the same routing rule"}]}</output>
