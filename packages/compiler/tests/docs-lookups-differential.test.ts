/**
 * The `/e/<code>` pages tell a reader of a production line what the message
 * would have said, from rows the docs generator writes into
 * `apps/docs/src/data/diagnostics.json` (`scripts/diagnostics/docs-lookups.mjs`).
 * The generator reads the compiler's tables, but which form a key reports and
 * how a computed value is spelled are the lowering's decisions, so each row is
 * held to them here: the `sz` literal that row stands for is driven through
 * the runtime `transform()` and through each engine artifact, and every lane
 * must report the row's code and args and print the row's `help` and `note`.
 *
 * A row marked `engine` is a form only the build reports (the runtime never
 * sees an opaque value); it is checked on the engines only.
 *
 * Runs in the `node` environment, where the runtime's development warnings
 * print (see `runtime-engine-diagnostic-differential.test.ts`).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsLiteral } from '../../../scripts/js-literal.mjs';
import { SZ_NODE_DIAGNOSTIC_WORDS } from '../src/diagnostic-node-words.generated.js';
import { PLACEHOLDER } from '../src/diagnostic-placeholder.js';
import { SZ_DIAGNOSTIC_REGISTRY } from '../src/diagnostic-spec.generated.js';
import { isRustTransformAvailable } from '../src/engine.js';
import type { SzDiagnosticIssue } from '../src/engine-spans.js';
import {
    renderEngineDiagnostic,
    transformRustUnrendered,
    transformWasmUnrendered,
    type UnrenderedTransformResult,
} from '../src/internal.js';
import { __resetSzWarnDedupForTests, transform } from '../src/transform-core.js';
import { parseSzConsoleLine, szCodeOf } from './helpers/sz-console-line.js';

/** One row of the generated docs data. */
interface LookupRow {
    args: Record<string, string>;
    values: Record<string, string>;
    engine?: true;
}

/** The rows the docs pages read, by id. */
const LOOKUPS: Record<string, LookupRow[]> = JSON.parse(
    readFileSync(
        path.resolve(import.meta.dirname, '../../../apps/docs/src/data/diagnostics.json'),
        'utf8',
    ),
).lookups;

/** One engine artifact's transform that leaves its diagnostics unrendered. */
type Unrendered = (source: string, filename: string) => UnrenderedTransformResult;

/**
 * The native addon, when it loads and answers for this engine version.
 *
 * @returns The lane, or `undefined` when it is not usable here.
 */
function nativeLane(): Unrendered | undefined {
    if (!isRustTransformAvailable()) return undefined;
    try {
        transformRustUnrendered('export const A = () => <p sz={{ p: 1 }} />;', '/p/probe.jsx');
        return transformRustUnrendered;
    } catch {
        return undefined;
    }
}

const NATIVE = nativeLane();

/** The engine artifacts this run compares against. */
const ENGINES: ReadonlyArray<readonly [string, Unrendered]> = [
    ['wasm', transformWasmUnrendered],
    ...(NATIVE === undefined ? [] : ([['native', NATIVE]] as const)),
];

/**
 * The `sz` source a row stands for: the value that makes the key report the
 * row's form.
 *
 * @param id - The row's id.
 * @param args - The row's args.
 * @returns The source of the `sz` object, as an engine reads it; `undefined`
 *   for a form no literal here drives, which fails that row.
 */
function sourceOf(id: string, args: Record<string, string>): string | undefined {
    const key = jsLiteral(args.key);
    switch (`${id}/${args.form}`) {
        case 'removed-key/removed':
            return `{ ${key}: 'x' }`;
        case 'removed-key/sugar':
        case 'removed-key/sugar-replaced':
        case 'removed-key/replaced':
            return `{ ${key}: true }`;
        case 'removed-key/runtime-alias':
            return `{ ${key}: runtimeValue }`;
        case 'moved-value/value':
            return `{ ${key}: ${jsLiteral(args.value)} }`;
        default:
            return undefined;
    }
}

/**
 * A row's `help` and `note`, filled from its args and values as the page does.
 *
 * @param id - The row's id.
 * @param row - The row.
 * @returns The filled parts the template has.
 */
function expectedParts(id: string, row: LookupRow): { help?: string; note?: string } {
    const spec = SZ_DIAGNOSTIC_REGISTRY.find(entry => entry.id === id);
    const words = { ...spec, ...SZ_NODE_DIAGNOSTIC_WORDS[id] } as Record<string, unknown>;
    const values = { ...row.args, ...row.values };
    const parts: { help?: string; note?: string } = {};
    for (const field of ['help', 'note'] as const) {
        const template = words[field];
        const text =
            typeof template === 'object' && template !== null
                ? (template as Record<string, string>)[row.args.form]
                : (template as string | undefined);
        if (text !== undefined) {
            parts[field] = text.replace(
                PLACEHOLDER,
                (_, name: string) => values[name] ?? `{${name}}`,
            );
        }
    }
    return parts;
}

/**
 * The runtime's line for one object, in one mode.
 *
 * @param source - The object's source, a literal.
 * @param production - Whether to run as a production bundle.
 * @param code - The code to keep.
 * @returns The line headed by the code, if any.
 */
function runtimeLine(source: string, production: boolean, code: string): string | undefined {
    __resetSzWarnDedupForTests();
    const lines: string[] = [];
    const capture = (...args: unknown[]) => {
        lines.push(String(args[0]));
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(capture);
    const error = vi.spyOn(console, 'error').mockImplementation(capture);
    vi.stubEnv('NODE_ENV', production ? 'production' : 'development');
    try {
        transform(new Function(`return (${source});`)());
    } finally {
        vi.unstubAllEnvs();
        warn.mockRestore();
        error.mockRestore();
    }
    return lines.find(line => szCodeOf(line) === code);
}

describe('the docs lookup rows', () => {
    afterEach(() => {
        __resetSzWarnDedupForTests();
    });

    it('cover the ids whose production line needs a computed value', () => {
        expect(Object.keys(LOOKUPS).sort()).toEqual(['moved-value', 'removed-key']);
        expect(Object.values(LOOKUPS).every(rows => rows.length > 0)).toBe(true);
    });

    for (const [id, rows] of Object.entries(LOOKUPS)) {
        for (const row of rows) {
            const label = `${id} ${JSON.stringify(row.args)}`;
            const parts = expectedParts(id, row);
            const source = sourceOf(id, row.args) ?? '';
            it(`${label} has a literal that drives it`, () => {
                expect(
                    sourceOf(id, row.args),
                    `no literal drives ${id}/${row.args.form}`,
                ).toBeDefined();
            });

            for (const [name, engine] of ENGINES) {
                it(`${label} is what the ${name} engine reports and says`, () => {
                    const result = engine(
                        `export const A = ({ runtimeValue }) => <p sz={${source}} />;`,
                        '/p/src/A.jsx',
                    );
                    const issue = (result.issues as SzDiagnosticIssue[]).find(
                        found => found.code === id,
                    );
                    expect(issue, `the engine reports ${id}`).toBeDefined();
                    expect({ ...(issue as SzDiagnosticIssue).args }).toEqual(row.args);
                    const line = parseSzConsoleLine(
                        renderEngineDiagnostic(issue as SzDiagnosticIssue, ''),
                    );
                    expect({ help: line.help, note: line.note }).toEqual({
                        help: parts.help,
                        note: parts.note,
                    });
                });
            }

            if (row.engine) continue;
            it(`${label} is what the runtime prints, in production and in development`, () => {
                const compact = runtimeLine(source, true, id);
                expect(compact, `a production bundle prints ${id}`).toBeDefined();
                const json = /^\[csszyx\] [a-z-]+: (\{.*\}) https:/.exec(compact as string)?.[1];
                expect(JSON.parse(json as string)).toEqual(row.args);
                const line = parseSzConsoleLine(runtimeLine(source, false, id) as string);
                expect({ help: line.help, note: line.note }).toEqual({
                    help: parts.help,
                    note: parts.note,
                });
            });
        }
    }
});
