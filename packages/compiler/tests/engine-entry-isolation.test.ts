/**
 * `transform-core.ts` is the browser lowering, the largest module of the
 * package. A process that imports `@csszyx/compiler/engine` or `/internal`
 * calls the engine and renders its diagnostics, and needs none of the
 * lowering: only the key and value tables the diagnostic renderer reads,
 * which live in leaf modules the lowering imports too. These walk the value
 * imports of both entries and fail when one reaches the lowering again.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SZ_DIAGNOSTIC_REGISTRY } from '../src/diagnostic-spec.generated.js';
import { compilerSrc, reachable } from './helpers/value-import-graph.js';

const LOWERING = path.join(compilerSrc, 'transform-core.ts');
/** The words of the ids Node renders beyond the engine's: a check pass, a build line. */
const NODE_WORDS = path.join(compilerSrc, 'diagnostic-node-words.generated.ts');
/**
 * Every id a console line or a throw reports, one plain literal each, so a
 * bundle keeps only the ones it names.
 */
const BROWSER_WORDS = path.join(compilerSrc, 'diagnostic-browser.generated.ts');
/** An import or re-export from the browser words module: its names, and whether it is a type. */
const FROM_BROWSER_WORDS =
    /(?:import|export)\s+(type\s+)?(\*|\{[^}]*\})[^;]*?from\s+'\.\/diagnostic-browser\.generated\.js'/g;

/**
 * The values the files an entry reaches take from the browser words module.
 *
 * @param entry - The entry's source file name.
 * @returns The names, sorted; `*` for a namespace import or re-export.
 */
function browserWordsTaken(entry: string): string[] {
    const taken = new Set<string>();
    for (const file of reachable([path.join(compilerSrc, entry)])) {
        if (file === BROWSER_WORDS) continue;
        for (const [, type, names] of readFileSync(file, 'utf8').matchAll(FROM_BROWSER_WORDS)) {
            if (type !== undefined) continue;
            for (const name of names.replace(/[{}]/g, '').split(',')) {
                const trimmed = name.trim();
                if (trimmed !== '' && !trimmed.startsWith('type ')) taken.add(trimmed);
            }
        }
    }
    return [...taken].sort();
}

/**
 * The constant the browser words module exports an id under.
 *
 * @param id - A registry id.
 * @returns The constant's name.
 */
const constName = (id: string): string => id.toUpperCase().replaceAll('-', '_');

/**
 * The words each Node entry (`./engine`, `./internal`, `./migrate`) throws:
 * the ids of errors Node raises from the engine's own lane, the template
 * lowering and the peer-module loader. The bundle keeps exactly these
 * literals of the module (`//#region src/diagnostic-browser.generated.ts`).
 */
const THROWN_BY_ENTRY = {
    'engine.ts': [
        'ENGINE_VERSION_SKEW',
        'INTERNAL_ERROR',
        'OPTIONS_OBJECT_REQUIRED__ENGINE_CALL',
        'WASM_ENGINE_UNAVAILABLE',
    ],
    'internal.ts': [
        'ENGINE_VERSION_SKEW',
        'INTERNAL_ERROR',
        'OPTIONS_OBJECT_REQUIRED__ENGINE_CALL',
        'PEER_MODULE_UNRESOLVED',
        'TEMPLATE_RUNTIME_VALUE',
        'TEMPLATE_SZ_INVALID',
        'WASM_ENGINE_UNAVAILABLE',
    ],
    'migrate-rust.ts': [
        'ENGINE_VERSION_SKEW',
        'INTERNAL_ERROR',
        'NATIVE_MIGRATE_UNAVAILABLE',
        'OPTIONS_OBJECT_REQUIRED__ENGINE_CALL',
    ],
} as const;

describe('the engine entries load no lowering', () => {
    it.each(['engine.ts', 'internal.ts'])('%s reaches no transform-core.ts', entry => {
        const reached = reachable([path.join(compilerSrc, entry)]);
        // The renderer is reached, so the walk followed the path the tables
        // are read on.
        expect(reached).toContain(path.join(compilerSrc, 'diagnostic-render-helpers.ts'));
        expect(reached).toContain(path.join(compilerSrc, 'sz-key-suggestion.ts'));
        expect(reached).not.toContain(LOWERING);
    });

    it.each(['engine.ts', 'internal.ts'])(
        '%s loads the engine words and none of what only other Node lines say',
        entry => {
            const reached = reachable([path.join(compilerSrc, entry)]);
            expect(reached).toContain(path.join(compilerSrc, 'diagnostic-registry.generated.ts'));
            expect(reached).not.toContain(NODE_WORDS);
        },
    );

    it.each(Object.entries(THROWN_BY_ENTRY))(
        '%s takes from the browser words module only the ids it throws',
        (entry, thrown) => {
            expect(browserWordsTaken(entry)).toEqual([...thrown].sort());
        },
    );

    it('lets an entry take only the words of an error Node throws', () => {
        const nodeErrors = SZ_DIAGNOSTIC_REGISTRY.filter(spec => {
            const host = (spec.surfaces as { error?: { host?: string } }).error?.host;
            return host === 'node' || host === 'both';
        }).map(spec => constName(spec.id));
        for (const thrown of Object.values(THROWN_BY_ENTRY)) {
            // A one-form export (`<ID>__<FORM>`) is the words of its id.
            const ids = thrown.map(name => name.split('__')[0]);
            expect(nodeErrors).toEqual(expect.arrayContaining(ids));
        }
    });

    it('reads the names of every form an import from the browser words module takes', () => {
        const text = [
            "import { A, type B, C } from './diagnostic-browser.generated.js';",
            "import type { D } from './diagnostic-browser.generated.js';",
            "export * from './diagnostic-browser.generated.js';",
        ].join('\n');
        expect([...text.matchAll(FROM_BROWSER_WORDS)].map(match => [match[1], match[2]])).toEqual([
            [undefined, '{ A, type B, C }'],
            ['type ', '{ D }'],
            [undefined, '*'],
        ]);
    });

    it('leaves those words to the root, whose renderer prints every Node line', () => {
        expect(reachable([path.join(compilerSrc, 'index.ts')])).toContain(NODE_WORDS);
    });
});
