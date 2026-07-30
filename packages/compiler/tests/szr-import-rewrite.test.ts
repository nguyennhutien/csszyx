/**
 * The szr import rewrite: proof matrix and three-engine decision parity.
 *
 * `import { szr } from '@csszyx/runtime'` ships the browser transform because
 * the barrel's szr must lower sz OBJECTS standalone. When a file provably
 * never passes szr anything but strings, the compiler retargets the import at
 * the `/core` entry (same-package subpath — `csszyx` → `csszyx/core`), whose
 * szr is string-first and compiler-free.
 *
 * Two invariants matter more than any single verdict:
 *
 * 1. **Decision parity.** A `build.parser` flip must not change the emitted
 *    import — one engine rewriting while another keeps the barrel would mean
 *    different bundles per parser. Every case here runs on all three engines
 *    and asserts the same verdict.
 * 2. **Conservative failure.** A wrong "keep" costs bytes; a wrong "rewrite"
 *    crashes at runtime when an object reaches the string-only szr. Every
 *    uncertain shape must therefore KEEP.
 */
import { describe, expect, it } from 'vitest';
import { countSzrWordOccurrences } from '../src/szr-import-rewrite.js';
import { transformSourceCode } from '../src/transform.js';
import { transformOxc } from '../src/transform-oxc.js';
import { isRustTransformAvailable, transformRust } from '../src/transform-rust.js';

type Engine = (source: string, filename?: string) => { code?: string };

const LANES: ReadonlyArray<readonly [string, Engine]> = [
    ['babel', transformSourceCode],
    ['oxc', transformOxc as Engine],
    ...(isRustTransformAvailable() ? ([['rust', transformRust as Engine]] as const) : []),
];

/**
 * Whether one engine rewrote the file's szr import to a core entry.
 *
 * @param engine - Engine entry under test.
 * @param source - Full module source.
 * @returns True when the emitted import targets a `/core` subpath.
 */
function rewrites(engine: Engine, source: string): boolean {
    const code = engine(source, '/p/t.tsx').code ?? source;
    return (
        code.includes('@csszyx/runtime/core') ||
        code.includes("'csszyx/core'") ||
        code.includes('"csszyx/core"')
    );
}

const RUNTIME = "import { szr } from '@csszyx/runtime';\n";

/** Sources that must be rewritten to the core entry. */
const REWRITE_CASES: ReadonlyArray<readonly [string, string]> = [
    ['string literals', `${RUNTIME}export const a = szr('p-4', 'm-2');`],
    ['template literal (any interpolation)', `${RUNTIME}export const a = szr(\`p-\${size}\`);`],
    ['&& guard — falsy left is skipped', `${RUNTIME}export const a = szr(cond && 'm-2');`],
    ['ternary of strings', `${RUNTIME}export const a = szr(wide ? 'w-full' : 'w-64');`],
    ['array of strings', `${RUNTIME}export const a = szr(['p-4', on && 'x']);`],
    ['falsy literals', `${RUNTIME}export const a = szr('p-4', false, null, undefined);`],
    ['umbrella source', "import { szr } from 'csszyx';\nexport const a = szr('p-4');"],
    [
        'double-quoted source',
        'import { szr } from "@csszyx/runtime";\nexport const a = szr("p-4");',
    ],
    ['imported but never called', `${RUNTIME}export const a = 1;`],
    ['multiple proven calls', `${RUNTIME}const x = szr('a'); export const b = szr('b', \`c\`);`],
    ['parenthesized string argument', `${RUNTIME}export const a = szr(('p-4'));`],
    ['inside JSX', `${RUNTIME}export const A = () => <div className={szr('p-4')} />;`],
];

/** Sources that must keep the barrel import. */
const KEEP_CASES: ReadonlyArray<readonly [string, string]> = [
    ['object argument', `${RUNTIME}export const a = szr({ p: 4 });`],
    ['identifier argument', `${RUNTIME}export const a = szr(cfg);`],
    ['call argument', `${RUNTIME}export const a = szr(mk());`],
    ['member argument', `${RUNTIME}export const a = szr(theme.card);`],
    ['|| with unprovable left', `${RUNTIME}export const a = szr(cfg || 'p-4');`],
    ['?? with unprovable left', `${RUNTIME}export const a = szr(cfg ?? 'p-4');`],
    ['TS assertion is not proof', `${RUNTIME}export const a = szr(x as string);`],
    ['spread argument', `${RUNTIME}export const a = szr(...parts);`],
    ['array with spread', `${RUNTIME}export const a = szr(['p-4', ...rest]);`],
    ['array with object element', `${RUNTIME}export const a = szr(['p-4', { m: 2 }]);`],
    ['numeric argument (truthy non-string)', `${RUNTIME}export const a = szr(4);`],
    ['true literal (truthy non-string)', `${RUNTIME}export const a = szr(true);`],
    ['szr passed as a value', `${RUNTIME}export const a = ['x'].map(szr);`],
    ['szr referenced without call', `${RUNTIME}export const helper = szr;`],
    ['member call on szr', `${RUNTIME}export const a = szr.call(null, 'x');`],
    [
        'shadowing declaration',
        `${RUNTIME}function f(szr) { return szr('x'); }\nexport const a = szr('p-4');`,
    ],
    ['comment mentions szr', `${RUNTIME}// szr is called below\nexport const a = szr('p-4');`],
    [
        'string mentions szr',
        `${RUNTIME}export const a = szr('p-4'); export const doc = 'call szr here';`,
    ],
    ['aliased import', "import { szr as r } from '@csszyx/runtime';\nexport const a = r('p-4');"],
    [
        'multi-specifier clause',
        "import { szr, szv } from '@csszyx/runtime';\nexport const a = szr('p-4');",
    ],
    ['unmapped source package', "import { szr } from 'other-lib';\nexport const a = szr('p-4');"],
    ['one proven and one unsafe call', `${RUNTIME}const x = szr('a'); export const b = szr(cfg);`],
];

describe.each(LANES)('%s lane', (_lane, engine) => {
    it.each(REWRITE_CASES)('rewrites: %s', (_name, source) => {
        expect(rewrites(engine, source)).toBe(true);
    });

    it.each(KEEP_CASES)('keeps the barrel: %s', (_name, source) => {
        expect(rewrites(engine, source)).toBe(false);
    });

    it('leaves the rest of the module intact when rewriting', () => {
        const source = `${RUNTIME}export const a = szr('p-4');\nexport const other = 42;`;
        const code = engine(source, '/p/t.tsx').code ?? source;
        expect(code).toContain('@csszyx/runtime/core');
        expect(code).not.toMatch(/from ['"]@csszyx\/runtime['"]/);
        expect(code).toContain("szr('p-4')");
        expect(code).toContain('42');
    });
});

describe('three-engine decision parity', () => {
    const all = [...REWRITE_CASES, ...KEEP_CASES];
    it.each(all)('every engine agrees on: %s', (_name, source) => {
        const verdicts = LANES.map(([, engine]) => rewrites(engine, source));
        expect(new Set(verdicts).size).toBe(1);
    });
});

describe('countSzrWordOccurrences', () => {
    it('counts standalone words only', () => {
        expect(countSzrWordOccurrences("szr('a'); myszr(); szr2(); a.szr; 'szr'")).toBe(3);
    });

    it('treats non-ASCII neighbours as boundaries — the overcounting direction', () => {
        // `szrΩ` is one identifier, but counting it can only FAIL the proof.
        expect(countSzrWordOccurrences('const szrΩ = 1;')).toBe(1);
    });

    it('returns zero for an empty or unrelated source', () => {
        expect(countSzrWordOccurrences('')).toBe(0);
        expect(countSzrWordOccurrences('const sz = 1; const zr = 2;')).toBe(0);
    });
});
