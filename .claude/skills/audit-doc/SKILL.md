---
name: audit-doc
description: "Audit one document an agent consumes (a skill, a CLAUDE.md, a seeded doc, the text a hook injects) against the writing-for-agents levers, with every claim checked against what enforces it."
disable-model-invocation: true
---

# Audit doc

Audits one document an agent consumes: a skill, a `CLAUDE.md`, a doc under `docs/agents/`, the
text a hook injects on `additionalContext` or `systemMessage`. The argument names the document.
No argument ⇒ stop and ask which.

The bar below is the whole standard. "audit X" and "be relentless about X" are the same job.

## Process

1. **Load the levers.** Call the Skill tool with "writing-for-agents"; when the document is a
   skill, read its `SKILL-MECHANICS.md` too. When the document is a hook, this audit covers the
   text it injects; its code is audited by calling the Skill tool with "writing-great-hooks" and
   running its Auditing rubric in the same report. Done when the lever list is in context.

2. **Gather the record.** Read the document in full, then everything it stands on:

   - every file, command, tool, skill, ticket, or ADR it names: read it, or run it with `--help`;
   - whatever enforces its rules: the validator, the test, the hook, the sibling skill that makes
     the same call one step later;
   - `git log` on the file;
   - every prior ruling on it: open tickets, `docs/research/`, ADRs that name it;
   - when the document is generated rather than written, whatever fills each interpolation
     point: the command whose output it inlines, the variable's source;
   - when the document *runs* (a hook, a script, a slash command) where it is registered and
     under what limits (the settings file, the frontmatter, the timeout beside it), and its own
     production record if it keeps one: the rows it writes, the log they land in, the report that
     reads them, **and the harness's own record of the same fires** in the session transcript,
     which `bin/hook-trace` joins to those rows (`--last`, `--session <id>`, `--check`). The rows
     are the document's self-report and stop at its exit; the transcript is the channel its text
     actually went out on, the audience that saw it, and what happened next. What a document does
     in the field is evidence no reading of it can supply, and it is the half that goes stale
     first. An audit that skips it grades the intent and calls it the behaviour.

   Done when every name in the document resolves to something you have read or run, every
   interpolation point resolves to the source that fills it, and a document that runs has had its
   live registration and its own rows read.

3. **Apply every lever to every line.** Walk the document line by line, holding each line to each
   lever: pointer wording, the two loads, the information hierarchy (disclosure, co-location,
   sprawl), completion criteria (clarity and demand), splits, leading words, negation, and the
   pruning set (single source of truth, cache, relevance, sediment, no-op); for a skill, the
   invocation choice. Three failures the levers imply but a read alone misses, so check them
   against the record from step 2:

   - **A rule written as description.** The document asserts a condition holds and never tells
     the agent to make it hold. It becomes a step with a checkable bound.
   - **A rule the environment already carries, or contradicts.** The document says one thing; the
     validator, test, hook, or sibling skill says another, or says the same thing (a cache).
   - **A generated document graded only where it is fixed.** A hook's message, a prompt template,
     any text assembled at runtime is part literal and part interpolated (`f"…{tail}"`,
     `${run.stdout}`). The levers reach the literal half; the interpolated half is whatever its
     source can emit, so grade it by reading that source: its worst case is the document's worst
     case. Where the source is code rather than text, say so in the report and hand that half to
     `writing-great-hooks` by name. Passing on the literal half alone is a silent partial audit,
     and reads in the report exactly like a clean one.

   Done when every line has met every lever, every rule has met whatever enforces it, and every
   interpolated half has been graded or explicitly handed off.

4. **Report in two places, and they are not the same document.**

   The **record** is a file: the scratchpad, unless the owner names somewhere else. Every finding
   with its lever, the line as `path:line`, the evidence outside the file that step 2 supplied,
   and the fix; then what is already right (so a fix keeps it), and only where you checked it
   against the record, because a line you merely read and approved is a claim the audit did not
   earn, and it is worse than silence: the next audit trusts it and stops looking. Then the
   constraints on any edit (markers, upstream rows, tests that cite the file by line). Done when
   an agent that read nothing but this file could apply every finding.

   The **reply** is what the owner reads, and it is bounded, because a report that has to be
   scrolled is graded by the levers it was written to enforce. Lead with the calls only the owner
   can make, batched, each with your rec. Then the findings that clear the floor. A finding earns
   its own paragraph when it changes what the document makes an agent do, or costs measurable
   time, context, or money, ranked by the run-to-run variance each causes. Everything else is one
   line each under one heading, and craft debt is called that in those words. The floor bounds the
   reply and never the search: find everything step 3 can find, then promote. More than five
   findings clearing the floor means the floor is set too low: re-rank and push the rest down,
   never go looking for less. Name the record's path last, so the depth is one click away rather
   than in the way.

   Done when the reply fits a screen and the record holds everything the reply left out. The audit
   is an assessment; edits wait for the owner's word.
