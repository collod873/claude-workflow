import { LANDED_PR, NOISE, landSession } from "./scenarios.ts";
import { declarePart } from "./part-files.ts";

declarePart({
  part: {
    name: "bin/land",
    file: "bin/land",
    stops: "https://github.com/collod873/claude-workflow/issues/652",
  },
  scenarios: [
    { label: "landing while gh chatters", run: () => landSession({ gh: `cat >&2 <<'NOISE'\n${NOISE}\nNOISE\n[[ $2 == create ]] && echo ${LANDED_PR}\nexit 0\n` }).run() },
    { label: "with GitHub refusing the merge while gh chatters", run: () => landSession({ gh: `cat >&2 <<'NOISE'\n${NOISE}\nNOISE\n[[ $2 == create ]] && echo ${LANDED_PR}\n[[ $2 == view ]] && echo BLOCKED\n[[ $2 == merge ]] && exit 1\nexit 0\n` }).run() },
    { label: "with gh pr create failing", run: () => landSession({ gh: `[[ $2 == create ]] || exit 0\ncat >&2 <<'NOISE'\n${NOISE}\nNOISE\nexit 1\n` }).run() },
    { label: "with the push refused", run: () => landSession({ gh: "exit 0\n", remoteRefuses: NOISE }).run() },
    { label: "refusing an em dash in a commit message", run: () => landSession({ gh: "exit 0\n", messages: ["change \u2014 dashed"] }).run() },
  ],
});
