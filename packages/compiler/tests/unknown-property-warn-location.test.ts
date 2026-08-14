import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    isRustTransformAvailable,
    transformRust,
    transformSource,
    transformWasm,
} from '../src/index.js';
import { setSzWarnLocation, transform } from '../src/transform-core.js';

function captureWarnings(action: () => void): string[] {
    const calls: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation(message => {
        calls.push(String(message));
    });
    action();
    return calls;
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
        expect(messages.some(m => m.includes('Unknown property "xyzzy"'))).toBe(true);
        expect(messages.some(m => m.includes('at src/components/Foo.tsx:2.'))).toBe(true);
        // The relativized path must not contain the absolute root prefix.
        expect(messages.every(m => !m.includes('/proj/src'))).toBe(true);
    });

    it('the selected engine attaches relativePath:line for the sz prop', () => {
        const result = transformSource(fixtureSrc, '/proj/src/components/Bar.tsx', {
            rootDir: '/proj',
        });
        expect(result.diagnostics.some(m => m.includes('at src/components/Bar.tsx:2.'))).toBe(true);
    });

    it('falls back to the raw filename when no rootDir is given', () => {
        const result = transformWasm(fixtureSrc, 'standalone/Baz.tsx');
        expect(result.diagnostics.some(m => m.includes('at standalone/Baz.tsx:2.'))).toBe(true);
    });

    it('runtime path (no source file) has no build location but keeps the core message', () => {
        // The browser/runtime `transform()` never sets a build location.
        transform({ xyzzy: 4 });
        const msg = warn.mock.calls.map(c => String(c[0])).find(m => m.includes('xyzzy'));
        expect(msg).toBeDefined();
        expect(msg).toContain('Unknown property "xyzzy" in sz prop.');
        expect(msg).toContain(
            'The class is still emitted, so it styles nothing unless Tailwind serves that utility. Check for typos.',
        );
        // No `at <file>:<line>` build location on the runtime path.
        expect(msg).not.toMatch(/ at \S+:\d+/);
    });

    it('does not leak a build location into a later runtime transform', () => {
        transformWasm(fixtureSrc, '/proj/src/components/Foo.tsx', { rootDir: '/proj' });
        warn.mockClear();
        transform({ qqq: 9 });
        const messages = warn.mock.calls.map(c => String(c[0]));
        // The runtime warning must NOT carry Foo.tsx (the post-loop clear ran).
        expect(messages.some(m => m.includes('Unknown property "qqq"'))).toBe(true);
        expect(messages.every(m => !m.includes('Foo.tsx'))).toBe(true);
    });

    it('a suggestion-worthy key is also located', () => {
        // `op` is a removed/aliased key; whichever branch fires must carry
        // the location in the diagnostics.
        const opSrc = 'export const A = () => <div sz={{ op: 50 }} />;';
        const result = transformWasm(opSrc, '/proj/src/X.tsx', { rootDir: '/proj' });
        expect(result.diagnostics.some(m => m.includes('at src/X.tsx'))).toBe(true);
    });

    it.each(['textEllipsis', 'textClip'])(
        '%s emits its class without a Babel or oxc warning',
        key => {
            const source = `export const A = () => <div sz={{ ${key}: true }} />;`;
            expect(
                transformSource(source, '/proj/src/Text.tsx', { rootDir: '/proj' }).code,
            ).toContain(key === 'textEllipsis' ? 'text-ellipsis' : 'text-clip');
            expect(
                transformWasm(source, '/proj/src/Text.tsx', { rootDir: '/proj' }).code,
            ).toContain(key === 'textEllipsis' ? 'text-ellipsis' : 'text-clip');
            const all = [
                ...transformSource(source, '/proj/src/Text.tsx', { rootDir: '/proj' }).diagnostics,
                ...transformWasm(source, '/proj/src/Text.tsx', { rootDir: '/proj' }).diagnostics,
            ];
            expect(all.some(m => m.includes('Unknown property'))).toBe(false);
        },
    );
});

/**
 * The native (Rust) engine emits the same warning via `result.diagnostics`. The
 * hard safety invariant is that it must NEVER over-warn — flag a key the oxc
 * engine considers valid (that would be a false typo warning on real code). It
 * MAY under-warn on value-dependent edge cases (a missed dev nudge is harmless).
 * This is the drift gate: a new special-cased key in the Rust lowering that is
 * not taught to `is_known_sz_key` would fail here. Skips when no native binary is
 * installed (the diagnostic can only be exercised through the real addon).
 */
describe('unknown-property warning — Rust engine parity (no over-warn)', () => {
    const rustAvailable = isRustTransformAvailable();
    const runOr = rustAvailable ? it : it.skip;

    const wasmWarns = (key: string, value: string): boolean =>
        transformWasm(`export const A = () => <div sz={{ ${key}: ${value} }} />;`, '/p/F.tsx', {
            rootDir: '/p',
        }).diagnostics.some(m => m.includes('Unknown property'));

    const rustWarns = (key: string, value: string): boolean =>
        transformRust(`export const A = () => <div sz={{ ${key}: ${value} }} />;`, '/p/F.tsx', {
            rootDir: '/p',
        }).diagnostics.some(m => m.includes('Unknown property'));

    runOr('emits a located, root-relative diagnostic for a typo', () => {
        const result = transformRust(
            'export const A = () => (\n  <div sz={{ xyzzy: 4 }} />\n);',
            '/proj/src/components/Foo.tsx',
            { rootDir: '/proj' },
        );
        expect(
            result.diagnostics.some(
                m =>
                    m.includes('Unknown property "xyzzy"') &&
                    m.includes('at src/components/Foo.tsx:2'),
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
        const overWarns: string[] = [];
        for (const key of keys) {
            for (const value of ['"x"', '4', 'true']) {
                if (rustWarns(key, value) && !wasmWarns(key, value)) {
                    overWarns.push(`${key}:${value}`);
                }
            }
        }
        expect(overWarns).toEqual([]);
    });

    runOr('accepts the css escape hatch without diagnosing its sub-properties', () => {
        const result = transformRust(
            'export const A = () => <div sz={{ css: { writingMode: "vertical-lr" } }} />;',
            '/p/F.tsx',
            { rootDir: '/p' },
        );
        expect(result.classes).toContain('[writing-mode:vertical-lr]');
        expect(result.diagnostics.some(message => message.includes('Unknown property'))).toBe(
            false,
        );
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
            expect(result.diagnostics.some(message => message.includes('Unknown property'))).toBe(
                false,
            );
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
        expect(calls.some(m => m.includes('Unknown property "zzznope"'))).toBe(true);
        const hint = calls.find(m => m.includes('npx @csszyx/cli check'));
        expect(
            hint,
            'the CLI-scan command must be printed for a location-less warning',
        ).toBeDefined();
        // The wording tells the developer why the scan is needed here.
        expect(hint).toContain('no source location');
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
        const calls = transformWasm(
            'export const A = () => <div sz={{ 4: true }} />;',
            '/p/F.tsx',
            { rootDir: '/p' },
        ).diagnostics;
        const msg = calls.find(m => m.includes('numeric key "4"'));
        expect(msg).toBeDefined();
        expect(msg).toContain('an array or a spread');
        expect(msg).toContain('at F.tsx:1');
        expect(msg).not.toContain('Check for typos');
    });

    it('the runtime path (no location) uses the same message', () => {
        const calls = captureWarnings(() => transform({ '4': true }));
        const msg = calls.find(m => m.includes('numeric key "4"'));
        expect(msg).toBeDefined();
        expect(msg).toContain('an array or a spread');
        expect(msg).not.toContain('Check for typos');
    });

    it.skipIf(!isRustTransformAvailable())('the rust engine emits the same numeric message', () => {
        const diagnostics = transformRust(
            'export const A = () => <div sz={{ 4: true }} />;',
            '/p/F.tsx',
            { rootDir: '/p' },
        ).diagnostics;
        const msg = diagnostics.find(m => m.includes('numeric key "4"'));
        expect(msg).toBeDefined();
        expect(msg).toContain('an array or a spread');
        expect(msg).not.toContain('Check for typos');
    });

    it('a real word typo still says "Check for typos"', () => {
        const calls = transformWasm(
            'export const A = () => <div sz={{ xyzzy: 4 }} />;',
            '/p/F.tsx',
            { rootDir: '/p' },
        ).diagnostics;
        const msg = calls.find(m => m.includes('Unknown property "xyzzy"'));
        expect(msg).toBeDefined();
        expect(msg).toContain('Check for typos');
    });
});

/**
 * `csszyx check` runs the Babel reference lowering and captures `[csszyx]`
 * warnings. Unknown/numeric keys inside a `szv()` catalog or a static `szr()`
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
        const msg = result.diagnostics.find(m => m.includes('Unknown property "xyzzy"'));
        expect(msg, result.diagnostics.join('\n')).toBeDefined();
        expect(msg).toContain('at src/F.tsx:2');
    });

    it('a numeric key in a szv variant uses the array/spread message, located', () => {
        const result = transformSource(
            'import { szv } from "@csszyx/runtime";\n' +
                'const s = szv({ variants: { c: { x: { 4: true, p: 4 } } } });',
            '/proj/src/F.tsx',
            { rootDir: '/proj' },
        );
        const msg = result.diagnostics.find(m => m.includes('numeric key "4"'));
        expect(msg, result.diagnostics.join('\n')).toBeDefined();
        expect(msg).toContain('at src/F.tsx:2');
        expect(msg).toContain('an array or a spread');
    });

    it('an unknown key in a static szr() argument is located at the szr() call', () => {
        const result = transformSource(
            'import { szr } from "@csszyx/runtime";\nconst c = szr({ nope: 1, m: 2 });',
            '/proj/src/F.tsx',
            { rootDir: '/proj' },
        );
        const msg = result.diagnostics.find(m => m.includes('Unknown property "nope"'));
        expect(msg, result.diagnostics.join('\n')).toBeDefined();
        expect(msg).toContain('at src/F.tsx:2');
    });

    it('dynamic() contributes no build diagnostic (runtime, out of scope)', () => {
        const result = transformSource(
            'import { dynamic } from "csszyx";\nconst d = dynamic({ badkey: 1 });',
            '/proj/src/F.tsx',
            { rootDir: '/proj' },
        );
        expect(result.diagnostics.some(m => m.includes('badkey'))).toBe(false);
    });

    it('both artifacts agree on the catalog diagnostics', () => {
        const src =
            'import { szv } from "@csszyx/runtime";\n' +
            'const s = szv({ variants: { c: { x: { xyzzy: 5 } } } });';
        const native = transformSource(src, '/proj/src/F.tsx', { rootDir: '/proj' });
        const wasm = transformWasm(src, '/proj/src/F.tsx', { rootDir: '/proj' });
        expect(wasm.diagnostics).toEqual(native.diagnostics);
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
        const msg = calls.find(m => m.includes('numeric key "4"')) ?? '';
        expect(msg).toContain('sz object was {"4":true,"xyzzy":9}');
        expect(msg).toContain('from DataGridRow');
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
        const msg = calls.find(m => m.includes('Unknown property "badkey"')) ?? '';
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
        expect(msg).toContain('at F.tsx:1');
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
        expect(calls.some(m => m.includes('Unknown property "xyzzy"'))).toBe(true);
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
        const msg = calls.find(m => m.includes('Unknown property "badkey"')) ?? '';
        expect(msg).toBeTruthy();
        // JSON.stringify throws → the shape is omitted, but the warning still fires.
        expect(msg).not.toContain('sz object was ');
    });
});
