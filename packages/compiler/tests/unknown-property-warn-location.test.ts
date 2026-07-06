import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    isRustTransformAvailable,
    transformOxc,
    transformRust,
    transformSourceCode,
} from '../src/index.js';
import { setSzWarnLocation, transform } from '../src/transform-core.js';

/**
 * The dev-mode "Unknown property" warning must point at the offending sz prop —
 * relative to the project root, with a line — so it is findable in a large
 * codebase. The build engines (oxc + babel) attach the location; the runtime
 * path (no source file) keeps the location-free message; and the location must
 * never leak from a build transform to an unrelated later call.
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

    it('oxc attaches relativePath:line for the sz prop', () => {
        transformOxc(fixtureSrc, '/proj/src/components/Foo.tsx', { rootDir: '/proj' });
        const messages = warn.mock.calls.map(c => String(c[0]));
        expect(messages.some(m => m.includes('Unknown property "xyzzy"'))).toBe(true);
        expect(messages.some(m => m.includes('at src/components/Foo.tsx:2.'))).toBe(true);
        // The relativized path must not contain the absolute root prefix.
        expect(messages.every(m => !m.includes('/proj/src'))).toBe(true);
    });

    it('babel attaches relativePath:line for the sz prop', () => {
        transformSourceCode(fixtureSrc, '/proj/src/components/Bar.tsx', { rootDir: '/proj' });
        const messages = warn.mock.calls.map(c => String(c[0]));
        expect(messages.some(m => m.includes('at src/components/Bar.tsx:2.'))).toBe(true);
    });

    it('falls back to the raw filename when no rootDir is given', () => {
        transformOxc(fixtureSrc, 'standalone/Baz.tsx');
        const messages = warn.mock.calls.map(c => String(c[0]));
        expect(messages.some(m => m.includes('at standalone/Baz.tsx:2.'))).toBe(true);
    });

    it('runtime path (no source file) has no build location but keeps the core message', () => {
        // The browser/runtime `transform()` never sets a build location.
        transform({ xyzzy: 4 });
        const msg = warn.mock.calls.map(c => String(c[0])).find(m => m.includes('xyzzy'));
        expect(msg).toBeDefined();
        expect(msg).toContain('Unknown property "xyzzy" in sz prop.');
        expect(msg).toContain('This will be ignored. Check for typos.');
        // No `at <file>:<line>` build location on the runtime path.
        expect(msg).not.toMatch(/ at \S+:\d+/);
    });

    it('does not leak a build location into a later runtime transform', () => {
        transformOxc(fixtureSrc, '/proj/src/components/Foo.tsx', { rootDir: '/proj' });
        warn.mockClear();
        transform({ qqq: 9 });
        const messages = warn.mock.calls.map(c => String(c[0]));
        // The runtime warning must NOT carry Foo.tsx (the post-loop clear ran).
        expect(messages.some(m => m.includes('Unknown property "qqq"'))).toBe(true);
        expect(messages.every(m => !m.includes('Foo.tsx'))).toBe(true);
    });

    it('a suggestion warning is also located', () => {
        // `op` is a removed/aliased key that triggers the suggestion branch.
        const opSrc = 'export const A = () => <div sz={{ op: 50 }} />;';
        transformOxc(opSrc, '/proj/src/X.tsx', { rootDir: '/proj' });
        const messages = warn.mock.calls.map(c => String(c[0]));
        // Whichever canonical-key/unknown branch fires, it must carry the location.
        expect(messages.some(m => m.includes('at src/X.tsx'))).toBe(true);
    });
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

    const oxcWarns = (key: string, value: string): boolean => {
        const calls: string[] = [];
        const spy = vi.spyOn(console, 'warn').mockImplementation(m => {
            calls.push(String(m));
        });
        transformOxc(`export const A = () => <div sz={{ ${key}: ${value} }} />;`, '/p/F.tsx', {
            rootDir: '/p',
        });
        spy.mockRestore();
        return calls.some(m => m.includes('Unknown property'));
    };

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

    runOr('never over-warns relative to oxc across a broad key/value matrix', () => {
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
                if (rustWarns(key, value) && !oxcWarns(key, value)) {
                    overWarns.push(`${key}:${value}`);
                }
            }
        }
        expect(overWarns).toEqual([]);
    });
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

    it('keeps the build-context wording when a location IS present', async () => {
        vi.resetModules();
        const calls: string[] = [];
        vi.spyOn(console, 'warn').mockImplementation(m => {
            calls.push(String(m));
        });
        const { transformOxc } = await import('../src/index.js');
        transformOxc('export const A = () => <div sz={{ xyzzy: 4 }} />;', '/p/F.tsx', {
            rootDir: '/p',
        });
        const hint = calls.find(m => m.includes('npx @csszyx/cli check'));
        expect(hint).toBeDefined();
        expect(hint).toContain('as you open them');
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

    const collectWarn = (fn: () => void): string[] => {
        const calls: string[] = [];
        vi.spyOn(console, 'warn').mockImplementation(m => {
            calls.push(String(m));
        });
        fn();
        return calls;
    };

    it('oxc names the array/spread cause and keeps the location', () => {
        const calls = collectWarn(() =>
            transformOxc('export const A = () => <div sz={{ 4: true }} />;', '/p/F.tsx', {
                rootDir: '/p',
            }),
        );
        const msg = calls.find(m => m.includes('numeric key "4"'));
        expect(msg).toBeDefined();
        expect(msg).toContain('an array or a spread');
        expect(msg).toContain('at F.tsx:1');
        expect(msg).not.toContain('Check for typos');
    });

    it('the runtime path (no location) uses the same message', () => {
        const calls = collectWarn(() => transform({ '4': true }));
        const msg = calls.find(m => m.includes('numeric key "4"'));
        expect(msg).toBeDefined();
        expect(msg).toContain('an array or a spread');
        expect(msg).not.toContain('Check for typos');
    });

    it('the rust engine emits the same numeric message', () => {
        if (!isRustTransformAvailable()) return;
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
        const calls = collectWarn(() =>
            transformOxc('export const A = () => <div sz={{ xyzzy: 4 }} />;', '/p/F.tsx', {
                rootDir: '/p',
            }),
        );
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
    afterEach(() => {
        vi.restoreAllMocks();
        setSzWarnLocation(undefined);
    });

    const warnsFor = (src: string): string[] => {
        const calls: string[] = [];
        vi.spyOn(console, 'warn').mockImplementation(m => {
            calls.push(String(m));
        });
        transformSourceCode(src, '/proj/src/F.tsx', { rootDir: '/proj' });
        return calls;
    };

    it('an unknown key in a szv variant is located at the szv() call', () => {
        const calls = warnsFor(
            'import { szv } from "@csszyx/runtime";\n' +
                'const s = szv({ variants: { c: { x: { xyzzy: 5, p: 4 } } } });',
        );
        const msg = calls.find(m => m.includes('Unknown property "xyzzy"'));
        expect(msg).toBeDefined();
        expect(msg).toContain('at src/F.tsx:2');
    });

    it('a numeric key in a szv variant is located and uses the array/spread message', () => {
        const calls = warnsFor(
            'import { szv } from "@csszyx/runtime";\n' +
                'const s = szv({ variants: { c: { x: { 4: true, p: 4 } } } });',
        );
        const msg = calls.find(m => m.includes('numeric key "4"'));
        expect(msg).toBeDefined();
        expect(msg).toContain('at src/F.tsx:2');
        expect(msg).toContain('an array or a spread');
    });

    it('an unknown key in a static szr() argument is located at the szr() call', () => {
        const calls = warnsFor(
            'import { szr } from "@csszyx/runtime";\n' + 'const c = szr({ nope: 1, m: 2 });',
        );
        const msg = calls.find(m => m.includes('Unknown property "nope"'));
        expect(msg).toBeDefined();
        expect(msg).toContain('at src/F.tsx:2');
    });

    it('dynamic() keeps the location-less message (runtime, out of scope)', () => {
        const calls = warnsFor(
            'import { dynamic } from "csszyx";\nconst d = dynamic({ badkey: 1 });',
        );
        const msg = calls.find(m => m.includes('Unknown property "badkey"'));
        expect(msg).toBeDefined();
        expect(msg).not.toContain(' at ');
    });

    it('the catalog location does not leak into a later sz prop warning', () => {
        const calls = warnsFor(
            'import { szv } from "@csszyx/runtime";\n' +
                'const s = szv({ variants: { c: { x: { xyzzy: 5 } } } });\n' +
                'export const A = () => <div sz={{ zzz: 1 }} />;',
        );
        // The sz prop on line 3 must report its OWN line, not the szv() line 2.
        const msg = calls.find(m => m.includes('Unknown property "zzz"'));
        expect(msg).toBeDefined();
        expect(msg).toContain('at src/F.tsx:3');
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
        // The whole suffix stays bounded (cap + framing), never the full object.
        const suffix = msg.slice(msg.indexOf('sz object was'));
        expect(suffix.length).toBeLessThan(320);
    });

    it('does NOT attach shape/frame to a located build warning', () => {
        const calls: string[] = [];
        vi.spyOn(console, 'warn').mockImplementation(m => {
            calls.push(String(m));
        });
        transformOxc('export const A = () => <div sz={{ xyzzy: 4 }} />;', '/p/F.tsx', {
            rootDir: '/p',
        });
        const msg = calls.find(m => m.includes('xyzzy')) ?? '';
        expect(msg).toContain('at F.tsx:1');
        expect(msg).not.toContain('sz object was');
    });
});
