import type { Plan } from "./plan-schema";

/**
 * Refuses a malformed ticket graph before anything downstream can act on it:
 * every `dependsOn` in range, no self-reference, exactly one unblocked root,
 * no cycle. Passes silently (returns nothing) when the plan is well-formed;
 * throws naming the offending slice by 1-based position and title otherwise.
 *
 * Checked in this order so each failure mode stays independently reachable
 * and reports its own message — a plan can fail more than one of these at
 * once, and this reports the first one found.
 */
export function validatePlan(plan: Plan): void {
  const size = plan.length;

  for (let index = 0; index < size; index++) {
    const slice = plan[index];
    const position = index + 1;

    for (const dep of slice.dependsOn) {
      if (dep === position) {
        throw new Error(`slice ${position} ("${slice.title}") depends on itself`);
      }
      if (dep < 1 || dep > size) {
        throw new Error(
          `slice ${position} ("${slice.title}") has an out-of-range dependsOn: ${dep} (plan has ${size} slice${size === 1 ? "" : "s"})`,
        );
      }
    }
  }

  const roots = plan
    .map((slice, index) => ({ slice, position: index + 1 }))
    .filter(({ slice }) => slice.dependsOn.length === 0);

  if (roots.length === 0) {
    throw new Error(
      "plan has no unblocked root: every slice declares at least one dependsOn, so nothing can start",
    );
  }
  if (roots.length > 1) {
    const named = roots.map(({ position, slice }) => `slice ${position} ("${slice.title}")`).join(", ");
    throw new Error(`plan has more than one unblocked root: ${named} each declare no dependsOn`);
  }

  const UNVISITED = 0;
  const IN_PROGRESS = 1;
  const DONE = 2;
  const state = new Array<number>(size + 1).fill(UNVISITED);

  const visit = (position: number): void => {
    state[position] = IN_PROGRESS;
    const slice = plan[position - 1];

    for (const dep of slice.dependsOn) {
      if (state[dep] === IN_PROGRESS) {
        const depTitle = plan[dep - 1].title;
        throw new Error(
          `dependency cycle detected: slice ${position} ("${slice.title}") depends on slice ${dep} ("${depTitle}"), which depends (directly or transitively) back on slice ${position}`,
        );
      }
      if (state[dep] === UNVISITED) {
        visit(dep);
      }
    }

    state[position] = DONE;
  };

  for (let position = 1; position <= size; position++) {
    if (state[position] === UNVISITED) {
      visit(position);
    }
  }
}
