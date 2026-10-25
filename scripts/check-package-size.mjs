import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

import { buildSync } from 'esbuild';

import ts from 'typescript';

import { cdnBuildOptions, INSTALLED_RESOLUTION } from '../packages/csszyx/cdn-build.mjs';
import { browserSourceFiles } from './diagnostics/browser-sources.mjs';
import * as registry from './diagnostics/registry.mjs';
import { browserDiagnostics, EDITOR_IDS } from './gen-diagnostic-codes.mjs';

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
 * The same bundles are measured a second time with Vite (`vite` on each
 * app-bundle budget, `checkViteBudgets`), the bundler most apps ship csszyx
 * with. Totals differ from esbuild's by 0.1 to 3 percent (the runtime most,
 * 15,686 against 16,170 on 2026-10-19), and where a module lands moves gzip
 * by tens of bytes, which the two bundlers do not lay out alike: the same day
 * a chunk-order change measured 8 bytes under its baseline in esbuild and 19
 * over in Vite. The lane adds ~0.35 s to the gate (17 Vite builds).
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
 * A fourth kind prices code that never reaches a browser but runs at the
 * start of every build: `kind: 'node-entry'` sums the gzip bytes of the files
 * a Node process loads when it imports one export subpath, the entry and every
 * file it reaches through a static import. Node compiles each of them whole
 * before the first call returns, so a heavy import added to a build-time
 * entry is start-up time for every build, dev server and CLI run.
 *
 * A fifth, `kind: 'installed-app'`, bundles the csszyx packages together the
 * way an app that installed them gets them, each from its built `dist` and
 * the compiler in once, so a chunk layout that only shows when the packages
 * meet is measured somewhere.
 *
 * Budgets are absolute gzip byte ceilings committed here, not diffs against a
 * stored baseline — nothing external to fetch, nothing that can go stale.
 * Crossing one is a one-line change to the number below plus a sentence in the
 * PR explaining the growth. Set them from a measured baseline plus ~10%
 * headroom: wide enough that legitimate small growth does not thrash the
 * number, tight enough that silently swallowing a 30KB dependency fails.
 */

/**
 * The sources of one package that a browser bundle can hold.
 *
 * @param {string} name - The package's directory under `packages/`.
 * @returns {Set<string>} The files, repository-relative.
 */
function sourcesOf(name) {
    return new Set(
        [...browserSourceFiles()].filter(file => file.startsWith(`packages/${name}/src/`)),
    );
}

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
        // Raised from 15,750 on 2026-10-08, measured 15,851: `splitBox` and
        // `splitBoxSz` gained the box roles of nine special keys, the
        // `content-<keyword>` alignment tokens, and `css` kept whole on the
        // fallback node. Budget set the usual ~300 above the measurement.
        //
        // Raised from 16,150 on 2026-10-17, measured 16,152: the async
        // mangle check finds its map on the page or in the bundle, says why
        // every `false` happened, and fails a census the page carries but
        // cannot read instead of reading past it to the bundle's map.
        //
        // Lowered from 16,450 on 2026-10-20, measured 15,689 (16,170 before):
        // its production lines print their code and args instead of the
        // sentence (ADR 0031), and the development ones are the registry's
        // templates, which a production build drops. Budget the usual ~300
        // above.
        //
        // Lowered from 16,000 on 2026-10-20, measured 15,547 (15,744 before):
        // the errors it throws carry their code and throw the compact line in
        // production instead of the sentence (`lowering-not-loaded`,
        // `runtime-prefix-conflict`, `web-crypto-unavailable`).
        maxGzipBytes: 15_850,
        // Measured 2026-10-08, after those roles: 15,417 / 426 / 1,359 / 434 /
        // 8,144 / 1,082. `.` raised from 15,700 on 2026-10-17, measured 15,721,
        // for the same check, and lowered from 16,000 on 2026-10-20, measured
        // 15,250, with the union. The other entries measured 426 / 1,366 / 434
        // / 8,153 / 1,096 that day: each module that reports keeps a bare
        // import of `@csszyx/compiler/report`, external here, which an app
        // that bundles the compiler drops (`sideEffects: false`).
        //
        // `.` lowered from 15,550 and `./merge` from 1,400 on 2026-10-20 with
        // the union, measured 15,064 and 1,030 (15,307 and 1,137 before), the
        // others 477 / 1,308 / 463 / 8,160: `./lite` and `./lowering` grew by
        // a bare import of `@csszyx/compiler/errors` each, external here.
        entryBudgets: {
            '.': 15_400,
            './lite': 750,
            './core': 1_650,
            './lowering': 750,
            './split': 8_450,
            './merge': 1_350,
        },
        // The same bundles built by Vite (see `checkViteBudgets`), measured
        // 2026-10-19: 15,686, then 15,376 / 464 / 1,362 / 515 / 8,059 / 996.
        // Each the usual ~300 above, rounded up to 50. The union and `.`
        // lowered on 2026-10-20 with the esbuild ones, measured 15,331 and
        // 15,014.
        //
        // Lowered on 2026-10-20 with the thrown errors' compact lines,
        // measured 15,088, then 14,693 / 478 / 1,264 / 530 / 8,072 / 892
        // (15,352, then 15,026 / 464 / 1,375 / 515 / 8,066 / 1,004 before).
        vite: {
            maxGzipBytes: 15_400,
            entryBudgets: {
                '.': 15_000,
                './lite': 800,
                './core': 1_600,
                './lowering': 850,
                './split': 8_400,
                './merge': 1_200,
            },
        },
        // Each one reports csszyx's own output as wrong or an integrity check
        // failing (ADR 0011), so it prints in production as its code and
        // args: the mangle map, census and recovery manifest the page
        // carries, a mangle check that answered false, hydration that
        // aborted or fell back, and a merge table from another csszyx
        // version. Read from the registry (`runtime.production`), never listed
        // here. A usage nudge belongs behind `NODE_ENV`.
        productionCodes: productionCodesOf(registry.DIAGNOSTICS, sourcesOf('runtime')),
        // The two lines `initRuntime({ debug: true })` prints. They report no
        // problem, so the registry has no id for them (ADR 0031 item 5), and
        // they are the only lines allowed beside its codes.
        nonRegistryMessages: [
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
        // Built by Vite, measured 2026-10-19: 10,659, then 10,373 / 7,800.
        vite: { maxGzipBytes: 11_000, entryBudgets: { '.': 10_700, './react': 8_100 } },
        // None today: its one production failure, an unreachable manifest, is
        // a rejected fetch it catches. Read from the registry all the same, so
        // a production line added to its sources has to be registered.
        productionCodes: productionCodesOf(registry.DIAGNOSTICS, sourcesOf('dynamic')),
    },
    {
        name: '@csszyx/compiler browser app bundle',
        kind: 'app-bundle',
        target: 'packages/compiler',
        // Every other export ships to the browser: `./browser` for
        // `@csszyx/dynamic` and `@csszyx/runtime`, and the leaf modules the
        // runtime's `/lite`, `/core` and variant helpers import by subpath.
        // Only `.`, `./engine`, `./internal` and `./migrate` stay out:
        // build-time code that never leaves the dev machine (`./engine` calls
        // the engine; `./internal` is what the adapters, the CLI and the build
        // plugin share). A new export is measured, and needs an entry budget,
        // unless it is added here.
        //
        // `./report` ships to the browser but only in development: the
        // reporter and every template, re-exported whole, which a namespace
        // import keeps live, so an entry budget would price the full template
        // set no app ships. It is priced through its consumers instead: a
        // site imports it from a `NODE_ENV` branch, and `checkTemplateLeaks`
        // fails any production bundle that keeps a template.
        excludeSubpaths: ['.', './engine', './internal', './migrate', './report'],
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
        //
        // Raised from 16,050 on 2026-10-09, measured 16,420: the CSS-wide
        // keyword tables (the keywords, the prefixes whose bracket sets the
        // key's own property, the utilities Tailwind names) and the added
        // negative-capable and fraction-taking keys ship with the runtime
        // lowering, so the browser carries them. Budget the usual ~300 above.
        //
        // Raised from 16,750 on 2026-10-10, measured 16,759: the per-key
        // capability table generated from Tailwind (159 rows; a row for every
        // key, empty ones included, measured ~400 more and was not taken)
        // replaces the CSS-wide prefix list, and a sign Tailwind does not
        // serve now warns in development (the text folds out of production).
        //
        // Lowered from 17,050 on 2026-10-10, measured 16,687: the runtime no
        // longer judges a sign from the baked table (ADR 0022) — the lookup
        // and its development warning are gone, and the table only spells.
        //
        // Raised from 16,990 on 2026-10-10, measured 17,056 (+369 over
        // 16,687): the runtime writes every colour string the engines write
        // instead of judging it (ADR 0022), the per-key variable type hints
        // are one table for both lanes and cover the width, position and
        // shadow-colour keys (`border-(length:--w)`, `bg-[position:var(--x)]`),
        // and a gradient layer on `mask` warns in production, as the engines
        // now report it (`moved-value`); the side and decoration colour keys
        // take the generic lowering instead of a copy of it. Budget the usual
        // ~300 above.
        //
        // 17,191 on 2026-10-19 after the key and closed-enum tables moved out
        // of `transform-core.ts` into two leaf modules (so the engine entries
        // load the tables without the lowering): 2 under the 17,193 before.
        // The move first measured 17,364, because the bundle placed the two
        // table modules' chunk at the top, more than gzip's 32 KB window away
        // from the code that repeats their keys; the capability table now
        // builds into a chunk of its own, imported ahead of them (see
        // `packages/compiler/tsdown.config.mjs`), and the budget was not
        // raised. 17,125 the same day once the property category map joined
        // that chunk ahead of the capability rows: it had stayed in the
        // lowering's chunk, after the tables, which cost `./browser` 89 to 115
        // bytes in each bundler measured (esbuild, Vite, Rollup).
        maxGzipBytes: 17_360,
        // Measured 2026-10-08: 15,104 / 346 / 675 / 366 / 257 / 691.
        // `./browser` raised from 15,250 the same day: the special-key box
        // roles took it to 15,104, 146 under, so it went back to the usual
        // ~300 above the measurement.
        entryBudgets: {
            // 15,646 after the CSS-wide keyword tables, 2026-10-09; 15,989
            // after the capability table, 2026-10-10 (+343, see the union);
            // 15,920 once the runtime stopped judging a sign (ADR 0022), the
            // same day, so lowered from 16,300; 16,297 with the variable type
            // hints, the unjudged colour strings and the production mask
            // warning (+377, see the union), so raised from 16,220. 16,425
            // once the tables moved to leaf modules, 2026-10-19 (-8; 16,584
            // in the chunk order that put them first, see the union), and
            // 16,332 with the category map ahead of them, the same day.
            './browser': 16_600,
            // `./sz-limits` measured 501 on 2026-10-20 (346 before):
            // `SzDepthError` extends the error class of `./errors`, measured
            // 357 alone, which ships to the browser because the runtime
            // re-exports its guard and every csszyx error extends it.
            './sz-limits': 650,
            './errors': 650,
            './keyword-families': 1_000,
            './bool-class': 650,
            './color-var': 550,
            './spacing-var': 1_000,
        },
        // The capability rows (with the category map) have to be laid out
        // before the key and closed-enum tables' chunk, in both lanes: with
        // the tables first, `./browser` measured 16,561 gzip bytes against
        // 16,425 in esbuild, under its budget, so only the order shows the
        // drift. A bundler upgrade that stops laying chunks out in
        // first-import order fails here, not in
        // `packages/compiler/tests/browser-chunk-order.test.ts`, which reads
        // the source.
        moduleOrder: { './browser': ['per-key-rows-', 'closed-enum-tables-'] },
        // Built by Vite, measured 2026-10-19: 17,151, then 16,323 / 384 /
        // 705 / 401 / 300 / 729. This lane is why it exists: when the key
        // tables moved to leaf modules, esbuild measured `./browser` 8 bytes
        // under the layout before the move and Vite 19 over (16,413 against
        // 16,394), the union 2 under and 27 over; the category map moving
        // ahead of the tables brought both lanes under.
        vite: {
            maxGzipBytes: 17_500,
            entryBudgets: {
                './browser': 16_650,
                // Measured 2026-10-20: 527 and 393.
                './sz-limits': 700,
                './errors': 700,
                './keyword-families': 1_050,
                './bool-class': 750,
                './color-var': 600,
                './spacing-var': 1_050,
            },
        },
        // Each one reports a class the transform did not emit (ADR 0011), so
        // it prints in production and in the browser, once each, as its code
        // and args; only `CSSZYX_QUIET_SZ_WARNINGS=1` mutes the sz key and
        // value lines. Read from the registry (`runtime.production`), never
        // listed here: a removed or replaced key, a moved value and a
        // gradient layer on `mask`, a stand-alone key a later group replaces,
        // a group's value written on that stand-alone key, a slash-opacity
        // string, and the two dynamic values the runtime helpers cannot lower.
        productionCodes: productionCodesOf(registry.DIAGNOSTICS, sourcesOf('compiler')),
    },
    // What an app that installs csszyx ships when it imports the runtime and
    // the dynamic layer: both resolved from `packages/csszyx`'s
    // `node_modules` to their built `dist`, the compiler bundled in once,
    // which no budget above measures (each leaves the other csszyx packages
    // external). It is where the compiler's chunk layout lands in a real app:
    // moving the closed-enum import to the top of `transform-core.ts`, where
    // the import sort puts it, measured +234 here; dropping the per-key-rows
    // chunk group +286; building `./report` with the entries +276. Each is
    // under the usual headroom, so the module order is what fails: the first
    // two lose a chunk, the third lays the key tables first (it fails the
    // Node budgets below too). Measured 39,733 on 2026-10-21. Budget the
    // usual ~300 above.
    {
        name: 'csszyx installed app bundle (runtime + dynamic, compiler bundled)',
        kind: 'installed-app',
        target: 'packages/csszyx',
        imports: ['@csszyx/runtime', '@csszyx/dynamic'],
        maxGzipBytes: 40_050,
        moduleOrder: ['per-key-rows-', 'closed-enum-tables-'],
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
        //
        // Raised from 557,500 on 2026-10-09: the branch base already measured
        // 558,738 (the negative-scale and fraction class fixes), and every
        // diagnostic now carries a code and a byte offset beside its text,
        // and each merge group the key behind each class and where it is,
        // which costs 1,073 gzip bytes here (559,811 after, un-optimized,
        // same build). Serializing the code as a number instead of its id
        // saved 204 of those and was not taken: the id is what keeps an
        // engine and a compiler from mislabelling each other's codes.
        // Raised again the same day: each merge group places every class at
        // the key it came from, one offset per class instead of one per
        // object (561,094 → 561,272), and a registry object's nested keys
        // are placed where the importing module names it, as its top-level
        // keys are (561,293, un-optimized, same build). The budget keeps
        // ~300 bytes of headroom, as the JS budgets do.
        //
        // Raised from 561,600 on 2026-10-10: a variant key with a runtime
        // value goes to `_szPart` with its keys rebuilt around it and reports
        // `fallback-missing-css` at the key, instead of a css variable that
        // styled nothing, and a mask slot's members are no longer walked as sz
        // keys (2,603 gzip bytes); a one-class object is placed at its key in
        // a list of its own beside the merge groups (1,399). 561,293 at the
        // branch base, 565,295 after, un-optimized, gzip -9 of the nodejs
        // parser build, same machine.
        //
        // Raised from 565,600 on 2026-10-10: the per-key capability table
        // generated from Tailwind (159 rows, binary-searched — a `match` over
        // the same keys cost 417 bytes more), the CSS-wide column replacing
        // the prefix list, `decoration` values reaching the generic lowering,
        // and the `unsigned-value` diagnostic (its collector and message,
        // ~900 of the total) cost 1,720 gzip bytes here: 565,270 on the same
        // tree without them, 566,990 with them, un-optimized, gzip -9 of the
        // nodejs parser build.
        //
        // Raised from 567,300 on 2026-10-10: an sz array element with a
        // runtime variant value splits as a lone object does and reports the
        // key, a guarded element reports it too, and a key no table claims
        // (a project breakpoint or `@custom-variant`) defers like a built-in
        // variant: 566,992 on the same tree without them, 567,792 with them
        // (split 713, guarded report 81, project variants 6), un-optimized,
        // gzip -9 of the nodejs parser build. `#[inline(never)]` on the two
        // part builders saved 2 and was not taken.
        //
        // Lowered from 568,100 on 2026-10-10, measured 567,527: the
        // `unsigned-value` verdict left the engine (its collector, its
        // message and their plumbing) for the build-time oracle, which reads
        // the project's own Tailwind (ADR 0012, 0022); a generated
        // colour-key match and the kebab-case variant segment came in.
        // Un-optimized, gzip -9 of the nodejs parser build, the working tree
        // of `fix/0.18.0-lowering-parity` with the other slices in flight.
        //
        // Raised from 567,830 on 2026-10-10, measured 568,891 (+1,364 over
        // 567,527): a colour key's slash-opacity string, which the lowering
        // drops, is reported as `slash-opacity-string` (its collector, its
        // message and the code), and a runtime value takes its key's type hint
        // (`bg-(position:…)`, `shadow-(color:…)`). Un-optimized, gzip -9 of the
        // nodejs parser build, same working tree.
        //
        // Raised from 569,190 on 2026-10-10, measured 569,814 (+923 over
        // 568,891): a gradient layer on `mask`, which the lowering drops, is
        // reported as `moved-value` (its collector and message), and a
        // variable on a key whose prefix reads it as another type takes the
        // key's hint in every spelling (`(--x)`, `var(--x)`), from one
        // generated table. Un-optimized, gzip -9 of the nodejs parser build,
        // same working tree.
        //
        // Raised from 570,110 on 2026-10-11, measured 571,447: a slash opacity
        // in a colour object's `color` is reported as `color-slash-opacity`
        // (its collector, message and code), and the colour object keeps its
        // important modifier at the end of the class. Un-optimized, gzip -9 of
        // the nodejs parser build, same working tree.
        //
        // Raised from 571,750 on 2026-10-12: the cross-module registry's
        // exported values are read by the engine's own evaluators in the
        // module-link scan (the export walk, the plain-object encoder and the
        // query), replacing a narrower evaluator in the compiler, and cost
        // 3,465 gzip bytes as this script measures them: 571,348 at the
        // branch base, 574,813 after, un-optimized nodejs parser build, same
        // machine.
        //
        // Raised from 575,100 on 2026-10-12: the global-var usage scan moved
        // from the compiler's second parse into the engine, and costs 10,323
        // gzip bytes as this script measures them: 574,813 at the branch base,
        // 585,136 after, un-optimized nodejs parser build, same machine. About
        // 7,200 of that is the scan's own oxc AST walker (each `Visit` impl
        // carries a full copy); the scan already reads constants in the same
        // walk to keep it to one.
        //
        // Raised from 585,500 on 2026-10-17: the engine reports its version
        // and source digest, which the compiler checks before its first call,
        // and refuses an option it does not know, which costs 362 gzip bytes:
        // 585,425 at the branch base, 585,787 after, un-optimized nodejs
        // parser build, same machine.
        //
        // Lowered from 586,100 on 2026-10-18 (ADR 0031): every issue carries its
        // named args and the engine no longer writes sentences, which the
        // compiler renders from the diagnostic registry. 583,410 at main
        // bd3f3f33, 577,844 after (gzip -9 of the un-optimized nodejs parser
        // build; 580,859 as this script measures it). The args alone had
        // cost 6,506; the sentences, their position lookups and the fallback
        // reason tables they read were 12,072. ~300 bytes of headroom.
        //
        // Raised from 581,200 on 2026-10-18: six diagnostic fixes from the
        // DX review of ADR 0031 cost 1,210 gzip bytes, 580,852 to 582,062 as
        // this script measures the un-optimized nodejs parser build, same
        // machine. Most of it is the three `closed-enum-value` forms the
        // engine now reports, with the alignment tables they read (+484), and
        // naming a group value before its group as the group's (+407); the
        // fast path counting a bare `sz` (+200), the dropped family conflict
        // (+186) and the szr nudge (+90) are the rest, less 157 from one
        // issue per syntax error and the spread notice alone.
        //
        // Raised from 582,400 on 2026-10-22: a file's spans cross to
        // JavaScript as one length-prefixed text instead of a JSON object per
        // span, and the recorded lowering copies each key and class once.
        // 582,254 before, 583,616 after, as this script measures the
        // un-optimized nodejs parser build, same machine; each part measured
        // alone on the base: the text writer +949, the single-copy recording
        // +183, the short-object key check +130, the cheaper dedupe hasher +2.
        // Two more fixes were measured and not taken: sorting the dedupe by
        // place (+3,796, nearly all of it `sort_unstable` instantiated per item
        // type) and inlining the global-keyword fast check (+599, for an
        // instruction-count gain inside wall-clock noise). ~300 bytes of
        // headroom.
        maxGzipBytes: 583_900,
    },
    // The VS Code extension: one CommonJS file that `packages/vscode/esbuild.mjs`
    // bundles from the compiler's source, unminified, and that every editor
    // with the extension loads at activation. It had no ceiling, so a heavy
    // import in the compiler grew it unseen. Measured 2026-10-19, gzip -9 of
    // `dist/extension.js` (raw bytes in brackets): 46,531 [195,793] at main
    // bd3f3f33, 51,219 [211,264] on `feat/0.18.0-diagnostic-render`. Most of
    // the 4,688 is the extension reporting each sz key with the code and
    // words of the diagnostic registry (+3,864, 62704628); the bit-parallel
    // typo search (+215), the template segments (+289), the tables moving to
    // leaf modules (+186) and smaller steps are the rest (per-commit deltas
    // from a worktree build, whose module path comments differ, so only the
    // deltas carry over). Budget the usual ~300 above.
    //
    // 49,180 on 2026-10-20, lowered from 51,500: the compiler's browser lane
    // now renders its development warnings from the registry, and the
    // extension, built without `NODE_ENV`, carried those templates (53,138)
    // to print warnings into the extension host's log. `esbuild.mjs` now
    // builds it as production, which folds them out.
    //
    // Raised from 49,500 on 2026-10-21, measured 49,629: the extension keeps
    // the tooling metadata of the 0.18 registry, the editor words of each id
    // (+468 raw) and the canonical key forms with their value types (+438
    // raw). A module order that measured smaller was a compression accident
    // nothing would hold, so it was not taken. Budget the usual ~300 above.
    {
        name: '@csszyx/vscode extension bundle',
        kind: 'file',
        target: 'packages/vscode/dist/extension.js',
        maxGzipBytes: 49_950,
        // Built as production, so the leak gate reads it, except for the ids
        // whose words the extension shows as its own editor diagnostics
        // (`diagnostic-provider.ts`, from `SZ_EDITOR_DIAGNOSTIC_TEMPLATES`).
        templateFree: { allowedIds: EDITOR_IDS },
    },
    // The CDN bundles, which a `<script>` tag loads whole: unpkg and jsdelivr
    // serve the production one at the package root, and nothing priced it.
    // Measured 2026-10-20: 16,097 production, 24,368 development (the
    // sentences and the development warnings the production one folds out).
    // Budget the usual ~300 above.
    //
    // Lowered from 16,400 and 25,400 on 2026-10-21, measured 15,854 and
    // 22,351 (16,117 and 25,355 before): both are built from the compiler's
    // `dist` instead of its source (`packages/csszyx/cdn-build.mjs`), so they
    // get the chunk layout the compiler's build sets up for gzip and one copy
    // of `errors` (the source's and `dist/errors.mjs` before), and the
    // development one one copy of the reporter and its templates (the
    // source's `report.ts` and `dist/report.mjs` before). `build` names the
    // options the file is written from, so the gate reads the layout back
    // from the same build: the per-key rows have to come before the key
    // tables, as in the compiler's own budget, and a bundle built from the
    // source again has neither chunk and fails here.
    {
        name: 'csszyx CDN bundle',
        kind: 'file',
        target: 'packages/csszyx/dist/browser.iife.js',
        maxGzipBytes: 16_200,
        // A `<script>` tag loads it as built, so the leak gate reads its bytes.
        templateFree: {},
        build: cdnBuildOptions('production'),
        moduleOrder: ['per-key-rows-', 'closed-enum-tables-'],
        // Its sinks are read as an app's (ADR 0031 §6): every line it prints
        // and every error it throws carries a code the registry lets print in
        // production. The file holds only what `browser.ts` reaches, so the
        // codes of every browser source are allowed and those of its own
        // sources required.
        productionCodes: productionCodesOf(registry.DIAGNOSTICS, browserSourceFiles()),
        requiredCodes: productionCodesOf(registry.DIAGNOSTICS, sourcesOf('csszyx')),
        // `reportUnreadable` prints an error the parse or the transform threw
        // that is not the attribute's syntax as it was thrown: a csszyx error
        // carries its own code, and anything else is not csszyx's to word.
        passthroughSinks: ['error: <expr>'],
    },
    // The development one raised from 24,650 on 2026-10-20, measured 24,795
    // (+427): the errors it can throw (`sz-object-depth`,
    // `options-object-required`, `sz-attribute-syntax`) carry the registry's
    // words, help and note included, where they threw a one-line sentence,
    // and the error class came with them. The production one measured 16,069
    // (-28) the same day. Raised again to 25,400 on 2026-10-20, measured 25,114
    // (+319): `unserved-variant` prints only in Node, but its gate reads
    // `typeof window`, which no bundler folds, so the table (84), the words
    // (120) and the report (~109) ride along, as every Node-only line does.
    // Raised to 22,800 on 2026-10-24, measured 22,724 (+41): every table the
    // lowering reads with an authored key or value goes through one own-entry
    // lookup, so `constructor` or `toString` no longer reads `Object.prototype`
    // and writes the text of a function as a class. Making the tables
    // themselves prototype-free cost +137 here and was dropped. Raised to
    // 23,000 the same day, measured 22,949 (+225): `op` is read as a percent
    // (`/[33.3%]`, where `/[33.3]` was 3,330%), a percent string is kept, and
    // anything else writes the colour alone with `opacity-value`, whose words
    // the development build prints; the production one measured +139.
    {
        name: 'csszyx CDN development bundle',
        kind: 'file',
        target: 'packages/csszyx/dist/browser.dev.iife.js',
        maxGzipBytes: 23_000,
        build: cdnBuildOptions('development'),
        moduleOrder: ['per-key-rows-', 'closed-enum-tables-'],
    },
    // What Node loads for the two entries the build tools import: the engine
    // calls and the diagnostic renderer, which reads the diagnostic registry
    // and the key tables. Measured 2026-10-19 from a fresh process, p50 of 30
    // each: importing `./engine` took 1.76 ms at 6,631 gzip bytes, 4.69 ms
    // once the renderer pulled the whole browser lowering in for its tables
    // (49,614), and 3.61 ms after the tables moved to their own module
    // (30,115). `./internal` measured 33,093 the same day. Budgets the usual
    // ~300 above the measurement.
    //
    // Raised 2026-10-20 from 30,400 / 33,400, measured 30,964 / 33,882 (+702
    // / +703 against 30,262 / 33,179): the engine's error classes extend
    // `CsszyxError` and carry the registry's `code` and `args`, so both
    // entries load `./errors` (394) and the code that fills those args
    // (`transform-rust` +192, `transform-select` +119). Branding the classes
    // without extending measured 30,594 / 33,510, still over (user accepted).
    //
    // Lowered 2026-10-21 from 31,250 / 34,200, measured 25,652 / 28,678
    // (-6,320 / -6,320 against 31,972 / 34,998 with the 0.18 words in): the
    // renderer reads `diagnostic-registry.generated.ts`, which now carries per
    // id only what a line is rendered from (id, position, arg joiners,
    // `variesBy`, words); the summaries, surfaces, forms and arg types moved
    // to `diagnostic-spec.generated.ts`, which no compiler entry imports
    // (`tests/diagnostic-render-specs.test.ts`). Importing `./engine` took
    // 4.95 ms p50 against 5.30 ms before, p50 of 60 fresh processes on the
    // devcontainer, where the 1.76 ms above measures about 5 ms.
    //
    // The state-variant table (`unserved-variant`, its forms generated from
    // Tailwind) stays in the lowering's chunk, which the root loads and
    // neither entry does. Grouped into the key tables' chunk, which both
    // load, it cost `./engine` +166 and `./internal` +165 gzip bytes on
    // 2026-10-21, under the ~300 headroom of each. `excludedModules` reads the
    // `//#region` markers of the files each entry loads, so the drift fails
    // at any size.
    //
    // Raised 2026-10-21 from 25,950 / 29,000, measured 26,936 / 29,974
    // (+1,284 / +1,296 against 25,652 / 28,678): the errors these entries
    // throw now carry the registry's words in full — `engine-version-skew`,
    // `internal-error`, `wasm-engine-unavailable`, and on `./internal`
    // `template-sz-invalid`, `template-runtime-value` and
    // `peer-module-unresolved` — each one plain literal of
    // `diagnostic-browser.generated.ts`, which the bundle keeps alone
    // (`tests/engine-entry-isolation.test.ts` pins which). Kept in full on
    // the user's call (2026-10-21) rather than cut to a compact line.
    //
    // Raised 2026-10-21 from 27,250 / 30,250, measured 27,103 / 30,135
    // (+139 / +131 against 26,964 / 30,004): a development render refuses a
    // diagnostic missing a required arg or a form with no sentence
    // (`assertFillable`, +189), the registry gained the
    // `stale-binding-versions` and `sz-attribute-syntax` `end` forms (+60),
    // and `diagnosticPath` changed (+11). Marking each arg's optionality as
    // an object per arg cost a further +221 / +234; the generator now writes
    // an entry's args as one string (`'form key replacement?'`) and its list
    // joiners apart (`templateArgs`, `templateJoiners`), which removes that
    // and keeps the check's semantics. Budgets the usual ~300 above.
    //
    // Raised 2026-10-22 from 27,400 / 30,450, measured 28,199 / 31,234
    // (+1,096 / +1,099 against 27,103 / 30,135): the engine's per-file spans
    // cross as length-prefixed text read by one decoder in
    // `engine-spans.ts` instead of napi objects or `JSON.parse`, which takes
    // 1.75 ms off 800 clean files and lowers the diagnostic-cost scavenges.
    // Folding the decoder's readers into one shared list reader and dropping
    // dead helpers saved 157 bytes; the rest is the decoder and its error
    // messages. Minifying these entries (about −5.3 / −6.1 KB) was measured
    // and not taken: most build tools ship readable Node code, and a
    // minified stack trace names `I` where it named `runWasmBatch`.
    //
    // Raised 2026-10-23 from 28,500 / 31,550, measured 28,641 / 31,671
    // (+442 / +437 against 28,199 / 31,234): the byte-offset locator in
    // `engine-spans.ts` reads only the lines holding non-ASCII text, which
    // takes 42% off placing positions across this repository's 382 source
    // files and 63% off the index memory a cached result holds. One shared
    // walk for indexing and lookup, and one table builder for ASCII and
    // non-ASCII sources, saved 187 bytes; the rest is the line table and the
    // marks that keep a lookup on a long minified line bounded. The built
    // chunk carries no comments, so this is code. Raised on the user's call.
    {
        name: '@csszyx/compiler `./engine`, loaded by Node',
        kind: 'node-entry',
        target: 'packages/compiler',
        subpath: './engine',
        maxGzipBytes: 28_950,
        excludedModules: ['src/state-variants.generated.ts'],
    },
    {
        name: '@csszyx/compiler `./internal`, loaded by Node',
        kind: 'node-entry',
        target: 'packages/compiler',
        subpath: './internal',
        maxGzipBytes: 31_950,
        excludedModules: ['src/state-variants.generated.ts'],
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
    return appBuild(entryPaths, packageDir).code;
}

/** An app entry that imports each entry as a namespace and exports them all,
 * so nothing a consumer could reach is shaken out.
 *
 * @param {string[]} entryPaths absolute entry files
 * @returns {string} the entry's source
 */
function namespaceEntry(entryPaths) {
    return entryPaths
        .map((entry, i) => `import * as e${i} from ${JSON.stringify(entry)};`)
        .concat(`export { ${entryPaths.map((_, i) => `e${i}`).join(', ')} };`)
        .join('\n');
}

/** The esbuild app build behind {@link appBundle}, with the bundle's modules
 * in the order it lays them out (esbuild's metafile lists an output's inputs
 * in that order).
 *
 * @param {string[]} entryPaths absolute entry files
 * @param {string} packageDir absolute package directory, the resolve root
 * @returns {{ code: string, moduleIds: string[] }} the bundle and its modules in order
 */
function appBuild(entryPaths, packageDir) {
    const manifest = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
    const result = buildSync({
        stdin: { contents: namespaceEntry(entryPaths), resolveDir: packageDir, loader: 'js' },
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'browser',
        minify: true,
        treeShaking: true,
        metafile: true,
        ...INSTALLED_RESOLUTION,
        external: ['@csszyx/*', ...Object.keys(manifest.peerDependencies ?? {})],
        define: { 'process.env.NODE_ENV': '"production"' },
        logLevel: 'silent',
    });
    const [output] = Object.values(result.metafile.outputs);
    return {
        code: result.outputFiles[0].text,
        moduleIds: Object.keys(output.inputs).map(id => path.resolve(packageDir, id)),
    };
}

/** Where a budget's `moduleOrder` is broken: each prefix names the first
 * module whose file name starts with it, and those modules must be laid out in
 * the listed order. Gzip finds a repeat only within 32 KB, so a table placed
 * far from the code that spells the same keys costs bytes no line of source
 * shows (see the compiler's budget).
 *
 * @param {string[]} moduleIds module paths in bundle order
 * @param {string[]} prefixes file-name prefixes, in the order required
 * @returns {string[]} one problem per prefix with no module or out of order
 */
export function moduleOrderProblems(moduleIds, prefixes) {
    const names = moduleIds.map(id => path.basename(id));
    const problems = [];
    let previous;
    for (const prefix of prefixes) {
        const at = names.findIndex(name => name.startsWith(prefix));
        if (at === -1) {
            problems.push(`bundles no module whose file name starts with \`${prefix}\``);
            continue;
        }
        if (previous !== undefined && at < previous.at) {
            problems.push(`bundles \`${prefix}\` before \`${previous.prefix}\``);
        }
        previous = { prefix, at };
    }
    return problems;
}

/** The failures of one module order, worded for the gate.
 *
 * @param {string} label who lays the modules out: the budget's name, and its subpath if any
 * @param {string[]} moduleIds module paths in bundle order
 * @param {string[]} prefixes file-name prefixes, in the order required
 * @returns {string[]} failure messages
 */
function orderFailures(label, moduleIds, prefixes) {
    return moduleOrderProblems(moduleIds, prefixes).map(
        problem =>
            `${label} ${problem}. The order keeps tables within gzip's reach of the code ` +
            'that repeats their keys; restore it in the import order or the chunk groups ' +
            'before moving the budget.',
    );
}

/** The failures of a budget's `moduleOrder` for one lane.
 *
 * @param {{ name: string, moduleOrder?: Record<string, string[]> }} budget the budget
 * @param {string} name the lane's budget name
 * @param {Array<{ subpath: string }>} entries the package's export entries
 * @param {Map<string, string[]>} modulesBySubpath each measured entry's modules in bundle order
 * @returns {string[]} failure messages
 */
function moduleOrderFailures(budget, name, entries, modulesBySubpath) {
    const failures = [];
    for (const [subpath, prefixes] of Object.entries(budget.moduleOrder ?? {})) {
        if (!entries.some(entry => entry.subpath === subpath)) {
            failures.push(`${name}: \`${subpath}\` has a module order but no export`);
            continue;
        }
        failures.push(
            ...orderFailures(
                `${name}: \`${subpath}\``,
                modulesBySubpath.get(subpath) ?? [],
                prefixes,
            ),
        );
    }
    return failures;
}

/** The failures of a file budget that names the esbuild options its file is
 * written from (`build`): the file has to be what those options write, and
 * the modules of that build laid out in its `moduleOrder`. The order is read
 * from esbuild's metafile, which a written file does not keep, so the build
 * runs again in memory and is compared byte for byte with the file first.
 *
 * @param {{ name: string, build: object, moduleOrder?: string[] }} budget the budget
 * @param {string} target absolute path of the file
 * @param {string} written the file's text, as the gate read it
 * @returns {string[]} failure messages
 */
function builtFileFailures(budget, target, written) {
    const result = buildSync({
        ...budget.build,
        outfile: target,
        write: false,
        metafile: true,
        logLevel: 'silent',
    });
    if (result.outputFiles[0].text !== written) {
        return [
            `${budget.name}: the file is not what its build options write, so the order ` +
                'of its modules cannot be read from them. Rebuild it, or build it from the ' +
                'options the budget names.',
        ];
    }
    const [output] = Object.values(result.metafile.outputs);
    return orderFailures(`${budget.name}:`, Object.keys(output.inputs), budget.moduleOrder ?? []);
}

/** Bundle the csszyx packages an app imports the way an app that installed
 * them ships them: each specifier imported as a namespace from the package
 * that depends on them, so they resolve through its `node_modules` to their
 * built `dist`, the compiler bundled in ({@link INSTALLED_RESOLUTION}).
 * Production, minified, the
 * peer dependencies left to the app. A build error throws.
 *
 * @param {{ target: string, imports: string[] }} budget the budget
 * @param {string} rootDir absolute repository root
 * @returns {{ code: string, moduleIds: string[] }} the bundle and its modules in order
 */
function installedAppBuild(budget, rootDir) {
    const packageDir = path.join(rootDir, budget.target);
    const result = buildSync({
        stdin: { contents: namespaceEntry(budget.imports), resolveDir: packageDir, loader: 'js' },
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'browser',
        minify: true,
        treeShaking: true,
        metafile: true,
        ...INSTALLED_RESOLUTION,
        external: appPeers(packageDir),
        define: { 'process.env.NODE_ENV': '"production"' },
        logLevel: 'silent',
    });
    const [output] = Object.values(result.metafile.outputs);
    return {
        code: result.outputFiles[0].text,
        moduleIds: Object.keys(output.inputs)
            .filter(id => id !== '<stdin>')
            .map(id => path.resolve(id)),
    };
}

/** The modules a build marks in its output, one `//#region <source>` line
 * each (Rolldown, and so tsdown, writes them), by the file that holds them.
 *
 * @param {string[]} files absolute file paths
 * @returns {Map<string, string[]>} file → the sources it holds
 */
function regionsOf(files) {
    return new Map(
        files.map(file => [
            file,
            [...readFileSync(file, 'utf8').matchAll(/^\/\/#region (\S+)$/gm)].map(m => m[1]),
        ]),
    );
}

/** Where the files a Node entry loads hold a module its budget keeps out of
 * them (`excludedModules`, package-relative source paths). Read from the
 * region markers, so a files list with none fails rather than passing; and a
 * name no source file has fails too, or a rename would leave an exclusion
 * that holds nothing.
 *
 * @param {string[]} files absolute files the entry loads
 * @param {string[]} excluded package-relative source paths kept out
 * @param {string} packageDir absolute package directory
 * @returns {string[]} one problem per mismatch
 */
export function excludedModuleProblems(files, excluded, packageDir) {
    const regions = regionsOf(files);
    const problems = [];
    if (![...regions.values()].some(sources => sources.length > 0)) {
        problems.push(
            'no file it loads carries a `//#region` marker, so which modules it holds cannot be read',
        );
    }
    for (const source of excluded) {
        if (!existsSync(path.join(packageDir, source))) {
            problems.push(`\`${source}\` names no source file`);
            continue;
        }
        for (const [file, sources] of regions) {
            if (sources.includes(source)) {
                problems.push(`loads \`${source}\` (${path.relative(packageDir, file)})`);
            }
        }
    }
    return problems;
}

/** The id of the entry module the Vite lane bundles from. */
const VITE_ENTRY = '\0csszyx-size-gate-entry';

/** Bundle a package's export entries the way a Vite app ships them: `vite
 * build` with no config of its own, so its defaults (Rolldown, the Oxc
 * minifier, the default browser target) decide, and the same inputs as
 * {@link appBundle}: every entry imported as a namespace and kept reachable,
 * `process.env.NODE_ENV` defined as production, and the other `@csszyx/*`
 * packages and the peer dependencies left external. A build error rejects.
 *
 * @param {string[]} entryPaths absolute entry files
 * @param {string} packageDir absolute package directory, the resolve root
 * @returns {Promise<string[]>} the code of every chunk the build emits
 */
export async function viteAppBundle(entryPaths, packageDir) {
    return (await viteAppBuild(entryPaths, packageDir)).map(chunk => chunk.code);
}

/** The Vite build behind {@link viteAppBundle}.
 *
 * @param {string[]} entryPaths absolute entry files
 * @param {string} packageDir absolute package directory, the resolve root
 * @returns {Promise<Array<{ code: string, moduleIds: string[] }>>} every chunk with its modules in layout order
 */
async function viteAppBuild(entryPaths, packageDir) {
    const manifest = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
    return viteSiteBuild({
        contents: globalEntry(entryPaths),
        root: packageDir,
        nodeEnv: 'production',
        external: ['@csszyx', ...Object.keys(manifest.peerDependencies ?? {})],
    });
}

/** An app entry for Vite: it exports nothing, so each namespace is kept
 * reachable through a global.
 *
 * @param {string[]} entryPaths absolute entry files
 * @returns {string} the entry's source
 */
function globalEntry(entryPaths) {
    return entryPaths
        .map((entry, i) => `import * as e${i} from ${JSON.stringify(entry)};`)
        .concat(`globalThis.__csszyxSizeGate = [${entryPaths.map((_, i) => `e${i}`).join(', ')}];`)
        .join('\n');
}

/** `vite build` of one entry source with no config of its own, so its
 * defaults (Rolldown, the Oxc minifier, the default browser target) decide.
 * A build error rejects.
 *
 * @param {object} options what to build
 * @param {string} options.contents the entry's source
 * @param {string} options.root absolute directory imports resolve from
 * @param {'production' | 'development'} options.nodeEnv the `process.env.NODE_ENV` to define
 * @param {string[]} options.external packages left out, each with its subpaths
 * @returns {Promise<Array<{ code: string, moduleIds: string[] }>>} every chunk with its modules in layout order
 */
async function viteSiteBuild(options) {
    const { build } = await import('vite');
    const { contents, root, nodeEnv, external } = options;
    // One output, so one result: a watcher or a list would fail on `.output`.
    const { output } = await build({
        configFile: false,
        root,
        publicDir: false,
        logLevel: 'silent',
        mode: nodeEnv,
        define: { 'process.env.NODE_ENV': JSON.stringify(nodeEnv) },
        plugins: [
            {
                name: 'csszyx-size-gate-entry',
                resolveId: id => (id === VITE_ENTRY ? id : null),
                load: id => (id === VITE_ENTRY ? contents : null),
            },
        ],
        build: {
            write: false,
            modulePreload: false,
            rollupOptions: {
                input: VITE_ENTRY,
                external: id => external.some(name => id === name || id.startsWith(`${name}/`)),
            },
        },
    });
    return output
        .filter(file => file.type === 'chunk')
        .map(chunk => ({ code: chunk.code, moduleIds: chunk.moduleIds }));
}

/** The parser the sink gate reads a bundle with: the compiler's own
 * dependency, resolved from the compiler so the gate needs no copy of it. */
const { parseSync } = createRequire(new URL('../packages/compiler/package.json', import.meta.url))(
    'oxc-parser',
);

/** The console methods whose first argument is a message. */
const CONSOLE_METHODS = new Set(['warn', 'error', 'log', 'info', 'debug']);

/** A native error class, the one constructor name a minifier keeps:
 * `Error`, `TypeError`, `SyntaxError`, … */
const NATIVE_ERROR = /^(?:[A-Z][A-Za-z]*)?Error$/;

/** The head of a registered line: `[csszyx] <code>: `. */
const CODE_HEAD = /^\[csszyx\] ([a-z][a-z0-9]*(?:-[a-z0-9]+)*): /;

/** How much of a prose literal a head keeps. */
const HEAD_LENGTH = 56;

/** Each error class the registry names (`surfaces.error.classes`), by the one
 * id it throws under. A class listed under two ids throws either, so its
 * code is not known from the class and it is left out.
 *
 * @param {Array<{ id: string, surfaces: { error?: { classes?: string[] } } }>} diagnostics the registry's entries
 * @returns {Map<string, string>} class name → id
 */
export function errorClassCodesOf(diagnostics) {
    const codes = new Map();
    const shared = new Set();
    for (const { id, surfaces } of diagnostics) {
        for (const name of surfaces.error?.classes ?? []) {
            if (codes.has(name)) shared.add(name);
            codes.set(name, id);
        }
    }
    for (const name of shared) codes.delete(name);
    return codes;
}

/** The registry's error classes, by id. */
const ERROR_CLASS_CODES = errorClassCodesOf(registry.DIAGNOSTICS);

/** A message as the literal text and the expressions it is built from, in
 * order: a string, a template literal, or a `+` chain of them.
 *
 * @param {any} node an expression
 * @returns {Array<{ text: string } | { expr: true }>} the parts
 */
function messageParts(node) {
    if (node.type === 'ParenthesizedExpression') return messageParts(node.expression);
    if (node.type === 'Literal' && typeof node.value === 'string') return [{ text: node.value }];
    if (node.type === 'TemplateLiteral') {
        return node.quasis.flatMap((quasi, i) =>
            i < node.expressions.length
                ? [{ text: quasi.value.cooked }, { expr: true }]
                : [{ text: quasi.value.cooked }],
        );
    }
    if (node.type === 'BinaryExpression' && node.operator === '+') {
        return [...messageParts(node.left), ...messageParts(node.right)];
    }
    return [{ expr: true }];
}

/** Whether a message opens with literal text. */
const literalLed = node => 'text' in messageParts(node)[0];

/** The head a sink's message is read by. The compact production line,
 * `[csszyx] <code>: <args> https://csszyx.com/e/<code>`, reads as its code
 * head alone; any other literal text beside it is prose, read as written so
 * no list can allow it by its code. A message that opens with no literal is
 * `<expr>`.
 *
 * @param {any} node the message expression, or nothing
 * @returns {string} the head
 */
function messageHead(node) {
    if (node === undefined) return '<expr>';
    const parts = messageParts(node);
    const [first] = parts;
    if (!('text' in first)) return '<expr>';
    const head = CODE_HEAD.exec(first.text);
    if (head === null || first.text.length > head[0].length) {
        return first.text.slice(0, HEAD_LENGTH);
    }
    const link = ` https://csszyx.com/e/${head[1]}`;
    const prose = parts
        .slice(1)
        .find(part => 'text' in part && part.text !== '' && part.text !== link);
    return prose === undefined ? head[0] : `${head[0]}…${prose.text}`;
}

/** The message of a csszyx error built from its options,
 * `{ code, args, message }`, with the code checked against the head: a
 * `code` the message does not name is a line no page explains.
 *
 * @param {any} node an argument
 * @returns {string | undefined} the head, or nothing for any other argument
 */
function optionsHead(node) {
    if (node?.type !== 'ObjectExpression') return undefined;
    const property = name =>
        node.properties.find(
            p => p.type === 'Property' && !p.computed && (p.key.name ?? p.key.value) === name,
        )?.value;
    const message = property('message');
    const code = property('code');
    if (message === undefined || code === undefined) return undefined;
    const head = messageHead(message);
    const named = CODE_HEAD.exec(head)?.[1];
    return code.type === 'Literal' && named !== undefined && code.value !== named
        ? `${head}(code ${code.value})`
        : head;
}

/** The messages a bundle can print or throw, read from its syntax tree, one
 * head per sink (ADR 0031 §6, the sinks `validate-undocumented-warnings`
 * reads): `method: head` for a console call, and `throw: head` for
 *
 * - a native error built with a message (`new TypeError(…)`),
 * - a csszyx error built from its options, by whatever name the minifier
 *   gave its class, directly or through a subclass's `super(…)`,
 * - a `super(…)` or a `throw` handed literal text, and
 * - a class the registry names, imported under any name, which throws its
 *   id: its message is worded, and read, in the package that defines it.
 *
 * Passthrough sinks are allowed by what they are (ADR 0031 item 5): a throw
 * of a caught value, of a call's result, or of a class that words its own
 * message carries no message at the throw, and its message is read where the
 * error is built. A non-literal message handed to a console call or a native
 * error reads `<expr>`, which a budget must name to let through.
 *
 * @param {string} code a bundle
 * @param {ReadonlyMap<string, string>} [classCodes] error class → id, from {@link errorClassCodesOf}
 * @returns {string[]} the heads, sorted
 */
export function sinkMessages(code, classCodes = ERROR_CLASS_CODES) {
    const { program, errors } = parseSync('bundle.js', code, { sourceType: 'module' });
    if (errors.length > 0) throw new Error(`cannot read the bundle: ${errors[0].message}`);
    const imported = new Map();
    for (const node of program.body) {
        if (node.type !== 'ImportDeclaration') continue;
        for (const specifier of node.specifiers) {
            const name = specifier.imported?.name ?? specifier.imported?.value;
            if (classCodes.has(name)) imported.set(specifier.local.name, classCodes.get(name));
        }
    }
    const heads = [];
    const sink = node => {
        const [first] = node.arguments ?? [];
        const { callee } = node;
        if (node.type === 'ThrowStatement') {
            if (literalLed(node.argument)) heads.push(`throw: ${messageHead(node.argument)}`);
        } else if (
            node.type === 'CallExpression' &&
            callee.type === 'MemberExpression' &&
            !callee.computed &&
            callee.object.type === 'Identifier' &&
            callee.object.name === 'console' &&
            CONSOLE_METHODS.has(callee.property.name)
        ) {
            heads.push(`${callee.property.name}: ${messageHead(first)}`);
        } else if (node.type === 'NewExpression' && imported.has(callee.name)) {
            heads.push(`throw: [csszyx] ${imported.get(callee.name)}: `);
        } else if (
            node.type === 'NewExpression' ||
            (node.type === 'CallExpression' && callee.type === 'Super')
        ) {
            const head =
                optionsHead(first) ??
                (NATIVE_ERROR.test(callee.name) ||
                (callee.type === 'Super' && first !== undefined && literalLed(first))
                    ? messageHead(first)
                    : undefined);
            if (head !== undefined) heads.push(`throw: ${head}`);
        }
    };
    const visit = node => {
        if (Array.isArray(node)) {
            for (const child of node) visit(child);
            return;
        }
        if (node === null || typeof node !== 'object') return;
        if (typeof node.type === 'string') sink(node);
        for (const [key, value] of Object.entries(node)) {
            if (key !== 'parent') visit(value);
        }
    };
    visit(program);
    return heads.sort();
}

/** The lines a production bundle may print and the errors it may throw, by
 * the code that heads them: every registry id that prints in production
 * (`runtime.production` true, or a list of the forms that do) from one of
 * the bundle's source files, with the method its entry names, and every id
 * it throws (`surfaces.error`, unless `production` is false) from one of
 * them. Read from the registry so the list is never written twice (ADR
 * 0031); a site writes the compact form inline,
 * `[csszyx] <code>: <args JSON> <link>`, whose head {@link sinkMessages}
 * reads.
 *
 * @param {Array<{ id: string, surfaces: { runtime?: { production: boolean | string[], console?: 'error' }, error?: { host: string, production?: false } }, sources?: string[] }>} diagnostics the registry's entries
 * @param {ReadonlySet<string>} files the sources the bundle can hold, repository-relative
 * @returns {string[]} the heads, `method: [csszyx] <code>: ` and `throw: [csszyx] <code>: `, sorted
 */
export function productionCodesOf(diagnostics, files) {
    const heads = [];
    for (const { id, surfaces, sources = [] } of diagnostics) {
        if (!sources.some(source => files.has(source.replace(/:\d+$/, '')))) continue;
        const production = surfaces.runtime?.production;
        if (production === true || (Array.isArray(production) && production.length > 0)) {
            heads.push(`${surfaces.runtime.console ?? 'warn'}: [csszyx] ${id}: `);
        }
        const thrown = surfaces.error;
        if (thrown !== undefined && thrown.host !== 'node' && thrown.production !== false) {
            heads.push(`throw: [csszyx] ${id}: `);
        }
    }
    return heads.sort();
}

/** Compare the lines a bundle prints and throws with the codes the registry
 * lets it print in production, as sets: one sink per site, and one code may
 * have several sites. A head no code allows is a development line that
 * failed to fold, a sentence where the compact line belongs, or a line
 * printed through another method than the registry names; a required head
 * the bundle no longer prints is a stale entry or a lost site. The required
 * heads are the allowed ones, unless a budget measures a file that holds
 * only what its entry reaches. A bundle with no sink at all fails too when
 * the registry lets it print something: the scan must find the sinks it
 * checks, or a reader that stopped matching would pass every bundle. One the
 * registry lets print nothing passes only while it prints nothing.
 *
 * @param {string[]} printed heads from {@link sinkMessages}
 * @param {string[]} allowed heads from {@link productionCodesOf}, and the ones a budget names
 * @param {string[]} [required] heads the bundle must print
 * @returns {string[]} one problem per mismatch
 */
export function codeProblems(printed, allowed, required = allowed) {
    const problems = [];
    if (printed.length === 0 && allowed.length > 0) {
        problems.push('found no sink to check, so the sink scan read nothing');
    }
    for (const head of new Set(printed)) {
        if (!allowed.includes(head)) {
            problems.push(
                `prints "${head}", which the registry does not mark as printing in production`,
            );
        }
    }
    for (const head of required) {
        if (!printed.includes(head)) problems.push(`no longer prints "${head}"`);
    }
    return problems;
}

/** The sink failures of one production bundle against its budget: the
 * registry's codes when the budget reads them, and a hand-written list
 * otherwise.
 *
 * @param {(typeof SIZE_BUDGETS)[number]} budget the budget
 * @param {string} bundle the bundle
 * @returns {string[]} failure messages
 */
function sinkFailures(budget, bundle) {
    const printed = sinkMessages(bundle);
    const named = [...(budget.nonRegistryMessages ?? []), ...(budget.passthroughSinks ?? [])];
    const problems =
        budget.productionCodes === undefined
            ? messageProblems(printed, budget.productionMessages ?? [])
            : codeProblems(
                  printed,
                  [...budget.productionCodes, ...named],
                  [...(budget.requiredCodes ?? budget.productionCodes), ...named],
              );
    return problems.map(
        problem =>
            `${budget.name}: the production bundle ${problem}. Only a message that ` +
            "reports csszyx's own output as wrong or missing, a security or a crash " +
            'stays in production (ADR 0011), as its code (ADR 0031); anything else checks ' +
            "`process.env.NODE_ENV !== 'production'` at the call site so the bundler drops it.",
    );
}

/** Compare a bundle's sink messages with the ones its budget allows, as
 * multisets, both ways: a message nobody listed is a development warning that
 * failed to fold (or a new production message that needs a decision, ADR
 * 0011), and a listed message the bundle no longer prints is a stale list.
 *
 * @param {string[]} printed heads from {@link sinkMessages}
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

/** The files a Node process loads when it imports one entry: the entry and
 * every file it reaches through a static `import` or `export … from`, read
 * from esbuild's metafile. A dynamic `import()` loads only when it runs, so
 * it is not followed, and other packages and Node builtins are left out.
 *
 * @param {string} entryFile absolute entry file
 * @returns {string[]} absolute file paths, sorted
 */
export function nodeEntryFiles(entryFile) {
    const dir = path.dirname(entryFile);
    const { metafile } = buildSync({
        entryPoints: [entryFile],
        absWorkingDir: dir,
        bundle: true,
        write: false,
        metafile: true,
        format: 'esm',
        platform: 'node',
        packages: 'external',
        logLevel: 'silent',
    });
    const seen = new Set();
    const queue = [path.relative(dir, entryFile)];
    while (queue.length > 0) {
        const file = queue.pop();
        if (seen.has(file)) continue;
        seen.add(file);
        for (const { path: target, kind, external } of metafile.inputs[file].imports) {
            if (kind === 'import-statement' && !external) queue.push(target);
        }
    }
    return [...seen].map(file => path.resolve(dir, file)).sort();
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

/** A function that records one measurement against its ceiling, into
 * `results`, and a failure with the raise-and-explain message when it is over.
 *
 * @param {Array<{ name: string, files: string[], gzipBytes: number, maxGzipBytes: number, ok: boolean }>} results measurements so far
 * @param {string[]} failures failure messages so far
 * @returns {(name: string, files: string[], gzipBytes: number, maxGzipBytes: number) => void} the recorder
 */
function recorder(results, failures) {
    return (name, files, gzipBytes, maxGzipBytes) => {
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
    const record = recorder(results, failures);
    for (const budget of budgets) {
        const target = path.join(rootDir, budget.target);
        let files;
        let gzipBytes;
        const entryMeasurements = [];
        try {
            if (budget.kind === 'node-entry') {
                const entry = listExportSubpaths(target).find(
                    ({ subpath }) => subpath === budget.subpath,
                );
                if (entry === undefined) {
                    const { name } = JSON.parse(
                        readFileSync(path.join(target, 'package.json'), 'utf8'),
                    );
                    throw new Error(`no export subpath \`${budget.subpath}\` in ${name}`);
                }
                files = nodeEntryFiles(entry.file);
                gzipBytes = gzipTotalBytes(files);
                const excluded = budget.excludedModules ?? [];
                for (const problem of excluded.length > 0
                    ? excludedModuleProblems(files, excluded, target)
                    : []) {
                    failures.push(
                        `${budget.name}: ${problem}. A module kept out of what Node loads ` +
                            'costs every build its bytes; see the budget for where it belongs.',
                    );
                }
            } else if (budget.kind === 'installed-app') {
                const { code, moduleIds } = installedAppBuild(budget, rootDir);
                files = moduleIds;
                gzipBytes = gzipSync(code, { level: 9 }).length;
                failures.push(
                    ...orderFailures(`${budget.name}:`, moduleIds, budget.moduleOrder ?? []),
                );
            } else if (budget.kind === 'file') {
                // A binary artifact is one opaque file: no import graph to
                // bundle, but its absence is still a failure, never a pass.
                // Read once: the size, the sinks and the build comparison all
                // judge these bytes, not a file that may change between reads.
                const bytes = readFileSync(target);
                files = [target];
                gzipBytes = gzipSync(bytes, { level: 9 }).length;
                // A production bundle shipped as a file is read like an app's.
                if (budget.productionCodes !== undefined) {
                    failures.push(...sinkFailures(budget, bytes.toString('utf8')));
                }
                if (budget.build !== undefined) {
                    failures.push(...builtFileFailures(budget, target, bytes.toString('utf8')));
                }
            } else {
                files = listExportEntries(target, budget.excludeSubpaths);
                if (files.length === 0) {
                    throw new Error(`no runtime export entries in ${budget.target}/package.json`);
                }
                const bundle = appBundle(files, target);
                gzipBytes = gzipSync(bundle, { level: 9 }).length;
                failures.push(...sinkFailures(budget, bundle));
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
                    const modulesBySubpath = new Map();
                    for (const { subpath, file } of entries) {
                        if (!Object.hasOwn(budget.entryBudgets, subpath)) continue;
                        const { code, moduleIds } = appBuild([file], target);
                        modulesBySubpath.set(subpath, moduleIds);
                        entryMeasurements.push([
                            subpath,
                            file,
                            gzipSync(code, { level: 9 }).length,
                        ]);
                    }
                    failures.push(
                        ...moduleOrderFailures(budget, budget.name, entries, modulesBySubpath),
                    );
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

/** Measure the app-bundle budgets that carry a `vite` field with Vite, the
 * union and each entry, against the ceilings in that field. Rolldown lays
 * modules out and names identifiers its own way, and the bytes a layout
 * change costs in a Vite build need not show in an esbuild one. A target that
 * is missing or fails to build is a failure, as in {@link checkBudgets}.
 *
 * @param {typeof SIZE_BUDGETS} budgets budget entries with repo-relative targets
 * @param {string} rootDir absolute repository root
 * @returns {Promise<{ results: Array<{ name: string, files: string[], gzipBytes: number, maxGzipBytes: number, ok: boolean }>, failures: string[] }>} measurements and failure messages
 */
export async function checkViteBudgets(budgets, rootDir) {
    const results = [];
    const failures = [];
    const record = recorder(results, failures);
    /** Gzip each chunk at a fixed level and sum them. */
    const gzipChunks = chunks =>
        chunks.reduce((total, code) => total + gzipSync(code, { level: 9 }).length, 0);
    for (const budget of budgets) {
        if (budget.kind !== 'app-bundle' || budget.vite === undefined) continue;
        const name = `${budget.name} (Vite)`;
        const target = path.join(rootDir, budget.target);
        const ceilings = budget.vite.entryBudgets ?? {};
        try {
            const files = listExportEntries(target, budget.excludeSubpaths);
            if (files.length === 0) {
                throw new Error(`no runtime export entries in ${budget.target}/package.json`);
            }
            const gzipBytes = gzipChunks(await viteAppBundle(files, target));
            const entries = listExportSubpaths(target, budget.excludeSubpaths);
            for (const problem of entryBudgetProblems(
                entries.map(({ subpath }) => subpath),
                ceilings,
            )) {
                failures.push(
                    `${name}: ${problem}. Each runtime export gets its own Vite ceiling.`,
                );
            }
            const entryMeasurements = [];
            const modulesBySubpath = new Map();
            for (const { subpath, file } of entries) {
                if (!Object.hasOwn(ceilings, subpath)) continue;
                const chunks = await viteAppBuild([file], target);
                modulesBySubpath.set(
                    subpath,
                    chunks.flatMap(chunk => chunk.moduleIds),
                );
                entryMeasurements.push([
                    subpath,
                    file,
                    gzipChunks(chunks.map(chunk => chunk.code)),
                ]);
            }
            failures.push(...moduleOrderFailures(budget, name, entries, modulesBySubpath));
            record(name, files, gzipBytes, budget.vite.maxGzipBytes);
            for (const [subpath, file, entryBytes] of entryMeasurements) {
                record(`${name} \`${subpath}\``, [file], entryBytes, ceilings[subpath]);
            }
        } catch (error) {
            failures.push(`${name}: ${error.message} — run \`pnpm build\` first?`);
        }
    }
    return { results, failures };
}

/** The ids whose templates the leak gate looks for: every id the browser
 * module carries, read from the registry the generator writes it from. */
export const TEMPLATE_DIAGNOSTICS = browserDiagnostics(registry);

/** The positive control: a site written the way a browser entry reports a
 * diagnostic, `szReport` on the development branch of a `NODE_ENV` check. A
 * development build of it must carry the id's templates, or the production
 * check could pass for a template that was never bundled at all. */
export const TEMPLATE_CONTROL = {
    resolveDir: 'packages/runtime',
    id: 'removed-key',
    contents:
        "import { REMOVED_KEY, szReport } from '@csszyx/compiler/report';\n" +
        "if (process.env.NODE_ENV !== 'production') {\n" +
        "    szReport({ diagnostic: REMOVED_KEY, args: { form: 'removed', key: 'fontVariant' } });\n" +
        '}\n',
};

/** Every template string the ids carry, each form of each field: what a
 * bundle holds as a string literal whenever it holds the template.
 *
 * @param {Array<{ id: string, text?: unknown, help?: unknown, note?: unknown }>} diagnostics the ids, with their templates
 * @returns {Array<{ id: string, text: string }>} the templates, in registry order
 */
export function templateTexts(diagnostics) {
    const texts = [];
    for (const diagnostic of diagnostics) {
        for (const field of ['text', 'help', 'note']) {
            const value = diagnostic[field];
            if (value === undefined) continue;
            for (const text of typeof value === 'string' ? [value] : Object.values(value)) {
                texts.push({ id: diagnostic.id, text });
            }
        }
    }
    return texts;
}

/** The value of every string literal in a bundle, as parsed: whichever
 * quotes and escapes a minifier picks, a literal reads as the text it holds.
 *
 * @param {string} code a bundle
 * @returns {Set<string>} the values
 */
function stringLiterals(code) {
    const source = ts.createSourceFile(
        'bundle.js',
        code,
        ts.ScriptTarget.Latest,
        false,
        ts.ScriptKind.JS,
    );
    const values = new Set();
    const visit = node => {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
            values.add(node.text);
        ts.forEachChild(node, visit);
    };
    visit(source);
    return values;
}

/** The templates a bundle holds, each as a whole string literal. Prose that
 * shares words with a template is not one: a template holds its `{name}`
 * placeholders, or, with none, is the whole sentence as the registry words it.
 *
 * @param {string} code a bundle
 * @param {Array<{ id: string, text: string }>} texts from {@link templateTexts}
 * @returns {Array<{ id: string, text: string }>} the ones found
 */
export function templateLeaks(code, texts) {
    const literals = stringLiterals(code);
    return texts.filter(({ text }) => literals.has(text));
}

/** The peer dependencies an app brings itself, for a package and the csszyx
 * packages it depends on: a build that bundles the siblings leaves these out.
 * Each sibling is read where the package resolves it, its `node_modules`. A
 * csszyx package is never one of them, though one names another as its peer
 * (`@csszyx/unplugin` names `@csszyx/runtime`): the csszyx packages are what
 * the build bundles.
 *
 * @param {string} packageDir absolute package directory
 * @returns {string[]} the package names
 */
function appPeers(packageDir) {
    const read = dir => JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const manifest = read(packageDir);
    const peers = new Set(Object.keys(manifest.peerDependencies ?? {}));
    for (const name of Object.keys(manifest.dependencies ?? {})) {
        const sibling = path.join(packageDir, 'node_modules', name);
        if (!name.startsWith('@csszyx/') || !existsSync(path.join(sibling, 'package.json'))) {
            continue;
        }
        for (const peer of Object.keys(read(sibling).peerDependencies ?? {})) peers.add(peer);
    }
    return [...peers].filter(name => !name.startsWith('@csszyx/'));
}

/** Bundle a site the way an app ships it, csszyx siblings included, so code
 * a package imports from another csszyx package is in the bundle, each
 * sibling from its built `dist` ({@link INSTALLED_RESOLUTION}): through the
 * repository's tsconfig `paths` the runtime's bundle held the compiler's
 * source, a layout no user gets, with a second copy of `errors` and
 * `sz-limits` beside the `dist` ones its subpath imports reach.
 *
 * @param {object} options what to build
 * @param {string} options.contents the entry's source
 * @param {string} options.resolveDir absolute directory imports resolve from
 * @param {'production' | 'development'} options.nodeEnv the `process.env.NODE_ENV` to define
 * @param {string[]} options.external packages left out
 * @returns {string} the minified bundle
 */
function siteBundle(options) {
    const { contents, resolveDir, nodeEnv, external } = options;
    return buildSync({
        stdin: { contents, resolveDir, loader: 'js' },
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'browser',
        minify: true,
        treeShaking: true,
        ...INSTALLED_RESOLUTION,
        external,
        define: { 'process.env.NODE_ENV': JSON.stringify(nodeEnv) },
        logLevel: 'silent',
    }).outputFiles[0].text;
}

/** The two-way template gate (ADR 0031, PR C). Every app bundle, built for
 * production by esbuild and by Vite ({@link TEMPLATE_LANES}) with the csszyx
 * packages it imports bundled in, must carry no
 * template text: a template reaches production only through a call outside a
 * `NODE_ENV` branch, or a template that is not a plain literal (a bare
 * `Object.freeze` survives in esbuild, Vite and webpack). And a development
 * build of {@link TEMPLATE_CONTROL} must carry its id's templates, so "none
 * found" cannot come from a check that sees nothing.
 *
 * @param {typeof SIZE_BUDGETS} budgets budget entries with repo-relative targets
 * @param {string} rootDir absolute repository root
 * @param {object} [options] what to look for
 * @param {Array<{ id: string }>} [options.diagnostics] the ids and their templates
 * @param {{ resolveDir: string, id: string, contents: string }} [options.control] the positive control
 * @returns {Promise<{ failures: string[], templates: number, bundles: number }>} failures, and what was checked
 */
export async function checkTemplateLeaks(budgets, rootDir, options = {}) {
    const { diagnostics = TEMPLATE_DIAGNOSTICS, control = TEMPLATE_CONTROL } = options;
    const texts = templateTexts(diagnostics);
    const failures = [];
    if (texts.length === 0) {
        failures.push('template leak gate: no template to look for, so no bundle can fail');
        return { failures, templates: 0, bundles: 0 };
    }
    let bundles = 0;
    for (const lane of TEMPLATE_LANES) {
        for (const budget of budgets.filter(b => b.kind === 'app-bundle')) {
            const target = path.join(rootDir, budget.target);
            const name = `${budget.name}${lane.suffix}`;
            let code;
            try {
                const entries = listExportEntries(target, budget.excludeSubpaths);
                code = await lane.build({
                    contents: lane.entry(entries),
                    resolveDir: target,
                    nodeEnv: 'production',
                    external: appPeers(target),
                });
            } catch (error) {
                failures.push(`${name}: ${error.message} — run \`pnpm build\` first?`);
                continue;
            }
            bundles += 1;
            for (const { id, text } of templateLeaks(code, texts)) {
                failures.push(
                    `${name}: the production bundle carries the development text "${text}" ` +
                        `of \`${id}\`. Report it with \`szReport\` only inside a ` +
                        "`process.env.NODE_ENV !== 'production'` branch, and keep the template a plain literal.",
                );
            }
        }
        failures.push(...(await controlFailures(lane, rootDir, control, texts)));
    }
    const shipped = shippedTemplateFailures(budgets, rootDir, texts);
    failures.push(...shipped.failures);
    return { failures, templates: texts.length, bundles: bundles + shipped.bundles };
}

/** The leak gate over what ships built rather than what an app builds: each
 * `kind: 'file'` budget that declares `templateFree`, read from its bytes on
 * disk, and the installed app, built for production. A file's `allowedIds`
 * names the ids it carries the words of by design.
 *
 * @param {typeof SIZE_BUDGETS} budgets budget entries with repo-relative targets
 * @param {string} rootDir absolute repository root
 * @param {Array<{ id: string, text: string }>} texts every template
 * @returns {{ failures: string[], bundles: number }} failures, and how many were read
 */
function shippedTemplateFailures(budgets, rootDir, texts) {
    const failures = [];
    let bundles = 0;
    for (const budget of budgets) {
        const scan =
            budget.kind === 'installed-app'
                ? {}
                : budget.kind === 'file'
                  ? budget.templateFree
                  : undefined;
        if (scan === undefined) continue;
        let code;
        try {
            code =
                budget.kind === 'installed-app'
                    ? installedAppBuild(budget, rootDir).code
                    : readFileSync(path.join(rootDir, budget.target), 'utf8');
        } catch (error) {
            failures.push(`${budget.name}: ${error.message} — run \`pnpm build\` first?`);
            continue;
        }
        bundles += 1;
        const allowed = new Set(scan.allowedIds ?? []);
        for (const { id, text } of templateLeaks(code, texts)) {
            if (allowed.has(id)) continue;
            failures.push(
                `${budget.name}: the production bundle carries the development text "${text}" ` +
                    `of \`${id}\`. Report it with \`szReport\` only inside a ` +
                    "`process.env.NODE_ENV !== 'production'` branch, and keep the template a plain literal.",
            );
        }
    }
    return { failures, bundles };
}

/** The control's failures in one lane: its development build must carry each
 * of its id's templates, its production build none.
 *
 * @param {(typeof TEMPLATE_LANES)[number]} lane the bundler
 * @param {string} rootDir absolute repository root
 * @param {{ resolveDir: string, id: string, contents: string }} control the positive control
 * @param {Array<{ id: string, text: string }>} texts every template
 * @returns {Promise<string[]>} failure messages
 */
async function controlFailures(lane, rootDir, control, texts) {
    const label = `template leak control${lane.suffix}`;
    const dir = path.join(rootDir, control.resolveDir);
    const build = nodeEnv =>
        lane.build({
            contents: control.contents,
            resolveDir: dir,
            nodeEnv,
            external: appPeers(dir),
        });
    const failures = [];
    try {
        const expected = texts.filter(({ id }) => id === control.id);
        const kept = templateLeaks(await build('development'), expected);
        for (const { text } of expected.filter(template => !kept.includes(template))) {
            failures.push(
                `${label}: a development build of a site that reports \`${control.id}\` ` +
                    `lacks "${text}", so a production bundle without it proves nothing.`,
            );
        }
        for (const { id, text } of templateLeaks(await build('production'), texts)) {
            failures.push(`${label}: its production build carries "${text}" of \`${id}\`.`);
        }
    } catch (error) {
        failures.push(`${label}: ${error.message} — run \`pnpm build\` first?`);
    }
    return failures;
}

/** The bundlers the template gate builds with: esbuild, and Vite (Rolldown
 * and the Oxc minifier), which drop dead branches and unused literals by
 * different rules. */
const TEMPLATE_LANES = [
    { suffix: '', entry: namespaceEntry, build: async options => siteBundle(options) },
    {
        suffix: ' (Vite)',
        entry: globalEntry,
        build: async ({ contents, resolveDir, nodeEnv, external }) =>
            (await viteSiteBuild({ contents, root: resolveDir, nodeEnv, external }))
                .map(chunk => chunk.code)
                .join('\n'),
    },
];

async function main() {
    const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const { results, failures } = checkBudgets(SIZE_BUDGETS, rootDir);
    const vite = await checkViteBudgets(SIZE_BUDGETS, rootDir);
    results.push(...vite.results);
    failures.push(...vite.failures);
    const leaks = await checkTemplateLeaks(SIZE_BUDGETS, rootDir);
    failures.push(...leaks.failures);
    for (const result of results) {
        const headroom = result.maxGzipBytes - result.gzipBytes;
        console.log(
            `${result.ok ? 'OK  ' : 'OVER'} ${result.name}: ${result.gzipBytes} / ${result.maxGzipBytes} gzip bytes ` +
                `(${result.files.length} files, ${headroom >= 0 ? `${headroom} under` : `${-headroom} over`})`,
        );
    }
    console.log(
        `Template leak gate: ${leaks.templates} templates looked for in ${leaks.bundles} ` +
            'production app bundles and shipped files, and the development control.',
    );
    if (failures.length > 0) {
        throw new Error(`Package size check failed:\n- ${failures.join('\n- ')}`);
    }
    console.log(`Package size check passed (${results.length} budgets).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
