# A lint rule is asked whether it ever fired only when standards-pass runs next, and leaves the config the moment the answer is no

Recorded 2026-08-23.

CODING_STANDARDS.md already names an entry's only exit: it leaves by becoming a rule in
`eslint.config.js`, in the commit that deletes the entry. Standing the linter up gives the rule
itself a matching exit. A rule is never audited on a calendar — the question rides the same event
that adds a rule, `/standards-pass`, rather than a new ritual of its own: the next time it runs, it
also asks each already-enabled rule whether any `Verify` run in Actions history has ever failed
naming it. A rule with zero such hits since it was enabled is deleted from `eslint.config.js` in a
commit stating that finding as the reason — the same one-line-reason convention this ticket used to
turn off a `typescript-eslint` recommended rule that already had hits.

## Why this, not a scheduled audit

C3 rules out a clock, and C4 rules out a second ritual next to `/standards-pass` — a rule's whole
adoption cost has to be paid at the one event that already exists for rules, or the linter grooms
itself into exactly the kind of obligation it was adopted to avoid.
