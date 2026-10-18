/**
 * The placeholder grammar of the diagnostic templates, shared by the
 * generator's check and the renderer: `{name}` with a camelCase name, and no
 * `$` before it so a `${…}` in a template stays text.
 *
 * @module diagnostic-placeholder
 */

/** One placeholder; the name is the first group. */
export const PLACEHOLDER: RegExp = /(?<!\$)\{([a-z][a-zA-Z0-9]*)\}/g;
