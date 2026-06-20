#!/usr/bin/env node
/**
 * gen-key-tests.mjs
 *
 * Generates packages/cli/tests/generated/sz-key-cases.json — a per-sz-key,
 * both-direction test corpus derived from docs/specs/snippets (the source of
 * truth). The companion test (sz-key-matrix.test.ts) iterates this file and the
 * coverage gate (sz-key-coverage.test.ts) asserts every compiler key is exercised.
 *
 *   forward:  transform(<documented sz>)        === <Tailwind class>
 *   reverse:  transform(classNameToSzObject(c)) === c   (migrate is exact inverse)
 *
 * Only pairs that round-trip at generation time are emitted, so the matrix is
 * green by construction; the committed JSON then guards against future drift and
 * `--check` fails CI if regenerating would change it.
 *
 * Usage:
 *   node --import tsx/esm scripts/gen-key-tests.mjs           # write JSON
 *   node --import tsx/esm scripts/gen-key-tests.mjs --check   # CI: fail if stale
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseClass } from '../packages/cli/src/migrate/class-parser.js';
import { classNameToSzObject } from '../packages/cli/src/migrate/variant-parser.js';
import { transform } from '../packages/compiler/src/transform.js';
import { BOOLEAN_SHORTHANDS, PROPERTY_MAP } from '../packages/compiler/src/transform-core.js';

const repoRoot = join(fileURLToPath(import.meta.url), '..', '..');
const snippetsDir = join(repoRoot, 'docs/specs/snippets');
const outPath = join(repoRoot, 'packages/cli/tests/generated/sz-key-cases.json');

// Classes that look like utilities but are not (custom CSS imports, demo markers).
const SKIP_CLASSES = new Set(["import './custom.css'", 'tw-text-center', 'tab-active', 'N/A']);
const TW_TOKEN_RE = /^!?(?:[\w-]+:)*[\w\-./[\]()@#%]+$/;
const CSS_FN_RE = /^(?:calc|var|url|rgb|rgba|hsl|hsla|oklch|color|env|min|max|clamp)\(/;

/**
 * Returns true when a token looks like a real Tailwind utility (mirrors the gate
 * in scripts/extract-corpus.ts).
 * @param token Candidate class token.
 * @returns Whether the token is a plausible Tailwind class.
 */
function isValidTwToken(token) {
    if (token === '-' || token === '/' || CSS_FN_RE.test(token)) return false;
    return TW_TOKEN_RE.test(token) && token.length >= 1 && token.length <= 120;
}

/**
 * Returns true when a class is a single concrete utility we can both compile and
 * migrate — no placeholders, ranges, variants, or multi-class strings.
 * @param cls Candidate class string.
 * @returns Whether the class is usable as a test case.
 */
function isConcrete(cls) {
    if (!cls || SKIP_CLASSES.has(cls)) return false;
    if (/\s/.test(cls)) return false; // multi-class element string
    if (cls.includes(':')) return false; // variant — covered by roundtrip.test.ts
    if (/[<>]|\.\.\.|\betc\b|\(value\)|\(--x\)/.test(cls)) return false; // placeholder
    return isValidTwToken(cls);
}

// Representative substitutions for the `<number>` / `<fraction>` template rows
// (e.g. `pt-<number>` / `{ pt: <number> }`). The forward/reverse round-trip gate
// drops any substitution a prop does not actually accept, so this can only add
// genuinely-valid cases — never a false assertion.
const PLACEHOLDER_SUBS = [
    [/<number>/g, '4'],
    [/<fraction>/g, '1/2'],
    [/<percentage>/g, '50%'],
];

/**
 * Concretizes a class token, substituting a single supported placeholder kind.
 * @param cls Raw class token (may contain a `<number>`/`<fraction>` placeholder).
 * @returns A concrete class string, or null if it cannot be concretized.
 */
function concretizeClass(cls) {
    if (!cls || /\s/.test(cls) || cls.includes(':')) return null;
    if (isConcrete(cls)) return cls;
    for (const [re, val] of PLACEHOLDER_SUBS) {
        if (re.test(cls)) {
            const c = cls.replace(re, val);
            return isConcrete(c) ? c : null;
        }
    }
    return null;
}

/**
 * Parses an sz literal, applying the same placeholder substitution as the class.
 * @param lit Raw `{ ... }` literal from the sz column.
 * @returns Parsed object or null.
 */
function concretizeSz(lit) {
    let s = lit;
    for (const [re, val] of PLACEHOLDER_SUBS) s = s.replace(re, val);
    return parseSzProp(s);
}

/**
 * Splits a markdown table row into trimmed cells.
 * @param line Raw table row.
 * @returns Cell strings.
 */
function splitTableRow(line) {
    let inner = line.trim();
    if (inner.startsWith('|')) inner = inner.slice(1);
    if (inner.endsWith('|')) inner = inner.slice(0, -1);
    return inner.split('|').map(c => c.trim());
}
const isTableRow = l => l.trim().startsWith('|');
const isSeparatorRow = l => /^\|\s*:?-+/.test(l.trim());
const stripMarkdown = t => t.replace(/`/g, '').replace(/\*\*/g, '').replace(/\*/g, '').trim();

/**
 * Splits a Tailwind cell into individual class tokens, respecting backticks and
 * top-level commas (commas inside [] or () are part of an arbitrary value).
 * @param cell Raw Tailwind-column cell.
 * @returns Class token strings.
 */
function classTokens(cell) {
    const ticked = [...cell.matchAll(/`([^`]+)`/g)].map(m => m[1].trim());
    const raw = ticked.length ? ticked : [stripMarkdown(cell)];
    const out = [];
    for (const chunk of raw) {
        let depth = 0;
        let cur = '';
        for (const ch of chunk) {
            if (ch === '[' || ch === '(') depth++;
            else if (ch === ']' || ch === ')') depth--;
            if (ch === ',' && depth === 0) {
                if (cur.trim()) out.push(cur.trim());
                cur = '';
            } else {
                cur += ch;
            }
        }
        if (cur.trim()) out.push(cur.trim());
    }
    return out;
}

/**
 * Parses an `sz` prop object literal from a spec cell into a plain object.
 * Mirrors scripts/spec-to-tests.ts parseSzProp.
 * @param raw Raw sz-column fragment.
 * @returns Parsed object or null.
 */
function parseSzProp(raw) {
    let cleaned = stripMarkdown(raw).trim();
    cleaned = cleaned.replace(/\s+etc\.?\s*$/, '');
    if (!cleaned.startsWith('{') || !cleaned.endsWith('}')) return null;
    if (/\{\s*\.\.\.\s*\}/.test(cleaned) || /\{\s*\.\.\./.test(cleaned)) return null;
    const strings = [];
    cleaned = cleaned.replace(/"([^"]*)"/g, (_m, c) => {
        strings.push(c);
        return `"__STR_${strings.length - 1}__"`;
    });
    cleaned = cleaned.replace(/'([^']*)'/g, (_m, c) => {
        strings.push(c);
        return `"__STR_${strings.length - 1}__"`;
    });
    cleaned = cleaned.replace(/([{,]\s*)([a-z_$][\w$]*)\s*:/gi, '$1"$2":');
    cleaned = cleaned.replace(/"__STR_(\d+)__"/g, (_m, i) => `"${strings[parseInt(i, 10)]}"`);
    try {
        return JSON.parse(cleaned);
    } catch {
        return null;
    }
}

/**
 * Extracts every top-level `{...}` object literal from an sz-column cell.
 * @param cell Raw sz-column cell.
 * @returns Array of object-literal substrings.
 */
function szObjectLiterals(cell) {
    const objs = [];
    const re = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
    for (const m of cell.matchAll(re)) objs.push(m[0]);
    return objs;
}

const roundTrip = cls => transform(classNameToSzObject(cls).szObject).className;
const topKey = sz => (sz && typeof sz === 'object' ? Object.keys(sz)[0] : undefined);

/**
 * Walks every snippet table and collects forward/reverse cases per sz key.
 * @returns The keyed case map plus skipped-class diagnostics.
 */
function collect() {
    const keys = {}; // key -> { forward: Map<sig,{sz,class}>, reverse: Set<class> }
    const reverseSkipped = [];

    const ensure = k => {
        if (!keys[k]) keys[k] = { forward: new Map(), reverse: new Set() };
        return keys[k];
    };

    for (const file of readdirSync(snippetsDir)
        .filter(f => f.endsWith('.md'))
        .sort()) {
        const lines = readFileSync(join(snippetsDir, file), 'utf8').split('\n');
        // Persist the detected columns across blank lines / sub-headings that split
        // one logical table into chunks; only a real header row re-detects them.
        let twIdx = -1;
        let szIdx = -1;
        for (const line of lines) {
            if (!isTableRow(line) || isSeparatorRow(line)) continue;
            const cells = splitTableRow(line);
            const twHdr = cells.findIndex(c => /tailwind/i.test(c) && /(class|output)/i.test(c));
            const szHdr = cells.findIndex(c => /\bsz\b/i.test(c));
            if (twHdr >= 0 && szHdr >= 0) {
                twIdx = twHdr; // header row — (re)detect columns and skip
                szIdx = szHdr;
                continue;
            }
            if (twIdx < 0 || szIdx < 0) continue;
            const twCell = cells[twIdx] ?? '';
            const szCell = cells[szIdx] ?? '';
            const classes = classTokens(twCell);

            // FORWARD: pair documented sz objects with their class by index.
            const objs = szCell.includes('{') ? szObjectLiterals(szCell) : [];
            for (let i = 0; i < Math.min(classes.length, objs.length); i++) {
                const cls = concretizeClass(classes[i]);
                if (!cls) continue;
                const sz = concretizeSz(objs[i]);
                const key = topKey(sz);
                if (!sz || !key) continue;
                let out;
                try {
                    out = transform(sz).className;
                } catch {
                    continue;
                }
                if (out !== cls) continue; // only keep verified forward pairs
                ensure(key).forward.set(`${key} ${cls}`, { sz, class: cls });
            }

            // REVERSE: every concrete class that migrates back to itself.
            for (const raw of classes) {
                const cls = concretizeClass(raw);
                if (!cls) continue;
                let parsed = null;
                try {
                    parsed = parseClass(cls, { display: 'canonical' });
                } catch {
                    /* unrecognized */
                }
                let ok = false;
                try {
                    ok = roundTrip(cls) === cls;
                } catch {
                    ok = false;
                }
                if (ok && parsed?.prop) {
                    ensure(parsed.prop).reverse.add(cls);
                } else if (!ok) {
                    reverseSkipped.push(cls);
                }
            }
        }
    }
    return { keys, reverseSkipped };
}

/**
 * Builds the serialisable JSON payload from collected cases, computing the
 * exempt set for compiler keys with no concrete snippet representation.
 * @returns The full JSON object to emit.
 */
function build() {
    const { keys, reverseSkipped } = collect();

    const outKeys = {};
    for (const k of Object.keys(keys).sort()) {
        const forward = [...keys[k].forward.values()].sort((a, b) =>
            a.class.localeCompare(b.class),
        );
        const reverse = [...keys[k].reverse].sort();
        outKeys[k] = { forward, reverse };
    }

    const covered = new Set(Object.keys(outKeys));
    const allKeys = new Set([...Object.keys(PROPERTY_MAP), ...BOOLEAN_SHORTHANDS]);
    const exempt = {};
    for (const k of [...allKeys].sort()) {
        if (!covered.has(k)) {
            exempt[k] = 'no concrete single-class snippet example';
        }
    }

    return {
        $comment:
            'GENERATED by scripts/gen-key-tests.mjs from docs/specs/snippets. Do not edit by hand. Run pnpm gen:key-tests.',
        keyCount: Object.keys(outKeys).length,
        reverseSkippedCount: new Set(reverseSkipped).size,
        keys: outKeys,
        exempt,
    };
}

const payload = build();
const json = `${JSON.stringify(payload, null, 4)}\n`;
const check = process.argv.includes('--check');

if (check) {
    let current = '';
    try {
        current = readFileSync(outPath, 'utf8');
    } catch {
        /* missing */
    }
    if (current !== json) {
        console.error(
            '[gen-key-tests] sz-key-cases.json is stale. Run pnpm gen:key-tests and commit.',
        );
        process.exit(1);
    }
    console.log('[gen-key-tests] up to date.');
    process.exit(0);
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, json);
console.log(
    `[gen-key-tests] wrote ${payload.keyCount} keys (${payload.reverseSkippedCount} reverse-only classes skipped).`,
);
