import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

/**
 * Size gate for the JS that ships to end users. Bytes are the one performance
 * metric here that is fully deterministic — the same build produces the same
 * gzip total on any machine — so unlike wall-clock timing (see tdd.md TDD-6)
 * this can be a hard merge gate with zero flake risk.
 *
 * Three surfaces are guarded, each one code a user's bundler pulls into the
 * browser bundle:
 * - `@csszyx/runtime` exports — the `_sz`/`szv` helper layer every app imports.
 * - `@csszyx/dynamic` exports — the runtime dynamic-styling layer.
 * - `@csszyx/compiler` browser entry closure — `@csszyx/dynamic` imports
 *   `@csszyx/compiler/browser` at runtime, so that entry plus the shared
 *   chunks it re-exports reach the browser too. Only that closure is
 *   measured; the rest of the compiler dist is build-time code that never
 *   leaves the dev machine.
 *
 * Measurement is the closure of each package's `exports` map under the
 * `import` condition (what modern bundlers resolve), NOT a directory walk of
 * dist: `tsc -b` has `outDir: ./dist` in these packages and emits per-module
 * `.js` files next to the bundler output whenever type-check runs, so a
 * directory total would swing by 2× depending on whether tsc ran last —
 * entry closures give the same number in CI and locally.
 *
 * Budgets are absolute gzip byte ceilings committed here, not diffs against a
 * stored baseline — nothing external to fetch, nothing that can go stale.
 * Crossing one is a one-line change to the number below plus a sentence in the
 * PR explaining the growth. Set them from a measured baseline plus ~10%
 * headroom: wide enough that legitimate small growth does not thrash the
 * number, tight enough that silently swallowing a 30KB dependency fails.
 */

/** Gzip ceilings per user-shipped surface. Baselines measured 2026-08-07 on
 * main (dae7d88e): runtime 18,665 B · dynamic 13,259 B · compiler browser
 * closure 22,008 B. Re-measure with `pnpm check:package-size` after a build. */
export const SIZE_BUDGETS = [
    {
        // Raised from 20,480 for the mangle registry, measured 2026-08-26 at
        // 20,758 B. The map used to reach the runtime helpers through a debug
        // global that an inline HTML script installed, which strict CSP
        // refuses; registering it from inside the bundle moved that code into
        // the shipped runtime, so the growth is the fix rather than drift.
        //
        // Raised again from 22,800 for routing `splitBox` by CSS role, measured
        // 2026-09-05 at 23,266 B in three steps: 22,109 before, 22,580 with the
        // value-routed box-role map (+471, real payload — the exact tokens now
        // carry the prefix and value they were built from), 23,266 with the
        // three development warnings (+686, all of it message text).
        //
        // That second half is package weight only, not app weight: bundled with
        // `process.env.NODE_ENV` defined as production, the warning text is gone
        // from the output (measured with esbuild — zero occurrences, and 794
        // gzip bytes smaller than the same bundle built for development).
        name: '@csszyx/runtime export closure',
        kind: 'package-exports',
        target: 'packages/runtime',
        maxGzipBytes: 23_552,
    },
    {
        name: '@csszyx/dynamic export closure',
        kind: 'package-exports',
        target: 'packages/dynamic',
        maxGzipBytes: 15_360,
    },
    {
        name: '@csszyx/compiler browser entry closure',
        kind: 'entry-closure',
        target: 'packages/compiler/dist/transform-core.mjs',
        maxGzipBytes: 24_576,
    },
    // The wasm build of the parser is the fourth surface: not browser code,
    // but a file every `npm install` downloads inside @csszyx/core. Measured
    // 2026-08-12 at 460,116 gzip bytes un-optimized (the release workflow's
    // wasm-opt pass only shrinks it). The ceiling exists to catch a debug
    // -profile build or dependency bloat slipping into the artifact — either
    // multiplies the size, a creep of +10% does not.
    {
        name: '@csszyx/core parser wasm artifact',
        kind: 'file',
        target: 'packages/core/pkg-parser/csszyx_core_bg.wasm',
        maxGzipBytes: 520_000,
    },
];

const RUNTIME_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);

/** Whether a file is runtime JS a bundler would ship, as opposed to
 * declarations (`.d.ts`/`.d.mts`/`.d.cts`), source maps, or metadata.
 * Declaration extensions never collide with the allowlist: `index.d.mts`
 * parses as `.mts`, not `.mjs`.
 *
 * @param {string} filePath file path (any base directory)
 * @returns {boolean} true when the file counts toward the budget
 */
export function isRuntimeArtifact(filePath) {
    return RUNTIME_EXTENSIONS.has(path.extname(filePath));
}

/** Pick the file a bundler resolves for one export subpath: the `import`
 * condition when present, else `default`, recursively through nested
 * condition objects.
 *
 * @param {unknown} conditionValue one subpath value from an exports map
 * @returns {string | null} relative target file, or null when unresolvable
 */
function importTarget(conditionValue) {
    if (typeof conditionValue === 'string') return conditionValue;
    if (conditionValue && typeof conditionValue === 'object') {
        const narrowed = conditionValue.import ?? conditionValue.default ?? null;
        return narrowed === null ? null : importTarget(narrowed);
    }
    return null;
}

/** List the runtime entry files a package's `exports` map ships under the
 * `import` condition. Non-runtime targets (type declarations, the
 * `./package.json` subpath) are skipped.
 *
 * @param {string} packageDir absolute package directory
 * @returns {string[]} absolute entry file paths, sorted
 */
export function listExportEntries(packageDir) {
    const manifest = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
    const entries = new Set();
    for (const conditionValue of Object.values(manifest.exports ?? {})) {
        const target = importTarget(conditionValue);
        if (target !== null && isRuntimeArtifact(target)) {
            entries.add(path.resolve(packageDir, target));
        }
    }
    return [...entries].sort();
}

/** Specifiers that pull other local chunks into the shipped graph. Package
 * imports (`@csszyx/…`, `node:…`) stay external to the bundle measurement.
 * Ordered alternation (call forms before bare `import`) keeps the scan
 * linear — no adjacent optional-whitespace groups to backtrack through. */
const RELATIVE_IMPORT_PATTERN = /(?:from|require\s*\(|import\s*\(|import)\s*['"](\.[^'"]+)['"]/g;

/** Resolve the transitive closure of entry files over their relative static
 * imports — the exact set of local files a bundler ships for those entries.
 * A broken relative import throws instead of silently shrinking the closure.
 *
 * @param {string | string[]} entryPaths absolute entry file(s)
 * @returns {string[]} absolute file paths in the closure, sorted
 */
export function resolveEntryClosure(entryPaths) {
    const seen = new Set();
    const queue = [entryPaths].flat().map(entry => path.resolve(entry));
    while (queue.length > 0) {
        const current = queue.pop();
        if (seen.has(current)) continue;
        seen.add(current);
        let source;
        try {
            source = readFileSync(current, 'utf8');
        } catch (error) {
            throw new Error(
                `Entry closure import does not exist: ${current} (${error.code ?? error.message})`,
            );
        }
        for (const match of source.matchAll(RELATIVE_IMPORT_PATTERN)) {
            queue.push(path.resolve(path.dirname(current), match[1]));
        }
    }
    return [...seen].sort();
}

/** Sum the gzip size of each file, compressed independently at a fixed level
 * so the total is stable across runs and machines.
 *
 * @param {string[]} filePaths absolute file paths
 * @returns {number} total gzip bytes
 */
export function gzipTotalBytes(filePaths) {
    let total = 0;
    for (const filePath of filePaths) {
        total += gzipSync(readFileSync(filePath), { level: 9 }).length;
    }
    return total;
}

/** Measure every budget target and compare against its ceiling. A target
 * whose package or entries are missing is a failure, not a pass — a green
 * result must always mean "measured and under budget", never "nothing there
 * to measure" (an unbuilt or restructured package would otherwise pass
 * silently).
 *
 * @param {typeof SIZE_BUDGETS} budgets budget entries with repo-relative targets
 * @param {string} rootDir absolute repository root
 * @returns {{ results: Array<{ name: string, files: string[], gzipBytes: number, maxGzipBytes: number, ok: boolean }>, failures: string[] }} measurements and failure messages
 */
export function checkBudgets(budgets, rootDir) {
    const results = [];
    const failures = [];
    for (const budget of budgets) {
        const target = path.join(rootDir, budget.target);
        let files;
        try {
            if (budget.kind === 'file') {
                // A binary artifact is one opaque file: no import closure to
                // walk, but its absence is still a failure, never a pass.
                statSync(target);
                files = [target];
            } else {
                const entries =
                    budget.kind === 'package-exports' ? listExportEntries(target) : [target];
                if (entries.length === 0) {
                    throw new Error(`no runtime export entries in ${budget.target}/package.json`);
                }
                files = resolveEntryClosure(entries);
            }
        } catch (error) {
            failures.push(`${budget.name}: ${error.message} — run \`pnpm build\` first?`);
            continue;
        }
        const gzipBytes = gzipTotalBytes(files);
        const ok = gzipBytes <= budget.maxGzipBytes;
        results.push({
            name: budget.name,
            files,
            gzipBytes,
            maxGzipBytes: budget.maxGzipBytes,
            ok,
        });
        if (!ok) {
            failures.push(
                `${budget.name}: ${gzipBytes} gzip bytes exceeds the ${budget.maxGzipBytes}-byte budget ` +
                    `(+${gzipBytes - budget.maxGzipBytes}). If the growth is intentional, raise the ` +
                    'budget in scripts/check-package-size.mjs and say why in the PR.',
            );
        }
    }
    return { results, failures };
}

function main() {
    const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const { results, failures } = checkBudgets(SIZE_BUDGETS, rootDir);
    for (const result of results) {
        const headroom = result.maxGzipBytes - result.gzipBytes;
        console.log(
            `${result.ok ? 'OK  ' : 'OVER'} ${result.name}: ${result.gzipBytes} / ${result.maxGzipBytes} gzip bytes ` +
                `(${result.files.length} files, ${headroom >= 0 ? `${headroom} under` : `${-headroom} over`})`,
        );
    }
    if (failures.length > 0) {
        throw new Error(`Package size check failed:\n- ${failures.join('\n- ')}`);
    }
    console.log(`Package size check passed (${results.length} budgets).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}
