import { z } from "zod";

/**
 * The check contract's one new seam (spec #117 §"The shared seam"): a single module owning the
 * six-slot schema and per-venue slot resolution (including the broader-slot degradation). `bin/gauntlet` is bash and must
 * not learn to parse JSON — this is where that parsing lives instead, so the runner and the
 * generator cannot disagree about the same schema.
 *
 * The six slots — `stop`, `test`, `test_one`, `typecheck`, `lint`, `all` — are era 6's, unchanged
 * (`agent-skills` ADR-0006/ADR-0022; see `docs/adr/0056-bin-gauntlet-runs-the-check-contract-instead-of-three-hardco.md`
 * and CONTEXT.md's "Check contract" entry). Nothing here renames, renumbers, or removes a slot.
 *
 * `test_related` is a seventh, added by #335 — the turn venue ran no tests at all, and the runner
 * this repo installs has a form (`vitest related`) that runs only the test files importing the
 * file just edited: one to three files, sub-second, at the venue where a repair is cheapest. It is
 * an addition and not a rename, so a contract written against the six still parses every slot it
 * names; a target that has no such form carries it as the sanctioned `cmd: null` and its turn
 * venue runs no tests, exactly as before. That is why it is the one optional slot — see
 * `CheckContract` below, and ADR-0143 for what requiring it cost.
 */

export const SLOT_NAMES = [
  "stop",
  "test",
  "test_one",
  "test_related",
  "typecheck",
  "lint",
  "all",
] as const;
export type SlotName = (typeof SLOT_NAMES)[number];

/**
 * One slot: a command to run, or the sanctioned `cmd: null` opt-out — either way carrying a
 * `why` that names a **declaration site**, never a measurement (ADR-0056: a stopwatch reading in
 * `why` is a second, unwatched copy of a fact the runner already holds live).
 */
export const Slot = z.object({
  cmd: z.string().min(1).nullable(),
  why: z.string().min(1),
});
export type Slot = z.infer<typeof Slot>;

/**
 * The sanctioned opt-out a contract written before `test_related` existed parses to — the same
 * `cmd: null` a target with no narrow test form carries explicitly (ADR-0143).
 */
const ABSENT_TEST_RELATED: Slot = {
  cmd: null,
  why: "absent from this contract — the turn venue runs no tests, as it did before #335",
};

/**
 * The seven-slot schema. `.strict()` is load-bearing: it is what makes a typo'd or invented slot
 * name a validation failure instead of a silently-ignored extra key — the reader this file gives
 * the contract, the same way a dead command is `exit 2` rather than a quiet no-op.
 *
 * `test_related` is the one **optional** slot, and it has to be. #335 added it on the criterion
 * that a contract omitting it degrades to no test run at the turn venue; requiring it made that
 * criterion unreachable, and an enrolled repository's committed contract — written against the six
 * and untouched since — stopped parsing, so its gauntlet refused to run *any* check. A schema
 * change here must never invalidate a file a target has already committed (ADR-0143). The default
 * fills the slot at parse time, so every reader downstream still sees seven.
 */
export const CheckContract = z
  .object({
    stop: Slot,
    test: Slot,
    test_one: Slot,
    test_related: Slot.default(ABSENT_TEST_RELATED),
    typecheck: Slot,
    lint: Slot,
    all: Slot,
  })
  .strict();
export type CheckContract = z.infer<typeof CheckContract>;

function isSlotName(name: string): name is SlotName {
  return (SLOT_NAMES as readonly string[]).includes(name);
}

/**
 * The one exported builder for a `CheckContract` fixture (CODING_STANDARDS.md: "a schema-typed
 * fixture through one exported builder"), every slot defaulting to a null opt-out so a test names
 * only the slot it is actually about.
 *
 * @fixture Reached only from the suite, by design — `knip.config.ts` asks whether a *lane* reaches
 * a thing, and the honest answer for a fixture builder is no.
 */
export function checkContractFixture(
  overrides: Partial<Record<SlotName, Partial<Slot>>> = {},
): CheckContract {
  const contract = {} as Record<SlotName, Slot>;
  for (const name of SLOT_NAMES) {
    contract[name] = { cmd: null, why: `${name} fixture default`, ...overrides[name] };
  }
  return CheckContract.parse(contract);
}

/** What resolving a requested form against a contract produced. */
export interface SlotResolution {
  /** The slot actually run. */
  slot: SlotName;
  /** That slot's resolved command — the same lookup a caller would otherwise repeat. */
  cmd: string | null;
  /** True when `requested` was not itself a schema slot and had to degrade to `slot`. */
  substituted: boolean;
  /** The form actually asked for, present only when it differs from `slot`. */
  requested?: string;
}

/**
 * What a venue runs for a requested form of check. `requested` is ordinarily a schema slot name
 * outright. Where a venue needs a narrower form the schema has no slot for — the `turn` venue
 * lints one file, and there is no `lint_one` — it asks for that narrow name (`lint_one`), and
 * resolution degrades to the **broader** slot the `_one` suffix strips down to (`lint`), reporting
 * the substitution rather than skipping (ADR-0056: "A venue never skips... No slot is invented.").
 * `test_one` needs no degradation: the schema already carries it, so it resolves directly.
 *
 * Throws when `requested` names neither a schema slot nor a `_one` form of one — a caller error
 * (a mistyped venue name), not a degradation case this function is meant to absorb.
 *
 * @shell `bin/gauntlet` is the production caller, and it reaches this through a dynamic `import()`
 * inside a heredoc — an edge no static analysis can see. Deleting this as unused would take the
 * gauntlet with it.
 */
export function resolveSlot(contract: CheckContract, requested: string): SlotResolution {
  if (isSlotName(requested)) {
    return { slot: requested, cmd: contract[requested].cmd, substituted: false };
  }
  const ONE_SUFFIX = "_one";
  const broader = requested.endsWith(ONE_SUFFIX)
    ? requested.slice(0, -ONE_SUFFIX.length)
    : undefined;
  if (broader && isSlotName(broader)) {
    return { slot: broader, cmd: contract[broader].cmd, substituted: true, requested };
  }
  throw new Error(`check-contract: "${requested}" names no slot and no broader form of one`);
}
