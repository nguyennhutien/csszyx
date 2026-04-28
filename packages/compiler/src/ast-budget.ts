/**
 * AST budget guard.
 *
 * Caps per-file AST traversal at 50 000 nodes to prevent the build from
 * hanging on pathologically large generated files. The cap value matches
 * the engine spec (`engine_specs.ast_budget_guard`).
 *
 * The check runs as an `enter` visitor in the Babel plugin, so it triggers
 * on every node regardless of type and bails out early via thrown error
 * instead of letting traversal continue.
 */

/**
 * Maximum AST nodes processed per file. Files larger than this are
 * almost always machine-generated (e.g. embedded data tables, .json-as-ts
 * fixtures) and shouldn't be sent through the sz transform.
 */
export const AST_BUDGET = 50_000;

/**
 * Thrown when a single file's AST exceeds {@link AST_BUDGET} nodes during
 * the csszyx compiler's traversal.
 */
export class ASTBudgetExceededError extends Error {
    /**
     * Source filename if known (set by callers via the `filename` argument
     * to {@link transformSourceCode}). May be `undefined` when invoked
     * with raw source strings outside a build context (e.g. tests).
     */
    public readonly filename: string | undefined;

    /**
     * Node count at the point traversal was aborted. Always strictly
     * greater than {@link AST_BUDGET}.
     */
    public readonly nodeCount: number;

    /**
     *
     * @param filename Source filename if known, otherwise `undefined`.
     * @param nodeCount Node count at the point traversal was aborted.
     */
    constructor(filename: string | undefined, nodeCount: number) {
        const where = filename ?? '<anonymous>';
        super(
            `[csszyx] AST budget exceeded: ${where} has more than ${AST_BUDGET} nodes ` +
            `(traversal aborted at ${nodeCount}). Files this large are almost always ` +
            'machine-generated and should be excluded from sz transformation. ' +
            'Add the file to your bundler\'s plugin "include"/"exclude" filter ' +
            'or your tsconfig "exclude".',
        );
        this.name = 'ASTBudgetExceededError';
        this.filename = filename;
        this.nodeCount = nodeCount;
    }
}
