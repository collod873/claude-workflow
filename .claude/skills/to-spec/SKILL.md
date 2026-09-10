---
name: to-spec
description: "Turn the current conversation into a spec and publish it to the project issue tracker: no interview, just synthesis of what you've already discussed."
disable-model-invocation: true
---

This skill takes the current conversation context and codebase understanding and produces a spec. Do NOT interview the user; just synthesize what you already know.

The issue tracker and pipeline label vocabulary should have been provided to you. If not, tell the user to run `/setup-matt-pocock-skills`.

## Process

1. Work from whatever is already in the conversation context. If the user passes a reference (a spec path, an issue number or URL) as an argument, fetch it and read its full body and comments.

   If it is an **index** (a body that gists and links other issues) follow it one level: fetch each linked issue. For each one, prefer the durable record its gist names (e.g. an ADR) over its resolution comment; fall back to the resolution comment only where the gist names no durable record.

   No argument and nothing already in context ⇒ stop and ask what to spec, rather than synthesizing a spec from nothing.

2. Explore the repo to understand the current state of the codebase, if you haven't already. Use the project's domain glossary vocabulary throughout the spec, and respect any ADRs in the area you're touching.

   **A spec sketches no test seams; `/to-tickets` owns those.** The seam sweep runs one lane later, against sliced work, with more information than a spec author has; a seam chosen here is a second, earlier, unreviewed answer to a question that stage answers better. Explore for orientation and vocabulary, not to pick where the feature gets tested.

3. Ask the user to finish one sentence, and ask for nothing else.

   Before asking, summarize what you are about to spec in plain language as three bullets, no jargon,, written for someone who hasn't read a line of the codebase:

   - **What changes for you**: the concrete, user-visible effect of doing this.
   - **Cost**: the effort, time, or money it takes.
   - **Risk**: what could go wrong, or what you're giving up.

   Then ask:

   > **I'll know it works when I can ___.**

   This is the only thing in the spec that is not synthesis, and it is the single behavioural claim the whole pipeline closes on. It becomes exactly one `- [ ]` item under the template's `## Acceptance criteria`, **in the user's own words**: quote the sentence, never paraphrase it into your own, with a trailing `- check: ` marker naming the one command that proves it.

   The command is allowed, and required, to read the tracker or production: a `gh run list`, a deployed health endpoint, a query against real data. That is the opposite of the rule a ticket's criterion is held to, and the asymmetry is the point: a ticket's check reads the tree, a spec's check reads the world. A spec's check that already passes the day the spec is filed is not a check; it should be red until the work has actually run.

   Exactly one criterion, never several: a spec with three behavioural claims is three specs, and the value of the rule is that there is one sentence to point at when asking whether the product does the thing.

   **If the sentence cannot be mechanised, do not invent a command.** Raise it as a numbered open question instead, naming what would have to exist for the sentence to be checkable, and settle it with the user before publishing. A guessed command is worse than no spec: it closes the spec on something that was never the claim. `~/bin/file-issue spec` refuses a body whose one criterion carries no well-formed marker, so this is a refusal you will meet either way; meeting it as a question is the cheap version.

4. Write the spec using the **session-spec variant** in
   [`docs/agents/spec-format.md`](../docs/agents/spec-format.md); read it now if you have not
   already. That doc is the one spec-body contract; every producer references it rather than
   restating it, because a restated copy is what lets a template drift out of sync with the
   validator it feeds. It carries the body's shape and nothing about this session's ritual: step 3
   above is the ritual, and it does not travel.

   Then **critique your own draft before publishing it**. Read it back as though someone else wrote it, hunting exactly two things:

   - **A sentence that admits two implementations.** Two engineers reading it in good faith could build different things and both call it done.
   - **A claim nobody could observe.** No command to run, no state to inspect, no verbatim quote from the user behind it. "Handles errors gracefully" is this; "returns 400 on a malformed request" is not.

   Resolve each one yourself and fold the resolution into the draft; never relay it back to the user as a question. Pick the reading, or write the sharper sentence, that a competent implementer would produce from what is already on the page: the problem statement, the user stories, the prior art, the rest of the body. Never a reading invented from nothing. A tightly written draft yields nothing here, and finding nothing is a real result, not a failed pass.

   **The bound: sharpen, never remove.** You may resolve a sentence into a clearer, more specific version of itself. You may never delete a user story, and you may never narrow the scope of the work to make an ambiguity disappear, since dropping a hard half of the job is not a resolution of it. A pass that leaves the spec claiming less than it did before is a failed pass, whatever the reasoning was. The one acceptance criterion is out of bounds entirely: it is the user's own sentence in their own words, and step 3 already settled it.

5. Publish it with `~/bin/file-issue spec --title "<name>" --body-file <path>`; the `spec` kind prefixes the title with `PRD: ` and applies the `prd` label itself (creating it once if missing), so neither is ever set by hand. Done when it reads as a spec by title and label, not when an issue merely exists.

The body template is not restated here: it lives in
[`docs/agents/spec-format.md`](../docs/agents/spec-format.md), under the session-spec variant,
along with every rule `~/bin/file-issue spec` enforces on it.

Exactly one `- [ ]` item under that last heading, carrying a well-formed check marker: that is the shape `~/bin/file-issue spec` enforces at filing time and `close-ticket --spec` runs at close time. It sits last, after the prose, because it is the sentence the whole spec was written to make true.
