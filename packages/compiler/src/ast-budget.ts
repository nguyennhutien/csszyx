/**
 * AST budget.
 *
 * Caps per-file AST traversal at 50 000 nodes so the build does not hang on
 * a pathologically large generated file. The engine enforces it while it
 * parses (`parser.rs` `AST_BUDGET`, same value): a file over the cap is left
 * as written and reported as an `ast-budget` issue on the transform result.
 */

/**
 * Maximum AST nodes processed per file. Files larger than this are
 * almost always machine-generated (e.g. embedded data tables, .json-as-ts
 * fixtures) and shouldn't be sent through the sz transform.
 */
export const AST_BUDGET = 50_000;
