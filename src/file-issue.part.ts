import { LANDED_PR, filing, misshapenSpec, wellFormedNote, wellFormedTicket } from "./scenarios.ts";
import { declarePart } from "./part-files.ts";

const FILED = `printf '%s\\n' ${LANDED_PR}\n`;
const NOTE_CALL = ["idea", "--title", "What the audit found", "--body-file", "body.md"];

declarePart({
  part: {
    name: "bin/file-issue",
    file: "bin/file-issue",
    stops: "https://github.com/collod873/claude-workflow/issues/662",
    lines: 6,
    printsData: true,
  },
  scenarios: [
    { label: "filing a ticket", run: () => filing({ gh: FILED, body: wellFormedTicket }).run() },
    { label: "refusing a body with one defect", run: () => filing({ gh: FILED, body: wellFormedTicket.replace("## Why", "## Background") }).run() },
    { label: "refusing a body defective more ways than it shows", run: () => filing({ gh: FILED, body: misshapenSpec }).run(["spec", "--title", "A spec", "--body-file", "body.md"]) },
    { label: "refusing a call it does not file", run: () => filing({ gh: FILED, body: wellFormedTicket }).run(["judgement", "--title", "A judgement"]) },
    { label: "filing a note", run: () => filing({ gh: FILED, body: wellFormedNote }).run(NOTE_CALL) },
    { label: "refusing a note that says no why", run: () => filing({ gh: FILED, body: "Four proposals, with no heading over them.\n" }).run(NOTE_CALL) },
    { label: "showing its help", run: () => filing({ gh: FILED, body: wellFormedTicket }).run(["--help"]) },
  ],
});
