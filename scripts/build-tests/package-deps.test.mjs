/**
 * Every published package declares the packages its shipped files import, and
 * imports what it declares.
 *
 * `@csszyx/runtime` declared `@csszyx/core` from the first release while no
 * runtime file imported it, and `@csszyx/cli` listed a types-only package as a
 * runtime dependency; neither failed anything. The rules and the allowlists
 * live in `scripts/check-package-deps.mjs`.
 *
 * Reads the built packages and FAILS when they are not built, so a missing
 * input never reads as a pass.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { checkAll } from '../check-package-deps.mjs';

test('published packages declare exactly the packages they import', () => {
    const { problems, checked } = checkAll();
    assert.ok(checked > 0, 'no published package found under packages/');
    assert.deepEqual(problems, []);
});
