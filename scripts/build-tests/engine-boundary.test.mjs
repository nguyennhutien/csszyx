/**
 * The engine stays behind `@csszyx/compiler/engine` and the build-only
 * subpaths, and the browser packages install none of it; the rules live in
 * `scripts/check-engine-boundary.mjs`.
 *
 * Reads the built packages and FAILS when they are not built.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { checkEngineBoundary } from '../check-engine-boundary.mjs';

test('only the build subpaths reach the engine, and the browser packages install none', () => {
    const { problems, engineSubpaths } = checkEngineBoundary();
    assert.deepEqual(problems, []);
    assert.deepEqual(engineSubpaths, ['./engine', './internal', './migrate']);
});
