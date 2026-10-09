/**
 * A `.jsx` sz object may repeat a key, and JavaScript keeps the first place
 * and the last value. The runtime lowers the object JavaScript built, so the
 * build has to read the repeat the same way, on both artifacts, for every key:
 * the family keys were settled that way already, every other key emitted each
 * occurrence (`{ p: 2, p: 4 }` gave `p-2 p-4`, where the runtime gives `p-4`).
 */
import { describe, expect, it } from 'vitest';

import { transform } from '../src/transform-core.js';
import { captureWarnings, ENGINES } from './engine-parity-harness.js';

/**
 * What the runtime makes of the same text: JSON reads a repeated key as an
 * object literal does, and `transform` is the runtime lowering.
 *
 * @param json - The object, as JSON.
 * @returns The className the runtime emits.
 */
function runtimeClassName(json: string): string {
    return transform(JSON.parse(json)).className;
}

const CASES: ReadonlyArray<readonly [string, string, string]> = [
    ['a plain key', '{ p: 2, m: 1, p: 4 }', '{"p":2,"m":1,"p":4}'],
    ['a quoted and a bare spelling', "{ 'p': 2, m: 1, p: 4 }", '{"p":2,"m":1,"p":4}'],
    ['a key inside a variant', '{ hover: { p: 2, p: 4 } }', '{"hover":{"p":2,"p":4}}'],
    [
        'a variant object, replaced whole',
        '{ hover: { p: 2 }, m: 1, hover: { bg: "red-500" } }',
        '{"hover":{"p":2},"m":1,"hover":{"bg":"red-500"}}',
    ],
];

describe.each(ENGINES)('%s reads a repeated key as JavaScript does', (_name, engine) => {
    it.each(CASES)('%s', (_case, sz, json) => {
        const run = captureWarnings(
            engine,
            `export const A = () => <p sz={${sz}} />;`,
            '/p/src/Repeat.jsx',
        );

        expect(run.className).toBe(runtimeClassName(json));
    });
});
