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
 * Every app-bundle budget carries two kinds of ceiling. `maxGzipBytes` caps
 * the union of its entries — what an app that imports all of them ships, and
 * the bundle whose console messages are checked. `entryBudgets` caps each
 * export subpath bundled on its own, the way size-limit lists one check per
 * entry: an app that imports only `@csszyx/runtime/lite` pays for `/lite`, and
 * a heavy import added to a light entry hides inside the union, which the
 * largest entry already dominates (the 13 KB browser transform landing in a
 * 400-byte entry moves the union by little and the entry by 30x). Every
 * runtime subpath in scope needs a budget and every budget a subpath, so a new
 * export cannot ship unmeasured. Scope is every JS export minus the ones a
 * budget names in `excludeSubpaths` — an exclusion list, never an inclusion
 * one, so a subpath added to `exports` is measured until someone decides in
 * this file that it never reaches a browser. The union stays because it is the one
 * bundle that holds every message the package can print, and because the
 * entries' headrooms add up: each entry can grow ~300 bytes and still pass.
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
 * 24,576 then, against 15,447 / 10,626 / 14,376 measured the new way the same
 * day, after the compiler's warnings moved behind a `NODE_ENV` check a bundler
 * folds and with peer dependencies left to the app. */
export const SIZE_BUDGETS = [
    {
        name: '@csszyx/runtime app bundle',
        kind: 'app-bundle',
        target: 'packages/runtime',
        maxGzipBytes: 15_750,
        // Measured 2026-10-08: 15,216 / 426 / 1,359 / 434 / 7,964 / 1,082.
        entryBudgets: {
            '.': 15_500,
            './lite': 750,
            './core': 1_650,
            './lowering': 750,
            './split': 8_250,
            './merge': 1_400,
        },
        // Each one reports csszyx's own output as wrong, an integrity check
        // failing, or prints only because the app turned `debug` on (ADR
        // 0011). A usage nudge belongs behind `NODE_ENV`, not in this list.
        productionMessages: [
            // The mangle map and recovery manifest are integrity inputs.
            'error: Failed to parse mangle map:',
            'error: Failed to parse recovery manifest:',
            'error: [csszyx] Failed to verify mangle map:',
            'error: [csszyx] Mangle map failed schema validation (not a plai',
            'error: [csszyx] Mangle map failed schema validation; treating i',
            'warn: [csszyx] No checksum found in HTML',
            // "Web Crypto is unavailable", built before the call.
            'warn: <expr>',
            // Hydration that aborted or fell back renders other than the
            // server did; `dev-only` recovery says it is off in production.
            'error: [csszyx] Hydration aborted at ',
            'warn: [csszyx] CSR recovery requires explicit szRecover direct',
            'warn: [csszyx] Hydration mismatch recovered via CSR. Fix root ',
            'warn: [csszyx] szRecover=',
            // A merge table from another csszyx version merges wrongly.
            'warn: [csszyx] the merge table was written in format ',
            // Only with `initRuntime({ debug: true })`.
            'log: [csszyx] Runtime initialized',
            'warn: [csszyx] Runtime already initialized',
        ],
    },
    {
        name: '@csszyx/dynamic app bundle',
        kind: 'app-bundle',
        target: 'packages/dynamic',
        // 13,902 measured with React bundled in; React is a peer dependency the
        // app already ships, and the unsafe-value warning now folds away.
        maxGzipBytes: 10_950,
        // Measured 2026-10-08: 10,358 / 7,897.
        entryBudgets: { '.': 10_650, './react': 8_200 },
    },
    {
        name: '@csszyx/compiler browser app bundle',
        kind: 'app-bundle',
        target: 'packages/compiler',
        // Every other export ships to the browser: `./browser` for
        // `@csszyx/dynamic` and `@csszyx/runtime`, and the leaf modules the
        // runtime's `/lite`, `/core` and variant helpers import by subpath.
        // Only `.` and `./migrate` stay out: build-time code that never
        // leaves the dev machine. A new export is measured, and needs an
        // entry budget, unless it is added here.
        excludeSubpaths: ['.', './migrate'],
        // Raised from 14,700 on 2026-10-02, measured 14,903: a replaced key, a
        // moved value and a later group overriding a stand-alone key now warn
        // in production as well (ADR 0011, its `productionMessages` below), so
        // their text ships by design, plus the settlement of family keys
        // across sz layers. Budget set the usual ~300 above the measurement.
        //
        // Raised from 15,200 on 2026-10-08, measured 15,752: no code grew, the
        // union took in the five leaf subpaths the runtime ships (they were
        // measured by no budget before), on top of `./browser` at 14,969.
        // Re-measured later the same day at 15,891, with `./browser` at
        // 15,104 after the special-key box roles.
        maxGzipBytes: 16_050,
        // Measured 2026-10-08: 15,104 / 346 / 675 / 366 / 257 / 691.
        // `./browser` raised from 15,250 the same day: the special-key box
        // roles took it to 15,104, 146 under, so it went back to the usual
        // ~300 above the measurement.
        entryBudgets: {
            './browser': 15_400,
            './sz-limits': 650,
            './keyword-families': 1_000,
            './bool-class': 650,
            './color-var': 550,
            './spacing-var': 1_000,
        },
        // Each one reports a class the transform did not emit (ADR 0011), so
        // they print in production and in the browser, once each; only
        // `CSSZYX_QUIET_SZ_WARNINGS=1` mutes them.
        productionMessages: [
            // A value that moved onto its group's own key (`touch: 'pan-x'`).
            'warn: <expr>',
            // A replaced or removed key (`ordinal`, `tabularNums`, `inlineFlex`).
            'warn: [csszyx] ',
            // A stand-alone key a later group key replaces in one object.
            'warn: [csszyx] ',
            // A removed key (`fontVariant`, `maskFrom`), named with its note.
            'warn: [csszyx] ',
            // A dynamic value the runtime helpers cannot lower, so the style
            // is dropped: a non-boolean on a boolean-only key (`./bool-class`)
            // and an unresolvable spacing value (`./spacing-var`).
            'warn: [csszyx] dynamic value on ',
            'warn: [csszyx] dynamic value on ',
        ],
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
        // Raised from 550,000 on 2026-10-02: settling stand-alone and group
        // keys across sz array layers, and the diagnostics for a moved value
        // in a ternary or parametric variant, a dynamic family conflict and a
        // spread override, cost 7,099 gzip bytes here (547,198 before,
        // 554,297 after, un-optimized, same build).
        maxGzipBytes: 557_500,
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

/** List the export subpaths of a package that ship runtime JS under the
 * `import` condition, each with its entry file. Non-runtime targets (type
 * declarations, the `./package.json` subpath) are skipped.
 *
 * @param {string} packageDir absolute package directory
 * @param {string[]} [excludeSubpaths] export subpaths left out of scope; every
 *   one must exist, so a renamed export cannot leave a stale exclusion behind
 * @returns {Array<{ subpath: string, file: string }>} subpaths in `exports` order, absolute files
 */
export function listExportSubpaths(packageDir, excludeSubpaths = []) {
    const manifest = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
    const exportsMap = manifest.exports ?? {};
    const missing = excludeSubpaths.filter(subpath => !Object.hasOwn(exportsMap, subpath));
    if (missing.length > 0) {
        throw new Error(
            `no export subpath ${missing.join(', ')} in ${manifest.name ?? packageDir}`,
        );
    }
    const entries = [];
    for (const [subpath, conditionValue] of Object.entries(exportsMap)) {
        if (excludeSubpaths.includes(subpath)) continue;
        const target = importTarget(conditionValue);
        if (target !== null && isRuntimeArtifact(target)) {
            entries.push({ subpath, file: path.resolve(packageDir, target) });
        }
    }
    return entries;
}

/** List the runtime entry files a package's `exports` map ships under the
 * `import` condition, once each.
 *
 * @param {string} packageDir absolute package directory
 * @param {string[]} [excludeSubpaths] export subpaths left out of scope
 * @returns {string[]} absolute entry file paths, sorted
 */
export function listExportEntries(packageDir, excludeSubpaths) {
    return [
        ...new Set(listExportSubpaths(packageDir, excludeSubpaths).map(({ file }) => file)),
    ].sort();
}

/** Compare the subpaths a package ships with the ones its budget prices, both
 * ways: an export with no budget ships unmeasured, a budget with no export is
 * stale.
 *
 * @param {string[]} shipped runtime subpaths in scope
 * @param {Record<string, number>} budgeted the budget's `entryBudgets`
 * @returns {string[]} one problem per mismatch
 */
export function entryBudgetProblems(shipped, budgeted) {
    const problems = [];
    for (const subpath of shipped) {
        if (!Object.hasOwn(budgeted, subpath)) {
            problems.push(`export \`${subpath}\` has no entry budget`);
        }
    }
    for (const subpath of Object.keys(budgeted)) {
        if (!shipped.includes(subpath)) {
            problems.push(`entry budget \`${subpath}\` names no runtime export`);
        }
    }
    return problems;
}

/** Bundle a package's export entries the way a production app ships them:
 * every entry imported as a namespace (so nothing a consumer could reach is
 * shaken out), tree-shaken, minified, `process.env.NODE_ENV` defined as
 * production, browser platform. Other `@csszyx/*` packages stay external so
 * each budget counts its own code once, and so do the package's peer
 * dependencies, which the app has whether or not it uses this package (React
 * for `@csszyx/dynamic`). A build error throws — an import that
 * resolves to nothing must fail the gate, never shrink the number.
 *
 * @param {string[]} entryPaths absolute entry files
 * @param {string} packageDir absolute package directory, the resolve root
 * @returns {string} the minified production bundle
 */
export function appBundle(entryPaths, packageDir) {
    const manifest = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
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
        external: ['@csszyx/*', ...Object.keys(manifest.peerDependencies ?? {})],
        define: { 'process.env.NODE_ENV': '"production"' },
        logLevel: 'silent',
    });
    return result.outputFiles[0].text;
}

/** Console calls whose first argument opens with a string literal: the
 * method, then the text up to the first interpolation or quote. Ordered
 * alternation and a negated class keep the scan linear on minified input. */
const CONSOLE_CALL_PATTERN =
    /console\.(warn|error|log|info|debug)\(\s*([`"'])?((?:(?!\$\{)[^`"'\\])*)/g;

/** The messages a bundle can print, one entry per console call: `method: head`,
 * where head is the literal's opening text (at most 56 characters) or
 * `<expr>` when the first argument is not a string literal.
 *
 * @param {string} code a bundle
 * @returns {string[]} message heads, sorted
 */
export function consoleMessages(code) {
    return [...code.matchAll(CONSOLE_CALL_PATTERN)]
        .map(([, method, quote, text]) => `${method}: ${quote ? text.slice(0, 56) : '<expr>'}`)
        .sort();
}

/** Compare a bundle's console messages with the ones its budget allows, as
 * multisets, both ways: a message nobody listed is a development warning that
 * failed to fold (or a new production message that needs a decision, ADR
 * 0011), and a listed message the bundle no longer prints is a stale list.
 *
 * @param {string[]} printed heads from {@link consoleMessages}
 * @param {string[]} allowed heads the budget lists
 * @returns {string[]} one problem per mismatch
 */
export function messageProblems(printed, allowed) {
    const left = [...allowed];
    const problems = [];
    for (const head of printed) {
        const at = left.indexOf(head);
        if (at === -1) problems.push(`prints "${head}", which its budget does not list`);
        else left.splice(at, 1);
    }
    for (const head of left) problems.push(`no longer prints "${head}"`);
    return problems;
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
    /** Record one measurement against its ceiling. */
    const record = (name, files, gzipBytes, maxGzipBytes) => {
        const ok = gzipBytes <= maxGzipBytes;
        results.push({ name, files, gzipBytes, maxGzipBytes, ok });
        if (!ok) {
            failures.push(
                `${name}: ${gzipBytes} gzip bytes exceeds the ${maxGzipBytes}-byte budget ` +
                    `(+${gzipBytes - maxGzipBytes}). If the growth is intentional, raise the ` +
                    'budget in scripts/check-package-size.mjs and say why in the PR.',
            );
        }
    };
    for (const budget of budgets) {
        const target = path.join(rootDir, budget.target);
        let files;
        let gzipBytes;
        const entryMeasurements = [];
        try {
            if (budget.kind === 'file') {
                // A binary artifact is one opaque file: no import graph to
                // bundle, but its absence is still a failure, never a pass.
                statSync(target);
                files = [target];
                gzipBytes = gzipTotalBytes(files);
            } else {
                files = listExportEntries(target, budget.excludeSubpaths);
                if (files.length === 0) {
                    throw new Error(`no runtime export entries in ${budget.target}/package.json`);
                }
                const bundle = appBundle(files, target);
                gzipBytes = gzipSync(bundle, { level: 9 }).length;
                for (const problem of messageProblems(
                    consoleMessages(bundle),
                    budget.productionMessages ?? [],
                )) {
                    failures.push(
                        `${budget.name}: the production bundle ${problem}. Only a message that ` +
                            "reports csszyx's own output as wrong or missing, a security or a crash " +
                            'stays in production (ADR 0011); anything else checks ' +
                            "`process.env.NODE_ENV !== 'production'` at the call site so the bundler drops it.",
                    );
                }
                if (budget.entryBudgets) {
                    const entries = listExportSubpaths(target, budget.excludeSubpaths);
                    for (const problem of entryBudgetProblems(
                        entries.map(({ subpath }) => subpath),
                        budget.entryBudgets,
                    )) {
                        failures.push(
                            `${budget.name}: ${problem}. Each runtime export gets its own ceiling ` +
                                '(measured alone, ~300 bytes of headroom) in `entryBudgets`.',
                        );
                    }
                    for (const { subpath, file } of entries) {
                        if (!Object.hasOwn(budget.entryBudgets, subpath)) continue;
                        const entryBytes = gzipSync(appBundle([file], target), {
                            level: 9,
                        }).length;
                        entryMeasurements.push([subpath, file, entryBytes]);
                    }
                }
            }
        } catch (error) {
            failures.push(`${budget.name}: ${error.message} — run \`pnpm build\` first?`);
            continue;
        }
        record(budget.name, files, gzipBytes, budget.maxGzipBytes);
        for (const [subpath, file, entryBytes] of entryMeasurements) {
            record(
                `${budget.name} \`${subpath}\``,
                [file],
                entryBytes,
                budget.entryBudgets[subpath],
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
