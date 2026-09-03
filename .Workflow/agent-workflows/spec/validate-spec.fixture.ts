import type { SpecBodyValidator } from "./validate-spec";

/**
 * @fixture Reached only from the suites, by design.
 */
export const NO_VALIDATION: SpecBodyValidator = () => [];
