/**
 * The Next source glob is built from the module flavours the build lowers;
 * the CLI help states it as text, because `bin.ts` loads no command module
 * before one is chosen. This pins the two together.
 */
import { readFileSync } from 'node:fs';

import { SOURCE_MODULE_EXTENSIONS } from '@csszyx/tailwind-oracle';
import { describe, expect, it } from 'vitest';

import { DEFAULT_NEXT_SOURCE_PATTERN } from '../src/commands/next-patterns.js';

describe('DEFAULT_NEXT_SOURCE_PATTERN', () => {
    it('names every module flavour the build lowers', () => {
        for (const extension of SOURCE_MODULE_EXTENSIONS) {
            expect(DEFAULT_NEXT_SOURCE_PATTERN).toContain(extension.slice(1));
        }
    });

    it('is the default the help of `next-prebuild` and `next-watch` states', () => {
        const bin = readFileSync(new URL('../src/bin.ts', import.meta.url), 'utf8');
        expect(bin.split(`(pattern default: ${DEFAULT_NEXT_SOURCE_PATTERN})`)).toHaveLength(3);
    });
});
