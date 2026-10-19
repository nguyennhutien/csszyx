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
        // Raised from 15,750 on 2026-10-08, measured 15,851: `splitBox` and
        // `splitBoxSz` gained the box roles of nine special keys, the
        // `content-<keyword>` alignment tokens, and `css` kept whole on the
        // fallback node. Budget set the usual ~300 above the measurement.
        //
        // Raised from 16,150 on 2026-10-17, measured 16,152: the async
        // mangle check finds its map on the page or in the bundle, says why
        // every `false` happened, and fails a census the page carries but
        // cannot read instead of reading past it to the bundle's map.
        maxGzipBytes: 16_450,
        // Measured 2026-10-08, after those roles: 15,417 / 426 / 1,359 / 434 /
        // 8,144 / 1,082. `.` raised from 15,700 on 2026-10-17, measured 15,721,
        // for the same check.
        entryBudgets: {
            '.': 16_000,
            './lite': 750,
            './core': 1_650,
            './lowering': 750,
            './split': 8_450,
            './merge': 1_400,
        },
        // The same bundles built by Vite (see `checkViteBudgets`), measured
        // 2026-10-19: 15,686, then 15,376 / 464 / 1,362 / 515 / 8,059 / 996.
        // Each the usual ~300 above, rounded up to 50.
        vite: {
            maxGzipBytes: 16_000,
            entryBudgets: {
                '.': 15_700,
                './lite': 800,
                './core': 1_700,
                './lowering': 850,
                './split': 8_400,
                './merge': 1_300,
            },
        },
        // Each one reports csszyx's own output as wrong, an integrity check
        // failing, or prints only because the app turned `debug` on (ADR
        // 0011). A usage nudge belongs behind `NODE_ENV`, not in this list.
        productionMessages: [
            // The mangle map and recovery manifest are integrity inputs.
            'error: Failed to parse mangle map:',
            'error: Failed to parse recovery manifest:',
            'error: [csszyx] Mangle map failed schema validation (not a plai',
            // `verifyMangleChecksumAsync` saying why it answered false:
            // `web-crypto-unavailable`, built before the call, then
            // `mangle-checksum-mismatch` / `mangle-map-unavailable`, chosen
            // by the call, and `mangle-census-unreadable` for a census the
            // page carries but cannot read.
            'warn: <expr>',
            'warn: <expr>',
            'warn: [csszyx] mangle-census-unreadable: the mangle census on ',
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
        // Built by Vite, measured 2026-10-19: 10,659, then 10,373 / 7,800.
        vite: { maxGzipBytes: 11_000, entryBudgets: { '.': 10_700, './react': 8_100 } },
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
        excludeSubpaths: ['.', './engine', './internal', './migrate'],
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
            './sz-limits': 650,
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
                './sz-limits': 700,
                './keyword-families': 1_050,
                './bool-class': 750,
                './color-var': 600,
                './spacing-var': 1_050,
            },
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
            // A colour key's slash-opacity string (`bg: 'red-500/50'`), which
            // emits nothing; the build reports it as `slash-opacity-string`.
            'warn: [csszyx] ',
            // A gradient layer on `mask` (`mask: 'linear-45'`), which emits
            // nothing; the build reports it as `moved-value`.
            'warn: [csszyx] mask: ',
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
        maxGzipBytes: 582_400,
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
    {
        name: '@csszyx/vscode extension bundle',
        kind: 'file',
        target: 'packages/vscode/dist/extension.js',
        maxGzipBytes: 51_500,
    },
    // What Node loads for the two entries the build tools import: the engine
    // calls and the diagnostic renderer, which reads the diagnostic registry
    // and the key tables. Measured 2026-10-19 from a fresh process, p50 of 30
    // each: importing `./engine` took 1.76 ms at 6,631 gzip bytes, 4.69 ms
    // once the renderer pulled the whole browser lowering in for its tables
    // (49,614), and 3.61 ms after the tables moved to their own module
    // (30,115). `./internal` measured 33,093 the same day. Budgets the usual
    // ~300 above the measurement.
    {
        name: '@csszyx/compiler `./engine`, loaded by Node',
        kind: 'node-entry',
        target: 'packages/compiler',
        subpath: './engine',
        maxGzipBytes: 30_400,
    },
    {
        name: '@csszyx/compiler `./internal`, loaded by Node',
        kind: 'node-entry',
        target: 'packages/compiler',
        subpath: './internal',
        maxGzipBytes: 33_400,
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
        metafile: true,
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
        for (const problem of moduleOrderProblems(modulesBySubpath.get(subpath) ?? [], prefixes)) {
            failures.push(
                `${name}: \`${subpath}\` ${problem}. The order keeps tables within gzip's ` +
                    'reach of the code that repeats their keys; restore it in the import order ' +
                    'or the chunk groups before moving the budget.',
            );
        }
    }
    return failures;
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
    const { build } = await import('vite');
    const manifest = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
    const external = ['@csszyx', ...Object.keys(manifest.peerDependencies ?? {})];
    // An app's entry exports nothing, so a namespace has to be used to stay.
    const contents = entryPaths
        .map((entry, i) => `import * as e${i} from ${JSON.stringify(entry)};`)
        .concat(`globalThis.__csszyxSizeGate = [${entryPaths.map((_, i) => `e${i}`).join(', ')}];`)
        .join('\n');
    // One output, so one result: a watcher or a list would fail on `.output`.
    const { output } = await build({
        configFile: false,
        root: packageDir,
        publicDir: false,
        logLevel: 'silent',
        mode: 'production',
        define: { 'process.env.NODE_ENV': '"production"' },
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
            } else if (budget.kind === 'file') {
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

async function main() {
    const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const { results, failures } = checkBudgets(SIZE_BUDGETS, rootDir);
    const vite = await checkViteBudgets(SIZE_BUDGETS, rootDir);
    results.push(...vite.results);
    failures.push(...vite.failures);
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
    await main();
}
