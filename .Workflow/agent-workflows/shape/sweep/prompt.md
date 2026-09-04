# Sweep

First of three stages turning an idea into a decision sheet. Scope: this repository's checkout and
its GitHub issues. Nothing else, and no web.

## The idea

{{IDEA}}

{{FOCUS}}

## 1. Prior art

Look for anything already on the record that bears on it:

- Issues, **open and closed**: `gh issue list --state all --search '<terms>' --json number,title,state,url`.
  Skip `#{{ISSUE_NUMBER}}`, which is the idea you are sweeping for, and it matches its own title.
  A closed idea labelled `killed` or `parked` was already shaped and set down; that is the strongest
  prior art there is.
- Rulings in `docs/adr/INDEX.md`: every ruling this repo has ever made, one line each, with its
  status. Open a body only for the *why*.
- `CONTEXT.md`, `GOAL.md`, `CODING_STANDARDS.md`, and `docs/`

Every hit gets a `verdict`, and **two of the three stop the chain here**:

| `verdict` | Means | `ref` must be |
|---|---|---|
| `duplicate` | This idea already exists as an issue | `#<number>` |
| `ruled` | A `constraint` ADR has already decided this | `ADR-NNNN` |
| `related` | Worth the owner's eye. Refuses nothing | either |

**Only `status: constraint` binds.** More than half the corpus is `note` or `superseded`, and a
superseded ADR's filename still reads as a live ruling while its body says the ruling no longer
governs. `INDEX.md`'s Status column is how you tell the difference. A `note` or a `superseded` hit
is `related`, whatever its title says.

A `duplicate` or `ruled` verdict ends the run: the shaper is never spent, and the owner gets a
refusal citing your evidence instead of a sheet. So the bar is *the same question, already answered*,
not *the same area*. An idea that touches a lane an ADR happens to mention is `related`. An idea
whose whole content is a decision `docs/adr/` already made is `ruled`.

Every hit also carries:

- a `url`, which is what the owner taps. `gh issue list --json …,url` gives you an issue's; a
  ruling's is `https://github.com/collod873/claude-workflow/blob/main/` plus its path under
  `docs/adr/`.
- a `bearing`, which is why it bears on *this* idea, **in one line**. The sheet funds three prior-art lines
  and no more, and on a refusal yours is printed to the owner verbatim.

Every issue and ruling you opened is either on `priorArt` with a verdict, or is something you can
say bears on nothing here. When that leaves nothing, return an empty `priorArt`: that is a real
answer and the sheet has a line for it.

## 2. The shaper's reading list

The next stage runs with **no tools at all**. Its entire context is the idea, `CONTEXT.md`,
`CODING_STANDARDS.md`, what you found above, and whatever you put on this list, enforced by its
toolbelt, not by its prompt.

So: anything the shaper needs in order to decide, you **list**. The runner reads each ref and
injects it in full; a ref it cannot read is replaced by a line saying it was dropped, so a wrong
path is a hole in the shaper's context that nothing downstream can fill.

- A `ref` is a **repo-relative path** or an **issue** (`#42`). Write the path whole:
  `docs/adr/0014-a-model-may-translate-evidence-into-a-gate-s-grammar-but-nev.md`, not an elided
  form, which reads as a file that does not exist.
- `CONTEXT.md` and `CODING_STANDARDS.md` are in the shaper's context already. Listing either spends
  its window on the same file twice.
- Every item carries a `because` naming **which part of the idea it bears on**. An item with no reason is dropped by the grammar before the shaper sees it, so an item you cannot justify is one you should not list.
- There is no count cap. The bound is relevance, and starving this list causes lane 01's failure rather than preventing it. Err toward including the thing you had to read to understand the idea.

## Output

Return your answer by calling the `StructuredOutput` tool, with `priorArt` and `readingList`.

Write whatever reasoning you need first; only the tool call is read as your answer, so nothing
you say before it can corrupt it.

```structured-output
{"priorArt":[{"ref":"ADR-0014","url":"https://github.com/collod873/claude-workflow/blob/main/docs/adr/0014-a-model-may-translate-evidence-into-a-gate-s-grammar-but-nev.md","bearing":"Rules that a model translates evidence into a gate's grammar and never renders the verdict, which this idea would hand back to the model","verdict":"ruled"}],"readingList":[{"ref":".Workflow/agent-workflows/shape/sheet.ts","because":"it applies the grammar this idea would change"},{"ref":"#42","because":"the earlier attempt at the same rule"}]}
```
