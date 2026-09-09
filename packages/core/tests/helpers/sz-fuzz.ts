/**
 * Seeded, structure-aware generator for `sz` objects, plus a shrinker.
 *
 * Two properties make this usable as a test oracle driver rather than a random
 * noise source:
 *
 * 1. **Structure-aware.** Cases are composed out of the generated per-key
 *    fixture (`packages/cli/tests/generated/sz-key-cases.json`, itself derived
 *    from `docs/specs/snippets`), so every property that goes in is a real key
 *    carrying a value the spec documents for it. Raw random bytes spend their
 *    budget on the parser's reject path; these inputs reach the lowering.
 * 2. **Seeded.** Every run is reproducible from one integer. A divergence is
 *    reported with the seed and the case index, so it replays exactly.
 *
 * Composition is deliberately allowed to produce objects nobody would author —
 * a key with a value from a different key's row, two keys that fight over the
 * same Tailwind slot. That is fine and it is the point: the harnesses built on
 * this assert that two engines AGREE, never that the output is meaningful.
 * `scripts/gen-rust-parity-corpus.mjs` records the same reasoning for the
 * frozen corpus.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { SzObject, SzValue } from '../../../compiler/src/transform-core.js';

/** One documented forward case: a single-key `sz` object and its class output. */
interface KeyCase {
    key: string;
    value: SzValue;
}

/** The pool a generator draws from. */
export interface SzPool {
    /** Every documented single-key forward case, flattened. */
    cases: readonly KeyCase[];
    /** Variant keys that may wrap a group, e.g. `hover`, `md`, `dark`. */
    variants: readonly string[];
}

const KEY_CASES_URL = new URL('../../../cli/tests/generated/sz-key-cases.json', import.meta.url);

/**
 * Builds a generator pool from the generated per-key fixture.
 *
 * @param variants Variant keys the caller wants used for wrapping. Passed in
 *   rather than imported so the harness decides which variant vocabulary it is
 *   willing to compare across engines.
 * @returns The pool of single-key cases plus the variant vocabulary.
 */
export function loadSzPool(variants: readonly string[]): SzPool {
    const fixture = JSON.parse(readFileSync(fileURLToPath(KEY_CASES_URL), 'utf8')) as {
        keys: Record<string, { forward?: { sz: Record<string, SzValue> }[] }>;
    };

    const cases: KeyCase[] = [];
    for (const [key, entry] of Object.entries(fixture.keys)) {
        for (const forward of entry.forward ?? []) {
            // Every fixture row is single-key by construction; read the one
            // entry rather than trusting the key name, which carries `@` and
            // `:` forms that do not always match the property literally.
            const pairs = Object.entries(forward.sz);
            if (pairs.length !== 1) continue;
            const [pairKey, value] = pairs[0] as [string, SzValue];
            cases.push({ key: pairKey, value });
        }
        void key;
    }

    if (cases.length === 0) {
        throw new Error(
            'sz key-case fixture produced no cases — run `pnpm gen:key-tests` before fuzzing',
        );
    }
    return { cases, variants };
}

/**
 * `mulberry32` — 32-bit seeded PRNG.
 *
 * Hand-rolled on purpose: it is nine lines, it needs no dependency, and the
 * exact bit pattern is part of the reproducer. A library upgrade that changed
 * the stream would silently retire every seed recorded in a bug report.
 *
 * @param seed Any 32-bit integer.
 * @returns A function yielding floats in `[0, 1)`.
 */
export function createRng(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Draws one element from a non-empty list.
 *
 * @param rng Seeded generator from `createRng`.
 * @param items The list to draw from; must not be empty.
 * @returns One element of `items`.
 */
function pick<T>(rng: () => number, items: readonly T[]): T {
    return items[Math.floor(rng() * items.length)] as T;
}

/**
 * Draws an integer in `[min, max]`, both ends inclusive.
 *
 * @param rng Seeded generator from `createRng`.
 * @param min Lower bound, inclusive.
 * @param max Upper bound, inclusive.
 * @returns An integer in the range.
 */
function pickInt(rng: () => number, min: number, max: number): number {
    return min + Math.floor(rng() * (max - min + 1));
}

/** Shape knobs for one generated case. */
export interface GenerateOptions {
    /** Upper bound on properties directly on the generated object. */
    maxKeys?: number;
    /** Upper bound on variant nesting depth. 0 disables variant wrapping. */
    maxVariantDepth?: number;
}

/**
 * Generates one `sz` object.
 *
 * @param rng Seeded generator from `createRng`.
 * @param pool Pool from `loadSzPool`.
 * @param options Shape knobs.
 * @returns A freshly built `sz` object.
 */
export function generateSzObject(
    rng: () => number,
    pool: SzPool,
    options: GenerateOptions = {},
): SzObject {
    const maxKeys = options.maxKeys ?? 4;
    const maxVariantDepth = options.maxVariantDepth ?? 2;

    const object: SzObject = {};
    const keyCount = pickInt(rng, 1, maxKeys);

    for (let index = 0; index < keyCount; index += 1) {
        const depth = pool.variants.length === 0 ? 0 : pickInt(rng, 0, maxVariantDepth);
        if (depth === 0) {
            const chosen = pick(rng, pool.cases);
            object[chosen.key] = chosen.value;
            continue;
        }

        // Wrap a group under `depth` nested variants. A later draw may pick the
        // same variant key again and overwrite the earlier group; that is a
        // legal authored shape (last write wins in an object literal) and both
        // engines see the identical input, so it stays in scope.
        const groupSize = pickInt(rng, 1, 2);
        let group: SzObject = {};
        for (let member = 0; member < groupSize; member += 1) {
            const chosen = pick(rng, pool.cases);
            group[chosen.key] = chosen.value;
        }
        for (let level = 0; level < depth; level += 1) {
            group = { [pick(rng, pool.variants)]: group };
        }
        for (const [key, value] of Object.entries(group)) {
            object[key] = value;
        }
    }

    return object;
}

/**
 * Narrows an `sz` value to a nested object.
 *
 * @param value The value to test.
 * @returns True when the value is a nested `sz` object.
 */
export function isSzObject(value: SzValue | undefined): value is SzObject {
    return typeof value === 'object' && value !== null;
}

/**
 * Every one-step reduction of `sz`.
 *
 * @param sz The object to reduce.
 * @returns Candidate reductions, unordered; the caller sorts them by size.
 */
function reductions(sz: SzObject): SzObject[] {
    return [...withoutOneProperty(sz), ...withOneVariantUnwrapped(sz), ...withOneGroupMember(sz)];
}

/**
 * Copies an object, leaving out one key.
 *
 * @param entries The source entries.
 * @param omitted The key to leave out.
 * @returns A new object without that key.
 */
function omitting(entries: readonly (readonly [string, SzValue])[], omitted: string): SzObject {
    const out: SzObject = {};
    for (const [key, value] of entries) {
        if (key !== omitted) out[key] = value;
    }
    return out;
}

/**
 * Reductions that drop one top-level property.
 *
 * @param sz The object to reduce.
 * @returns One candidate per property.
 */
function withoutOneProperty(sz: SzObject): SzObject[] {
    const entries = Object.entries(sz);
    return entries.map(([key]) => omitting(entries, key));
}

/**
 * Reductions that lift one variant group's members up a level, replacing
 * `{ hover: { p: 4 } }` with `{ p: 4 }`.
 *
 * A variant-prefix defect survives this reduction only if it does not depend
 * on that level, which is exactly what the shrink is trying to find out.
 *
 * @param sz The object to reduce.
 * @returns One candidate per nested group.
 */
function withOneVariantUnwrapped(sz: SzObject): SzObject[] {
    const entries = Object.entries(sz);
    const out: SzObject[] = [];
    for (const [key, value] of entries) {
        if (!isSzObject(value)) continue;
        out.push({ ...omitting(entries, key), ...value });
    }
    return out;
}

/**
 * Reductions that shrink a nested group without unwrapping it.
 *
 * @param sz The object to reduce.
 * @returns One candidate per member of each nested group, skipping the
 *   reductions that would leave a group empty.
 */
function withOneGroupMember(sz: SzObject): SzObject[] {
    const out: SzObject[] = [];
    for (const [key, value] of Object.entries(sz)) {
        if (!isSzObject(value)) continue;
        const groupEntries = Object.entries(value);
        if (groupEntries.length < 2) continue;
        for (const [inner] of groupEntries) {
            out.push({ ...sz, [key]: omitting(groupEntries, inner) });
        }
    }
    return out;
}

/**
 * Number of leaf properties, used to order reductions and to stop shrinking.
 *
 * @param sz The object to size.
 * @returns The count of non-object properties at every depth.
 */
export function szSize(sz: SzObject): number {
    let total = 0;
    for (const value of Object.values(sz)) {
        total += isSzObject(value) ? szSize(value) : 1;
    }
    return total;
}

/**
 * Greedy delta-debugging shrink.
 *
 * A property test that only reports the first random case it dislikes hands
 * back a 4-key object with two nested variants, and the reader cannot tell
 * which part carries the bug. Shrinking is what turns a generated failure into
 * a filed one.
 *
 * @param sz The failing case.
 * @param stillFails Predicate: does this smaller case still fail?
 * @param maxSteps Safety bound on the greedy loop.
 * @returns The smallest case the reductions could reach that still fails.
 */
export function shrinkSzObject(
    sz: SzObject,
    stillFails: (candidate: SzObject) => boolean,
    maxSteps = 200,
): SzObject {
    let current = sz;
    for (let step = 0; step < maxSteps; step += 1) {
        const next = reductions(current)
            .filter(candidate => Object.keys(candidate).length > 0)
            .sort((left, right) => szSize(left) - szSize(right))
            .find(candidate => stillFails(candidate));
        if (next === undefined) return current;
        current = next;
    }
    return current;
}

/**
 * A seed derived from the commit under test.
 *
 * A generated suite pinned to one seed explores one fixed slice of the input
 * space, however many times it runs: a defect outside those cases is invisible
 * to it permanently. Deriving a second seed from the commit moves that slice
 * per commit, so the covered area grows with history while any single run stays
 * exactly reproducible — the seed is printed on failure, and it is a property
 * of the commit, not of the clock.
 *
 * That distinction is what keeps this compatible with determinism as a
 * precondition: two runs of the same commit draw the same cases. A time-based
 * or random seed would make a real divergence look like a flake and a flake
 * look like a divergence.
 *
 * @param fallback Seed to use when the commit cannot be read (a tarball, a
 *   shallow export, git missing).
 * @returns A 32-bit seed.
 */
export function commitSeed(fallback: number): number {
    const sha = process.env.GITHUB_SHA ?? readHeadSha();
    if (sha === null) return fallback;
    // FNV-1a over the hex: any spread of the bits will do, and this needs no
    // dependency and no crypto import.
    let hash = 0x811c9dc5;
    for (let index = 0; index < sha.length; index += 1) {
        hash ^= sha.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

/**
 * Reads the commit at `HEAD`.
 *
 * @returns The sha, or `null` outside a git checkout.
 */
function readHeadSha(): string | null {
    try {
        return execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: fileURLToPath(new URL('../../../..', import.meta.url)),
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
    } catch {
        return null;
    }
}

/**
 * Reads the case budget and seed from the environment.
 *
 * The default seed is fixed so CI is deterministic — a fuzz lane that picks a
 * fresh seed per run turns one real bug into an intermittent failure nobody can
 * reproduce, and `ADD-3` makes determinism a precondition of the differential
 * laws rather than a nice-to-have. Override to explore:
 *
 * ```
 * SZ_FUZZ_SEED=$RANDOM SZ_FUZZ_CASES=20000 pnpm --filter @csszyx/core test
 * ```
 *
 * @param defaultCases Case count when the environment says nothing.
 * @returns Seed and case budget.
 */
export function fuzzBudget(defaultCases: number): { seed: number; cases: number } {
    const seed = Number.parseInt(process.env.SZ_FUZZ_SEED ?? '', 10);
    const cases = Number.parseInt(process.env.SZ_FUZZ_CASES ?? '', 10);
    return {
        seed: Number.isFinite(seed) ? seed : 0x5a5a5a5a,
        cases: Number.isFinite(cases) && cases > 0 ? cases : defaultCases,
    };
}
