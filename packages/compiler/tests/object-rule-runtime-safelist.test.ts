import { describe, expect, it } from 'vitest';

import type { EngineMergeTable } from '../src/index.js';
import { ENGINES } from './engine-parity-harness.js';

// Candidate collection is not emission: runtime objects keep every class,
// even when static siblings in the same file are merged by the build.
describe.each(ENGINES)('%s runtime candidates with the object rule', (_, transform) => {
    for (const classPrefix of [undefined, 'tw']) {
        const prefix = classPrefix === undefined ? '' : `${classPrefix}:`;
        const table: EngineMergeTable = {
            format: 1,
            signatures: { [`${prefix}p-4`]: 0, [`${prefix}pb-2`]: 1 },
            coverage: [[1], []],
        };

        describe(`stylesheet prefix ${prefix || '(none)'}`, () => {
            for (const variants of [['hover'], ['md', 'hover']]) {
                for (const branch of ['c ? {pb:2,p:4} : {p:8}', 'c && {pb:2,p:4}']) {
                    const nested = variants.reduceRight(
                        (value, variant) => `{${variant}:${value}}`,
                        `{...(${branch})}`,
                    );
                    const object = `{...${nested},w:width}`;
                    for (const sz of [object, `[${object}]`]) {
                        it(`safelists runtime classes in ${sz}`, () => {
                            const source = `export const A=({c,width})=><><div sz={{pb:2,p:4}}/><div sz={${sz}}/><div sz={{pb:2,p:4}}/></>`;
                            const plain = transform(source, 'a.tsx', { classPrefix });
                            const merged = transform(source, 'a.tsx', {
                                classPrefix,
                                mergeTable: table,
                            });
                            const expected = `${prefix}${variants.join(':')}:pb-2`;
                            expect([...(plain.classes ?? [])]).toContain(expected);
                            expect([...(merged.classes ?? [])]).toContain(expected);
                            expect([...(merged.classes ?? [])].sort()).toEqual(
                                [...(plain.classes ?? [])].sort(),
                            );
                            expect(merged.code).toBe(
                                plain.code?.replaceAll(
                                    `className="${prefix}pb-2 ${prefix}p-4"`,
                                    `className="${prefix}p-4"`,
                                ),
                            );
                            expect(merged.code?.match(/className="[^"]*"/g)).toEqual([
                                `className="${prefix}p-4"`,
                                `className="${prefix}p-4"`,
                            ]);
                        });
                    }
                }
            }
        });
    }
});
