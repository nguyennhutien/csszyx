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
 * Input is the tri-engine parity corpus, which already pins one emitted class
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
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { __unstable__loadDesignSystem } from 'tailwindcss';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = path.join(REPO, 'packages/core/tests/fixtures/parity-corpus.json');

/**
 * Why a dead class is tolerated. Anything NOT listed here fails the check.
 *
 * `accepted` — correct behaviour; the stock design system simply cannot see it.
 * `known-dead` — a real defect: csszyx emits a name Tailwind does not serve.
 *   Listed so the gate can land without a mapping rewrite, and so a NEW one
 *   still fails. Each entry records the form Tailwind actually accepts.
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
    ...(['group/item', 'peer/form'].map(
        c =>
            [
                c,
                {
                    kind: 'accepted',
                    reason: 'named group/peer MARKER — emits no CSS by design, consumed by group-*/peer-* variants',
                },
            ] as const,
    ) as ReadonlyArray<readonly [string, Baseline]>),

    // ── known-dead: unknown sz key that still emits ─────────────────────────
    ...(['break-word', 'pointer-none'].map(
        c =>
            [
                c,
                {
                    kind: 'known-dead',
                    reason: 'emitted from an UNKNOWN sz key — warned truthfully, but the dead class still ships (systemic; the drop-vs-emit decision is still open)',
                },
            ] as const,
    ) as ReadonlyArray<readonly [string, Baseline]>),
]);

/**
 * Load a design system over stock Tailwind, resolving its own stylesheets.
 *
 * @returns The loaded design system.
 */
async function loadStockDesignSystem() {
    const twRoot = path.dirname(fileURLToPath(import.meta.resolve('tailwindcss/package.json')));
    return __unstable__loadDesignSystem('@import "tailwindcss";', {
        base: twRoot,
        async loadStylesheet(id: string) {
            const relative = id === 'tailwindcss' ? 'index.css' : id.replace(/^tailwindcss\//, '');
            const file = path.join(
                twRoot,
                relative.endsWith('.css') ? relative : `${relative}.css`,
            );
            return {
                path: file,
                base: path.dirname(file),
                content: await readFile(file, 'utf8'),
            };
        },
    });
}

/** One corpus record: an sz input and the class string every engine emits. */
interface CorpusRecord {
    sz: string;
    oxc?: string;
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
        for (const token of (record.oxc ?? '').split(/\s+/)) {
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

    const designSystem = await loadStockDesignSystem();
    // A deliberately bogus candidate rides along as a self-proof: if Tailwind
    // ever stops reporting an unservable class as `null` (say `undefined` or
    // `''` after an API change), every dead class would read as alive and the
    // gate would pass vacuously. The probe fails loudly instead.
    const selfProofToken = 'zz-not-a-class';
    const css = designSystem.candidatesToCss([...tokens, selfProofToken]);
    if (css[tokens.length] !== null) {
        throw new Error(
            `the oracle no longer detects dead classes: candidatesToCss("${selfProofToken}") ` +
                `returned ${JSON.stringify(css[tokens.length])} instead of null`,
        );
    }
    const dead = tokens.filter((_, index) => css[index] === null);

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
    if (process.exitCode === 1) {
        return;
    }

    console.log('\nNo new dead classes.');
}

await main();
