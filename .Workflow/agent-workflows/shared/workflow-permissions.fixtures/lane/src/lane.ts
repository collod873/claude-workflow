import { fileFinding, type Exec } from "./file-finding";

/**
 * The fixture lane's entrypoint. It performs no write of its own — the write is one import away,
 * which is the whole point: a deriver that only read the file named on the `run:` line would call
 * this lane permission-free and the fixture would prove nothing.
 */

/** Stands in for `execGh`; the fixture is never executed, only read. */
const gh: Exec = () => "";

function main(): void {
  fileFinding(gh, "the fixture lane found something");
}

main();
