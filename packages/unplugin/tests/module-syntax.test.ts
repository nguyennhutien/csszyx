/**
 * The format a module is loaded in, as the prefix registration reads it: the
 * extension first, then the module's own syntax, then the package type.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { moduleFormatOf } from '../src/module-syntax.js';

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * A package directory with the given `type`.
 *
 * @param type - The package type, or undefined for none.
 * @returns The directory.
 */
function packageDir(type?: string): string {
    const root = mkdtempSync(join(tmpdir(), 'csszyx-module-format-'));
    roots.push(root);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'p', type }));
    return root;
}

describe('moduleFormatOf', () => {
    const esm = () => true;
    const cjs = () => false;

    it('takes the extension over what the parse found', () => {
        expect(moduleFormatOf('/a/x.mjs', cjs)).toBe('esm');
        expect(moduleFormatOf('/a/x.mts?v=1', cjs)).toBe('esm');
        expect(moduleFormatOf('/a/x.cjs', esm)).toBe('cjs');
        expect(moduleFormatOf('/a/x.cts', esm)).toBe('cjs');
    });

    it('asks the parse only when the extension does not settle it', () => {
        let asked = 0;
        const counted = () => {
            asked += 1;
            return true;
        };
        moduleFormatOf('/a/x.mjs', counted);
        expect(asked).toBe(0);
        expect(moduleFormatOf('/a/x.js', counted)).toBe('esm');
        expect(asked).toBe(1);
    });

    it('reads the package type for a file the parse found no module syntax in', () => {
        expect(moduleFormatOf(join(packageDir('module'), 'x.js'), cjs)).toBe('esm');
        expect(moduleFormatOf(join(packageDir(), 'x.js'), cjs)).toBe('cjs');
    });

    it('is CommonJS for a module with no path and no module syntax', () => {
        expect(moduleFormatOf(undefined, cjs)).toBe('cjs');
    });
});
