---
status: constraint
date: 2026-08-27
reversal: The direction that matters cannot be un-decided: the repository is already public and the deleted prompt corpus stays fetchable by SHA on GitHub's own garbage-collection schedule, so reversing the boundary would mean publishing raw session material a second time under the same exposure.
---

# The public repository carries the argument, the private repository carries the evidence

This repository is public. What **argues** a decision belongs here; what **evidences** it belongs in the private `Knowledge-Base`. Public: ADRs, `CONTEXT.md`, `DESIGN.md`, code, tests, and a research note that draws a conclusion from evidence without reproducing the evidence. Private: session transcripts, prompt corpora, anything that is raw material rather than a finding. The test: if deleting the corpus would invalidate the note, it is argument and stays; if deleting the corpus would delete the note's entire content, it was evidence wearing a research note's clothes. `session-prompts-2026-08.md` — 152,031 characters of verbatim prompts — is deleted under it. Exposure, not staleness, removes a research note; staleness supersedes or updates and never deletes.

**Accepted cost.** Deleted means removed from every ref published going forward; GitHub keeps unreferenced objects fetchable by SHA on a schedule this repo does not control.
