# The backwards question writes rather than reports, so it needs no section 6 row and no counter admission bar

Recorded 2026-08-26.

The backwards question is filed today inside
[move 8b](https://github.com/collod873/claude-workflow/issues/93), whose title is *"The remaining
model lenses, and the backwards question."* That placement is now wrong in both directions.

**It spends no model.** [ADR-0044](0044-an-unread-document-cannot-be-detected-so-the-backwards-quest.md)
makes it a graph walk over a declared trailer. Move 8b is three unbuilt Opus lenses, and an
afternoon's work has no reason to queue behind them.

**It is not a counter either.** `DESIGN.md` §6's counters *report* — they produce issues that reach
the owner through the brief, and §6 says so: *every lens and counter produces issues, never
notifications.* This one **writes**. Its output is a commit that stamps `Status: superseded by
ADR-NNNN` onto a record that could not say that about itself. Nobody receives it; the repair *is*
the output.

That is a third kind of mechanism, and naming it is what settles the placement:

| Kind | Output | Reader |
|---|---|---|
| **Gate** / **Refusal** | Refuses the action | None needed — only a trigger |
| **Lens** / **Counter** | Files an issue | The owner, via the brief |
| **Back-stamp** | Commits the repair | None — the repaired record is the output |

So it ships as **its own build-order move, blocked by nothing**. It needs no §6 row, and it is not
subject to whatever admission bar [#102](https://github.com/collod873/claude-workflow/issues/102)
sets for counters — which matters, because §6 went from three counters to eight in three days on an
argument with no stopping condition, and this would otherwise have been the ninth.

`#102` still gets something from this map: the *operational shape* of the backwards question, which
is the refusal it says already exists and is not being applied to counters. It does not get another
counter to admit.

## Why now rather than later

`DESIGN.md` §10's own argument for putting the free venues first: *they cost an afternoon, spend
nothing, and every hour after them is an hour of agent work that corrects itself instead of arriving
on his desk.* This is that shape. Concretely it is one flag on `bin/new-adr`, a backfill over ~20
ADRs, and a graph walk on a commit that adds a file under `docs/adr/` or `docs/research/`.

**The firing event is the add-event**, per
[ADR-0003](0003-a-lint-rule-is-asked-whether-it-ever-fired-only-when-standar.md)'s shape — the event
that would add another of its kind — not every push. `GOAL.md` C3 asks what real event fires this
and whether it is silent when there is nothing to say: a commit landing a new ADR is exactly the
moment the answer can have changed, and it is the moment the predecessor needs its stamp. No other
push moves the graph, so every other push is silent by construction rather than by a filter.

The alternative considered and rejected was running it on every push alongside §6's three counters.
It is cheap enough that this would have worked, but it makes the mechanism's silence a property of
its output rather than of its trigger, which is the distinction §6 uses to separate a lens from a
cadence.
