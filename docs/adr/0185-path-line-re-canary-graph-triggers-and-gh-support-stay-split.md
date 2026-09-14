---
status: constraint
date: 2026-09-14
reversal: Collapsing any of the three loses what made each a split rather than a drift: PATH_LINE_RE would need one grammar to mean the same thing in two engines with different `\w` widths, the stub would need to read live workflow YAML at generation time, and folding gh_support.py into gh.ts asks one runtime to shell through the other's process model.
---

# PATH_LINE_RE, the canary-graph trigger stubs, and gh_support.py stay split on purpose

Three pairs from #552's sweep read like duplication and are not.

`PATH_LINE_RE` (`bin/ticket_shape.py`, `shared/ticket-shape.ts`) stays two regexes because `\w`/`\d` are Unicode-wide in Python and ASCII in JavaScript. ADR-0184 already ruled this the evidence grammar's one legitimate split; the citation now lives in `ticket-shape.rules.json`, since ADR-0151 bars the comment that would point at it from `ticket_shape.py` itself.

The canary-graph trigger stubs (`bin/canary-graph-gen.mjs`'s generated stubs versus the real lane workflows) are a caller and a source, not two copies: a stub carries no content by design (ADR-0055). `canary-graph-triggers.proc.test.ts` is the worked example of a guard that exercises the axis it claims: it diffs each stub's `on:` block against its lane's workflow and asserts every lane with a caller is stubbed.

`bin/gh_support.py` and `shared/gh.ts` hold different jobs, resolving a binary versus execing one, not one rule split by language.

**Rejected:** a comment at `PATH_LINE_RE` citing this ADR. ADR-0151 holds code at zero prose.
