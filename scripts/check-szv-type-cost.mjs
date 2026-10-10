#!/usr/bin/env node
// Type-checking cost gate for `szv()`.
//
// The `szv()` signature re-types every row of a config so that an unknown sz
// key is a compile error. That checking runs in every consumer's editor and
// `tsc`, once per `szv()` call, and nothing else in the repository measures
// it: the signature's own type tests only ask whether an error fires. When the
// typing landed (0.18) the instantiation count of a 200-call file went from
// 15,609 to 373,263, about 24x, which is still a fraction of a second, but a
// change to the mapped types can multiply it again without any test noticing.
//
// TypeScript's instantiation count is deterministic for a given compiler
// version and input, unlike check time, so it can gate a merge with no flake.
// This script writes a fixed consumer file, type-checks it against the
// runtime's `variants.ts` with the pinned TypeScript, and fails when the count
// crosses the budget below.
//
// It reads the compiler's built declarations (`variants.ts` imports
// `@csszyx/compiler`, which resolves to `dist`), so the compiler must be built
// first: `pnpm exec turbo run build --filter=@csszyx/compiler`.
//
// Usage: node scripts/check-szv-type-cost.mjs

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Instantiation ceiling for `FIXTURE_CALLS` calls of the fixture below, under
 * the pinned TypeScript (`@typescript/native`). Measured 2026-10-09 at
 * 57,911 on TS 7.0.2; set about 10% above. A legitimate rise is a one-line
 * change here plus a sentence in the commit saying what grew it. A count far
 * below the budget means the budget should come down with it, or it stops
 * catching anything.
 */
export const INSTANTIATION_BUDGET = 63_700;

/** How many factories the fixture declares. */
export const FIXTURE_CALLS = 24;

/**
 * Four config shapes a component library writes: a button (nested `hover`,
 * `md`, an `aria` table, defaults), a badge (shared `as const` row), a card
 * (`css`, `group-hover`, `@md`, a gradient value) and an input (`focus`, empty
 * rows, a call with no selection). Each is declared `FIXTURE_CALLS / 4` times under a
 * new name, and each factory is called once.
 *
 * @param {number} index - Suffix that keeps declarations distinct.
 * @returns {string} TypeScript source for one block of four factories.
 */
function fixtureBlock(index) {
    return `
const shared${index} = { px: 2, py: 1, rounded: 'full', text: 'xs' } as const;
export const button${index}: SzProps = szv({
    base: { display: 'inline-flex', items: 'center', rounded: 'md', hover: { opacity: 90 } },
    variants: {
        intent: {
            primary: { bg: 'blue-600', color: 'white', hover: { bg: 'blue-700' } },
            danger: { bg: 'red-600', color: 'white', md: { px: 6 } },
            ghost: { bg: 'transparent', border: true, borderColor: 'gray-300' },
        },
        size: { sm: { h: 8, px: 2, text: 'sm' }, md: { h: 10, px: 4 }, lg: { h: 12, px: 6, text: 'lg' } },
        state: { open: { aria: { expanded: { bg: 'gray-100' } } }, closed: { opacity: 50 } },
    },
    defaultVariants: { intent: 'primary', size: 'md' },
})({ intent: 'danger', size: 'lg' });
export const badge${index}: SzProps = szv({
    variants: {
        tone: {
            neutral: shared${index},
            info: { ...shared${index}, bg: 'sky-100', color: 'sky-900' },
            warn: { ...shared${index}, bg: 'amber-100', color: 'amber-900' },
        },
    },
    defaultVariants: { tone: 'neutral' },
})({ tone: 'info' });
export const card${index}: SzProps = szv({
    base: { display: 'flex', flexDir: 'col', gap: 4, p: 6, rounded: 'xl', shadow: 'sm' },
    variants: {
        look: {
            flat: { bg: 'white' },
            glow: { bgImg: { gradient: 'linear', dir: 'to-r' }, 'group-hover': { shadow: 'lg' } },
            vertical: { css: { writingMode: 'vertical-rl' }, '@md': { p: 8 } },
        },
    },
})({ look: 'glow' });
export const input${index}: SzProps = szv({
    base: { w: 'full', border: true, rounded: 'md', px: 3, focus: { ring: 2, ringColor: 'blue-500' } },
    variants: {
        invalid: { yes: { borderColor: 'red-500', focus: { ringColor: 'red-500' } }, no: {} },
        disabled: { yes: { opacity: 50, cursor: 'not-allowed' }, no: {} },
    },
    defaultVariants: { invalid: 'no', disabled: 'no' },
})();
`;
}

/**
 * The whole fixture: `FIXTURE_CALLS` factories, each called once.
 *
 * @param {string} variantsPath - Absolute path of the runtime's `variants.ts`.
 * @returns {string} TypeScript source.
 */
export function fixtureSource(variantsPath) {
    const blocks = Array.from({ length: FIXTURE_CALLS / 4 }, (_, i) => fixtureBlock(i));
    return [
        `import type { SzProps } from '@csszyx/compiler';`,
        `import { szv } from ${JSON.stringify(variantsPath)};`,
        ...blocks,
    ].join('\n');
}

/**
 * Read the instantiation count out of `tsc --extendedDiagnostics` output.
 *
 * @param {string} output - What tsc printed.
 * @returns {number | null} The count, or null when the line is missing.
 */
export function parseInstantiations(output) {
    const match = /^Instantiations:\s+([\d,]+)\s*$/m.exec(output);
    return match ? Number(match[1].replaceAll(',', '')) : null;
}

/**
 * Compare a measured count with the budget.
 *
 * @param {number} count - Measured instantiations.
 * @param {number} budget - The ceiling.
 * @returns {{ ok: boolean, message: string }} The verdict and the line to print.
 */
export function judge(count, budget) {
    const share = `${count.toLocaleString('en-US')} of ${budget.toLocaleString('en-US')}`;
    if (count > budget) {
        return {
            ok: false,
            message: `szv type cost: ${share} instantiations, over budget. Find what in the szv typing grew it; raise INSTANTIATION_BUDGET in scripts/check-szv-type-cost.mjs only with the reason in the commit.`,
        };
    }
    return { ok: true, message: `szv type cost: ${share} instantiations.` };
}

/**
 * Type-check the fixture and return tsc's exit status and output.
 *
 * @returns {{ status: number | null, output: string }} The tsc run.
 */
function runFixture() {
    const dir = mkdtempSync(path.join(tmpdir(), 'szv-type-cost-'));
    try {
        const variantsPath = path.join(ROOT, 'packages/runtime/src/variants.ts');
        writeFileSync(path.join(dir, 'consumer.ts'), fixtureSource(variantsPath));
        writeFileSync(
            path.join(dir, 'tsconfig.json'),
            JSON.stringify({
                compilerOptions: {
                    strict: true,
                    noEmit: true,
                    target: 'ES2022',
                    module: 'ESNext',
                    moduleResolution: 'bundler',
                    allowImportingTsExtensions: true,
                    skipLibCheck: true,
                    types: ['node'],
                    typeRoots: [path.join(ROOT, 'node_modules/@types')],
                    // `consumer.ts` resolves `@csszyx/compiler` from the temp
                    // directory, which has no node_modules; point it at the
                    // same package `variants.ts` resolves.
                    paths: {
                        '@csszyx/compiler': [
                            path.join(ROOT, 'packages/runtime/node_modules/@csszyx/compiler'),
                        ],
                    },
                },
                files: ['consumer.ts'],
            }),
        );
        const tsc = path.join(ROOT, 'node_modules/@typescript/native/lib/tsc.js');
        const run = spawnSync(process.execPath, [tsc, '-p', dir, '--extendedDiagnostics'], {
            encoding: 'utf8',
        });
        return { status: run.status, output: `${run.stdout}${run.stderr}` };
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

/** Run the gate and exit non-zero on a failure. */
function main() {
    const { status, output } = runFixture();
    if (status !== 0) {
        console.error(
            `szv type cost: the fixture does not type-check (tsc exit ${status}).\n${output}`,
        );
        process.exit(1);
    }
    const count = parseInstantiations(output);
    if (count === null) {
        console.error(`szv type cost: no "Instantiations:" line in tsc output.\n${output}`);
        process.exit(1);
    }
    const verdict = judge(count, INSTANTIATION_BUDGET);
    (verdict.ok ? console.log : console.error)(verdict.message);
    if (!verdict.ok) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    main();
}
