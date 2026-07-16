import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { extractClassStrings, isValidTailwindToken } from './extract-corpus-classes.js';

describe('extractClassStrings', () => {
    it('extracts targeted class attributes and helper arguments', () => {
        const source = `
            <div className="flex items-center text-sm" />
            const classes = cn('grid gap-4', dynamic);
        `;

        const extracted = extractClassStrings(source);
        assert.ok(extracted.includes('flex items-center text-sm'));
        assert.ok(extracted.includes('grid gap-4'));
    });

    it('accepts Tailwind-like generic theme strings but rejects prose', () => {
        const source = `
            const theme = { base: "flex items-center gap-2" };
            const message = "this sentence contains ordinary prose words";
        `;

        assert.deepEqual(extractClassStrings(source), ['flex items-center gap-2']);
    });

    it('ignores dynamic templates and captures with too few valid tokens', () => {
        const source = `
            <div className={\`flex \${active ? 'block' : 'hidden'}\`} />
            <div className="flex calc(100%-1rem) prose" />
        `;

        assert.deepEqual(extractClassStrings(source), []);
    });
});

describe('isValidTailwindToken', () => {
    it('bounds tokens and excludes CSS expressions', () => {
        assert.equal(isValidTailwindToken('hover:bg-red-500'), true);
        assert.equal(isValidTailwindToken('calc(100%-1rem)'), false);
        assert.equal(isValidTailwindToken('-'), false);
        assert.equal(isValidTailwindToken(`p-${'x'.repeat(121)}`), false);
    });
});
