# The spec author reads the repo through an allow list and cannot reach a second source of intent

Recorded 2026-08-26.

The cloud spec author runs with `--allowedTools Read,Grep,Glob` and nothing else. It may read the
repository without limit, including `docs/adr/`; it has no `Bash`, no web, no issue search and no
subagent spawner, so the **only** intent it can see is the Decided context its collector assembled
([ADR-0058](0058-lane-02-is-one-prompt-with-a-collector-per-trigger-and-a-pay.md)).

Extends [ADR-0030](0030-the-shaper-is-given-a-prepared-context-and-no-search-tools.md), which took
lane 01's shaper off search entirely. Both records stand: the ruling is unchanged for the shaper, and
this states why the same answer does not transfer one lane down.

## The two lanes fail differently, so the bound goes in a different place

§01 names lane 01's failure as *a confident, coherent sheet resting on a wrong premise*, and ADR-0030
rejected a reading-list cap because *starving the shaper's inputs causes that failure rather than
preventing it.* Lane 02's failure is a different one: **inventing intent**, which §02 already makes
the author's one non-negotiable — *every place it had to invent intent becomes a numbered open
question rather than a silent assumption.*

Intent is not in the codebase. So the bound that matters here is not on reading code — an author that
cannot read the code it specifies against writes a spec nobody can build — it is on reading a
**second source of intent**: another repo's issues, an unrelated open idea, a transcript, someone
else's spec. `docs/adr/` is deliberately on the readable side: a ruled decision is exactly what §01
requires the spec to **cite rather than restate**, and reading more of the record can only reduce
re-deciding.

## Why an allow list rather than a deny list

`StageOptions.disallowedTools` states its own ceiling in the code that implements it: *"this names
tools, so a tool the CLI gains after this list was written is reachable by a stage that denies
everything on it. The honest claim is 'denies the tools that exist', not 'denies all tools'."*

For the shaper that ceiling costs nothing, because its list denies every tool it has. This author has
to **keep** three, so a deny list would be an enumeration of everything else — and the day the CLI
ships a fourth way to reach the network, this stage silently gains it. That is `CONTEXT.md`'s
**Fail-open**, which this estate has ruled repeatedly it cannot survive: ADR-0053 restates it as the
stronger rule for the immutability job, *a check that skips is not a gate.*

An allow list fails closed. A tool that does not exist yet is not on it, so the failure mode of being
out of date is a stage that cannot do something, which is loud, rather than a stage that can do
something it was never meant to, which is silent.

## Considered options

- **Prepared context and no tools, as ADR-0030 rules for the shaper.** Rejected: it produces a spec
  that cannot be built. The author has to know what exists before it can say what should.
- **A deny list, mirroring lane 01.** Rejected above, on the instrument rather than on the policy.
- **No bound; bound the output instead** — the critic refuses any claim about the codebase that names
  no path. Rejected as sufficient, kept as a good idea: it bounds accuracy, not reach, and says
  nothing about the author wandering into a second repo's intent.
- **An allow list of `Read`, `Grep`, `Glob`.** Chosen.

## Consequences

**`--allowedTools` is a second flag on `StageOptions`, and it is the one to prefer from here.**
`disallowedTools` stays for lane 01, where it is exactly right; nothing new should reach for it when
what it means is *these and no others*.

**The local door is bound by the owner, not by the toolbelt.** `DESIGN.md` §00 keeps the tactical
door local because the session already holds the nuance, so the in-session author has the whole
harness and the intent-holder is sitting in it. That is a different guarantee, and it is only sound
while the door stays local.

**The honest hole:** an allow-listed `Read` still reaches any file in the checkout, including issue
bodies someone has committed into it. Nothing in this repo does that today, and the failure would be
visible in the spec rather than silent.
