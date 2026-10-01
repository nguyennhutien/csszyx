import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

import { buildSync } from 'esbuild';

/**
 * Size gate for the JS that ships to end users. Bytes are the one performance
 * metric here that is fully deterministic — the same build produces the same
 * gzip total on any machine — so unlike wall-clock timing (see tdd.md TDD-6)
 * this can be a hard merge gate with zero flake risk.
 *
 * Three JS surfaces are guarded, each one code a user's bundler pulls into the
 * browser bundle:
 * - `@csszyx/runtime` exports — the `_sz`/`szv` helper layer every app imports.
 * - `@csszyx/dynamic` exports — the runtime dynamic-styling layer.
 * - `@csszyx/compiler` `./browser` entry — `@csszyx/dynamic` imports it at
 *   runtime. The rest of the compiler is build-time code that never leaves the
 *   dev machine.
 *
 * Each is measured as an app ships it (`kind: 'app-bundle'`): the export entries
 * bundled with esbuild, tree-shaken, minified, `process.env.NODE_ENV` defined as
 * `"production"`, then gzipped — the method size-limit uses. The other
 * `@csszyx/*` packages stay external so each budget counts its own code once.
 * Until 2026-10-01 this gzipped the package's `dist` files as published, which
 * counted comments and development-only warnings that no production app
 * downloads; the notes on the runtime budget below kept saying "package weight
 * only, not app weight" because the number measured the wrong thing. The
 * install-size question that method answered is the wasm budget's job, the
 * one artifact where package weight is what users pay.
 *
 * Budgets are absolute gzip byte ceilings committed here, not diffs against a
 * stored baseline — nothing external to fetch, nothing that can go stale.
 * Crossing one is a one-line change to the number below plus a sentence in the
 * PR explaining the growth. Set them from a measured baseline plus ~10%
 * headroom: wide enough that legitimate small growth does not thrash the
 * number, tight enough that silently swallowing a 30KB dependency fails.
 */

/** Gzip ceilings per user-shipped surface, set the usual ~300 bytes above a
 * measurement. Re-measure with `pnpm check:package-size` after a build.
 *
 * The JS budgets were re-based 2026-10-01 when the measurement moved from the
 * published `dist` text to the production app bundle. Their history before
 * that — every raise and the reason for it — is in git, against a number that
 * also counted comments and development-only warning text: 28,300 / 15,360 /
 * 24,576 then, against 15,447 / 13,902 / 14,376 measured the new way the same
 * day, after the compiler's warnings moved behind a `NODE_ENV` check a bundler
 * folds. */
export const SIZE_BUDGETS = [
    {
        name: '@csszyx/runtime app bundle',
        kind: 'app-bundle',
        target: 'packages/runtime',
        maxGzipBytes: 15_750,
    },
    {
        name: '@csszyx/dynamic app bundle',
        kind: 'app-bundle',
        target: 'packages/dynamic',
        maxGzipBytes: 14_200,
    },
    {
        name: '@csszyx/compiler browser app bundle',
        kind: 'app-bundle',
        target: 'packages/compiler',
        subpaths: ['./browser'],
        maxGzipBytes: 14_700,
    },
    // The wasm build of the parser is the fourth surface: not browser code,
    // but a file every `npm install` downloads inside @csszyx/core. Measured
    // 2026-08-12 at 460,116 gzip bytes un-optimized (the release workflow's
    // wasm-opt pass only shrinks it). The ceiling exists to catch a debug
    // -profile build or dependency bloat slipping into the artifact — either
    // multiplies the size, a creep of +10% does not.
    //
    // Raised 2026-09-14 from 520,000: the module-link scan (stylesheet imports
    // and re-export forwards read from the engine's own module record) moved
    // off the JS parser, whose per-call arena leaked, and costs ~15 KB gzip in
    // this artifact (507,792 without it, 522,327 with it, un-optimized).
    //
    // Raised 2026-09-22 from 530,000: the object rule applies a per-file merge
    // table inside the engine and reports each static object's class list,
    // which costs 9,112 gzip bytes here (522,744 at the merge base, 531,856
    // on the branch, both un-optimized, gzip -9 of the nodejs parser build).
    //
    // Raised 2026-09-27 from 542,000: a spread splits an element into sides
    // that merge and rewrite on their own, and the note for a split element
    // writes its fix from the element's own spread and class values, which
    // costs 4,693 gzip bytes here (537,756 at the merge base, 542,449 on the
    // branch, measured the same way).
    {
        name: '@csszyx/core parser wasm artifact',
        kind: 'file',
        target: 'packages/core/pkg-parser/csszyx_core_bg.wasm',
        maxGzipBytes: 550_000,
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
 * @param {string[]} [subpaths] only these export subpaths; every one must exist
 * @returns {string[]} absolute entry file paths, sorted
 */
export function listExportEntries(packageDir, subpaths) {
    const manifest = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
    const exportsMap = manifest.exports ?? {};
    const missing = (subpaths ?? []).filter(subpath => !(subpath in exportsMap));
    if (missing.length > 0) {
        throw new Error(
            `no export subpath ${missing.join(', ')} in ${manifest.name ?? packageDir}`,
        );
    }
    const entries = new Set();
    for (const [subpath, conditionValue] of Object.entries(exportsMap)) {
        if (subpaths && !subpaths.includes(subpath)) continue;
        const target = importTarget(conditionValue);
        if (target !== null && isRuntimeArtifact(target)) {
            entries.add(path.resolve(packageDir, target));
        }
    }
    return [...entries].sort();
}

/** Bundle a package's export entries the way a production app ships them:
 * every entry imported as a namespace (so nothing a consumer could reach is
 * shaken out), tree-shaken, minified, `process.env.NODE_ENV` defined as
 * production, browser platform. Other `@csszyx/*` packages stay external so
 * each budget counts its own code once. A build error throws — an import that
 * resolves to nothing must fail the gate, never shrink the number.
 *
 * @param {string[]} entryPaths absolute entry files
 * @param {string} packageDir absolute package directory, the resolve root
 * @returns {string} the minified production bundle
 */
export function appBundle(entryPaths, packageDir) {
    const contents = entryPaths
        .map((entry, i) => `import * as e${i} from ${JSON.stringify(entry)};`)
        .concat(`export { ${entryPaths.map((_, i) => `e${i}`).join(', ')} };`)
        .join('\n');
    const result = buildSync({
        stdin: { contents, resolveDir: packageDir, loader: 'js' },
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'browser',
        minify: true,
        treeShaking: true,
        external: ['@csszyx/*'],
        define: { 'process.env.NODE_ENV': '"production"' },
        logLevel: 'silent',
    });
    return result.outputFiles[0].text;
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
        let gzipBytes;
        try {
            if (budget.kind === 'file') {
                // A binary artifact is one opaque file: no import graph to
                // bundle, but its absence is still a failure, never a pass.
                statSync(target);
                files = [target];
                gzipBytes = gzipTotalBytes(files);
            } else {
                files = listExportEntries(target, budget.subpaths);
                if (files.length === 0) {
                    throw new Error(`no runtime export entries in ${budget.target}/package.json`);
                }
                gzipBytes = gzipSync(appBundle(files, target), { level: 9 }).length;
            }
        } catch (error) {
            failures.push(`${budget.name}: ${error.message} — run \`pnpm build\` first?`);
            continue;
        }
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
