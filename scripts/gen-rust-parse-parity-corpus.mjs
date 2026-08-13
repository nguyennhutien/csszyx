#!/usr/bin/env node
/**
 * Regenerates the *parse-level* regression corpus from the native engine.
 *
 * The oracle IS the engine under test — canonical since 2026-08-12, when the
 * corpus was re-based off the TypeScript engines it originally mirrored. That
 * makes this generator a footgun if pointed at a red gate: regenerating
 * launders whatever the engine does TODAY into the expectation, so a
 * regression would vanish instead of failing. Run it only to add new source
 * shapes (append to `sources` below) or after an INTENDED behaviour change,
 * and let review judge the fixture diff either way.
 *
 * `packages/core/tests/parse_parity_corpus.rs` replays the same sources
 * through the napi binding; `wasm-parser-parity.test.ts` replays them through
 * the wasm build. (The lowering corpus, gen-rust-parity-corpus.mjs, is NOT
 * frozen like this — its oracle is `transform-core.ts`, which stays.)
 *
 * Usage: pnpm gen:parse-parity-corpus
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    isRustTransformAvailable,
    transformRust,
} from '../packages/compiler/src/transform-rust.js';

const here = dirname(fileURLToPath(import.meta.url));
const outFile = resolve(here, '../packages/core/tests/fixtures/parse-parity-corpus.json');

const sorted = values => [...new Set(values)].sort();

// Source snippets exercising the parse surface: static sz, multi-prop, variants,
// dynamic values (→ css vars), ternary branches, color-opacity, mixed
// className+sz, multiple elements, components, and comment/string decoys.
const sources = [
    'const A = () => <div sz={{ p: 4 }} />;',
    'const A = () => <div sz={{ p: 4, bg: "red-500", display: "flex" }} />;',
    'const A = () => <div sz={{ m: -2, gap: "1/2" }} />;',
    'const A = () => <div sz={{ w: "280px minmax(0,1fr)" }} />;',
    'const A = () => <div sz={{ display: "flex" }} />;',
    'const A = () => <div sz={{ md: { display: "flex" }, p: 6 }} />;',
    'const A = () => <div sz={{ hover: { bg: "blue-600" } }} />;',
    'const A = () => <div sz={{ group: { hover: { color: "white" } } }} />;',
    'const A = () => <div sz={{ supports: { "display:grid": { display: "grid" } } }} />;',
    'const A = () => <div sz={{ bg: { color: "blue-500", op: 20 } }} />;',
    'const A = () => <div sz={{ p: pad }} />;',
    'const A = () => <div sz={{ p: 4, m: gap }} />;',
    'const A = () => <div sz={cond ? { p: 4 } : { m: 2 }} />;',
    'const A = ({ on }) => <div sz={(on ? { p: 2 } : { p: 4 }) as const} />;',
    'const A = ({ on }) => <div sz={(on ? { p: 2 } : { p: 4 }) satisfies object} />;',
    'const A = ({ on }) => <div sz={(on ? { p: 2 } : { p: 4 })!} />;',
    'const STYLE = (on ? { p: 2 } : { p: 4 }) as const; const A = () => <div sz={STYLE} />;',
    'const STYLE = ((on ? { p: 2 } : { p: 4 }) as const)!; const A = () => <div sz={STYLE} />;',
    'const A = () => <div className="flex gap-2" sz={{ p: 4 }} />;',
    'const A = () => <div className="sport-neon p-4" />;',
    'const A = () => <div className={`a ${x}`} />;',
    'const A = () => (<section><span sz={{ m: 2 }} /><p sz={{ p: 1, text: "sm" }} /></section>);',
    'const A = () => <Card sz={{ p: 4 }} />;',
    'const A = () => <div sz={{ p: 4 }}>{/* sz={{ m: 9 }} in a comment */}</div>;',
    'const A = () => <div title="sz={{ z: 9 }}" sz={{ p: 4 }} />;',
    'const A = () => <div sz={{ "before:content": "\'\'", before: { p: 1 } }} />;',
    'const A = () => <div sz={{ rounded: "lg", border: 2, shadow: "md" }} />;',
    'const A = () => <div sz={{ forcedColors: { borderColor: "gray" } }} />;',
    'const A = () => <div sz={{ starting: { opacity: 0 }, inert: { opacity: 50 } }} />;',
    // A bare runtime identifier and a nullable ternary in ONE object: the rust
    // parser used to punt the whole object and silently drop every dynamic
    // utility (only statics survived), while oxc/babel emit all of them.
    'const A = ({ width, flex }) => <div sz={{ w: width, flex: typeof flex === "number" ? flex : undefined }} />;',
    'const A = ({ width, flex, cond }) => <div sz={{ w: width, h: "max", flex: cond ? flex : undefined }} />;',
    'const A = ({ flex, cond }) => <div sz={{ flex: cond ? flex : undefined }} />;',
    'const A = ({ width, flex }) => <div sz={{ w: width, flex }} />;',
    // sz inside // line and /** doc comments must not contribute classes: the
    // rust scanner used to extract them while oxc/babel ignore comments.
    'const A = () => {\n  // <Box sz={{ mb: 10 }}>x</Box>\n  return <div sz={{ p: 2 }} />;\n};',
    '/** example: <svg sz={{ fill: "red-500" }} /> */\nconst A = () => <div sz={{ p: 2 }} />;',
    'const A = () => <div /* sz={{ mt: 8 }} */ sz={{ p: 2 }} />;',
    // An `as`-cast literal in a conditional branch resolves statically in every
    // lane (rust always unwrapped casts; babel/oxc used to collapse the whole
    // conditional to a runtime CSS variable).
    'const A = ({ isImage }) => <div sz={{ whitespace: isImage ? "nowrap" : ("wrap" as any) }} />;',
    // Family sweep around the ternary-beside-runtime-var fix: finite ternary +
    // var, variant-prefixed var, nullable-in-variant, className merge.
    'const A = ({ w, on }) => <div sz={{ w: w, p: on ? 2 : 4 }} />;',
    'const A = ({ w, on }) => <div sz={{ hover: { w: w }, p: on ? 2 : undefined }} />;',
    'const A = ({ w, a, b }) => <div sz={{ w: w, p: a ? 2 : undefined, m: b ? 4 : undefined }} />;',
    'const A = ({ f, on }) => <div sz={{ md: { flex: on ? f : undefined } }} />;',
    'const A = ({ w, f, on }) => <div className="x" sz={{ w: w, flex: on ? f : undefined }} />;',
    // Multi-ternary lane: N property conditionals append one template segment
    // each, coexisting with statics, runtime vars, variants, an existing
    // className, and color-opacity sub-object conditionals.
    'const A = ({ a, b }) => <div sz={{ p: a ? 2 : 4, m: b ? 1 : 3 }} />;',
    'const A = ({ a, b, c }) => <div sz={{ p: a ? 2 : 4, m: b ? 1 : 3, h: c ? "max" : "full" }} />;',
    'const A = ({ a, b }) => <div className="x" sz={{ p: a ? 2 : 4, m: b ? 1 : 3 }} />;',
    'const A = ({ w, a, b }) => <div sz={{ w: w, h: "max", p: a ? 2 : undefined, m: b ? 4 : undefined }} />;',
    'const A = ({ a, b }) => <div sz={{ hover: { p: a ? 1 : 2 }, m: b ? 4 : undefined }} />;',
    'const A = ({ a, b }) => <div sz={{ bg: { color: "black", op: a ? 30 : 100 }, p: b ? 2 : undefined }} />;',
    'const A = ({ a, b }) => <div sz={{ p: a ? 2 : undefined, m: b ? 4 : undefined }} />;',
    // Multi-ternary × dynamic-var combos: both nullable branches runtime, and
    // the kitchen sink (var + runtime-branch ternary + finite ternary +
    // className merge).
    'const A = ({ x, y, a, b }) => <div sz={{ p: a ? x : undefined, m: b ? y : undefined }} />;',
    'const A = ({ w, f, on, big }) => <div sz={{ w: w, flex: on ? f : undefined, p: big ? 8 : 2 }} />;',
    'const A = ({ w, f, on, big }) => <div className="x" sz={{ w: w, flex: on ? f : undefined, p: big ? 8 : 2 }} />;',

    // A const DECLARED in the same file, used as a scalar sz value. The corpus
    // already covers a free identifier (`p: pad`), which every engine defers to
    // runtime — but not a resolvable one, where the engines disagree about
    // whether to read it at build time. Without these the gate cannot see the
    // divergence at all.
    'const x = 4; const A = () => <div sz={{ p: x }} />;',
    'const c = "red-500"; const A = () => <div sz={{ bg: c }} />;',
    'const c = "red-500"; const A = () => <div sz={{ hover: { bg: c } }} />;',
    'const A = () => { const x = 4; return <div sz={{ p: x }} />; };',
    // Computed key whose const resolves to a real property name.
    'const k = "p"; const A = () => <div sz={{ [k]: 4 }} />;',
];

if (!isRustTransformAvailable()) {
    // Recording from a different engine than the one the gate replays would
    // reintroduce the two-oracle drift this corpus was re-based to remove.
    console.error('[gen-parse-parity] native engine unavailable — refusing to record.');
    process.exit(1);
}

const records = sources.map(source => {
    const result = transformRust(source, 'file.tsx');
    return {
        source,
        classes: sorted(result.classes),
        rawClassNames: sorted(result.rawClassNames ?? []),
    };
});

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
console.log(`Wrote ${records.length} parse-parity records to ${outFile}`);
