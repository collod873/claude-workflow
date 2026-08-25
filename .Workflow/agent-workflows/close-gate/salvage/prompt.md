# Salvage a closing record

Issue #{{ISSUE_NUMBER}} was closed as completed and carries no `## Closing record` comment. Your
job is to write the record its closer didn't — **not** to decide whether the close was justified.

You are a translator. A deterministic checker reads your output and passes its own verdict on it.
Nothing you write can make a close pass that the checker would refuse, and nothing you say outside
the record is read at all.

## Scope

This prompt, `.Workflow/agent-workflows/close-gate/RECORD-GRAMMAR.md`, and whatever the commands
below return. Do not explore the codebase; do not run the tests.

## What to do

1. Read the grammar: `.Workflow/agent-workflows/close-gate/RECORD-GRAMMAR.md`.
2. Read the issue and its comments:
   `gh issue view {{ISSUE_NUMBER}} --json title,body,comments`
3. Find what closed it:
   `gh api "repos/{owner}/{repo}/issues/{{ISSUE_NUMBER}}/timeline" --jq '[.[] | select(.event == "closed" or .event == "referenced" or .event == "cross-referenced")]'`
   When that names a pull request or a commit, read it — `gh pr view <n> --json title,body,files`
   or `gh show <sha>` — for the range and the evidence.
4. Write one bullet for **each** `- [ ]` item under the issue's `## Acceptance criteria` heading,
   in the body's own order, same count. For each one, give the verdict the evidence you actually
   found supports:
   - `MET` only when you can point at a `path:line` you saw in the diff, or a command with an
     exit status somebody actually reported. **A criterion you cannot evidence is `UNMET`.**
   - `UNMET` otherwise, naming what is missing.
5. Use the real base..head range from the pull request or the timeline. If you genuinely cannot
   find one and the issue carries no commit, write `No diff.` instead of a range.

## The one thing that would make this useless

Do not invent evidence to make a bullet pass. The checker cannot tell a real `path:line` from a
plausible one, which is exactly why a fabricated bullet would be worse than the refusal it
replaced: it would close a ticket nobody delivered and leave a record saying somebody had. If the
evidence isn't there, say `UNMET` and let the close be refused. That is the correct outcome and
it costs nothing.

## Output

Emit only a raw `<output>` block containing a JSON object with one key, `record`, whose value is
the complete comment text starting at the `## Closing record` heading.

Example:

<output>{"record": "## Closing record\n\n`main..a1b2c3d`\n\n- The gate reopens a close it refuses — MET: `.Workflow/agent-workflows/close-gate/close-gate.ts:141`\n- The suite covers the refusal path — MET: `npx vitest run` exit 0"}</output>
