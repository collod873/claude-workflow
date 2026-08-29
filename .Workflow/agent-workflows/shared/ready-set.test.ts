import { describe, expect, it } from "vitest";
import type { GhExec } from "./gh";
import {
  announceGraphChanged,
  dispatchTicketReady,
  GRAPH_CHANGED_DISPATCH_ACTION,
  implementationBranch,
  implementationBranchTicket,
  readySlices,
  TICKET_READY_DISPATCH_ACTION,
  unreachableSlices,
  type Delivery,
  type SliceState,
} from "./ready-set";

function state(number: number, blockedBy: number[] = [], overrides: Partial<SliceState> = {}): SliceState {
  return { number, blockedBy, delivery: "open", started: false, ...overrides };
}

const numbers = (slices: SliceState[]): number[] => slices.map((slice) => slice.number).sort((a, b) => a - b);

describe("readySlices", () => {
  it("is every slice with no blockers when nothing has happened yet — the answer the folded constant gave", () => {
    const graph = [state(1), state(2), state(3, [1]), state(4, [1, 2])];

    expect(numbers(readySlices(graph))).toEqual([1, 2]);
  });

  it("adds a slice the moment its last blocker delivers", () => {
    const graph = [state(1, [], { delivery: "delivered" }), state(2, [1])];

    expect(numbers(readySlices(graph))).toEqual([2]);
  });

  it("does not include a slice with one delivered and one open blocker", () => {
    const graph = [state(1, [], { delivery: "delivered" }), state(2), state(3, [1, 2])];

    expect(numbers(readySlices(graph))).toEqual([2]);
  });

  it("does not include a slice already started — the branch ref is the claim", () => {
    const graph = [state(1, [], { delivery: "delivered" }), state(2, [1], { started: true })];

    expect(readySlices(graph)).toEqual([]);
  });

  it("does not include a slice that is itself closed", () => {
    const graph = [state(1, [], { delivery: "delivered" }), state(2, [], { delivery: "undelivered" })];

    expect(readySlices(graph)).toEqual([]);
  });

  it("leaves a slice blocked by an issue it was not handed, rather than treating the gap as delivery", () => {
    // The quiet direction. A blocker past the page boundary must not read as satisfied.
    const graph = [state(2, [999])];

    expect(readySlices(graph)).toEqual([]);
  });
});

describe("an edge is satisfied by delivery, not by closure", () => {
  it("is unsatisfied when the blocker closed `not planned`", () => {
    const graph = [state(1, [], { delivery: "undelivered" }), state(2, [1])];

    expect(readySlices(graph)).toEqual([]);
  });

  /**
   * The asymmetry test, both directions through one predicate.
   *
   * The sandcastle prior art counts *open* blockers and skips promotion on a `not planned` close,
   * so a blocker closed `not planned` **before** fan-out does not block at all — it is not open —
   * while the identical close landing **after** fan-out refuses to unblock. Same fact, opposite
   * behaviour, decided by when it happened. There is no "before" and "after" here to disagree
   * about: the predicate reads state, and the state is the same state.
   */
  it("gives the same answer whether the `not planned` close landed before or after the edge was drawn", () => {
    const closedBeforePublish = [state(1, [], { delivery: "undelivered" }), state(2, [1])];
    const closedAfterPublish = [state(1, [], { delivery: "undelivered" }), state(2, [1])];

    expect(readySlices(closedBeforePublish)).toEqual(readySlices(closedAfterPublish));
    expect(numbers(unreachableSlices(closedBeforePublish))).toEqual(numbers(unreachableSlices(closedAfterPublish)));
    expect(numbers(unreachableSlices(closedAfterPublish))).toEqual([2]);
  });

  it("is unsatisfied when the blocker closed as completed with nothing merged", () => {
    // `deliveryOf` in `dispatch/reconcile.ts` is what resolves that close to `undelivered`; this
    // pins what the predicate does with it once resolved.
    const graph = [state(1, [], { delivery: "undelivered" }), state(2, [1])];

    expect(readySlices(graph)).toEqual([]);
    expect(numbers(unreachableSlices(graph))).toEqual([2]);
  });
});

describe("unreachableSlices", () => {
  it("names a slice directly behind a blocker that closed without delivering", () => {
    const graph = [state(1, [], { delivery: "undelivered" }), state(2, [1])];

    expect(numbers(unreachableSlices(graph))).toEqual([2]);
  });

  it("names a slice transitively behind one, through an open intermediate", () => {
    const graph = [state(1, [], { delivery: "undelivered" }), state(2, [1]), state(3, [2]), state(4, [3])];

    expect(numbers(unreachableSlices(graph))).toEqual([2, 3, 4]);
  });

  it("names nothing when every blocker is open or delivered — waiting is not unreachable", () => {
    const graph = [state(1), state(2, [], { delivery: "delivered" }), state(3, [1, 2])];

    expect(unreachableSlices(graph)).toEqual([]);
  });

  it("does not name a closed slice — it is the cause, not a casualty", () => {
    const graph = [state(1, [], { delivery: "undelivered" }), state(2, [1], { delivery: "undelivered" })];

    expect(unreachableSlices(graph)).toEqual([]);
  });

  it("leaves a slice behind an unseen blocker unnamed, rather than filing a finding it cannot support", () => {
    expect(unreachableSlices([state(2, [999])])).toEqual([]);
  });

  it("treats a cycle as never delivering rather than recursing forever", () => {
    // `validatePlan` refuses a cyclic plan before publish, so this is a guard against a live tracker
    // that has one anyway.
    const graph = [state(1, [2]), state(2, [1]), state(3, [1])];

    expect(() => unreachableSlices(graph)).not.toThrow();
    expect(numbers(unreachableSlices(graph))).toEqual([1, 2, 3]);
  });

  it("never names a slice it also calls ready", () => {
    const graph = [
      state(1, [], { delivery: "delivered" }),
      state(2, [], { delivery: "undelivered" }),
      state(3, [1]),
      state(4, [2]),
    ];

    const ready = new Set(numbers(readySlices(graph)));
    expect(numbers(unreachableSlices(graph)).some((number) => ready.has(number))).toBe(false);
  });
});

/**
 * **The invariant, not two transitions.**
 *
 * #178 asked for two transition tests — merging one slice dispatches once each for the newly ready,
 * and a slice with two blockers merging in sequence fires exactly once. Both pass against a design
 * that is wrong under reordering, because both fix the order. The property below does not: it
 * applies **every permutation** of the same event sequence and asserts the answer is a function of
 * the final state alone. That subsumes partial unblocking, duplicate dispatch, event reordering and
 * the `not planned` asymmetry together.
 */
describe("the ready set is a function of final state, under every event order", () => {
  type Event = { number: number; delivery: Delivery };

  /** Six slices: a root, three behind it, a join, and one behind a slice that gets abandoned. */
  const graph = (): SliceState[] => [
    state(1),
    state(2, [1]),
    state(3, [1]),
    state(4, [2, 3]),
    state(5, [1]),
    state(6, [5]),
  ];

  const events: Event[] = [
    { number: 1, delivery: "delivered" },
    { number: 2, delivery: "delivered" },
    { number: 3, delivery: "delivered" },
    { number: 5, delivery: "undelivered" },
  ];

  function permutations<T>(items: T[]): T[][] {
    if (items.length <= 1) return [items];
    return items.flatMap((item, index) =>
      permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]),
    );
  }

  function apply(order: Event[]): SliceState[] {
    const slices = graph();
    for (const event of order) {
      const target = slices.find((slice) => slice.number === event.number);
      if (target) target.delivery = event.delivery;
    }
    return slices;
  }

  const orders = permutations(events);

  it("enumerates every order, so a passing suite is not a single sequence", () => {
    expect(orders).toHaveLength(24);
  });

  it("dispatches the same set for every permutation, equal to the set derived from final state alone", () => {
    // Derived independently of any event replay: this is what the tracker looks like afterwards.
    const finalState = [
      state(1, [], { delivery: "delivered" }),
      state(2, [1], { delivery: "delivered" }),
      state(3, [1], { delivery: "delivered" }),
      state(4, [2, 3]),
      state(5, [1], { delivery: "undelivered" }),
      state(6, [5]),
    ];
    const expected = numbers(readySlices(finalState));
    expect(expected).toEqual([4]);

    for (const order of orders) {
      expect(numbers(readySlices(apply(order))), order.map((event) => event.number).join(">")).toEqual(expected);
    }
  });

  it("reports the same unreachable set for every permutation", () => {
    for (const order of orders) {
      expect(numbers(unreachableSlices(apply(order))), order.map((event) => event.number).join(">")).toEqual([6]);
    }
  });

  it("is correct under no events at all", () => {
    expect(numbers(readySlices(graph()))).toEqual([1]);
    expect(unreachableSlices(graph())).toEqual([]);
  });

  it("does not re-dispatch a slice a previous recompute already started", () => {
    // What makes an intermediate reconcile free: the claim is the branch, and a claimed slice drops
    // out of the set rather than being remembered as sent.
    const afterDispatch = apply(events).map((slice) =>
      slice.number === 4 ? { ...slice, started: true } : slice,
    );

    expect(readySlices(afterDispatch)).toEqual([]);
  });
});

describe("the branch ref that is the claim", () => {
  it("is deterministic per issue, so two implementers race on one atomic create", () => {
    expect(implementationBranch(167)).toBe("implement/issue-167");
    expect(implementationBranch(167)).toBe(implementationBranch(167));
  });

  it("decodes back to the issue it was built from", () => {
    expect(implementationBranchTicket(implementationBranch(167))).toBe(167);
    expect(implementationBranchTicket("implement/issue-42")).toBe(42);
  });

  it("decodes anything that is not a claim to undefined, so the reader decides", () => {
    for (const ref of [
      "main",
      "implement/issue-",
      "implement/issue-abc",
      "implement/issue-167/fix",
      "feature/implement/issue-167",
    ]) {
      expect(implementationBranchTicket(ref)).toBeUndefined();
    }
  });
});

function recordingGh(): { gh: GhExec; calls: string[][] } {
  const calls: string[][] = [];
  return { gh: (args) => (calls.push(args), ""), calls };
}

describe("the two dispatches this pipeline sends about readiness", () => {
  it("sends ticket-ready naming the issue, and nothing else", () => {
    const { gh, calls } = recordingGh();

    dispatchTicketReady(gh, 89);

    expect(calls).toEqual([
      [
        "api",
        "repos/{owner}/{repo}/dispatches",
        "-f",
        `event_type=${TICKET_READY_DISPATCH_ACTION}`,
        "-f",
        "client_payload[issue]=89",
      ],
    ]);
  });

  it("rings the doorbell naming the pull request, and carries no graph in the payload", () => {
    const { gh, calls } = recordingGh();

    announceGraphChanged(gh, "https://github.com/owner/repo/pull/42");

    expect(calls).toEqual([
      [
        "api",
        "repos/{owner}/{repo}/dispatches",
        "-f",
        `event_type=${GRAPH_CHANGED_DISPATCH_ACTION}`,
        "-f",
        "client_payload[pr]=https://github.com/owner/repo/pull/42",
      ],
    ]);
  });

  it("keeps the two actions distinct, so a hint can never be read as a wave", () => {
    expect(GRAPH_CHANGED_DISPATCH_ACTION).not.toBe(TICKET_READY_DISPATCH_ACTION);
  });
});
