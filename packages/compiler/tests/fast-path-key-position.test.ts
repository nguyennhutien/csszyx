/**
 * A key the fast path reads is reported on the line it is written.
 *
 * A flat static object skips the parser and is split on its commas. Each key
 * kept the offset of its text inside its own comma-separated part but not the
 * part's place in the object, so every key after the first was reported on
 * the object's first line: a typo on line 3 of a multi-line `sz` read as line 2.
 */
import { describe, expect, it } from 'vitest';

import { ENGINES } from './engine-parity-harness.js';

describe.each(ENGINES)('fast-path key positions — %s', (_name, transform) => {
    it('reports a key on a later line of the object on that line', () => {
        const source = 'export const A = () => <div sz={{\n  p: 4,\n  xyzzy: 4,\n}} />;';
        const diagnostics = transform(source, '/p/src/A.tsx').diagnostics ?? [];

        expect(diagnostics).toEqual([
            expect.stringContaining('Unknown property "xyzzy" in sz prop at /p/src/A.tsx:3.'),
        ]);
    });
});
