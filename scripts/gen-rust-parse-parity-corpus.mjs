#!/usr/bin/env node
/**
 * Generates the TS↔Rust *parse-level* parity corpus.
 *
 * The lowering harness (gen-rust-parity-corpus.mjs) compares object→className.
 * This one compares `source .tsx → extracted classes` so the rust parser
 * (the shipped default) cannot diverge from the canonical oxc parser when it
 * pulls sz objects and className strings out of real source.
 *
 * For each source snippet it records the oxc `classes` (sz-derived) and
 * `rawClassNames` (static className strings). `packages/core/tests/
 * parse_parity_corpus.rs` replays the same sources through the native
 * `transform_batch` and asserts the same two sets.
 *
 * Usage: pnpm gen:parse-parity-corpus
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { transformOxc } from '../packages/compiler/src/transform-oxc.js';

const here = dirname(fileURLToPath(import.meta.url));
const outFile = resolve(here, '../packages/core/tests/fixtures/parse-parity-corpus.json');

const sorted = values => [...new Set(values)].sort();

// Source snippets exercising the parse surface: static sz, multi-prop, variants,
// dynamic values (→ css vars), ternary branches, color-opacity, mixed
// className+sz, multiple elements, components, and comment/string decoys.
const sources = [
    'const A = () => <div sz={{ p: 4 }} />;',
    'const A = () => <div sz={{ p: 4, bg: "red-500", flex: true }} />;',
    'const A = () => <div sz={{ m: -2, gap: "1/2" }} />;',
    'const A = () => <div sz={{ w: "280px minmax(0,1fr)" }} />;',
    'const A = () => <div sz={{ display: "flex" }} />;',
    'const A = () => <div sz={{ md: { flex: true }, p: 6 }} />;',
    'const A = () => <div sz={{ hover: { bg: "blue-600" } }} />;',
    'const A = () => <div sz={{ group: { hover: { color: "white" } } }} />;',
    'const A = () => <div sz={{ supports: { "display:grid": { grid: true } } }} />;',
    'const A = () => <div sz={{ bg: { color: "blue-500", op: 20 } }} />;',
    'const A = () => <div sz={{ p: pad }} />;',
    'const A = () => <div sz={{ p: 4, m: gap }} />;',
    'const A = () => <div sz={cond ? { p: 4 } : { m: 2 }} />;',
    'const A = () => <div className="flex gap-2" sz={{ p: 4 }} />;',
    'const A = () => <div className="sport-neon p-4" />;',
    'const A = () => <div className={`a ${x}`} />;',
    'const A = () => (<section><span sz={{ m: 2 }} /><p sz={{ p: 1, text: "sm" }} /></section>);',
    'const A = () => <Card sz={{ p: 4 }} />;',
    'const A = () => <div sz={{ p: 4 }}>{/* sz={{ m: 9 }} in a comment */}</div>;',
    'const A = () => <div title="sz={{ z: 9 }}" sz={{ p: 4 }} />;',
    'const A = () => <div sz={{ "before:content": "\'\'", before: { p: 1 } }} />;',
    'const A = () => <div sz={{ rounded: "lg", border: 2, shadow: "md" }} />;',
];

const records = sources.map(source => {
    const result = transformOxc(source, 'file.tsx');
    return {
        source,
        classes: sorted(result.classes),
        rawClassNames: sorted(result.rawClassNames ?? []),
    };
});

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
console.log(`Wrote ${records.length} parse-parity records to ${outFile}`);
