import { callerWith, clocking } from "./scenarios.ts";
import { declarePart } from "./part-files.ts";

declarePart({
  part: {
    name: "bin/ship-clock",
    file: "bin/ship-clock",
    stops: "https://github.com/collod873/claude-workflow/issues/1692",
    lines: 6,
  },
  scenarios: [
    { label: "installing three apps' ship clocks", run: () => clocking({ "collod873/Mezzanine": callerWith("0 8 * * *"), "collod873/PW-Zone2": callerWith("20 8 * * *"), "collod873/workout-tracker": callerWith("40 8 * * *") }).run() },
    { label: "refusing a cron that is not daily", run: () => clocking({ "collod873/Mezzanine": callerWith("*/15 * * * *") }).run() },
  ],
});
