import { fileFinding, type Exec } from "./file-finding";

/**
 * @fixture The permanently-wrong lane `workflow-permissions.test.ts` derives against; no venue runs it.
 */

const gh: Exec = () => "";

function main(): void {
  fileFinding(gh, "the fixture lane found something");
}

main();
