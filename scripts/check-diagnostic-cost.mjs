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
//   control, held under an absolute ceiling of its own;
// - `eager`: modules with six diagnostics each, four of them unknown keys
//   named afresh each pass, through `transformRust`, which renders every one
//   and computes every suggestion;
// - `lane`: the same modules through `transformRustUnrendered`, reading every
//   position as the router does and rendering the first 20 per pass, as many
//   as a build lists.
//
// The diagnostic path is what `eager` and `lane` allocate beyond `clean`, so
// each is budgeted as that difference. It used to be a ratio to `clean`,
// which read a regression of the control as an improvement: 0.18.0 grew
// `clean` from 64 to 125 with the per-class merge lists and the ratios fell,
// while the fix for it raised them toward their budget. The difference
// stayed put across both (149 and 52 before, 151 and 53 after).
//
// Measured 2026-10-22 on Node 24.18.0, linux arm64 (scavenges; difference to
// clean; identical over repeated runs):
//
//   build                                      clean  eager      lane
//   v0.17.2                                      64
//   88e1b319 (merge lists recorded twice,
//             positions resolved eagerly)       125   274 +149   177 +52
//   this gate's first baseline                  111   262 +151   164 +53
//   spans as one length-prefixed text per file   94   230 +136   124 +30
//
// The last row is the current baseline. The spans cross the napi boundary as
// one string per file, read by a cursor that builds the located entries
// directly, reuses a string it has already read for a repeated key or class,
// and parses every issue's args with one `JSON.parse`; the engine also
// stopped copying each object's keys and classes twice while recording it.
//
// The clean ceiling is the baseline plus 3%, so a change that makes every
// transform allocate more fails here even when no diagnostic is involved; the
// two budgets sit about 10% and 13% above their differences. Not yet
// measured on x64, so the first CI run on that runner is that measurement. A
// legitimate rise is a change to `CLEAN_SCAVENGE_CEILING` or
// `SCAVENGE_DELTA_BUDGETS` plus a sentence in the commit saying what grew it;
// a fall should lower the ceiling with it. The three workloads take about
// 1.7 s together.
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

/** The most scavenges the clean control may reach: what every transform allocates. */
export const CLEAN_SCAVENGE_CEILING = 97;

/** The most scavenges each workload may run beyond the clean control. */
export const SCAVENGE_DELTA_BUDGETS = { eager: 150, lane: 34 };

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
 * Hold the clean control under its ceiling, and what each workload allocates
 * beyond it under its budget.
 *
 * @param {{ clean: number, eager: number, lane: number }} counts - Scavenges per workload.
 * @param {{ ceiling: number, budgets: { eager: number, lane: number } }} limits - The
 *        clean ceiling, and the most each workload may run beyond clean.
 * @returns {{ ok: boolean, lines: string[] }} The verdict and the lines to print.
 */
export function judge(counts, limits) {
    const lines = [];
    let ok = true;
    const clean = `${counts.clean} scavenges, ceiling ${limits.ceiling}`;
    if (counts.clean > limits.ceiling) {
        ok = false;
        lines.push(
            `transform cost (clean): ${clean}, over the ceiling. Every transform allocates more than it did; find what, or raise CLEAN_SCAVENGE_CEILING in scripts/check-diagnostic-cost.mjs only with the reason in the commit.`,
        );
    } else {
        lines.push(`transform cost (clean): ${clean}.`);
    }
    for (const workload of /** @type {const} */ (['eager', 'lane'])) {
        const beyond = counts[workload] - counts.clean;
        const share = `${counts[workload]} scavenges against ${counts.clean} clean, ${beyond} beyond it of ${limits.budgets[workload]}`;
        if (beyond > limits.budgets[workload]) {
            ok = false;
            lines.push(
                `diagnostic cost (${workload}): ${share}, over budget. Find what in the diagnostic path allocates more; raise SCAVENGE_DELTA_BUDGETS in scripts/check-diagnostic-cost.mjs only with the reason in the commit.`,
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
    const { ok, lines } = judge(counts, {
        ceiling: CLEAN_SCAVENGE_CEILING,
        budgets: SCAVENGE_DELTA_BUDGETS,
    });
    for (const line of lines) (ok ? console.log : console.error)(line);
    if (!ok) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const at = process.argv.indexOf('--workload');
    if (at === -1) main();
    else await runWorkload(/** @type {'clean' | 'eager' | 'lane'} */ (process.argv[at + 1]));
}
