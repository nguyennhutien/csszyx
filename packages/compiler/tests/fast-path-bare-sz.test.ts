/**
 * A bare `sz` attribute beside static ones is reported as it is alone.
 *
 * A file whose `sz` values are all flat static objects is lowered without the
 * parser, and that scan counted only `sz=` attributes: `<span sz />` beside
 * `<div sz={{ p: 4 }}>` was invisible to it, so the file was transformed with
 * no word about the bare one, which the parser path reports.
 */
import { describe, expect, it } from 'vitest';

import { ENGINES } from './engine-parity-harness.js';

const SOURCE = 'export const A = () => <div sz={{ p: 4 }}><span sz /></div>;';

describe.each(ENGINES)('a bare sz beside a static one — %s', (_name, transform) => {
    it('is reported at the attribute', () => {
        const result = transform(SOURCE, { filename: '/p/src/A.tsx' });

        expect(result.issues?.map(issue => [issue.code, issue.line, issue.column])).toEqual([
            ['unsupported-dynamic-sz', 1, 49],
        ]);
    });

    it('is left as written, while the static one is lowered', () => {
        expect(transform(SOURCE, { filename: '/p/src/A.tsx' }).code).toBe(
            'export const A = () => <div className="p-4"><span sz /></div>;',
        );
    });
});
