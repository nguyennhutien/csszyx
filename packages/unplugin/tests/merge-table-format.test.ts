/**
 * The plugin writes the table's format beside it, and it is the one the
 * runtime reads.
 *
 * Two numbers, one per side, so that a plugin and a runtime from different
 * releases disagree loudly instead of merging on a misread table. This test
 * is what keeps them equal within one release.
 */
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { _szcn, szcn } from '../../runtime/src/merge-classes.js';
import {
    __resetMergeSignaturesForTests,
    MERGE_TABLE_FORMAT as READ,
    registerMergeSignatures,
} from '../../runtime/src/merge-signatures.js';
import { isUnservedClass, registerUnservedClasses } from '../../runtime/src/unserved-classes.js';
import { MERGE_TABLE_FORMAT as WRITTEN } from '../src/merge-signature.js';
import { createUnservedRuntimeModule } from '../src/virtual-modules.js';

afterEach(() => {
    __resetMergeSignaturesForTests();
    registerUnservedClasses([]);
    vi.restoreAllMocks();
});

describe('the merge table format', () => {
    it('is the one the runtime reads', () => {
        expect(WRITTEN).toBe(READ);
    });

    it.each(['esm', 'cjs'] as const)('travels with the table in the %s module', format => {
        const source = createUnservedRuntimeModule([], [{ 'p-4': 0 }, [[0]]], format);
        expect(source).not.toContain('import.meta.hot');
        let options: unknown;
        runInNewContext(source.replace(/^(import|const) .*;$/m, ''), {
            JSON,
            registerUnservedClasses() {},
            registerMergeSignatures(_table: unknown, given: unknown) {
                options = given;
            },
        });

        expect(options).toEqual({ format: WRITTEN });
    });

    it.each([8, 128, 1024])('replaces hot registration state for %i candidates', size => {
        const listeners = new Map<string, (data: unknown) => void>();
        const source = createUnservedRuntimeModule([], [{}, []], 'vite');
        const execute = (hot: unknown) =>
            runInNewContext(
                source.replace(/^(import|const) .*;$/m, '').replaceAll('import.meta.hot', 'hot'),
                { JSON, hot, registerUnservedClasses, registerMergeSignatures },
            );
        // The same dev module is also evaluated by SSR, with no client HMR context.
        execute(undefined);
        execute({
            on: (event: string, listener: (data: unknown) => void) =>
                listeners.set(event, listener),
        });
        expect([...listeners.keys()]).toEqual(['csszyx:merge-table']);
        const update = listeners.get('csszyx:merge-table');
        assert.ok(update);
        const names = Array.from({ length: size }, (_, index) => `item-${index}`);
        const table = [Object.fromEntries(names.map(name => [name, 0])), [[0]]];
        const payload = { classes: ['tab-custom'], table, format: WRITTEN };
        const merge = () => [szcn(names[0], names[1]), _szcn(names[0], names[1])];
        expect(merge()).toEqual(['item-0 item-1', 'item-0 item-1']);
        // Delivery is JSON over a websocket; repeat delivery must preserve semantics.
        for (let round = 0; round < 3; round += 1) {
            update(JSON.parse(JSON.stringify(payload)));
            expect(merge()).toEqual(['item-1', 'item-1']);
            expect(isUnservedClass('tab-custom')).toBe(true);
        }
        update({ classes: [], table: [{}, []], format: WRITTEN });
        expect(merge()).toEqual(['item-0 item-1', 'item-0 item-1']);
        expect(isUnservedClass('tab-custom')).toBe(false);
        update(payload);
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        update({ ...payload, format: WRITTEN + 1 });
        expect(merge()).toEqual(['item-0 item-1', 'item-0 item-1']);
        update(payload);
        expect(merge()).toEqual(['item-1', 'item-1']);
    });
});
