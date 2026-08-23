# Every gate fires at the earliest venue that can run it

Recorded 2026-08-23.

A gate is placed by its latency, not by its importance: it runs at the earliest venue whose budget
it fits, and it moves later only when it physically cannot run earlier. Typecheck fits inside the
agent's turn, so it fires there; a suite needing a live database cannot, so it fires in Actions.

The estate does the opposite today. Lumaria carries seven mechanical hooks — `post-edit-validate.py`,
`stop-gate.sh`, husky `pre-commit`, `pre-push`, `close-gate.py` — every one of which fires at the
moment of an action and can genuinely refuse, and every one of which was told not to run the checks
that matter. `stop-gate.sh` carries the comment *"Types + tests intentionally NOT run here — CI owns
them."* Meanwhile `ci.yml` runs everything and sits where it can refuse nothing.
`verification-boundaries-2026-08.md` states the result: **every mechanism that runs tests is
advisory or after the fact, and every mechanical mechanism runs no tests.** That is not a missing
gate. It is an inverted assignment, and correcting it costs no money.

The argument for earliest is the cost of the fix, not the cost of the check. A type error surfaced
inside the turn is repaired by the implementer that caused it, in the same turn, with its context
still loaded — approximately free. The identical error surfaced in Actions costs a cold fixer run
that must reconstruct what the implementer already knew. Surfaced by a reviewer it costs a review, a
fixer and a re-review. Surfaced by the owner it costs the premise. Verification is cheapest exactly
where the repair is cheapest, and those are the same place.

## Considered options

- **CI owns every check** — the status quo, and Lumaria's ADR-0022 rationale. Rejected. It puts the
  slowest venue on the critical path of the fastest correction, and it is the arrangement that
  produced blocker 5: twelve broken commits reaching `main` in five days with a full suite watching
  them arrive.
- **A pre-commit hook owns every check**, Pocock's shape in `course-video-manager`. Rejected as the
  whole answer, kept as one rung. His `.husky/pre-commit` is genuinely fail-closed and self-installs
  on the runner via `"prepare": "husky"`, so an agent's commits pass the same gate his do — worth
  stealing outright. But commit-time is already late: the implementer has moved on, and the fix is
  a second turn rather than the same one. He also runs no tests there, because commit-time cannot
  afford a suite. Something still has to.
- **One reviewer verifies at the end** — rejected. It breaks W2 only if the reviewer also built, but
  it breaks C1 unconditionally: a single terminal verifier is a serialisation point that caps
  throughput at one agent no matter how many implement. A reviewer catching type errors is a very
  slow compiler.
- **Placement by latency, every venue carrying what fits** — chosen.

## Consequences

**Each venue is a filter, so the expensive venues stop seeing failures.** That is where the speed
comes from — not from checking less, but from checking earlier. The nightly and Actions rungs get
cheaper as a side effect of the free rungs working.

**This amends the growth rule.** `DESIGN.md` §06 says every defect that escapes to the owner adds a
gate. It now adds that gate at the **lowest venue that could have caught it**, never to Actions by
default. Adding every escape to CI is how the gauntlet becomes the bottleneck it was built to
prevent.

**A venue's cost scales with blast radius, not with headcount.** Six concurrent implementers each
run the in-turn and turn-end venues, because those are free. They do not each buy an Actions run;
the slicer's physical disjointness (W3) is what makes one run per merge batch sound.

**The flake precondition is load-bearing.** ~14 of Lumaria's 26 CI failures over 30 days are one
file, `.claude/hooks/stop-gate.test.mjs`, failing on whether `jq` is on the runner's PATH. Half the
red is environment flake in the meta-layer. Promoting a venue to refusing while that holds trains
every agent in the estate to reach for `--no-verify`, and crewops ADR-0003 already ruled the
consequence: *a flaky gate trains `--no-verify` and is worse than a slow one.* Quarantine first,
promote second.
