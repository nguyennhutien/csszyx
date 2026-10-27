/**
 * The transform the build lanes call leaves each diagnostic unrendered, and
 * rendering one later gives the message the rendering transform gives.
 *
 * A build prints a handful of its findings and counts or drops the rest, so
 * the bundler plugin, the Next loader and jest render only what they print.
 * Each freeze source is the corpus: every engine code and form, on both
 * artifacts.
 */
import { describe, expect, it } from 'vitest';

import {
    diagnosticFileOf,
    renderEngineDiagnostic,
    transformRustBatchUnrendered,
    transformSourceUnrendered,
} from '../src/internal.js';
import { transformRustBatch } from '../src/transform-rust.js';
import { transformSource } from '../src/transform-select.js';
import { FREEZE_SOURCES } from './diagnostic-freeze-sources.js';
import { RUST_LANE, UNRENDERED_ENGINES } from './engine-parity-harness.js';

// The modules below are named `authored`, not `source`: the extracted parity
// corpus collects every `const source` of the test files.
describe.each(UNRENDERED_ENGINES)(
    'the unrendered transform — %s',
    (_name, rendered, unrendered) => {
        it('renders each issue later as the rendering transform renders it now', () => {
            let issues = 0;
            for (const { source, filename, options } of FREEZE_SOURCES) {
                const file = filename ?? 'src/freeze.tsx';
                const eager = rendered(source, { filename: file, ...options });
                const lazy = unrendered(source, { filename: file, ...options });

                expect(lazy.diagnostics).toEqual([]);
                expect(lazy.issues?.map(issue => issue.code)).toEqual(
                    eager.issues?.map(issue => issue.code),
                );
                for (const [index, issue] of (lazy.issues ?? []).entries()) {
                    expect(renderEngineDiagnostic(issue, lazy.diagnosticFile)).toBe(
                        eager.diagnostics?.[index],
                    );
                    expect(issue.args).toEqual(eager.issues?.[index]?.args);
                    issues += 1;
                }
            }

            expect(issues).toBeGreaterThanOrEqual(FREEZE_SOURCES.length);
        });

        it('computes no suggestion for an unknown key until it is rendered', () => {
            const authored = "export const A = () => <div sz={{ workBreak: 'all' }} />;";
            const [issue] = unrendered(authored, { filename: '/p/src/A.tsx' }).issues ?? [];

            expect(issue?.args).toEqual({ key: 'workBreak' });
        });

        it('names the file a rendered header names: relative to the root it was given', () => {
            const authored = "export const A = () => <div sz={{ workBreak: 'all' }} />;";

            expect(
                unrendered(authored, { filename: '/p/src/A.tsx', rootDir: '/p' }).diagnosticFile,
            ).toBe('src/A.tsx');
            expect(
                rendered(authored, { filename: '/p/src/A.tsx', rootDir: '/p' }).diagnostics?.[0],
            ).toContain('unknown-key: src/A.tsx:1:');
        });
    },
);

describe.skipIf(!RUST_LANE)('transformRustBatchUnrendered', () => {
    it("renders each file's issues later as the rendering batch renders them now", () => {
        const files = FREEZE_SOURCES.filter(entry => entry.options === undefined).map(entry => ({
            filename: entry.filename ?? 'src/freeze.tsx',
            source: entry.source,
        }));
        const eager = transformRustBatch(files);
        const lazy = transformRustBatchUnrendered(files);

        expect(lazy.map(result => result.diagnostics)).toEqual(files.map(() => []));
        expect(
            lazy.map(result =>
                (result.issues ?? []).map(issue =>
                    renderEngineDiagnostic(issue, result.diagnosticFile),
                ),
            ),
        ).toEqual(eager.map(result => result.diagnostics));
    });
});

describe('transformSourceUnrendered', () => {
    it('answers as the artifact transformSource picks does, unrendered', () => {
        const authored = "export const A = () => <div sz={{ workBreak: 'all', p: 4 }} />;";
        const eager = transformSource(authored, { filename: '/p/src/A.tsx' });
        const lazy = transformSourceUnrendered(authored, { filename: '/p/src/A.tsx' });

        expect(lazy.code).toBe(eager.code);
        expect(lazy.diagnostics).toEqual([]);
        expect(
            lazy.issues?.map(issue => renderEngineDiagnostic(issue, lazy.diagnosticFile)),
        ).toEqual(eager.diagnostics);
    });
});

describe('diagnosticFileOf', () => {
    it('reads the path of an unrendered result, and nothing from a rendered one', () => {
        const authored = "export const A = () => <div sz={{ workBreak: 'all' }} />;";

        expect(
            diagnosticFileOf(transformSourceUnrendered(authored, { filename: 'src/A.tsx' })),
        ).toBe('src/A.tsx');
        expect(
            diagnosticFileOf(transformSource(authored, { filename: 'src/A.tsx' })),
        ).toBeUndefined();
    });
});
