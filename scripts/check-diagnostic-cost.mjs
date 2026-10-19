#!/usr/bin/env node
// Allocation gate for the engine's diagnostic path.
//
// The compiler renders each engine diagnostic from the diagnostic registry and
// fills the suggestion of an unknown key; the build lanes leave them
// unrendered and render only what they print. Nothing else in the repository
// would notice that path growing again: wall time here varies far more than
// the regressions worth catching (see the performance rule's PDD-3), and
// output is checked by tests that ask what is printed, not what it cost.
//
// This gate counts young-generation collections instead. V8 runs one each
// time the nursery fills, so with the nursery fixed at 1 MB, single-threaded,
// the count tracks bytes allocated, and it repeats exactly run to run (some
// runs of the unrendered lane differ by up to 2 of 177). Three workloads run
// in child processes, each 20 passes over 800 modules after one warm pass:
//
// - `clean`: modules with no diagnostic, through `transformRust` — the
//   control, so the ratios below cancel what the transform itself allocates;
// - `eager`: modules with six diagnostics each, four of them unknown keys
//   named afresh each pass, through `transformRust`, which renders every one
//   and computes every suggestion;
// - `lane`: the same modules through `transformRustUnrendered`, reading every
//   position as the router does and rendering the first 20 per pass, as many
//   as a build lists.
//
// Measured 2026-10-19 on Node 24.18.0, linux arm64 (scavenges; ratio to clean;
// identical over repeated runs; a build with no unrendered transform runs the
// lane workload through `transformRust`):
//
//   build                                  clean  eager       lane
//   main (bd3f3f33, renders in the engine)  120   176 1.47   176 1.47
//   af62dd86 (renders every diagnostic)     123  8204 66.7  8204 66.7
//   122dd14a (lanes render what they print) 125   270 2.16   177 1.42
//
// The lane budget holds the build lanes to `main`'s ratio plus about 9%; the
// eager budget sits about 11% above what the public transform costs now: it
// renders in TypeScript what `main` rendered in Rust. Not yet measured on x64,
// so the first CI run on that runner is that measurement. A legitimate rise is
// a change to `SCAVENGE_RATIO_BUDGETS` plus a sentence in the commit saying
// what grew it. The three workloads take about 1.7 s together.
//
// Reads `packages/compiler/dist` and needs the host native addon:
// `pnpm --filter @csszyx/core native:build` and
// `pnpm exec turbo run build --filter=@csszyx/compiler`.
//
// Usage: node scripts/check-diagnostic-cost.mjs

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The highest ratio of scavenges to the clean control each workload may reach. */
export const SCAVENGE_RATIO_BUDGETS = { eager: 2.4, lane: 1.6 };

/** V8 flags that make the scavenge count repeat: a fixed 1 MB nursery, one thread. */
export const V8_FLAGS = [
    '--trace-gc',
    '--single-threaded',
    '--max-semi-space-size=1',
    '--min-semi-space-size=1',
];

/** Modules per pass and measured passes. */
export const MODULES = 800;
export const PASSES = 20;

/** Diagnostics each noisy module reports. */
export const NOISY_DIAGNOSTICS = 6;

/** How many diagnostics the lane workload renders per pass: what a build lists. */
export const RENDERED_PER_PASS = 20;

/** Printed by a child before and after the measured passes. */
const START = '--- measured passes start';
const END = '--- measured passes end';

/**
 * A module with six diagnostics: four unknown keys, salted so each pass names
 * keys no earlier pass did, an alias typo and an alias.
 *
 * @param {number} index - The module's index.
 * @param {string} salt - Text that makes this pass's unknown keys new.
 * @returns {string} The module source.
 */
export function noisyModule(index, salt) {
    return `export function C${index}() {
  return (
    <div sz={{ p: 4, fooBar${salt}: 1, workBreak: 'x' }}>
      <span sz={{ bg: 'blue-500', zzTop${salt}: 2 }} />
      <a sz={{ m: 2, qqq${salt}: 3, padding: 4 }} />
      <b sz={{ text: 'sm', xyzw${salt}: 1 }} />
    </div>
  );
}
`;
}

/**
 * The same markup with every key known: no diagnostic.
 *
 * @param {number} index - The module's index.
 * @returns {string} The module source.
 */
export function cleanModule(index) {
    return `export function C${index}() {
  return (
    <div sz={{ p: 4, mt: 1, mb: 'x' }}>
      <span sz={{ bg: 'blue-500', ml: 2 }} />
      <a sz={{ m: 2, mr: 3, px: 4 }} />
      <b sz={{ text: 'sm', py: 1 }} />
    </div>
  );
}
`;
}

/**
 * Count the scavenges `--trace-gc` printed between the child's markers.
 *
 * @param {string} output - The child's stdout.
 * @returns {number | null} The count, or null when a marker is missing.
 */
export function countScavenges(output) {
    const start = output.indexOf(START);
    const end = output.indexOf(END);
    if (start === -1 || end === -1 || end < start) return null;
    return output.slice(start, end).match(/\bScavenge\b/g)?.length ?? 0;
}

/**
 * Compare each workload's ratio to the clean control with its budget.
 *
 * @param {{ clean: number, eager: number, lane: number }} counts - Scavenges per workload.
 * @param {{ eager: number, lane: number }} budgets - The highest ratio each may reach.
 * @returns {{ ok: boolean, lines: string[] }} The verdict and the lines to print.
 */
export function judge(counts, budgets) {
    const lines = [];
    let ok = true;
    for (const workload of /** @type {const} */ (['eager', 'lane'])) {
        const ratio = counts[workload] / counts.clean;
        const share = `${counts[workload]} scavenges against ${counts.clean} clean, ratio ${ratio.toFixed(2)} of ${budgets[workload]}`;
        if (ratio > budgets[workload]) {
            ok = false;
            lines.push(
                `diagnostic cost (${workload}): ${share}, over budget. Find what in the diagnostic path allocates more; raise SCAVENGE_RATIO_BUDGETS in scripts/check-diagnostic-cost.mjs only with the reason in the commit.`,
            );
        } else {
            lines.push(`diagnostic cost (${workload}): ${share}.`);
        }
    }
    return { ok, lines };
}

/**
 * Run one workload in this process: the child side of the gate.
 *
 * @param {'clean' | 'eager' | 'lane'} workload - Which one.
 */
async function runWorkload(workload) {
    const dist = path.join(ROOT, 'packages/compiler/dist');
    const engine = await import(pathToFileURL(path.join(dist, 'engine.mjs')).href);
    const internal = await import(pathToFileURL(path.join(dist, 'internal.mjs')).href);
    const transform = workload === 'lane' ? internal.transformRustUnrendered : engine.transformRust;
    const expected = workload === 'clean' ? 0 : NOISY_DIAGNOSTICS;
    let sink = 0;
    const pass = number => {
        let rendered = 0;
        for (let index = 0; index < MODULES; index++) {
            const source =
                workload === 'clean'
                    ? cleanModule(index)
                    : noisyModule(index, `${index}p${number}`);
            const result = transform(source, `/project/src/C${index}.tsx`);
            const issues = result.issues ?? [];
            if (issues.length !== expected) {
                throw new Error(
                    `${workload}: module ${index} reported ${issues.length} diagnostics, not ${expected}`,
                );
            }
            sink += result.diagnostics.length;
            for (const issue of issues) {
                sink += issue.line + issue.column;
                if (workload === 'lane' && rendered < RENDERED_PER_PASS) {
                    sink += internal.renderEngineDiagnostic(issue, result.diagnosticFile).length;
                    rendered++;
                }
            }
        }
    };
    pass(0);
    console.log(START);
    for (let number = 1; number <= PASSES; number++) pass(number);
    console.log(END, sink >= 0);
}

/**
 * Run one workload in a child process under the counting flags.
 *
 * @param {'clean' | 'eager' | 'lane'} workload - Which one.
 * @returns {number} Its scavenges.
 */
function measure(workload) {
    const run = spawnSync(
        process.execPath,
        [...V8_FLAGS, fileURLToPath(import.meta.url), '--workload', workload],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    const count = run.status === 0 ? countScavenges(run.stdout) : null;
    if (count === null) {
        console.error(
            `diagnostic cost: the ${workload} workload failed (exit ${run.status}).\n${run.stderr}`,
        );
        process.exit(1);
    }
    return count;
}

/** Run the gate and exit non-zero on a failure. */
function main() {
    const counts = { clean: measure('clean'), eager: measure('eager'), lane: measure('lane') };
    const { ok, lines } = judge(counts, SCAVENGE_RATIO_BUDGETS);
    for (const line of lines) (ok ? console.log : console.error)(line);
    if (!ok) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const at = process.argv.indexOf('--workload');
    if (at === -1) main();
    else await runWorkload(/** @type {'clean' | 'eager' | 'lane'} */ (process.argv[at + 1]));
}
