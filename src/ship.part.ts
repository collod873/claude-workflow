import { FULL_CHECK_PASSED, type Run, type ShipRun, shipping } from "./scenarios.ts";
import { declarePart } from "./part-files.ts";

const shippingNext = (runs: ShipRun[] | null): Run => {
  const app = shipping();
  app.land("next", runs);
  return app.run();
};

declarePart({
  part: {
    name: "bin/ship",
    file: "bin/ship",
    stops: "https://github.com/collod873/Mezzanine/issues/2495",
    printsData: true,
  },
  scenarios: [
    { label: "shipping a commit that passed the full check", run: () => shippingNext(FULL_CHECK_PASSED) },
    { label: "holding a commit whose full check is red", run: () => shippingNext(null) },
    { label: "refusing a daily run with no health URL", run: () => shipping().run(["--daily"]) },
    { label: "showing its help", run: () => shipping().run(["--help"]) },
  ],
});
