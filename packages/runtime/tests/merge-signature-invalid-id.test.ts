import { afterEach, expect, it } from 'vitest';

import { szcn } from '../src/merge-classes.js';
import {
    __resetMergeSignaturesForTests,
    registerMergeSignatures,
} from '../src/merge-signatures.js';

afterEach(() => __resetMergeSignaturesForTests());

it('does not remove an unrelated class when malformed numeric metadata has no ordered match', () => {
    // Map accepts NaN as a key, but Array.indexOf cannot find it. The generated
    // table never writes this id; registration is still a runtime boundary.
    registerMergeSignatures([{ broken: Number.NaN, keep: 0 }, [[0]]]);
    const classes = szcn('broken keep', 'broken').split(' ');
    expect(classes).toContain('keep');
    expect(classes).toContain('broken');
});
