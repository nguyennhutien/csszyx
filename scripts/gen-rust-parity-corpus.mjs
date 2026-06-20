#!/usr/bin/env node
/**
 * Generates the TS↔Rust lowering parity corpus.
 *
 * Sources two sets of sz objects: the hand-curated edge cases below (variants,
 * nesting, color-opacity, arbitrary spaces) plus every documented single-key
 * forward case from the per-key matrix fixture
 * (`packages/cli/tests/generated/sz-key-cases.json`), so the rust default engine
 * is proven equivalent to the TS engine for every key the snippets document —
 * not just the curated edges. For each object it records the canonical Babel/oxc
 * `transform()` className and serializes the object into the Rust
 * `StaticSzObject` IR shape. `packages/core/tests/parity_corpus.rs` replays the
 * same objects through the native `lower_static_sz_object` and asserts identical
 * class output, so a divergence between the two parser paths fails closed
 * instead of shipping a silent default-parser bug.
 *
 * Usage: pnpm gen:parity-corpus       (write)
 *        pnpm gen:parity-corpus:check (verify committed file is in sync)
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { transform } from '../packages/compiler/src/transform.js';

const here = dirname(fileURLToPath(import.meta.url));
const outFile = resolve(here, '../packages/core/tests/fixtures/parity-corpus.json');
const keyCasesFile = resolve(here, '../packages/cli/tests/generated/sz-key-cases.json');
const check = process.argv.includes('--check');

/** Converts a JS sz value into the serde `StaticSzValue` tagged shape. */
function toIrValue(value) {
    if (value === null) {
        return { kind: 'string', value: '' };
    }
    if (typeof value === 'string') {
        return { kind: 'string', value };
    }
    if (typeof value === 'number') {
        return { kind: 'number', value };
    }
    if (typeof value === 'boolean') {
        return { kind: 'boolean', value };
    }
    if (typeof value === 'object') {
        return { kind: 'object', value: toIrObject(value) };
    }
    return { kind: 'string', value: String(value) };
}

/** Converts a JS sz object into the serde `StaticSzObject` shape (order kept). */
function toIrObject(object) {
    return {
        properties: Object.entries(object).map(([key, value]) => ({
            key,
            span: { start: 0, end: 0 },
            value: toIrValue(value),
        })),
    };
}

// Representative, spec-aligned sz objects across every category, plus the
// edge cases the KLTN dogfood surfaced (display, color opacity, arbitrary
// spaces) and variant/nesting forms. Nonsensical-for-a-key values are fine:
// the harness asserts the two paths AGREE, not that the value is meaningful.
const corpus = [
    // spacing
    { p: 4 },
    { px: 2 },
    { py: 8 },
    { m: 'auto' },
    { m: -2 },
    { gap: 6 },
    { p: '100px' },
    { mx: '--space' },
    { p: '1/2' },
    { gap: '[10px]' },
    // sizing
    { w: 4 },
    { w: 'full' },
    { w: '1/2' },
    { h: 'screen' },
    { minW: '3px' },
    { maxW: 'prose' },
    { size: 10 },
    { w: 'calc(100%-1rem)' },
    { h: '[var(--h)]' },
    // layout — display / position / visibility (KLTN P0-1)
    { display: 'block' },
    { display: 'inline-block' },
    { display: 'flex' },
    { display: 'inline-flex' },
    { display: 'grid' },
    { display: 'none' },
    { display: 'contents' },
    { display: 'table-cell' },
    { display: 'flow-root' },
    { position: 'absolute' },
    { position: 'fixed' },
    { position: 'sticky' },
    { visibility: 'visible' },
    { visibility: 'hidden' },
    { visibility: 'collapse' },
    { float: 'left' },
    { clear: 'both' },
    { object: 'cover' },
    { overflow: 'hidden' },
    { z: 10 },
    { z: 'auto' },
    { inset: 0 },
    { top: 4 },
    { isolation: 'isolate' },
    // flex / grid (KLTN P1-4 arbitrary spaces)
    { display: 'flex' },
    { flex: 1 },
    { flex: 'auto' },
    { flexDir: 'row' },
    { flexDir: 'col' },
    { items: 'center' },
    { justify: 'between' },
    { self: 'end' },
    { content: 'center' },
    { grow: true },
    { shrink: 0 },
    { order: 2 },
    { basis: '14.28%' },
    { gridCols: 3 },
    { gridCols: 'none' },
    { gridCols: '200px' },
    { gridCols: '280px minmax(0,1fr)' },
    { gridCols: '1fr auto' },
    { gridRows: 'subgrid' },
    // colors + opacity object (KLTN P1-3)
    { bg: 'red-500' },
    { bg: '--my-color' },
    { bg: '#0d0d12' },
    { bg: 'transparent' },
    { bg: { color: 'blue-500', op: 20 } },
    { bg: { color: '--my-color', op: 50 } },
    { bg: { color: '#0d0d12', op: 90 } },
    { bg: { color: 'black', op: 0.05 } },
    { bg: { color: 'pink-500', op: '78%' } },
    { bg: { color: 'white' } },
    { color: 'gray-900' },
    { color: { color: 'white', op: 70 } },
    { border: 'red-200' },
    { ring: { color: 'blue-500', op: 50 } },
    // typography
    { text: 'sm' },
    { text: 'lg' },
    { text: '[13px]' },
    { font: 'bold' },
    { font: 'mono' },
    { leading: 7 },
    { leading: 'tight' },
    { tracking: 'wide' },
    { align: 'middle' },
    { whitespace: 'nowrap' },
    { fontStyle: 'italic' },
    { italic: false },
    { decoration: 'underline' },
    { weight: 600 },
    { indent: 4 },
    { breakWord: true },
    // borders
    { rounded: 'lg' },
    { rounded: 'full' },
    { rounded: '[4px]' },
    { border: 2 },
    { borderStyle: 'dashed' },
    { divide: 'gray-200' },
    { outline: 2 },
    { ring: 4 },
    { ringOffset: 2 },
    // backgrounds
    { bgSize: 'cover' },
    { bgSize: '8px 8px' },
    { bgRepeat: 'no-repeat' },
    { bgPos: 'center' },
    { bgImg: { gradient: 'linear', dir: 45 } },
    // effects / filters
    { shadow: 'lg' },
    { shadow: '0 35px 60px -15px rgba(0,0,0,0.3)' },
    { opacity: 80 },
    { mixBlend: 'multiply' },
    { blur: 'sm' },
    { brightness: 110 },
    { grayscale: true },
    // transforms / transitions
    { scale: 110 },
    { rotate: 45 },
    { rotate: -90 },
    { translateX: 4 },
    { transition: 'colors' },
    { duration: 300 },
    { ease: 'in-out' },
    { delay: 150 },
    // interactivity
    { cursor: 'pointer' },
    { select: 'none' },
    { pointer: 'none' },
    { scroll: 'smooth' },
    // variants — responsive / state / dark / group / peer / arbitrary / supports
    { md: { display: 'flex' } },
    { lg: { gridCols: 4 } },
    { sm: { p: 2 } },
    { hover: { bg: 'blue-600' } },
    { focus: { ring: 2 } },
    { active: { scale: 95 } },
    { dark: { bg: 'gray-900' } },
    { group: { hover: { color: 'white' } } },
    { peer: { focus: { text: 'red-500' } } },
    { peer: { checked: { bg: 'green-500' } } },
    { group: { has: { input: { display: 'block' } } } },
    { group: { data: { active: { bg: 'blue-500' } } } },
    { group: { aria: { checked: { bg: 'blue-500' } } } },
    { group: { '.is-published': { display: 'block' } } },
    { group: { sidebar: { hover: { color: 'white' } } } },
    { has: { checked: { bg: 'blue-500' } } },
    { has: { img: { rounded: 'lg' } } },
    { aria: { checked: { bg: 'blue-500' } } },
    { aria: { 'busy=true': { p: 2 } } },
    { 'group-hover': { dark: { text: 'white' } } },
    { md: { hover: { text: 'white' } } },
    { '[&>span]': { p: 1 } },
    { supports: { 'display:grid': { display: 'grid' } } },
    { supports: { 'backdrop-filter:blur(1px)': { rounded: 'lg' } } },
    { not: { first: { mt: 4 } } },
    { not: { hover: { opacity: 75 } } },
    { not: { supports: { 'display:grid': { display: 'block' } } } },
    { data: { active: { bg: 'blue-500' } } },
    { data: { 'state=open': { p: 2 } } },
    { firstChild: { ml: 0 } },
    // combinations / multiple props / important
    { p: 4, bg: 'red-500', display: 'flex' },
    { display: 'flex', items: 'center', gap: 3 },
    { md: { display: 'grid', gridCols: 2 }, p: 6 },
    { mt: 6, display: 'flex', flexWrap: 'wrap', gap: 3 },
];

// Merge the hand-curated corpus (first, order preserved) with every documented
// single-key forward case from the per-key matrix fixture. Dedup by stable JSON
// key so a curated object and its fixture twin collapse to one record, and the
// Map preserves insertion order for a diff-clean, deterministic output.
const byKey = new Map();
for (const sz of corpus) {
    byKey.set(JSON.stringify(sz), sz);
}

const keyCases = JSON.parse(readFileSync(keyCasesFile, 'utf8'));
for (const entry of Object.values(keyCases.keys)) {
    for (const { sz } of entry.forward ?? []) {
        const key = JSON.stringify(sz);
        if (!byKey.has(key)) {
            byKey.set(key, sz);
        }
    }
}

const records = [...byKey.values()].map(sz => ({
    sz: JSON.stringify(sz),
    ir: toIrObject(sz),
    oxc: transform(sz).className,
}));

const serialized = `${JSON.stringify(records, null, 2)}\n`;

if (check) {
    const current = readFileSync(outFile, 'utf8');
    if (current !== serialized) {
        console.error(
            '[gen-rust-parity-corpus] parity corpus is stale. Run pnpm gen:parity-corpus.',
        );
        process.exit(1);
    }
    console.log(`[gen-rust-parity-corpus] up to date (${records.length} records).`);
    process.exit(0);
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, serialized, 'utf8');
console.log(`Wrote ${records.length} parity records to ${outFile}`);
