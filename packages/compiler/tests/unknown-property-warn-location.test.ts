import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { transformRust, transformSource, transformWasm } from '../src/engine.js';
import {
    __resetSzWarnDedupForTests,
    isKnownSzPropertyKey,
    MIGRATION_NOTES,
    SUGGESTION_MAP,
    setSzWarnLocation,
    transform,
} from '../src/transform-core.js';
import { ENGINES, RUST_LANE } from './engine-parity-harness.js';
import { parseSzConsoleLine, szCodeOf } from './helpers/sz-console-line.js';

// Runtime reports print once per message per process; each test asks afresh.
beforeEach(() => {
    __resetSzWarnDedupForTests();
});

function captureWarnings(action: () => void): string[] {
    const calls: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation(message => {
        calls.push(String(message));
    });
    action();
    return calls;
}

/**
 * The lines of one code among some console lines, each read into its parts.
 *
 * @param messages - Console lines.
 * @param code - The code.
 * @returns The lines it heads.
 */
function linesOf(messages: readonly string[], code: string) {
    return messages.filter(m => szCodeOf(m) === code).map(parseSzConsoleLine);
}

/**
 * The "Unknown property" report must point at the offending sz prop —
 * relative to the project root, with a line — so it is findable in a large
 * codebase. Both engine artifacts attach the location in their DIAGNOSTICS;
 * the runtime path (no source file) keeps the location-free console warning,
 * and the location must never leak from a build transform to an unrelated
 * later call.
 */
describe('unknown-property warning — source location', () => {
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        warn.mockRestore();
        setSzWarnLocation(undefined);
    });

    const fixtureSrc = 'export const A = () => (\n  <div sz={{ xyzzy: 4, p: 2 }} />\n);';

    it('the wasm artifact attaches relativePath:line for the sz prop', () => {
        const result = transformWasm(fixtureSrc, '/proj/src/components/Foo.tsx', {
            rootDir: '/proj',
        });
        const messages = result.diagnostics;
        expect(result.issues).toMatchObject([
            { code: 'unknown-key', args: { key: 'xyzzy' }, line: 2, column: 14 },
        ]);
        expect(
            messages.some(m => m.startsWith('[csszyx] unknown-key: src/components/Foo.tsx:2:14\n')),
        ).toBe(true);
        // The relativized path must not contain the absolute root prefix.
        expect(messages.every(m => !m.includes('/proj/src'))).toBe(true);
    });

    it('the selected engine attaches relativePath:line for the sz prop', () => {
        const result = transformSource(fixtureSrc, '/proj/src/components/Bar.tsx', {
            rootDir: '/proj',
        });
        expect(
            result.diagnostics.some(m =>
                m.startsWith('[csszyx] unknown-key: src/components/Bar.tsx:2:14\n'),
            ),
        ).toBe(true);
    });

    it('falls back to the raw filename when no rootDir is given', () => {
        const result = transformWasm(fixtureSrc, 'standalone/Baz.tsx');
        expect(
            result.diagnostics.some(m =>
                m.startsWith('[csszyx] unknown-key: standalone/Baz.tsx:2:14\n'),
            ),
        ).toBe(true);
    });

    it('runtime path (no source file) has no build location but keeps the core message', () => {
        // The browser/runtime `transform()` never sets a build location.
        transform({ xyzzy: 4 });
        const [line] = linesOf(
            warn.mock.calls.map(c => String(c[0])),
            'unknown-key',
        );
        expect(line).toMatchObject({
            text: '`xyzzy` is not an sz property.',
            help: "check the spelling; for a custom utility, define it with Tailwind's `@utility`.",
            note: 'the class is still emitted, and it styles nothing unless Tailwind serves that utility.',
        });
        // No `<file>:<line>` build location on the runtime path: the header
        // names the object instead.
        expect(line?.place).toMatch(/^sz object was \{"xyzzy":4\}/);
    });

    it('does not leak a build location into a later runtime transform', () => {
        transformWasm(fixtureSrc, '/proj/src/components/Foo.tsx', { rootDir: '/proj' });
        warn.mockClear();
        transform({ qqq: 9 });
        const messages = warn.mock.calls.map(c => String(c[0]));
        // The runtime warning must NOT carry Foo.tsx (the post-loop clear ran).
        expect(linesOf(messages, 'unknown-key').map(l => l.text)).toEqual([
            '`qqq` is not an sz property.',
        ]);
        expect(messages.every(m => !m.includes('Foo.tsx'))).toBe(true);
    });

    it('a suggestion-worthy key is also located', () => {
        // `op` is a removed/aliased key; whichever branch fires must carry
        // the location in the diagnostics.
        const opSrc = 'export const A = () => <div sz={{ op: 50 }} />;';
        const result = transformWasm(opSrc, '/proj/src/X.tsx', { rootDir: '/proj' });
        expect(result.issues).toMatchObject([
            { code: 'unknown-key', args: { key: 'op' }, line: 1 },
        ]);
        expect(
            result.diagnostics.some(m => m.startsWith('[csszyx] unknown-key: src/X.tsx:1:')),
        ).toBe(true);
    });

    it.each(['textEllipsis', 'textClip'])(
        '%s emits its class without an unknown-property warning',
        key => {
            const source = `export const A = () => <div sz={{ ${key}: true }} />;`;
            for (const [name, transform] of ENGINES) {
                const result = transform(source, '/proj/src/Text.tsx', { rootDir: '/proj' });
                expect(result.code, name).toContain(
                    key === 'textEllipsis' ? 'text-ellipsis' : 'text-clip',
                );
                expect(
                    (result.issues ?? []).some(issue => issue.code === 'unknown-key'),
                    name,
                ).toBe(false);
            }
        },
    );
});

/**
 * The native and wasm artifacts are one engine, so they warn on exactly the same
 * keys. This is the drift gate for a build of one artifact that differs from the
 * other (a feature-gated table, a stale binary). Skips when no native binary is
 * installed (the diagnostic can only be exercised through the real addon).
 */
describe('unknown-property warning — native and wasm warn on the same keys', () => {
    const rustAvailable = RUST_LANE;
    const runOr = rustAvailable ? it : it.skip;

    const wasmWarns = (key: string, value: string): boolean =>
        transformWasm(`export const A = () => <div sz={{ ${key}: ${value} }} />;`, '/p/F.tsx', {
            rootDir: '/p',
        }).issues.some(issue => issue.code === 'unknown-key');

    const rustWarns = (key: string, value: string): boolean =>
        transformRust(`export const A = () => <div sz={{ ${key}: ${value} }} />;`, '/p/F.tsx', {
            rootDir: '/p',
        }).issues.some(issue => issue.code === 'unknown-key');

    runOr('emits a located, root-relative diagnostic for a typo', () => {
        const result = transformRust(
            'export const A = () => (\n  <div sz={{ xyzzy: 4 }} />\n);',
            '/proj/src/components/Foo.tsx',
            { rootDir: '/proj' },
        );
        expect(result.issues).toMatchObject([
            { code: 'unknown-key', args: { key: 'xyzzy' }, line: 2, column: 14 },
        ]);
        expect(
            result.diagnostics.some(m =>
                m.startsWith('[csszyx] unknown-key: src/components/Foo.tsx:2:14\n'),
            ),
        ).toBe(true);
    });

    runOr('the artifacts agree on every key in the broad warn matrix', () => {
        const keys = [
            // valid: real props, variants, special-cased keys, removed sugar
            'm',
            'p',
            'gap',
            'bg',
            'flexDir',
            'hover',
            'md',
            'data',
            'aria',
            'group',
            'min',
            'fromPos',
            'alignContent',
            // removed aliases: both engines must diagnose them
            'backgroundRepeat',
            'listStyle',
            'maskComposite',
            'maskMode',
            'maskType',
            'ordinal',
            'snapStrictness',
            'snapAlign',
            'content',
            'display',
            'isolation',
            'visibility',
            'textTransform',
            'fontStyle',
            'decoration',
            'list',
            'bgImg',
            'grid',
            'flex',
            'block',
            'italic',
            'underline',
            // flag-only utilities: emit a class but carry no value, so they were
            // absent from rust's boolean_class table and over-warned (field report)
            'truncate',
            'css',
            'textEllipsis',
            'textClip',
            'blur',
            'grayscale',
            'invert',
            'sepia',
            'backdropBlur',
            'backdropGrayscale',
            'backdropInvert',
            'backdropSepia',
            // typos
            'xyzzy',
            'pading',
            'colour',
            'fooBar',
            'wibble',
            'zzz',
        ];
        const disagree: string[] = [];
        for (const key of keys) {
            for (const value of ['"x"', '4', 'true']) {
                if (rustWarns(key, value) !== wasmWarns(key, value)) {
                    disagree.push(`${key}:${value}`);
                }
            }
        }
        expect(disagree).toEqual([]);
    });

    runOr('accepts the css escape hatch without diagnosing its sub-properties', () => {
        const result = transformRust(
            'export const A = () => <div sz={{ css: { writingMode: "vertical-lr" } }} />;',
            '/p/F.tsx',
            { rootDir: '/p' },
        );
        expect(result.classes).toContain('[writing-mode:vertical-lr]');
        expect(result.issues.some(issue => issue.code === 'unknown-key')).toBe(false);
    });

    runOr.each(['textEllipsis', 'textClip'])(
        '%s emits its class without a native diagnostic',
        key => {
            const result = transformRust(
                `export const A = () => <div sz={{ ${key}: true }} />;`,
                '/p/F.tsx',
                { rootDir: '/p' },
            );
            expect(result.classes).toContain(
                key === 'textEllipsis' ? 'text-ellipsis' : 'text-clip',
            );
            expect(result.issues.some(issue => issue.code === 'unknown-key')).toBe(false);
        },
    );
});

/**
 * The project-scan hint is the only pointer a developer gets for a LOCATION-LESS
 * runtime warning (sz built from a variable / spread / szv() / dynamic()), which
 * cannot be traced by eye. It must print the `npx @csszyx/cli check` command for
 * those warnings — it used to be gated on having a source location and so never
 * fired for exactly the case that needs it. The hint fires at most once per
 * process, so each case re-imports the module fresh to reset that latch.
 */
describe('project-scan hint — prints the CLI command for location-less warnings', () => {
    afterEach(() => {
        vi.resetModules();
        vi.restoreAllMocks();
    });

    it('prints the `npx @csszyx/cli check` command for a runtime (no-location) warning', async () => {
        vi.resetModules();
        const calls: string[] = [];
        vi.spyOn(console, 'warn').mockImplementation(m => {
            calls.push(String(m));
        });
        const { transform } = await import('../src/transform-core.js');
        transform({ zzznope: true });
        expect(calls.map(szCodeOf)).toEqual(['unknown-key', 'dev-warnings-partial']);
        // The wording tells the developer why the scan is needed here.
        expect(calls[1]).toBe(
            [
                '[csszyx] dev-warnings-partial: The `sz` key warning above has no source location, so it does not name the file that triggered it.',
                '  help: run `npx @csszyx/cli check` to list every file and key at once; set `CSSZYX_NO_PROJECT_SCAN_HINT=1` to hide this line.',
                '  docs: https://csszyx.com/e/dev-warnings-partial',
            ].join('\n'),
        );
    });

    it('stays silent after a located warning, which names its file', async () => {
        vi.resetModules();
        const calls: string[] = [];
        vi.spyOn(console, 'warn').mockImplementation(m => {
            calls.push(String(m));
        });
        const core = await import('../src/transform-core.js');
        core.setSzWarnLocation('src/Hint.tsx:3');
        try {
            core.transform({ zzzlocated: true });
        } finally {
            core.setSzWarnLocation(undefined);
        }
        expect(calls.map(szCodeOf)).toEqual(['unknown-key']);
    });

    it('stays silent when CSSZYX_NO_PROJECT_SCAN_HINT is set', async () => {
        vi.resetModules();
        const prev = process.env.CSSZYX_NO_PROJECT_SCAN_HINT;
        process.env.CSSZYX_NO_PROJECT_SCAN_HINT = '1';
        const calls: string[] = [];
        vi.spyOn(console, 'warn').mockImplementation(m => {
            calls.push(String(m));
        });
        try {
            const { transform } = await import('../src/transform-core.js');
            transform({ '4': true });
        } finally {
            if (prev === undefined) delete process.env.CSSZYX_NO_PROJECT_SCAN_HINT;
            else process.env.CSSZYX_NO_PROJECT_SCAN_HINT = prev;
        }
        expect(calls.some(m => m.includes('npx @csszyx/cli check'))).toBe(false);
    });
});

/**
 * A numeric (or sequential 0,1,2…) key in an sz object almost always means an
 * array or a spread reached `sz`, not a typo. The warning must name that cause
 * instead of "Check for typos", on the build engines and the runtime path alike.
 */
describe('numeric sz key — array/spread message, not "Check for typos"', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        setSzWarnLocation(undefined);
    });

    it('the wasm artifact names the array/spread cause and keeps the location', () => {
        const result = transformWasm(
            'export const A = () => <div sz={{ 4: true }} />;',
            '/p/F.tsx',
            {
                rootDir: '/p',
            },
        );
        expect(result.issues).toMatchObject([
            { code: 'numeric-key', args: { key: '4' }, line: 1, column: 35 },
        ]);
        const msg = result.diagnostics[0];
        expect(msg).toContain('[csszyx] numeric-key: F.tsx:1:35\n');
        expect(msg).toContain('an array or a spread');
        expect(msg).not.toContain('check the spelling');
    });

    it('the runtime path (no location) uses the same message', () => {
        const calls = captureWarnings(() => transform({ '4': true }));
        expect(linesOf(calls, 'numeric-key')).toMatchObject([
            {
                text: '`sz` received a numeric key `4`, and its value is ignored.',
                help: 'pass an object of sz keys here; a numeric key usually means an array or a spread was passed in its place.',
            },
        ]);
    });

    it.skipIf(!RUST_LANE)('the rust engine emits the same numeric message', () => {
        const result = transformRust(
            'export const A = () => <div sz={{ 4: true }} />;',
            '/p/F.tsx',
            {
                rootDir: '/p',
            },
        );
        expect(result.issues).toMatchObject([
            { code: 'numeric-key', args: { key: '4' }, line: 1, column: 35 },
        ]);
        const msg = result.diagnostics[0];
        expect(msg).toContain('an array or a spread');
        expect(msg).not.toContain('check the spelling');
    });

    it('a real word typo still says to check the spelling', () => {
        const result = transformWasm(
            'export const A = () => <div sz={{ xyzzy: 4 }} />;',
            '/p/F.tsx',
            { rootDir: '/p' },
        );
        expect(result.issues.map(issue => issue.code)).toEqual(['unknown-key']);
        const msg = result.diagnostics[0];
        expect(msg).toContain('`xyzzy` is not an sz property.');
        expect(msg).toContain('help: check the spelling;');
        expect(msg).not.toContain('an array or a spread');
    });
});

/**
 * `csszyx check` runs the engine (`transformSource`) and reads its diagnostics. Unknown/numeric keys inside a `szv()` catalog or a static `szr()`
 * argument already warn (the walk compiles each object through `transform()`),
 * but used to carry no location, so `check` could only attribute them to a file,
 * not a line. The catalog walk now points those warnings at the `szv()` / `szr()`
 * call. `dynamic()` stays location-less — its values are runtime, out of scope.
 */
describe('szv/szr catalog warnings carry a source location (for csszyx check)', () => {
    it('an unknown key in a szv variant is located at its own line', () => {
        const result = transformSource(
            'import { szv } from "@csszyx/runtime";\n' +
                'const s = szv({ variants: { c: { x: { xyzzy: 5, p: 4 } } } });',
            '/proj/src/F.tsx',
            { rootDir: '/proj' },
        );
        expect(result.issues).toMatchObject([
            { code: 'unknown-key', args: { key: 'xyzzy' }, line: 2 },
        ]);
        expect(result.diagnostics[0]).toContain('[csszyx] unknown-key: src/F.tsx:2:');
    });

    it('a numeric key in a szv variant uses the array/spread message, located', () => {
        const result = transformSource(
            'import { szv } from "@csszyx/runtime";\n' +
                'const s = szv({ variants: { c: { x: { 4: true, p: 4 } } } });',
            '/proj/src/F.tsx',
            { rootDir: '/proj' },
        );
        expect(result.issues).toMatchObject([{ code: 'numeric-key', args: { key: '4' }, line: 2 }]);
        expect(result.diagnostics[0]).toContain('[csszyx] numeric-key: src/F.tsx:2:');
        expect(result.diagnostics[0]).toContain('an array or a spread');
    });

    it('an unknown key in a static szr() argument is located at the szr() call', () => {
        const result = transformSource(
            'import { szr } from "@csszyx/runtime";\nconst c = szr({ nope: 1, m: 2 });',
            '/proj/src/F.tsx',
            { rootDir: '/proj' },
        );
        expect(result.issues).toMatchObject([
            { code: 'unknown-key', args: { key: 'nope' }, line: 2 },
        ]);
        expect(result.diagnostics[0]).toContain('[csszyx] unknown-key: src/F.tsx:2:');
    });

    it('dynamic() contributes no build diagnostic (runtime, out of scope)', () => {
        const result = transformSource(
            'import { dynamic } from "csszyx";\nconst d = dynamic({ badkey: 1 });',
            '/proj/src/F.tsx',
            { rootDir: '/proj' },
        );
        expect(result.issues.some(issue => JSON.stringify(issue.args).includes('badkey'))).toBe(
            false,
        );
        expect(result.diagnostics.some(m => m.includes('badkey'))).toBe(false);
    });

    it('both artifacts agree on the catalog diagnostics', () => {
        const src =
            'import { szv } from "@csszyx/runtime";\n' +
            'const s = szv({ variants: { c: { x: { xyzzy: 5 } } } });';
        const wasm = transformWasm(src, '/proj/src/F.tsx', { rootDir: '/proj' });
        for (const [name, transform] of ENGINES) {
            const result = transform(src, '/proj/src/F.tsx', { rootDir: '/proj' });
            expect(result.diagnostics, name).toEqual(wasm.diagnostics);
        }
    });
});

/**
 * A location-less runtime warning (sz built from a variable / spread / szv() or
 * dynamic() result) cannot carry a build `at file:line`, so it attaches what
 * makes it traceable in the browser/SSR console: the offending object's shallow
 * shape and the first user stack frame. A located build warning does NOT get
 * this suffix — its location already names the source.
 */
describe('runtime sz warnings carry object shape + user stack frame', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        setSzWarnLocation(undefined);
    });

    it('attaches the serialized shape and the calling frame on the runtime path', () => {
        const calls: string[] = [];
        vi.spyOn(console, 'warn').mockImplementation(m => {
            calls.push(String(m));
        });
        // A named function stands in for a component; its frame must surface.
        function DataGridRow(): unknown {
            return transform({ '4': true, xyzzy: 9 });
        }
        DataGridRow();
        const [line] = linesOf(calls, 'numeric-key');
        expect(line?.place).toContain('sz object was {"4":true,"xyzzy":9}');
        expect(line?.place).toContain('from DataGridRow');
    });

    it('caps a large object shape instead of dumping it', () => {
        const calls: string[] = [];
        vi.spyOn(console, 'warn').mockImplementation(m => {
            calls.push(String(m));
        });
        const big: Record<string, unknown> = { badkey: 1 };
        for (let i = 0; i < 100; i++) {
            big[`k${i}`] = `value-${i}`;
        }
        transform(big);
        const msg = linesOf(calls, 'unknown-key')[0]?.place ?? '';
        expect(msg).toContain('sz object was ');
        expect(msg).toContain('...');
        // The SHAPE segment is capped (the frame that follows is a source path
        // whose length varies by environment, so it is not bounded here). The
        // serialized shape is capped at 200 chars incl. the trailing ellipsis.
        const start = msg.indexOf('sz object was ') + 'sz object was '.length;
        const sep = msg.indexOf('  ·  ', start);
        const shape = sep >= 0 ? msg.slice(start, sep) : msg.slice(start);
        expect(shape.length).toBeLessThanOrEqual(200);
        expect(shape.endsWith('...')).toBe(true);
    });

    it('does NOT attach shape/frame to a located build diagnostic', () => {
        const msg =
            transformWasm('export const A = () => <div sz={{ xyzzy: 4 }} />;', '/p/F.tsx', {
                rootDir: '/p',
            }).diagnostics.find(m => m.includes('xyzzy')) ?? '';
        expect(msg).toContain('[csszyx] unknown-key: F.tsx:1:');
        expect(msg).not.toContain('sz object was');
    });
});

/**
 * `CSSZYX_QUIET_SZ_WARNINGS=1` mutes every dev-mode sz warning so a team that
 * prefers a quiet dev loop can rely on `csszyx check` instead. Default stays ON —
 * an unknown key is a dropped-class correctness signal, not a style nudge.
 */
describe('CSSZYX_QUIET_SZ_WARNINGS opt-out', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        setSzWarnLocation(undefined);
        delete process.env.CSSZYX_QUIET_SZ_WARNINGS;
    });

    it('warns by default (flag unset)', () => {
        const calls = captureWarnings(() => transform({ xyzzy: 1 }));
        expect(linesOf(calls, 'unknown-key').map(l => l.text)).toEqual([
            '`xyzzy` is not an sz property.',
        ]);
    });

    it('is silent on the runtime path when set to 1', () => {
        process.env.CSSZYX_QUIET_SZ_WARNINGS = '1';
        const calls = captureWarnings(() => transform({ xyzzy: 1 }));
        expect(calls.some(m => m.includes('xyzzy'))).toBe(false);
    });

    it('is silent on the build path when set to 1', () => {
        process.env.CSSZYX_QUIET_SZ_WARNINGS = '1';
        const calls = captureWarnings(() =>
            transformWasm('export const A = () => <div sz={{ xyzzy: 4 }} />;', '/p/F.tsx', {
                rootDir: '/p',
            }),
        );
        expect(calls.some(m => m.includes('xyzzy'))).toBe(false);
    });

    it('only 1 mutes — any other value still warns', () => {
        process.env.CSSZYX_QUIET_SZ_WARNINGS = 'true';
        const calls = captureWarnings(() => transform({ xyzzy: 1 }));
        expect(calls.some(m => m.includes('xyzzy'))).toBe(true);
    });
});

/**
 * Defensive edges of the runtime warning context — a cyclic object must not
 * throw or dump; the warning still fires, just without a serialized shape.
 */
describe('runtime warning context — defensive edges', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        setSzWarnLocation(undefined);
    });

    it('an unserializable value warns without crashing and omits the shape', () => {
        const calls: string[] = [];
        vi.spyOn(console, 'warn').mockImplementation(m => {
            calls.push(String(m));
        });
        // A BigInt value makes JSON.stringify throw, without the nested-object
        // recursion a cyclic object would hit (which trips the depth guard first).
        const bad = { badkey: 1n } as unknown as Parameters<typeof transform>[0];
        expect(() => transform(bad)).not.toThrow();
        const [line] = linesOf(calls, 'unknown-key');
        expect(line?.text).toBe('`badkey` is not an sz property.');
        // JSON.stringify throws → the shape is omitted, but the warning still fires.
        expect(line?.place ?? '').not.toContain('sz object was ');
    });
});

describe('runtime warning context — nothing to name', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('prints the sentence after the code when neither the shape nor a frame is known', () => {
        const calls: string[] = [];
        vi.spyOn(console, 'warn').mockImplementation(m => {
            calls.push(String(m));
        });
        const limit = Error.stackTraceLimit;
        // No frame to read, and a BigInt the shape cannot serialize.
        Error.stackTraceLimit = 0;
        try {
            transform({ unnamedkey: 1n } as unknown as Parameters<typeof transform>[0]);
        } finally {
            Error.stackTraceLimit = limit;
        }
        const [line] = linesOf(calls, 'unknown-key');
        expect(line?.place).toBeUndefined();
        expect(
            calls[0]?.startsWith('[csszyx] unknown-key: `unnamedkey` is not an sz property.'),
        ).toBe(true);
    });
});

describe('unknown-property warning — repeated at runtime', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        __resetSzWarnDedupForTests();
    });

    it('prints once per key, however often the object is lowered', () => {
        // Server-side lowering runs on every render; the report says nothing new
        // the second time, so it would only bury the first one.
        __resetSzWarnDedupForTests();
        const warnings = captureWarnings(() => {
            for (let render = 0; render < 3; render++) {
                transform({ xyzzy: 4, plugh: 2 } as never);
                transform({ backgroundColor: 'red-500' } as never);
            }
        });

        const about = (code: string, text: string) =>
            linesOf(warnings, code).filter(line => line.text === text);
        expect(about('unknown-key', '`xyzzy` is not an sz property.')).toHaveLength(1);
        expect(about('unknown-key', '`plugh` is not an sz property.')).toHaveLength(1);
        expect(
            about(
                'canonical-key',
                '`backgroundColor` is an alias of `bg`, and nothing is emitted for it.',
            ),
        ).toHaveLength(1);
    });
});

describe('unknown-property warning — a flood of distinct keys', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('stops at 512 and says once that it stopped', () => {
        const warnings = captureWarnings(() => {
            for (let index = 0; index < 600; index++) {
                transform({ [`dataKey${index}`]: 4 } as never);
            }
        });

        expect(warnings.filter(w => szCodeOf(w) === 'unknown-key')).toHaveLength(512);
        expect(warnings.filter(w => szCodeOf(w) === 'diagnostics-capped')).toEqual([
            [
                '[csszyx] diagnostics-capped: This process has reported 512 distinct unknown sz keys, so further ones are suppressed.',
                '  help: look above for one key repeating with different names; sz keys built from data are the usual cause.',
                '  docs: https://csszyx.com/e/diagnostics-capped',
            ].join('\n'),
        ]);
    });
});

describe('alias and removed keys', () => {
    it('are never known keys, so their report never needs the check', () => {
        // The alias branch reports without asking `isKnownSzPropertyKey`.
        const keys = [...Object.keys(SUGGESTION_MAP), ...Object.keys(MIGRATION_NOTES)];
        expect(keys.filter(key => isKnownSzPropertyKey(key))).toEqual([]);
    });
});
