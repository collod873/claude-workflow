---
status: constraint
date: 2026-10-07
reversal: Builds would stop at the owner again, and a Spec would sit idle until he looked.
---

# No build work waits on the owner

The owner makes his decisions ahead of time, and Specs and tickets run from them without him. A
stage never parks build work on him: a builder that finds a ticket's Done when wrong rewrites it
against the ticket's Why, which stays the owner's words, and keeps building. `stuck` is the one
label that holds build work, the last resort of a stage that cannot go on, and the machine never
closes unbuilt work, since he could not find it again. Planning he drives himself, a Wayfinder map
and its tickets, may wait on him.

**Rejected: a held label such as `needs-human`, or a builder answer that waits for the owner.**
Held work is idle work: on 2026-10-07 one waiting ticket held Lumaria idle for 5 of 10.5 hours.

Evidence: `docs/research/owner-rules-2026-10.md`, N5 and N15.
