/**
 * The full error-code registry, in code order. Each entry carries the stable
 * code, its subsystem, a short title, what causes it, and how to fix it.
 * @returns {ErrorEntry[]}
 */
export function errorCatalog(): ErrorEntry[];
/**
 * Look up one code, or undefined when it is not registered.
 * @param {string} code
 * @returns {ErrorEntry | undefined}
 */
export function errorForCode(code: string): ErrorEntry | undefined;
/**
 * Render `docs/errors.md` from the registry. Generated, never hand-edited, so
 * the reference page cannot drift from the codes the compiler actually throws
 * (`scripts/gen-errors.mjs` writes it; tests/error-codes.test.js re-checks it).
 * @returns {string}
 */
export function errorsMarkdown(): string;
/**
 * One subsystem block of the numbering scheme.
 * @typedef {object} ErrorArea
 * @property {number} block The hundreds digit (0-9).
 * @property {string} range Human label for the block, e.g. `WD1xx`.
 * @property {string} name Short machine name, e.g. `loops`.
 * @property {string} title One-line description of what the block covers.
 */
/**
 * A registered error code.
 * @typedef {object} ErrorEntry
 * @property {string} code The stable `WDxxx` identifier.
 * @property {string} area The subsystem name (derived from the hundreds digit).
 * @property {string} title Short name for the mistake.
 * @property {string} cause What the author wrote that triggers it.
 * @property {string} fix The corrective action, in one line.
 * @property {string} [example] A concrete, compilable line, sourced from the
 *   compiler's own `*_EXAMPLE` constants.
 */
/** The subsystem blocks, in code order. */
/** @type {ErrorArea[]} */
export const ERROR_AREAS: ErrorArea[];
/**
 * Codes that were withdrawn. They are NEVER reused: a retired number stays
 * listed here so the next free number in its block is always genuinely free,
 * and so an old error message found in a log or an issue still resolves to a
 * meaningful (if historical) entry. Empty today.
 * @type {string[]}
 */
export const RETIRED_CODES: string[];
/**
 * One subsystem block of the numbering scheme.
 */
export type ErrorArea = {
    /**
     * The hundreds digit (0-9).
     */
    block: number;
    /**
     * Human label for the block, e.g. `WD1xx`.
     */
    range: string;
    /**
     * Short machine name, e.g. `loops`.
     */
    name: string;
    /**
     * One-line description of what the block covers.
     */
    title: string;
};
/**
 * A registered error code.
 */
export type ErrorEntry = {
    /**
     * The stable `WDxxx` identifier.
     */
    code: string;
    /**
     * The subsystem name (derived from the hundreds digit).
     */
    area: string;
    /**
     * Short name for the mistake.
     */
    title: string;
    /**
     * What the author wrote that triggers it.
     */
    cause: string;
    /**
     * The corrective action, in one line.
     */
    fix: string;
    /**
     * A concrete, compilable line, sourced from the
     * compiler's own `*_EXAMPLE` constants.
     */
    example?: string | undefined;
};
