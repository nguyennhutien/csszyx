/**
 * Every sz key × every value shape, on every lane, against the pinned
 * Tailwind.
 *
 * For each case the runtime lowering, the wasm engine and the native engine
 * must write the same bytes, and the verdict on what they wrote comes from the
 * oracle, the same one the build asks: the class is served, or it is dead and
 * the build's dead-class check reports it at its sz key (ADR 0024). A case
 * that writes nothing must say why with a lowering diagnostic, on the engine
 * and on the runtime alike — a value dropped in silence is the failure this
 * repository exists to prevent, and no oracle can see a class that was never
 * written. No verdict here comes from a table baked from the pinned Tailwind
 * (PROJECT-RULES §4): the pin is only what this repository's CI compiles.
 *
 * Not every case holds yet. Those that do not are listed in
 * `fixtures/sz-capability-baseline.json`, one entry per case with the way it
 * fails. The suite fails when a case fails that is not listed, when a listed
 * case fails differently, and when a listed case passes: the baseline only
 * ever shrinks, by hand, in the change that fixes the case. Regenerate it with
 * `CSSZYX_UPDATE_CAPABILITY_BASELINE=1` and read the diff.
 *
 * The cases are lowered by `sz-capability-cases.ts`, which the multi-version
 * gate (`scripts/check-tailwind-versions.mjs`) reads too. One engine call per
 * key renders all shapes as lines of one module, and the classes go to
 * Tailwind in one batch, so the suite runs in seconds.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    SZ_CAP_SIGN_NUMBER,
    SZ_CAPABILITIES,
} from '../../compiler/src/sz-capabilities.generated.js';
import { NEGATIVE_ALLOWED, PROPERTY_MAP } from '../../compiler/src/transform-core.js';
import { ENGINES } from '../../compiler/tests/engine-parity-harness.js';
import { candidateDeclarationsFromCss } from '../../unplugin/src/merge-signature.js';
import { createEmittedClassOracle } from '../src/index.js';
import { type CapabilityEngine, lowerEveryCase, SHAPES, tokensOf } from './sz-capability-cases.js';

const REPO = path.resolve(import.meta.dirname, '../../..');
const BASELINE = path.join(import.meta.dirname, 'fixtures/sz-capability-baseline.json');

/** Version of the baseline file's shape. */
const BASELINE_FORMAT = 2;

/**
 * How a case fails; a passing case has no entry.
 *
 * - `diverge`: the lanes wrote different bytes.
 * - `dead`: they agree on a class the pinned Tailwind does not serve; the
 *   build's dead-class check reports it, so it is not silent, but csszyx wrote
 *   it and the baseline keeps it from growing.
 * - `inert`: a CSS-wide keyword Tailwind serves on a class that sets no
 *   property to it (`blur-[inherit]` writes `blur(inherit)`), with no
 *   diagnostic: the oracle cannot see it, so nothing reports it.
 * - `silent`, `silent-runtime`, `silent-engine`: nothing written, and no
 *   lowering diagnostic on either side, the runtime, or the engine.
 */
type Failure = 'dead' | 'diverge' | 'inert' | 'silent' | 'silent-engine' | 'silent-runtime';

/**
 * Which lanes kept quiet about a value they wrote nothing for.
 *
 * @param runtime - Whether the runtime lowering warned.
 * @param engine - Whether every engine artifact reported it.
 * @returns The failure, or null when both said why.
 */
function silence(runtime: boolean, engine: boolean): Failure | null {
    if (runtime && engine) return null;
    if (runtime) return 'silent-engine';
    return engine ? 'silent-runtime' : 'silent';
}

describe('every sz key against every value shape', async () => {
    const oracle = await createEmittedClassOracle({
        resolveFrom: REPO,
        css: '@import "tailwindcss";',
        cssBase: REPO,
    });
    if (!oracle.ok) throw new Error(`expected a ready oracle, got: ${oracle.reason}`);
    const keys = Object.keys(PROPERTY_MAP);
    const cases = lowerEveryCase(ENGINES as ReadonlyArray<readonly [string, CapabilityEngine]>);
    const classes = [...new Set(cases.flatMap(c => tokensOf(c.runtime.className)))];
    const answers = oracle.cssFor(classes);
    const css = new Map(classes.map((cls, index) => [cls, answers[index] ?? null] as const));
    const dead = new Set(oracle.findDead(classes));

    /**
     * Whether a served class sets some property to the CSS-wide keyword it
     * was given, read by the one CSS analyzer (ADR 0026 §5).
     *
     * @param token - A class Tailwind serves.
     * @returns True when a declaration of its own reads exactly `inherit`.
     */
    const keywordReachesAProperty = (token: string): boolean =>
        (candidateDeclarationsFromCss(token, css.get(token) ?? null) ?? []).some(
            ({ property, value }) => !property.startsWith('--') && value === 'inherit',
        );

    const failures: Record<string, Failure> = {};
    for (const c of cases) {
        const outputs = c.engines.map(([, output]) => output);
        if (outputs.some(output => output.className !== c.runtime.className)) {
            failures[c.id] = 'diverge';
            continue;
        }
        const tokens = tokensOf(c.runtime.className);
        const engineReported = outputs.every(output => output.reported);
        let failure: Failure | null = null;
        if (tokens.length === 0) failure = silence(c.runtime.reported, engineReported);
        else if (tokens.some(token => dead.has(token))) failure = 'dead';
        else if (c.shape === 'css-wide' && !tokens.every(keywordReachesAProperty)) {
            failure = engineReported ? null : 'inert';
        }
        if (failure !== null) failures[c.id] = failure;
    }

    it('covers every key and shape', () => {
        expect(keys.length).toBeGreaterThan(300);
        expect(cases).toHaveLength(keys.length * SHAPES.length);
    });

    it('fails no case outside the baseline, and every baseline case still fails as listed', () => {
        if (process.env.CSSZYX_UPDATE_CAPABILITY_BASELINE === '1') {
            const sorted = Object.fromEntries(
                Object.entries(failures).sort(([a], [b]) => (a < b ? -1 : 1)),
            );
            writeFileSync(
                BASELINE,
                `${JSON.stringify({ format: BASELINE_FORMAT, cases: sorted }, null, 4)}\n`,
            );
        }
        const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as {
            format: number;
            cases: Record<string, Failure>;
        };
        expect(baseline.format).toBe(BASELINE_FORMAT);
        const grown = Object.entries(failures)
            .filter(([id, failure]) => baseline.cases[id] !== failure)
            .map(
                ([id, failure]) =>
                    `${id}: ${failure} (baseline: ${baseline.cases[id] ?? 'passes'})`,
            );
        const fixed = Object.keys(baseline.cases)
            .filter(id => failures[id] === undefined)
            .map(id => `${id}: now passes — remove it from the baseline`);
        expect([...grown, ...fixed]).toEqual([]);
    });
});

describe('the hand-kept negative list', () => {
    it('holds every prefix the table gives a signed number, and two more', () => {
        // Migrate and the editor tooling read `NEGATIVE_ALLOWED`; the lowering
        // reads the table. The two extras take a sign on other values only
        // (`-tracking-tight`, `-mask-linear-45`), which the number column does
        // not measure.
        const signed = new Set(
            Object.entries(PROPERTY_MAP as Record<string, string>)
                .filter(([key]) => SZ_CAPABILITIES[key]?.includes(SZ_CAP_SIGN_NUMBER))
                .map(([, prefix]) => prefix),
        );

        expect([...signed].filter(prefix => !NEGATIVE_ALLOWED.has(prefix))).toEqual([]);
        expect([...NEGATIVE_ALLOWED].filter(prefix => !signed.has(prefix))).toEqual([
            'mask',
            'tracking',
        ]);
    });
});
