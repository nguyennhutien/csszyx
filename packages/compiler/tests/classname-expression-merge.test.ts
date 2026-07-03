/**
 * A className EXPRESSION next to a static `sz` object must survive as a runtime
 * merge — never be overwritten by the compiled classes.
 *
 * Regression for the vui 0.10.10 field report item 1: the oxc static-sz path
 * merged only a string-literal className and OVERWROTE any expression
 * (`className={isMobile ? undefined : 'dems-panel'}` next to `sz={{ p: 4 }}`
 * compiled to `className="p-4"`, silently deleting the panel class). Babel and
 * the native engine already emitted `className={_szMerge(<expr>, "<compiled>")}`;
 * oxc now matches byte-for-byte.
 *
 * Fixtures are field-named (not `const source = ...`) so the extracted-corpus
 * meta-test does not sample them.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { loadNativeBinding } from '../../core/native/index.js';
import { transformSourceCode } from '../src/transform.js';
import { transformOxc } from '../src/transform-oxc.js';
import { isRustTransformAvailable, transformRust } from '../src/transform-rust.js';

/**
 * Extract the transformed JSX element for stable comparison.
 * @param code - transformed source.
 * @returns the element text, single-spaced.
 */
function element(code: string): string {
    return code.replace(/\s+/g, ' ').match(/<(Row|Flex|div)[\s\S]*?\/>/)?.[0] ?? code;
}

const FIXTURES: Array<{ name: string; tsx: string; expectMerge: string }> = [
    {
        name: 'ternary className (the reported dems-panel shape)',
        tsx: 'export const A = ({ isMobile }) => <Row className={isMobile ? undefined : "dems-panel"} sz={{ p: 4 }} />;',
        expectMerge: '_szMerge(isMobile ? undefined : "dems-panel", "p-4")',
    },
    {
        name: 'identifier className',
        tsx: 'export const A = ({ cls }) => <Row className={cls} sz={{ p: 4 }} />;',
        expectMerge: '_szMerge(cls, "p-4")',
    },
    {
        name: 'clsx(...) call className',
        tsx: 'export const A = ({ d }) => <Flex className={clsx("multi", d && "on")} sz={{ py: 1.5 }} />;',
        expectMerge: '_szMerge(clsx("multi", d && "on"), "py-1.5")',
    },
    {
        name: 'szcn(...) call className',
        tsx: 'export const A = ({ c }) => <Row className={szcn(c)} sz={{ p: 4 }} />;',
        expectMerge: '_szMerge(szcn(c), "p-4")',
    },
    {
        name: 'member-expression className',
        tsx: 'export const A = (p) => <Row className={p.cls} sz={{ p: 4 }} />;',
        expectMerge: '_szMerge(p.cls, "p-4")',
    },
    {
        name: 'template-literal className',
        tsx: 'export const A = ({ c }) => <Row className={`x ${c}`} sz={{ p: 4 }} />;',
        expectMerge: '_szMerge(`x ${c}`, "p-4")',
    },
    {
        name: 'sz before className (attribute order flipped)',
        tsx: 'export const A = ({ c }) => <Row sz={{ p: 4 }} className={c} />;',
        expectMerge: '_szMerge(c, "p-4")',
    },
    {
        name: 'host element',
        tsx: 'export const A = ({ c }) => <div className={c} sz={{ p: 4 }} />;',
        expectMerge: '_szMerge(c, "p-4")',
    },
    {
        name: 'empty static sz still keeps the expression',
        tsx: 'export const A = ({ c }) => <Row className={c} sz={{}} />;',
        expectMerge: '_szMerge(c, "")',
    },
    {
        name: 'spread sibling attribute',
        tsx: 'export const A = ({ c, ...r }) => <Row className={c} sz={{ p: 4 }} {...r} />;',
        expectMerge: '_szMerge(c, "p-4")',
    },
];

describe('className expression + static sz merges (never overwritten)', () => {
    beforeAll(() => {
        const here = path.dirname(fileURLToPath(import.meta.url));
        try {
            loadNativeBinding(path.resolve(here, '../../core-linux-arm64-gnu'));
        } catch {
            // Binding absent — rust assertions are skipped below.
        }
    });

    for (const fixture of FIXTURES) {
        it(`oxc merges and matches babel — ${fixture.name}`, () => {
            const oxc = transformOxc(fixture.tsx, 'F.tsx');
            const babel = transformSourceCode(fixture.tsx, 'F.tsx');
            expect(element(oxc.code), 'oxc keeps the expression').toContain(fixture.expectMerge);
            expect(element(babel.code), 'babel keeps the expression').toContain(
                fixture.expectMerge,
            );
            // The static classes are still safelisted even though the emission is
            // a runtime merge.
            expect([...oxc.classes]).toEqual([...babel.classes]);
        });

        it.skipIf(!isRustTransformAvailable())(
            `rust is byte-identical to oxc — ${fixture.name}`,
            () => {
                const oxc = transformOxc(fixture.tsx, 'F.tsx');
                const rust = transformRust(fixture.tsx, 'F.tsx');
                expect(element(rust.code)).toBe(element(oxc.code));
                expect([...rust.classes]).toEqual([...oxc.classes]);
            },
        );
    }

    it('string-literal className still merges into one static string', () => {
        const tsx = 'export const A = () => <Row className="static-x" sz={{ p: 4 }} />;';
        for (const engine of [transformOxc, transformSourceCode]) {
            const out = element(engine(tsx, 'F.tsx').code);
            expect(out).toContain('className="static-x p-4"');
            expect(out).not.toContain('_szMerge');
        }
    });

    it('sets the runtime/merge flags so the import gets injected (oxc)', () => {
        const tsx = 'export const A = ({ c }) => <Row className={c} sz={{ p: 4 }} />;';
        const result = transformOxc(tsx, 'F.tsx');
        expect(result.metadata?.usesRuntime ?? result.usesRuntime).toBe(true);
        expect(result.metadata?.usesMerge ?? result.usesMerge).toBe(true);
    });
});
