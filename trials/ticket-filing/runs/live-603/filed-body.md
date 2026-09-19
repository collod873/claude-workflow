## Why

Asked for at the end of the session that filed #601 and #602, once both had landed: "So whats your
follow up suggestion about the edges? What would that look like?", then "#1 appears to make sense",
then "Do that yes".

#601 made "the blocked-by graph has one writer" a thing a test checks
(`.Workflow/agent-workflows/shared/edge-writer-gate.test.ts`), and that test records the
duplication rather than closing it: it permits `blockedByPath` in the TypeScript slice publisher
and, separately, the literal `dependencies/blocked_by` in `bin/publish-issue-graph`. Two programs
publish the same graph by two different routes, so every rule about that graph has to be written
twice or it drifts. #407 is the standing evidence: three rules the `/to-tickets` skill states in
prose are enforced by neither writer, and one of them costs a whole drain run when it is broken.

## What to build

One publisher, reached by both routes.

`.Workflow/agent-workflows/shared/publish-sub-issues.ts` (86 lines, used by lane 03 inside
Actions) creates the issues, attaches them under the PRD, wires the edges and verifies them on
read-back, and validates almost nothing. `bin/publish-issue-graph` (240 lines, used by a session
through the `/to-tickets` skill) does the same job against a graph JSON file and validates rather
more first: unique keys, resolvable `blockedBy` references, no cycles, every body a valid
`ticket`.

Fold the validation and the writing into the TypeScript publisher, and leave
`bin/publish-issue-graph` as a shim that hands its graph JSON to it. The command, the JSON shape,
the printed table and the read-back verification all stay exactly as they are for whoever runs it;
what changes is that there is one place the graph is checked and one place it is written.

Carry #407's three rules into that one place as the fold happens, so it closes with this:

- a `blockedBy` naming an issue outside the batch is refused before the first write, not published
  silently the way the `isinstance(b, str)` guard lets a bare number through today at
  `bin/publish-issue-graph:113`
- every claimed path resolves in the repo
- overlapping claims between parallel slices earn a **warning**, never a refusal. #601 is why: an
  overlap is a scheduling fact, and the reconciler already spaces overlapping tickets out by a pass
  at dispatch. A refusal here would re-introduce the rule that chained #600 behind #538.

The Python validation and `.claude/hooks/test_publish_issue_graph.py` go once the TypeScript side
covers them, and the gate test from #601 tightens: no file under `bin/` spells the blocked-by
endpoint any more.

Closes #407.

## Acceptance criteria

- [ ] `bin/publish-issue-graph` makes no GitHub write of its own: it spells neither the blocked-by endpoint nor the sub-issues endpoint, and hands its graph JSON to the one TypeScript publisher instead - check: `bash -c '! grep -qE "dependencies/blocked_by|/sub_issues" bin/publish-issue-graph'`
- [ ] The folded publisher refuses, before the first write, a `blockedBy` pointing at an issue outside the batch (#407), a duplicate key, a cycle, and a body that fails `ticket` shape, and warns without refusing when two slices with no edge between them claim the same path - check: `npx vitest run .Workflow/agent-workflows/shared/publish-issue-graph.test.ts`
- [ ] The Python copy of that validation is gone with its suite, and `bin/publish-issue-graph` no longer imports `ticket_shape` - check: `bash -c '! test -f .claude/hooks/test_publish_issue_graph.py && ! grep -q ticket_shape bin/publish-issue-graph'`

## Files claimed

- bin/publish-issue-graph
- .Workflow/agent-workflows/shared/publish-sub-issues.ts
- .Workflow/agent-workflows/shared/publish-sub-issues.test.ts
- .Workflow/agent-workflows/shared/publish-issue-graph.cli.ts
- .Workflow/agent-workflows/shared/publish-issue-graph.test.ts
- .Workflow/agent-workflows/shared/edge-writer-gate.test.ts
- .claude/hooks/test_publish_issue_graph.py
