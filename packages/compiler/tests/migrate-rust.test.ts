/**
 * The native migrate seen from JavaScript.
 *
 * `packages/core/tests/migrate_source_parity.rs` proves the Rust port writes
 * what the TypeScript writes. This replays the same corpus through the napi
 * binding, so the bridging — options across, batching, results back in the
 * TypeScript's shape — is proven on the built binary too. Batching groups
 * the cases by option set, the way a migrate run sends a whole job at once.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
    isRustMigrateAvailable,
    migrateRustBatch,
    migrateRustHtml,
    RustMigrateUnavailableError,
} from '../src/migrate-rust.js';

interface Corpus {
    customMap: Record<string, unknown>;
    sources: { file: string; source: string }[];
    cases: {
        src: number;
        options: { injectTodos?: boolean; keysOnly?: boolean; customMap?: boolean };
        result: Record<string, unknown> & { warnings: string[] };
    }[];
    htmlCases: {
        name: string;
        source: string;
        options: Record<string, unknown>;
        result: Record<string, unknown>;
    }[];
}

const corpus: Corpus = JSON.parse(
    readFileSync(
        fileURLToPath(
            new URL('../../core/tests/fixtures/migrate-source-parity-corpus.json', import.meta.url),
        ),
        'utf8',
    ),
);

/**
 * A parser failure is worded by the parser; only its prefix is shared.
 *
 * @param result - A recorded or produced transform result.
 * @param file - The file the result is for.
 * @returns The result with a parse-error warning reduced to its prefix.
 */
function withoutParserWording(result: Record<string, unknown>, file: string) {
    const warnings = result.warnings as string[];
    const prefix = `Parse error in ${file}: `;
    if (warnings.length === 1 && warnings[0]?.startsWith(prefix)) {
        return { ...result, warnings: [prefix] };
    }
    return result;
}

describe('migrateRustBatch', () => {
    it('answers availability once and keeps answering the same', () => {
        const first = isRustMigrateAvailable();
        expect(isRustMigrateAvailable()).toBe(first);
    });

    it.skipIf(!isRustMigrateAvailable())(
        'writes what the TypeScript transformer writes, one batch per option set',
        () => {
            const groups = new Map<string, Corpus['cases']>();
            for (const entry of corpus.cases) {
                const key = JSON.stringify(entry.options);
                groups.set(key, [...(groups.get(key) ?? []), entry]);
            }
            let changed = 0;
            for (const [key, entries] of groups) {
                const options = JSON.parse(key) as Corpus['cases'][number]['options'];
                const results = migrateRustBatch(
                    entries.map(entry => ({
                        filename: corpus.sources[entry.src]?.file ?? '',
                        source: corpus.sources[entry.src]?.source ?? '',
                    })),
                    {
                        injectTodos: options.injectTodos,
                        keysOnly: options.keysOnly,
                        customMap: options.customMap ? corpus.customMap : undefined,
                    },
                );
                expect(results).toHaveLength(entries.length);
                entries.forEach((entry, index) => {
                    const file = corpus.sources[entry.src]?.file ?? '';
                    if (entry.result.changed) changed++;
                    expect(
                        withoutParserWording(results[index] as Record<string, unknown>, file),
                        file,
                    ).toEqual(withoutParserWording(entry.result, file));
                });
            }
            expect(changed).toBeGreaterThan(100);
        },
    );

    it.skipIf(!isRustMigrateAvailable())('writes what the TypeScript HTML pass writes', () => {
        for (const entry of corpus.htmlCases) {
            expect(migrateRustHtml(entry.source, entry.options), entry.name).toEqual(entry.result);
        }
    });

    it.skipIf(!isRustMigrateAvailable())('refuses a resolution map that is not an object', () => {
        expect(() =>
            migrateRustBatch([{ filename: 'a.tsx', source: '<div className="p-4" />' }], {
                customMap: [1] as unknown as Record<string, unknown>,
            }),
        ).toThrow(/customMapJson/);
    });

    it.skipIf(isRustMigrateAvailable())(
        'names the install problem when the engine is absent',
        () => {
            expect(() => migrateRustBatch([])).toThrow(RustMigrateUnavailableError);
            expect(() => migrateRustHtml('<div class="p-4" />')).toThrow(
                RustMigrateUnavailableError,
            );
        },
    );
});
