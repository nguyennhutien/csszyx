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
 * Usage:
 *   pnpm corpus:check              — print report, exit 0 always
 *   pnpm corpus:check --fail-fast  — exit 1 if any gaps found
 *
 * This is a reporting tool, not a vitest test. Run on PRs to track coverage
 * trends. Add missing mappings to the relevant packages/compiler/tests/ file.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { transform } from '../packages/compiler/src/transform.js';
import { PROPERTY_MAP } from '../packages/compiler/src/transform-core.js';

// ── Build prefix → szKey(s) inverted map ──────────────────────────────────
// Same TW prefix can map from multiple sz keys (e.g. `text-` ← color + text).
// We keep ALL candidate keys and try them all during round-trip.
const prefixToKeys = new Map<string, string[]>();
for (const [szKey, twPrefix] of Object.entries(PROPERTY_MAP)) {
    const existing = prefixToKeys.get(twPrefix);
    if (existing) {
        existing.push(szKey);
    } else {
        prefixToKeys.set(twPrefix, [szKey]);
    }
}

// Sort prefixes longest-first for greedy matching
const sortedPrefixes = [...prefixToKeys.keys()].sort((a, b) => b.length - a.length);

/**
 * Parse a single non-variant Tailwind class into candidate sz objects using
 * longest-prefix-first matching against the inverted PROPERTY_MAP.
 *
 * @param twClass - A bare Tailwind class (no variant prefix, e.g. "p-4", "bg-blue-500")
 * @returns Array of candidate { szKey, value } pairs to try in round-trip
 */
function classToSzCandidates(
    twClass: string,
): Array<{ szKey: string; value: string | number | boolean }> {
    const candidates: Array<{ szKey: string; value: string | number | boolean }> = [];

    for (const prefix of sortedPrefixes) {
        const sep = `${prefix}-`;
        if (twClass === prefix) {
            // Exact match — boolean property (e.g. "flex", "block")
            const keys = prefixToKeys.get(prefix);
            if (keys) {
                for (const szKey of keys) {
                    candidates.push({ szKey, value: true });
                }
            }
            break;
        }
        if (twClass.startsWith(sep)) {
            const rawValue = twClass.slice(sep.length);
            // Numeric value: "p-4" → 4, "p-0.5" → 0.5
            const num = Number(rawValue);
            const value = !Number.isNaN(num) && rawValue !== '' ? num : rawValue;
            const keys = prefixToKeys.get(prefix);
            if (keys) {
                for (const szKey of keys) {
                    candidates.push({ szKey, value });
                }
            }
            break;
        }
    }

    return candidates;
}

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
    // Pass 1: try as a boolean property — handles absolute, fixed, relative,
    // uppercase, invisible, etc. which live outside the PROPERTY_MAP prefix system.
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
