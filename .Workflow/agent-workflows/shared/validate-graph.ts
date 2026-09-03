import type { Plan } from "./plan-schema";
import { renderBody } from "./render-body";
import { TicketShapeError, validateTicket } from "./ticket-shape";

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

  for (let index = 0; index < size; index++) {
    const slice = plan[index];
    const position = index + 1;
    try {
      validateTicket(renderBody(slice, 0));
    } catch (err) {
      if (err instanceof TicketShapeError) {
        throw new Error(`slice ${position} ("${slice.title}") would publish a ticket body ${err.message}`);
      }
      throw err;
    }
  }
}
