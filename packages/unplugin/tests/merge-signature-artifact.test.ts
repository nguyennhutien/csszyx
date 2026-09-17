import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createMergeSignatureTable, type MergeSignature } from '../src/merge-signature.js';
import { createUnservedRuntimeModule } from '../src/virtual-modules.js';

const signature = (...properties: string[]): MergeSignature => ({
    rules: [{ context: '&', properties }],
    important: false,
});

describe('merge signature artifact', () => {
    it.each([64, 256, 1024])('deduplicates %i equal signatures before building coverage', size => {
        const candidates = Array.from({ length: size }, (_, id) => `color-${id}`);
        let lookups = 0;
        const resolve = () => {
            lookups++;
            return signature('color');
        };
        const table = createMergeSignatureTable([...candidates, ...candidates], resolve);
        expect(lookups).toBe(size);
        expect(Object.keys(table[0])).toHaveLength(size);
        expect(table[1]).toEqual([[0]]);
        expect(JSON.stringify(createMergeSignatureTable([...candidates].reverse(), resolve))).toBe(
            JSON.stringify(table),
        );
    });

    it('round-trips hostile class names through generated JavaScript', () => {
        const names = [
            '__proto__',
            'constructor',
            '</script>',
            'content-["x"]',
            'x\\\\y',
            '`',
            '${x}',
        ];
        const table = [
            Object.fromEntries(names.map((name, id) => [name, id])),
            names.map((_, id) => [id]),
        ] as const;
        const module = createUnservedRuntimeModule([], table);
        let received: unknown;
        runInNewContext(module.replace(/^import .*;$/m, ''), {
            registerUnservedClasses() {},
            registerMergeSignatures(value: unknown) {
                received = value;
            },
        });
        expect(JSON.stringify(received)).toBe(JSON.stringify(table));
        expect(module).not.toContain('</script>');
    });

    it('retains prototype-shaped candidate names as own keys', () => {
        const [table] = createMergeSignatureTable(['__proto__', 'constructor'], () =>
            signature('color'),
        );
        expect(Object.hasOwn(table, '__proto__')).toBe(true);
        expect(Object.getOwnPropertyDescriptor(table, '__proto__')?.value).toBe(table.constructor);
    });

    it('sorts candidates and encodes full-set subset coverage deterministically', () => {
        const signatures = new Map([
            ['p-4', signature('padding-bottom', 'padding-left', 'padding-right', 'padding-top')],
            ['pb-2', signature('padding-bottom')],
            ['unknown', null],
        ]);

        const first = createMergeSignatureTable(
            ['unknown', 'p-4', 'pb-2', 'p-4'],
            candidate => signatures.get(candidate) ?? null,
        );
        const second = createMergeSignatureTable(
            ['pb-2', 'p-4', 'unknown'],
            candidate => signatures.get(candidate) ?? null,
        );

        expect(first).toEqual(second);
        expect(first).toEqual([{ 'p-4': 0, 'pb-2': 1 }, [[0, 1], [1]]]);
    });
});
