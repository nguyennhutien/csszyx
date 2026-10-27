/**
 * A className EXPRESSION next to a static `sz` object must survive as a runtime
 * merge — never be overwritten by the compiled classes.
 *
 * Regression for the vui 0.10.10 field report item 1: the since-removed oxc
 * static-sz lane merged only a string-literal className and OVERWROTE any
 * expression (`className={isMobile ? undefined : 'dems-panel'}` next to
 * `sz={{ p: 4 }}` compiled to `className="p-4"`, silently deleting the panel
 * class). The engine emits `className={_szMerge(<expr>, "<compiled>")}`, and
 * its native and wasm artifacts must agree byte-for-byte.
 *
 * Fixtures are field-named (not `const source = ...`) so the extracted-corpus
 * meta-test does not sample them.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { loadNativeBinding } from '../../core/native/index.js';
import { transformRust } from '../src/transform-rust.js';
import { transformWasm } from '../src/transform-wasm.js';

import { ENGINES, RUST_LANE } from './engine-parity-harness.js';

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
        try {
            loadNativeBinding();
        } catch {
            // Binding absent — rust assertions are skipped below.
        }
    });

    for (const fixture of FIXTURES) {
        it(`every artifact keeps the expression as a merge — ${fixture.name}`, () => {
            for (const [name, transform] of ENGINES) {
                const code = transform(fixture.tsx, { filename: 'F.tsx' }).code ?? '';
                expect(element(code), `${name} keeps the expression`).toContain(
                    fixture.expectMerge,
                );
            }
        });

        it.skipIf(!RUST_LANE)(`native is byte-identical to wasm — ${fixture.name}`, () => {
            const wasm = transformWasm(fixture.tsx, { filename: 'F.tsx' });
            const rust = transformRust(fixture.tsx, { filename: 'F.tsx' });
            expect(rust.code).toBe(wasm.code);
            expect([...rust.classes]).toEqual([...wasm.classes]);
        });
    }

    it('string-literal className still merges into one static string', () => {
        const tsx = 'export const A = () => <Row className="static-x" sz={{ p: 4 }} />;';
        for (const [, transform] of ENGINES) {
            const out = element(transform(tsx, { filename: 'F.tsx' }).code ?? '');
            expect(out).toContain('className="static-x p-4"');
            expect(out).not.toContain('_szMerge');
        }
    });

    it('leaves a valueless className beside the compiled one', () => {
        // `<div className sz={...}>` gives the attribute the value `true`,
        // which carries no classes. The engine does not treat it as a
        // mergeable className and emits its own attribute after it — React
        // resolves duplicate props last-wins, so the compiled value applies.
        // (The removed TS lanes folded it into the merge as `""`.)
        const tsx = 'export const A = ({ r }) => <Row className sz={{ ...r }} />;';
        expect(element(transformWasm(tsx, { filename: 'F.tsx' }).code)).toContain(
            'className className={_sz({ ...r })}',
        );
    });

    it('sets the runtime/merge flags so the import gets injected (wasm)', () => {
        const tsx = 'export const A = ({ c }) => <Row className={c} sz={{ p: 4 }} />;';
        const result = transformWasm(tsx, { filename: 'F.tsx' });
        expect(result.metadata?.usesRuntime ?? result.usesRuntime).toBe(true);
        expect(result.metadata?.usesMerge ?? result.usesMerge).toBe(true);
    });
});
