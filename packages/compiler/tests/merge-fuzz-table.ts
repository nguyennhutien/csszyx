/**
 * Generated merge tables for the differential tests of the engine's merges.
 *
 * @module
 */
import { createRng } from '../../core/tests/helpers/sz-fuzz.js';
import type { EngineMergeTable } from '../src/index.js';

/**
 * A random table over some classes: some get no signature, some share one,
 * and a row may cover any ids, name its own, or be missing.
 *
 * @param classes - The classes the table may sign.
 * @param tableSeed - Seed for the table's randomness.
 * @returns The table in the engine's shape.
 */
export function randomTable(classes: readonly string[], tableSeed: number): EngineMergeTable {
    const rng = createRng(tableSeed);
    const ids = Math.max(1, Math.ceil(classes.length / 2));
    const signatures: Record<string, number> = {};
    for (const className of new Set(classes)) {
        if (rng() < 0.25) continue;
        signatures[className] = Math.floor(rng() * ids);
    }
    // One row short now and then: a signature past the end covers nothing.
    const rows = rng() < 0.2 ? ids - 1 : ids;
    const coverage: number[][] = [];
    for (let row = 0; row < rows; row += 1) {
        const covered: number[] = [];
        for (let id = 0; id < ids; id += 1) {
            if (rng() < 0.3) covered.push(id);
        }
        coverage.push(covered);
    }
    return { format: 1, signatures, coverage };
}
