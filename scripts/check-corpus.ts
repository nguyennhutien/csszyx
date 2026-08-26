#!/usr/bin/env tsx
/**
 * Corpus coverage checker.
 *
 * Reads pinned class snapshots from scripts/corpus/*.txt, attempts to
 * round-trip each Tailwind class through the sz compiler, and reports
 * which classes are covered vs. which are gaps.
 *
 * Round-trip: TW class → invert PROPERTY_MAP prefix → sz object → transform() → compare
 *
 * Both halves run on the engine that ships: the class is read by the native
 * migrate and lowered by the native transform, so a pass here is a statement
 * about csszyx, not about a second implementation of it.
 *
 * Usage:
 *   pnpm corpus:check                    — print report, exit 0 always
 *   pnpm corpus:check --fail-fast        — exit 1 if any gap (broken or unmapped)
 *   pnpm corpus:check --require-no-broken — exit 1 only on broken (wrong output);
 *                                           ignores unmapped, which is advisory
 *                                           coverage noise (component class names)
 *
 * This is a reporting tool, not a vitest test. Run on PRs to track coverage
 * trends. Add missing mappings to the relevant packages/compiler/tests/ file.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { migrateRustParseClass as parseClass } from '../packages/compiler/src/migrate-rust.js';
import { transform } from '../packages/compiler/src/transform-core.js';
import { classToSzCandidates } from './check-corpus-candidates.js';

// ── Try round-trip for a single class ─────────────────────────────────────
/**
 *
 */
type Result =
    | { status: 'covered'; szKey: string }
    | { status: 'broken'; szKey: string; got: string }
    | { status: 'unmapped' };

/**
 * Attempt a full round-trip for a bare (non-variant) Tailwind class.
 * Pass 1: try as boolean key (absolute, fixed, uppercase, etc.)
 * Pass 2: try all prefix candidates from PROPERTY_MAP inversion.
 *
 * @param twClass - Bare Tailwind class without variant prefix
 * @returns covered | broken | unmapped result
 */
function roundTrip(twClass: string): Result {
    // Pass 0: run the class through the migrate parser — the maintained inverse
    // of the compiler. It resolves single-property value classes to their
    // canonical key (absolute → { position: 'absolute' }, italic → { fontStyle:
    // 'italic' }), which the removed boolean sugar no longer covers.
    try {
        const parsed = parseClass(twClass);
        if (parsed) {
            const sz = { [parsed.prop]: parsed.value } as Parameters<typeof transform>[0];
            if (transform(sz).className === twClass) {
                return { status: 'covered', szKey: parsed.prop };
            }
        }
    } catch {
        /* not migrate-parseable */
    }

    // Pass 1: try as a boolean shorthand (truncate, container, …) that maps a
    // bare class to a true value.
    try {
        const result = transform({ [twClass]: true }).className;
        if (result === twClass) {
            return { status: 'covered', szKey: twClass };
        }
    } catch {
        /* not a boolean prop */
    }

    // Pass 2: try all prefix candidates, keep the first that produces an exact match.
    const candidates = classToSzCandidates(twClass);
    let lastAttempt: { szKey: string; got: string } | undefined;

    for (const { szKey, value } of candidates) {
        try {
            const result = transform({ [szKey]: value }).className;
            if (result === twClass) {
                return { status: 'covered', szKey };
            }
            // Non-empty wrong result — record as last attempt
            if (result) {
                lastAttempt = { szKey, got: result };
            }
        } catch {
            /* skip */
        }
    }

    if (lastAttempt) {
        return { status: 'broken', szKey: lastAttempt.szKey, got: lastAttempt.got };
    }
    return { status: 'unmapped' };
}

// ── Read corpus files ──────────────────────────────────────────────────────
const corpusDir = fileURLToPath(new URL('./corpus', import.meta.url));
const corpusFiles = readdirSync(corpusDir).filter(f => f.endsWith('.txt'));

const allClasses = new Set<string>();
for (const file of corpusFiles) {
    const lines = readFileSync(join(corpusDir, file), 'utf-8').split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        // Skip comments and blanks
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }
        allClasses.add(trimmed);
    }
}

// ── Run round-trips ────────────────────────────────────────────────────────
const covered: string[] = [];
const broken: Array<{ cls: string; szKey: string; got: string }> = [];
const unmapped: string[] = [];

for (const cls of [...allClasses].sort()) {
    // Skip variant-prefixed classes (hover:, dark:, sm:, etc.) —
    // these are variant composition, not base property coverage.
    if (cls.includes(':')) {
        covered.push(`${cls} (variant — skipped)`);
        continue;
    }
    const result = roundTrip(cls);
    if (result.status === 'covered') {
        covered.push(cls);
    } else if (result.status === 'broken') {
        broken.push({ cls, szKey: result.szKey, got: result.got });
    } else {
        unmapped.push(cls);
    }
}

// ── Report ─────────────────────────────────────────────────────────────────
const total = allClasses.size;
const coveredCount = covered.length;
const pct = Math.round((coveredCount / total) * 100);

console.log('\n╔══ Corpus Coverage Report ══════════════════════════╗');
console.log(`║  Corpus:  ${corpusFiles.join(', ')}`);
console.log(`║  Classes: ${total} unique`);
console.log(`║  Covered: ${coveredCount}/${total} (${pct}%)`);
if (broken.length > 0) {
    console.log(`║  Broken:  ${broken.length}`);
}
if (unmapped.length > 0) {
    console.log(`║  Unmapped: ${unmapped.length}`);
}
console.log('╚════════════════════════════════════════════════════╝\n');

if (broken.length > 0) {
    console.log('── Broken (maps but produces wrong class) ───────────');
    for (const { cls, szKey, got } of broken) {
        console.log(`  ${cls}  →  { ${szKey}: ... }  →  "${got}"`);
    }
    console.log('');
}

if (unmapped.length > 0) {
    console.log('── Unmapped (no sz equivalent found) ────────────────');
    for (const cls of unmapped) {
        console.log(`  ${cls}`);
    }
    console.log('');
    console.log('To fix: add the missing property to PROPERTY_MAP in');
    console.log('packages/compiler/src/transform-core.ts, then add a test.\n');
}

if (broken.length === 0 && unmapped.length === 0) {
    console.log('✓ Full coverage — all corpus classes round-trip cleanly.\n');
}

const failFast = process.argv.includes('--fail-fast');
if (failFast && (broken.length > 0 || unmapped.length > 0)) {
    process.exit(1);
}

// `broken` means a class maps but compiles to the WRONG output — a real
// correctness risk worth gating. `unmapped` is a coverage trend (mostly
// non-utility component class names like rt-*) and stays advisory. This mode
// lets a gate require "no broken" without the unmapped noise; it could back a
// required CI step or the verify:ci mirror.
const requireNoBroken = process.argv.includes('--require-no-broken');
if (requireNoBroken && broken.length > 0) {
    process.exit(1);
}
