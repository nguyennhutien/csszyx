#!/usr/bin/env tsx

/**
 * Emitted-class oracle: does every class csszyx emits actually produce CSS?
 *
 * csszyx owns the sz → class mapping but NOT the class vocabulary — Tailwind
 * does, and it moves between minors (`break-*` became `wrap-*` in v4.1). A
 * mapping that emits a name Tailwind no longer serves produces a class that
 * silently styles nothing, which is the exact failure csszyx exists to prevent.
 *
 * Rather than re-implement Tailwind's grammar here — the vocabulary would drift
 * on every release, and a checker that false-positives gets ignored — this asks
 * the installed Tailwind directly: compile the candidate, and if no CSS comes
 * back, the class is dead. `__unstable__loadDesignSystem` is the same entry
 * point Tailwind's own prettier plugin, IntelliSense server, upgrade tool and
 * CLI use, so it cannot be dropped without breaking those first.
 *
 * Input is the cross-artifact parity corpus, which already pins one emitted class
 * string per sz input, so the whole mapping surface is covered for free.
 *
 * Usage:
 *   pnpm check:emitted-classes          — report, exit 1 on an UNBASELINED dead class
 *   pnpm check:emitted-classes --list   — print every dead class, baselined or not
 *
 * This runs against STOCK Tailwind on purpose: the corpus carries no project
 * theme and no plugins, so anything theme- or plugin-dependent is baselined
 * below rather than checked. A user project gets the project-aware version
 * through the CLI, which must resolve Tailwind from the user's own cwd.
 *
 * A class that produces CSS can still produce a declaration the browser
 * drops: Tailwind serves `col-span-[50px]` as `grid-column: span 50px`, which
 * no `grid-column` takes. So the declarations of every live class are matched
 * against the property's grammar with css-tree, the CSS syntax database
 * stylelint and csso read. A value the lexer cannot judge — `var()`, `calc()`,
 * `env()` — is left alone, a custom property is any value, and an `@property`
 * descriptor is no property.
 */

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createEmittedClassOracle } from '@csszyx/tailwind-oracle';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = path.join(REPO, 'packages/core/tests/fixtures/parity-corpus.json');

/**
 * Why a dead class is tolerated. Anything NOT listed here fails the check.
 *
 * `accepted` — correct behaviour; the stock design system simply cannot see it,
 *   or csszyx emits it on purpose and says so.
 * `known-dead` — a real defect: csszyx emits a name Tailwind does not serve.
 *   Listed so the gate can land without a mapping rewrite, and so a NEW one
 *   still fails. Each entry records the form Tailwind actually accepts.
 *   Empty is the goal, and reaching it is not a reason to drop the kind: the
 *   next mapping bug lands here before it is fixed.
 */
interface Baseline {
    readonly kind: 'accepted' | 'known-dead';
    readonly reason: string;
    /**
     * True when the class is dead under the stock theme but served once a
     * project declares the right theme variable. Such entries are exempt from
     * the stale-baseline failure: whether they produce CSS is a property of
     * the theme, not of the mapping.
     */
    readonly themeConditional?: boolean;
}

const BASELINE: ReadonlyMap<string, Baseline> = new Map([
    // ── accepted ────────────────────────────────────────────────────────────
    ...(['prose', 'prose-gray', 'prose-lg', 'prose-invert'].map(
        c =>
            [
                c,
                {
                    kind: 'accepted',
                    reason: 'provided by @tailwindcss/typography, which the stock design system does not load',
                },
            ] as const,
    ) as ReadonlyArray<readonly [string, Baseline]>),
    [
        'text-mint-500',
        {
            kind: 'accepted',
            reason: 'custom theme colour; resolves once the project @theme declares --color-mint-500',
        },
    ],
    // ── accepted: unknown sz key rides the kebab pass-through ───────────────
    ...(['break-word', 'pointer-none'].map(
        c =>
            [
                c,
                {
                    kind: 'accepted',
                    reason: 'emitted from an UNKNOWN sz key through the kebab pass-through, which decision 0001 keeps on purpose so a utility newer than csszyx still reaches Tailwind; the warning says so and the author fixes it in place',
                },
            ] as const,
    ) as ReadonlyArray<readonly [string, Baseline]>),
    // ── accepted: a number off the spacing scale, reported where it is written ─
    [
        'leading-1.4',
        {
            kind: 'accepted',
            reason: "a number on `leading` is the spacing scale like on `p` (ADR 0037), and 1.4 is off its quarter step; the build reports `off-scale-value` at the site and points to `leading: '1.4'` for the ratio",
        },
    ],
    [
        'p-1/2',
        {
            kind: 'accepted',
            reason: "a fraction on a spacing key with no fraction utilities is written as a Tailwind author would (ADR 0036): its bracket `p-[1/2]` was `padding: 1/2`, which the browser drops; every lane reports `off-scale-value` (form `fraction`) at the site and names `p: '50%'`",
        },
    ],
    // ── known-dead: a fraction that no bare utility spells ───────────────────
    // `aspect` and `weight` bracket every number and `grow`/`shrink`/`flex`/
    // `stroke`/`tabSize` bracket a decimal (ADR 0037), because there the
    // bracket sets the number written. The entry here is the key a corpus
    // record happens to cover; `p`, `w`, `gap`, `rotate` and `z` fail the same
    // way on the same input and have no record yet.
    //
    // Bracketing everything is NOT the fix and must not be treated as one:
    // Tailwind serves `p-[1.4]` and emits `padding: 1.4`, which a browser drops
    // for want of a unit. That trades a dead class this gate can see for an
    // invalid declaration it cannot, because the oracle asks whether a rule
    // exists and not whether the rule is valid. The repair is a per-key value
    // domain — unitless number, unitless integer, length, angle — that brackets
    // where the property takes a bare number and reports the value invalid
    // where it does not, together with the oracle work needed to defend it.
    [
        'scale-1.05',
        {
            kind: 'known-dead',
            reason: 'Tailwind serves scale-105 for this value, or scale-[1.05] as an arbitrary one; the bare fraction spells neither',
        },
    ],
]);

/**
 * Live classes whose declaration CSS rejects, each a tracked defect. Anything
 * not listed fails the check, and a listed class whose declarations now match
 * fails it too, so the list only shrinks.
 */
const INVALID_BASELINE: ReadonlyMap<string, string> = new Map([
    ['col-span-[50px]', 'TASK-13.54: `span` takes an integer, not a length'],
    ['row-span-[50px]', 'TASK-13.54: `span` takes an integer, not a length'],
    ['justify-baseline', 'TASK-13.54: `justify-content` takes no `baseline`'],
    ['mask-position-[center_top_1rem]', 'TASK-13.54: `<position>` has no three-value form'],
    ['text-[--9(4)]', 'TASK-13.55: a dashed function CSS does not define'],
    ['text-[---x(4)]', 'TASK-13.55: a dashed function CSS does not define'],
    ['text-[--_x(4)]', 'TASK-13.55: a dashed function CSS does not define'],
]);

/** The css-tree API this check reads; the package ships no types. */
interface CssTree {
    parse(css: string, options: { parseCustomProperty: boolean }): unknown;
    walk(
        ast: unknown,
        options: {
            visit: 'Declaration';
            enter(this: { atrule: { name: string } | null }, node: CssDeclaration): void;
        },
    ): void;
    generate(node: unknown): string;
    lexer: { matchProperty(property: string, value: unknown): { error: unknown } };
}

/** A css-tree declaration node. */
interface CssDeclaration {
    property: string;
    value: unknown;
}

const csstree = createRequire(import.meta.url)('css-tree') as CssTree;

/** A value css-tree cannot judge: it resolves only in the browser. */
const UNJUDGED_VALUE = /\b(?:var|calc|env)\(/;

/**
 * The declarations in one class's CSS that its property's grammar rejects.
 *
 * Cost: linear in the CSS; one lexer match per declaration checked.
 *
 * @param css - The CSS Tailwind emits for the class.
 * @returns `property: value` for each rejected declaration.
 */
function invalidDeclarations(css: string): string[] {
    const invalid: string[] = [];
    csstree.walk(csstree.parse(css, { parseCustomProperty: false }), {
        visit: 'Declaration',
        enter(node) {
            if (this.atrule?.name === 'property' || node.property.startsWith('--')) return;
            const value = csstree.generate(node.value);
            if (UNJUDGED_VALUE.test(value)) return;
            if (csstree.lexer.matchProperty(node.property, node.value).error) {
                invalid.push(`${node.property}: ${value}`);
            }
        },
    });
    return invalid;
}

/**
 * Check the declarations of every live class, and report.
 *
 * @param oracle - The open design system.
 * @param oracle.cssFor - CSS per class, null when it emits none.
 * @param live - The classes that produce CSS.
 * @param origins - Class → the sz input that produced it.
 */
function checkDeclarations(
    oracle: { cssFor(classes: readonly string[]): Array<string | null> },
    live: readonly string[],
    origins: ReadonlyMap<string, string>,
): void {
    const found = new Map<string, string[]>();
    oracle.cssFor(live).forEach((css, index) => {
        const invalid = css === null ? [] : invalidDeclarations(css);
        if (invalid.length > 0) found.set(live[index] as string, invalid);
    });
    const unbaselined = [...found.keys()].filter(token => !INVALID_BASELINE.has(token));
    const stale = [...INVALID_BASELINE.keys()].filter(
        token => live.includes(token) && !found.has(token),
    );
    console.log(
        `\nchecked the declarations of ${live.length} live classes — ${found.size} rejected by CSS, ${unbaselined.length} new`,
    );
    if (stale.length > 0) {
        console.log('\nSTALE invalid-declaration entries — these match their grammar now:');
        for (const token of stale)
            console.log(`  ${token.padEnd(32)} ${INVALID_BASELINE.get(token)}`);
        console.log('\nRemove them from INVALID_BASELINE in scripts/check-emitted-classes.ts.');
        process.exitCode = 1;
    }
    if (unbaselined.length > 0) {
        console.log('\nNEW declarations CSS rejects — the class is served, the browser drops it:');
        for (const token of unbaselined) {
            console.log(
                `  ${token.padEnd(32)} ${found.get(token)?.join('; ')} <- sz ${origins.get(token)}`,
            );
        }
        console.log(
            '\nFix the mapping so the class writes a value its property takes, or add it to\n' +
                'INVALID_BASELINE in scripts/check-emitted-classes.ts with its task.',
        );
        process.exitCode = 1;
    }
}

/** One corpus record: an sz input and the class string every engine emits. */
interface CorpusRecord {
    sz: string;
    runtime?: string;
}

/**
 * Collect every distinct emitted class token, remembering one sz origin each.
 *
 * @param records - Parity corpus records.
 * @returns Class token → the sz input that produced it.
 */
function collectTokens(records: readonly CorpusRecord[]): Map<string, string> {
    const origins = new Map<string, string>();
    for (const record of records) {
        for (const token of (record.runtime ?? '').split(/\s+/)) {
            if (token && !origins.has(token)) {
                origins.set(token, record.sz);
            }
        }
    }
    return origins;
}

/**
 * Run the oracle over the parity corpus and report.
 */
async function main(): Promise<void> {
    const listAll = process.argv.includes('--list');

    // The major assert lives HERE, in the repo gate's entrypoint — not in the
    // oracle loader. The user-project lane must resolve Tailwind from the
    // user's cwd and degrade safely when v4 is absent, so requiring a major is
    // a property of this gate, and only checks the copy THIS script resolved
    // (packages/cli keeps its own permanent v3 pin for unrelated reasons).
    const tailwindManifest = fileURLToPath(import.meta.resolve('tailwindcss/package.json'));
    const { version } = JSON.parse(await readFile(tailwindManifest, 'utf8')) as {
        version: string;
    };
    if (!version.startsWith('4.')) {
        throw new Error(
            `check:emitted-classes resolved tailwindcss ${version}, but the oracle needs the ` +
                'repo-pinned 4.x. The hoist winner changed — restore the pin in root devDependencies.',
        );
    }

    const records = JSON.parse(await readFile(CORPUS, 'utf8')) as CorpusRecord[];
    const origins = collectTokens(records);
    const tokens = [...origins.keys()];

    // Stock Tailwind on purpose: the corpus carries no project theme, so
    // anything theme- or plugin-dependent is baselined rather than checked.
    // The oracle degrades to a skip where a user project would carry on; this
    // gate has no such freedom, so a skip is a hard failure here. That includes
    // the self-proof — the oracle refuses to run once Tailwind stops reporting
    // an unservable class as null, which would otherwise pass vacuously.
    const twRoot = path.dirname(fileURLToPath(import.meta.resolve('tailwindcss/package.json')));
    const oracle = await createEmittedClassOracle({
        resolveFrom: REPO,
        css: '@import "tailwindcss";',
        cssBase: twRoot,
    });
    if (!oracle.ok) {
        throw new Error(`check:emitted-classes cannot run: ${oracle.reason}`);
    }
    const dead = oracle.findDead(tokens);

    const unbaselined = dead.filter(token => !BASELINE.has(token));
    const baselined = dead.filter(token => BASELINE.has(token));
    // The ratchet's other direction: a baselined class that now DOES produce
    // CSS is a fixed mapping whose baseline entry outlived it. Theme-conditional
    // entries are exempt — their liveness is a property of the theme.
    const deadSet = new Set(dead);
    const stale = tokens.filter(token => {
        const entry = BASELINE.get(token);
        return entry !== undefined && entry.themeConditional !== true && !deadSet.has(token);
    });

    console.log(
        `checked ${tokens.length} emitted class tokens from ${records.length} corpus records`,
    );
    console.log(
        `  ${dead.length} produce no CSS — ${baselined.length} baselined, ${unbaselined.length} new`,
    );

    if (listAll) {
        const knownDead = baselined.filter(t => BASELINE.get(t)?.kind === 'known-dead');
        const accepted = baselined.filter(t => BASELINE.get(t)?.kind === 'accepted');
        console.log(`\nknown-dead (${knownDead.length}) — real defects, tracked:`);
        for (const token of knownDead) {
            console.log(`  ${token.padEnd(24)} ${BASELINE.get(token)?.reason}`);
        }
        console.log(`\naccepted (${accepted.length}) — not defects:`);
        for (const token of accepted) {
            console.log(`  ${token.padEnd(24)} ${BASELINE.get(token)?.reason}`);
        }
    }

    if (stale.length > 0) {
        console.log('\nSTALE baseline entries — these produce CSS now:');
        for (const token of stale) {
            console.log(`  ${token.padEnd(24)} ${BASELINE.get(token)?.reason}`);
        }
        console.log(
            '\nThe mapping (or Tailwind) now serves these classes. Remove their BASELINE\n' +
                'entries in scripts/check-emitted-classes.ts so the dead-class count only ratchets down.',
        );
        process.exitCode = 1;
    }

    if (unbaselined.length > 0) {
        console.log('\nNEW dead classes — these emit no CSS and are not baselined:');
        for (const token of unbaselined) {
            console.log(`  ${token.padEnd(24)} <- sz ${origins.get(token)}`);
        }
        console.log(
            '\nEither fix the mapping so Tailwind serves the class, or add it to BASELINE\n' +
                'in scripts/check-emitted-classes.ts with the reason it is tolerated.',
        );
        process.exitCode = 1;
    }
    reportRefusedVocabulary(oracle.findDead(REFUSED_VOCABULARY));
    checkDeclarations(
        oracle,
        tokens.filter(token => !deadSet.has(token)),
        origins,
    );

    if (process.exitCode === 1) {
        return;
    }

    console.log('\nNo new dead classes.');
}

/**
 * Classes csszyx REFUSES to emit because Tailwind serves no rule for them.
 *
 * The corpus check above asks whether an emitted class is dead. This asks the
 * other direction, and it is the direction a refusal rots in: once the mapping
 * stops emitting a class, nothing here notices when Tailwind starts serving it,
 * and csszyx quietly drops a value that would now work.
 *
 * Per-side border styles are the first entry. CSS gives every side its own
 * border-style; Tailwind spells the style at the root only, so `borderB: 'none'`
 * compiled to `border-b-none` and generated nothing. A Tailwind version that
 * adds the per-side form should take the refusal off `is_border_side_style_value`
 * in `packages/core/src/transform/lower.rs` rather than keep dropping it.
 */
const REFUSED_VOCABULARY: readonly string[] = [
    't',
    'r',
    'b',
    'l',
    'x',
    'y',
    's',
    'e',
    'bs',
    'be',
].flatMap(side =>
    ['solid', 'dashed', 'dotted', 'double', 'hidden', 'none'].map(
        style => `border-${side}-${style}`,
    ),
);

/**
 * Fail when Tailwind has started serving something csszyx refuses to emit.
 *
 * @param dead - The refused classes Tailwind still serves no rule for.
 */
function reportRefusedVocabulary(dead: readonly string[]): void {
    const served = REFUSED_VOCABULARY.filter(token => !dead.includes(token));
    console.log(
        `\nchecked ${REFUSED_VOCABULARY.length} refused classes — ${served.length} now served`,
    );
    if (served.length === 0) {
        return;
    }
    console.log('\nREFUSED classes Tailwind now serves — the mapping should emit them again:');
    for (const token of served) {
        console.log(`  ${token}`);
    }
    console.log(
        '\nTake the pairing off is_border_side_style_value in\n' +
            'packages/core/src/transform/lower.rs, and drop its entry here.',
    );
    process.exitCode = 1;
}

await main();
