# csszyx

## [0.15.1](https://github.com/nguyennhutien/csszyx/compare/v0.15.0...v0.15.1) (2026-09-01)

### Bug Fixes

* stop one failure costing more than the thing that failed ([#260](https://github.com/nguyennhutien/csszyx/issues/260))
* **unplugin:** keep a component out of the Tailwind entry list ([#260](https://github.com/nguyennhutien/csszyx/issues/260))
* **unplugin:** replace the safelist file instead of writing through it ([#260](https://github.com/nguyennhutien/csszyx/issues/260))
* **unplugin:** say when the generated safelist could not be written ([#260](https://github.com/nguyennhutien/csszyx/issues/260))
* **cli:** charge a refused HTML file to itself, not to the whole run ([#260](https://github.com/nguyennhutien/csszyx/issues/260))
* **core,compiler:** give the too-old binding advice that can work ([#260](https://github.com/nguyennhutien/csszyx/issues/260))

## [0.15.0](https://github.com/nguyennhutien/csszyx/compare/v0.14.5...v0.15.0) (2026-08-31)

### ⚠ BREAKING CHANGES

* `production.mangleMapDelivery` is removed. There is one delivery — a registration module inside the JS bundle — on Vite, Rollup and webpack alike, so no build emits an executable inline `<script>` for the mangle map and a strict `script-src 'self'` policy needs no exception. A config still setting the option is warned once and the value ignored; delete the line, and drop any import of the `MangleMapDelivery` type from `@csszyx/types/config`, which is gone with it. `window.__csszyx` is no longer installed by default — set `production.mangleDebugGlobal: true` to get it, or read `getMangleRegistry()` from `@csszyx/runtime`. A build with mangling off (the default) installs nothing on `window`. ([#250](https://github.com/nguyennhutien/csszyx/issues/250))
* **core:** the mangle checksum is computed over a different canonical form, so every checksum value changes. A page keeps its build's checksum embedded in it and the runtime that verifies it ships alongside, so an upgrade needs no action; a checksum recorded outside a build — a fixture, a snapshot, a monitoring baseline — has to be re-taken. ([#250](https://github.com/nguyennhutien/csszyx/issues/250))
* **cli:** `csszyx migrate` requires the `@csszyx/core-<platform>` package and no longer falls back to a TypeScript implementation, so it fails on a platform with no prebuilt binary or after an install that skipped optional packages. `CSSZYX_MIGRATE_ENGINE` is gone: there is one engine to select. `migrateSource` and `classNameToSzObject` keep their names and shapes but throw when that package is absent. ([#255](https://github.com/nguyennhutien/csszyx/issues/255))
* **unplugin:** the safelist is written to `.csszyx/csszyx-classes.txt` instead of `csszyx-classes.html`. Remove any hand-written `@source "…/csszyx-classes.html"`: the bundler plugins inject the directive, and a Next.js project gets it from `@csszyx/unplugin/postcss` listed before `@tailwindcss/postcss` in `postcss.config`, with `@csszyx/unplugin` as a direct dependency. A build whose stylesheet still names the old file fails with this guidance. Ignore, lint-ignore and clean entries for `csszyx-classes.html` can go; `.csszyx/` covers the new file. A project that passes its own `--output-file` or `safelistOutputFile` keeps it, and lists that file in the PostCSS plugin's `safelistFiles`. ([#258](https://github.com/nguyennhutien/csszyx/issues/258))

### Features

* deliver the mangle map inside the bundle instead of an inline script ([#250](https://github.com/nguyennhutien/csszyx/issues/250))
* register the runtime mangle map from the bundle, not an inline script ([#250](https://github.com/nguyennhutien/csszyx/issues/250))
* drop the inline mangle installer from every lane and remove the delivery option ([#250](https://github.com/nguyennhutien/csszyx/issues/250))
* **cli:** run migrate on the engine only, and delete the TypeScript one ([#255](https://github.com/nguyennhutien/csszyx/issues/255))
* **core:** answer the class-level migrate question from the engine ([#255](https://github.com/nguyennhutien/csszyx/issues/255))
* **unplugin:** move the safelist to .csszyx/csszyx-classes.txt ([#258](https://github.com/nguyennhutien/csszyx/issues/258))
* **unplugin:** add a PostCSS plugin that points Tailwind at the safelist ([#258](https://github.com/nguyennhutien/csszyx/issues/258))
* **cli:** wire the csszyx PostCSS plugin into Next.js projects ([#258](https://github.com/nguyennhutien/csszyx/issues/258))

### Bug Fixes

* **unplugin:** register the mangle map from the webpack build, not from imports ([#250](https://github.com/nguyennhutien/csszyx/issues/250))
* **runtime:** decode an element's classes from its class attribute ([#250](https://github.com/nguyennhutien/csszyx/issues/250))
* **runtime:** read the checksum attribute the build actually writes ([#250](https://github.com/nguyennhutien/csszyx/issues/250))
* **runtime:** derive the checksum the way the Rust core derives it ([#250](https://github.com/nguyennhutien/csszyx/issues/250))
* **core:** make the mangle checksum tell two different maps apart ([#250](https://github.com/nguyennhutien/csszyx/issues/250))
* **runtime:** order names by the bytes that get hashed ([#250](https://github.com/nguyennhutien/csszyx/issues/250))
* **unplugin:** let the Turbopack loader yield to a running watcher ([#253](https://github.com/nguyennhutien/csszyx/issues/253))
* **core:** tell a migrate user what this install actually needs ([#255](https://github.com/nguyennhutien/csszyx/issues/255))
* **core:** let the loader answer for what the caller needed ([#255](https://github.com/nguyennhutien/csszyx/issues/255))
* **core:** say what a migrate user can do, in the layer that knows ([#255](https://github.com/nguyennhutien/csszyx/issues/255))
* **cli:** keep a migrate run answering when it cannot do the job ([#255](https://github.com/nguyennhutien/csszyx/issues/255))
* **core:** say what the native engine is missing, what to do and what still holds ([#256](https://github.com/nguyennhutien/csszyx/issues/256))
* **unplugin:** stop a growing safelist from reloading the dev page ([#257](https://github.com/nguyennhutien/csszyx/issues/257))
* **unplugin:** compare the safelist path the way Vite reports it ([#257](https://github.com/nguyennhutien/csszyx/issues/257))
* **cli:** install @csszyx/unplugin for Next.js and keep every PostCSS config Next reads ([#258](https://github.com/nguyennhutien/csszyx/issues/258))
* **unplugin:** recognise every legacy safelist csszyx wrote, and only those ([#258](https://github.com/nguyennhutien/csszyx/issues/258))
* **unplugin:** have PostCSS watch the safelist directory ([#258](https://github.com/nguyennhutien/csszyx/issues/258))
* **unplugin:** stop a Next.js upgrade whose stylesheet still names the old safelist ([#259](https://github.com/nguyennhutien/csszyx/issues/259))
* **unplugin:** refuse to run the PostCSS plugin after Tailwind ([#259](https://github.com/nguyennhutien/csszyx/issues/259))
* **compiler:** keep the loader's diagnosis when migrate cannot use the native engine ([#259](https://github.com/nguyennhutien/csszyx/issues/259))
* **compiler:** read type-only and from-clause re-exports as the AST walker did ([#259](https://github.com/nguyennhutien/csszyx/issues/259))
* **cli:** install the Tailwind PostCSS adapter the written config names ([#259](https://github.com/nguyennhutien/csszyx/issues/259))
* **unplugin:** name the safelist from a stylesheet that imports Tailwind through another file ([#259](https://github.com/nguyennhutien/csszyx/issues/259))

### Performance

* **vscode:** share one TypeScript environment across the drift table ([#254](https://github.com/nguyennhutien/csszyx/issues/254))
* **unplugin:** merge the CSS variable maps when read, not on every write ([#255](https://github.com/nguyennhutien/csszyx/issues/255))
* **cli:** migrate in runs of 25 files or 2 MiB instead of one call ([#255](https://github.com/nguyennhutien/csszyx/issues/255))
* **compiler:** parse only modules that can carry a forward, and parse cheaper ([#255](https://github.com/nguyennhutien/csszyx/issues/255))
* **unplugin:** build RSC module records only when a server module exists ([#255](https://github.com/nguyennhutien/csszyx/issues/255))

## [0.14.5](https://github.com/nguyennhutien/csszyx/compare/v0.14.4...v0.14.5) (2026-08-25)

### Features

* **cli:** run migrate on the native engine by default, falling back when absent ([#245](https://github.com/nguyennhutien/csszyx/issues/245))
* **cli:** run migrate on the native Rust core behind CSSZYX_MIGRATE_ENGINE=rust ([#245](https://github.com/nguyennhutien/csszyx/issues/245))

### Bug Fixes

* **cli:** stop migrate writing later tokens into the resolution map ([#245](https://github.com/nguyennhutien/csszyx/issues/245))
* **cli:** let a resolve pass merge into the sz prop an earlier migration wrote ([#245](https://github.com/nguyennhutien/csszyx/issues/245))
* **core:** keep the font-stretch rule the sz-key path needs ([#245](https://github.com/nguyennhutien/csszyx/issues/245))
* **cli:** resolve a legacy font value, not only its key ([#245](https://github.com/nguyennhutien/csszyx/issues/245))
* **compiler:** report a font weight written as a string instead of emitting a dead class ([#245](https://github.com/nguyennhutien/csszyx/issues/245))
* **cli:** see a call written with optional chaining ([#245](https://github.com/nguyennhutien/csszyx/issues/245))
* **core:** spell a number the way JavaScript spells it ([#245](https://github.com/nguyennhutien/csszyx/issues/245))
* **core:** state the number invariant instead of handling it ([#245](https://github.com/nguyennhutien/csszyx/issues/245))

## [0.14.4](https://github.com/nguyennhutien/csszyx/compare/v0.14.3...v0.14.4) (2026-08-22)

### Features

* **mcp-server:** compile the reverse answer back before returning it ([#243](https://github.com/nguyennhutien/csszyx/issues/243))

### Bug Fixes

* compile breakpoints and font-stretch the same on every engine, and run the CLI on Windows ([#243](https://github.com/nguyennhutien/csszyx/issues/243))
* **core:** lower min and max breakpoints as one variant on the native engine ([#243](https://github.com/nguyennhutien/csszyx/issues/243))
* **compiler:** lower fontStretch keywords under the font-stretch prefix ([#243](https://github.com/nguyennhutien/csszyx/issues/243))
* **cli:** read a Windows-style --pattern and emit posix paths everywhere ([#243](https://github.com/nguyennhutien/csszyx/issues/243))
* **cli:** register the Next watch root under its canonical name ([#243](https://github.com/nguyennhutien/csszyx/issues/243))

## [0.14.3](https://github.com/nguyennhutien/csszyx/compare/v0.14.2...v0.14.3) (2026-08-22)

### Bug Fixes

* **cli:** keep a migrated file's line endings ([#240](https://github.com/nguyennhutien/csszyx/issues/240))

## [0.14.2](https://github.com/nguyennhutien/csszyx/compare/v0.14.1...v0.14.2) (2026-08-21)

### Features

* compile a style whose other branch is nothing ([#237](https://github.com/nguyennhutien/csszyx/issues/237))
* precompile an szv branch that nests a variant csszyx cannot name ([#237](https://github.com/nguyennhutien/csszyx/issues/237))
* compile a conditional whose else-branch is another conditional ([#237](https://github.com/nguyennhutien/csszyx/issues/237))
* read a style through a module that re-exports it ([#237](https://github.com/nguyennhutien/csszyx/issues/237))
* **compiler:** report an element whose className and sz precedence is unstated ([#237](https://github.com/nguyennhutien/csszyx/issues/237))
* **unplugin:** report a utility block that claims a name twice ([#237](https://github.com/nguyennhutien/csszyx/issues/237))
* **cli:** report an sz value that belongs to a sibling key ([#237](https://github.com/nguyennhutien/csszyx/issues/237))
* **cli:** fail the check on a theme token that shadows a built-in ([#237](https://github.com/nguyennhutien/csszyx/issues/237))
* **cli:** give check a file list, a JSON report and line numbers ([#237](https://github.com/nguyennhutien/csszyx/issues/237))

### Bug Fixes

* check a file list, name a colliding theme token, and stop passing on work not done ([#237](https://github.com/nguyennhutien/csszyx/issues/237))
* stop lowering a runtime value Tailwind cannot read ([#237](https://github.com/nguyennhutien/csszyx/issues/237))
* name the szv factory an sz attribute could not precompile ([#237](https://github.com/nguyennhutien/csszyx/issues/237))
* point a refused szv config at the property that refused it ([#237](https://github.com/nguyennhutien/csszyx/issues/237))
* drop a border style Tailwind cannot spell per side ([#237](https://github.com/nguyennhutien/csszyx/issues/237))
* **compiler:** keep the wasm core out of the import graph ([#237](https://github.com/nguyennhutien/csszyx/issues/237))
* **compiler:** precompile an szv branch that sets a boolean flag ([#237](https://github.com/nguyennhutien/csszyx/issues/237))
* **compiler:** report removed boolean sugar where it is written ([#237](https://github.com/nguyennhutien/csszyx/issues/237))
* **runtime:** block the theme names Tailwind reads two ways ([#237](https://github.com/nguyennhutien/csszyx/issues/237))
* **runtime:** stop calling the shadowed-token fallback safe ([#237](https://github.com/nguyennhutien/csszyx/issues/237))
* **cli:** check the bg key for values another background key owns ([#237](https://github.com/nguyennhutien/csszyx/issues/237))
* **cli:** generate migrate's reverse map from the compiler's property map ([#237](https://github.com/nguyennhutien/csszyx/issues/237))
* **vscode:** read sz object text without a JavaScript parser ([#237](https://github.com/nguyennhutien/csszyx/issues/237))
* **unplugin:** strip css comments without a quadratic scan ([#237](https://github.com/nguyennhutien/csszyx/issues/237))
* **cli:** fail the check on a listed file it could not read ([#237](https://github.com/nguyennhutien/csszyx/issues/237))
* **cli:** order css entries by the separator fast-glob actually returns ([#237](https://github.com/nguyennhutien/csszyx/issues/237))

### Performance

* **cli:** load a command only when it is the one being run ([#237](https://github.com/nguyennhutien/csszyx/issues/237))

## [0.14.1](https://github.com/nguyennhutien/csszyx/compare/v0.14.0...v0.14.1) (2026-08-16)

### Features

* read a style a module shares, however it exports it ([#234](https://github.com/nguyennhutien/csszyx/issues/234))
* **tooling:** benchmark external app build artifacts ([#234](https://github.com/nguyennhutien/csszyx/issues/234))
* **ts-plugin:** complete generated theme value suggestions ([#234](https://github.com/nguyennhutien/csszyx/issues/234))
* **core:** read a token map an sz value imports from another module ([#234](https://github.com/nguyennhutien/csszyx/issues/234))
* **compiler:** record a value the module exports through a list ([#234](https://github.com/nguyennhutien/csszyx/issues/234))
* resolve a style a module exports as its default ([#234](https://github.com/nguyennhutien/csszyx/issues/234))
* read a style through a namespace import ([#234](https://github.com/nguyennhutien/csszyx/issues/234))

### Bug Fixes

* **compiler:** drop removed sz aliases instead of dead classes ([#234](https://github.com/nguyennhutien/csszyx/issues/234))
* **cli:** watch source files inside a directory that appears mid-session ([#234](https://github.com/nguyennhutien/csszyx/issues/234))
* keep changed lines within the limits the services enforce ([#234](https://github.com/nguyennhutien/csszyx/issues/234))
* **ts-plugin:** align the type surface with the engine floor it declares ([#234](https://github.com/nguyennhutien/csszyx/issues/234))
* **cli:** wait for the signal handler instead of guessing when it exists ([#236](https://github.com/nguyennhutien/csszyx/issues/236))

## [0.14.0](https://github.com/nguyennhutien/csszyx/compare/v0.13.0...v0.14.0) (2026-08-14)

### ⚠ BREAKING CHANGES

* one engine, two artifacts — remove the babel and oxc parser lanes ([#216](https://github.com/nguyennhutien/csszyx/issues/216))
* **unplugin:** `build.parser` and `CSSZYX_PARSER` accept `'rust'` and `'wasm'` only. The `'oxc'` and `'babel'` values are gone, along with the oxc transform branch, the oxc→Babel compatibility fallback, and the degrade-to-oxc last resort. A config still saying `'oxc'`/`'babel'` (reachable from untyped JavaScript) is ignored like an invalid env var: the build runs on the default and the active-parser banner names the lane that actually ran. ([#216](https://github.com/nguyennhutien/csszyx/issues/216))
* **compiler:** transformSourceCode, transformOxc, OxcNotImplementedError, TransformOxcResult, hoistCSSVariables, buildParentMap and CSSVarUsage are no longer exported. transform.ts (the Babel lane), transform-oxc.ts (the oxc lane) and hoisting.ts are deleted; the contract types (SourceTransformResult, TransformSourceCodeOptions, GlobalVarAliasTableInput, CssVariableMangleValue) now live in transform-core. Callers that just want a transform use the new transformSource, which picks the native addon when the host has one and the wasm build otherwise — the same signature transformSourceCode had, so most migrations are a rename. The CLI project scan and the MCP compile preview migrated exactly that way. ([#216](https://github.com/nguyennhutien/csszyx/issues/216))

### Features

* ship the native engine's wasm build as the parser fallback lane ([#215](https://github.com/nguyennhutien/csszyx/issues/215))
* **unplugin:** say how many fallbacks the build did not list ([#215](https://github.com/nguyennhutien/csszyx/issues/215))
* **core:** compile the transform engine to wasm as pkg-parser ([#215](https://github.com/nguyennhutien/csszyx/issues/215))
* **compiler:** expose the wasm engine as a lane ([#215](https://github.com/nguyennhutien/csszyx/issues/215))
* **unplugin:** degrade the default rust parser to its wasm build ([#215](https://github.com/nguyennhutien/csszyx/issues/215))
* **core:** put the parser wasm artifact under performance gates ([#215](https://github.com/nguyennhutien/csszyx/issues/215))
* one engine, two artifacts — remove the babel and oxc parser lanes ([#216](https://github.com/nguyennhutien/csszyx/issues/216))
* **unplugin:** run on the engine's two artifacts only ([#216](https://github.com/nguyennhutien/csszyx/issues/216))
* **compiler:** one engine, two artifacts — the TypeScript parser lanes are gone ([#216](https://github.com/nguyennhutien/csszyx/issues/216))
* **core:** check catalog keys the way an sz prop is checked ([#216](https://github.com/nguyennhutien/csszyx/issues/216))
* **core:** suggest the canonical key from engine diagnostics ([#216](https://github.com/nguyennhutien/csszyx/issues/216))

### Bug Fixes

* **unplugin:** detect source() wherever it sits in the import ([#215](https://github.com/nguyennhutien/csszyx/issues/215))
* **unplugin:** describe the scan that happens, not a worse one ([#215](https://github.com/nguyennhutien/csszyx/issues/215))
* **unplugin:** weigh the class shortening the advisory disclaimed ([#215](https://github.com/nguyennhutien/csszyx/issues/215))
* **unplugin:** print the size verdict after the asset table ([#215](https://github.com/nguyennhutien/csszyx/issues/215))
* **cli:** resolve stylesheet imports that name a package ([#215](https://github.com/nguyennhutien/csszyx/issues/215))
* **cli:** fail when the dead-class check could not run ([#215](https://github.com/nguyennhutien/csszyx/issues/215))
* **compiler:** compile a colour-fusion op inside its own property ([#215](https://github.com/nguyennhutien/csszyx/issues/215))
* **unplugin:** stop promising the parser fallback keeps classes ([#215](https://github.com/nguyennhutien/csszyx/issues/215))
* **cli:** read the engine's diagnostics instead of a console latch ([#216](https://github.com/nguyennhutien/csszyx/issues/216))
* **core:** drop a redundant clone the strict clippy gate rejects ([#216](https://github.com/nguyennhutien/csszyx/issues/216))
* the 0.14.0 defect queue ([#222](https://github.com/nguyennhutien/csszyx/issues/222))
* **compiler:** name the disqualifying config position in the szr factory fallback ([#222](https://github.com/nguyennhutien/csszyx/issues/222))
* **cli:** judge opacity modifiers from the compiled rule, not the token's text ([#222](https://github.com/nguyennhutien/csszyx/issues/222))
* **compiler:** add a runtime resolver for dynamic boolean-only keys ([#222](https://github.com/nguyennhutien/csszyx/issues/222))
* **engine:** lower a dynamic boolean-only key to a conditional class ([#222](https://github.com/nguyennhutien/csszyx/issues/222))
* **unplugin:** mangle before the bundler hashes the output ([#222](https://github.com/nguyennhutien/csszyx/issues/222))
* **cli:** prove the watcher delivers before reporting ready ([#222](https://github.com/nguyennhutien/csszyx/issues/222))
* **engine:** read a static value off a constant map ([#222](https://github.com/nguyennhutien/csszyx/issues/222))

## [0.13.0](https://github.com/nguyennhutien/csszyx/compare/v0.12.0...v0.13.0) (2026-08-11)

### ⚠ BREAKING CHANGES

* compile sz objects a component imports from another module ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **unplugin:** `shouldEmitWarning`, `shouldEmitMissingCssFallback` and `emitMissingCssFallback` now type their first parameter as the resolved `QuietMode` rather than the authored option. TypeScript callers passing a boolean should pass `resolveQuietMode(value)` instead; the runtime still accepts a boolean, so JavaScript callers are unaffected. ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **unplugin:** `csszyx-manifest.json` is no longer emitted by default. An app using `@csszyx/dynamic` that relies on it must set `build: { emitManifest: true }` and await `preloadManifest()` before its first render; run `dynamicReport()` from `@csszyx/dynamic` to check whether the file earns its transfer on that app. Apps that do not use `dynamic()` need no change. ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* `build.importedStaticSz` defaults to true. A component that imports a static sz object now compiles it instead of resolving it at runtime. Set it to false to keep the previous behaviour, and pass `--no-imported-static-sz` to `csszyx next prebuild` and `csszyx next watch` so the Next lanes agree. ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **types:** `performance` and its four options (`parallel`, `workers`, `optimizeVariables`, `zeroRuntime`) are removed, along with `production.contentHashing`, `production.incrementalBuild`, `build.tailwindConfig`, `hydration.auditLog` and `hydration.defaultRecoveryMode`. Remove them from your plugin config; none of them affected the build. `PerformanceConfig` and `DEFAULT_PERFORMANCE_CONFIG` are no longer exported. ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **compiler:** `OxcNotImplementedError` takes only the construct description. The first argument was a planning label that no caller read — every consumer catches the type and reads `detail` — and it was the reason the label reached build logs at all. ([#206](https://github.com/nguyennhutien/csszyx/issues/206))

### Features

* compile sz objects a component imports from another module ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **unplugin:** let quiet keep the reports that matter ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **unplugin:** precompile imported szv factories in watch modes too ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **dynamic:** report whether the manifest paid for itself ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **unplugin:** type the quiet gates as the resolved mode ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **unplugin:** emit the dynamic manifest only when asked ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **mcp:** preview what csszyx compiles a whole module into ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **cli:** ask the project's own Tailwind which emitted classes are real ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **cli:** load the plugins a project stylesheet asks for ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **cli:** let a project vouch for a class the stylesheet cannot show ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **compiler:** read exported static sz objects into the registry extractor ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* compile a static sz object that a component imports ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **unplugin:** refresh szcn theme groups live on the Turbopack lane ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **runtime:** give the theme group registry a full lifecycle ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* compile imported static sz objects by default ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **unplugin:** resolve cross-module style objects on the Turbopack lane ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **unplugin:** resolve imported style modules named through a project alias ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **compiler:** describe the code instead of the plan that produced it ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **types:** drop the config options nothing ever read ([#206](https://github.com/nguyennhutien/csszyx/issues/206))

### Bug Fixes

* **compiler:** compose the sz merge with the szv precompile ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **unplugin:** report a package skip that costs the szv registry ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **compiler:** bracket any CSS function value, not a list of names ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **unplugin:** stop reporting fallbacks csszyx caused by design ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **compiler:** keep a trailing variable shorthand out of the bracket rule ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **unplugin:** keep the quiet gates accepting the authored boolean ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **unplugin:** warn on a plugin option that will never be read ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **ts-plugin:** complete values after a quote at end of line ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **vscode:** stop flagging the parametric variants as unknown props ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **ts-plugin:** complete a key slot whose comma is not typed yet, and add it ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **compiler:** bracket a numeric font weight so it styles something ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **cli:** stop calling the group and peer markers dead classes ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **compiler:** surface an sz fallback that collected no classes ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **compiler:** stop folding a binding that is written to again ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **compiler:** unwrap a TS assertion written at the sz site ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **types:** accept a readonly array as an sz value ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **compiler:** report a lost import, not a forwarded prop ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **core:** keep an important modifier outside the arbitrary brackets ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **core:** tell the two szRecover failures apart on every engine ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **cli:** quote the apostrophe the way the compiler quotes it ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **runtime:** stop a colour from deleting a size on eight more prefixes ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **unplugin:** keep theme merge groups whole when scanCss narrows typing ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **cli:** ask every Tailwind entry before calling a class dead ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **unplugin:** register szcn theme groups on the Turbopack lane ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **unplugin:** register szcn theme groups on the webpack lane ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **unplugin:** create the theme-group registration at build start ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **unplugin:** give the rust prescan its per-file registry entries ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **compiler:** honour the quiet switch on the WASM color path ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **unplugin:** keep imported names out of Object.prototype ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **unplugin:** read a style module first imported mid dev session ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **unplugin:** refuse `__proto__` as a cross-module table key ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **compiler:** refuse an imported array where an sz object was expected ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **unplugin:** reload the page when a theme edit changes szcn groups ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **unplugin:** rewrite a Next safelist shard when its classes change ([#206](https://github.com/nguyennhutien/csszyx/issues/206))
* **csszyx:** serve browsers an umbrella entry they can bundle ([#206](https://github.com/nguyennhutien/csszyx/issues/206))

## [0.12.0](https://github.com/nguyennhutien/csszyx/compare/v0.11.11...v0.12.0) (2026-08-03)

### ⚠ BREAKING CHANGES

* compile-time variants, a compiler-free runtime entry, and opt-in mangling ([#190](https://github.com/nguyennhutien/csszyx/issues/190))
* **unplugin:** production.mangle now defaults to false. Builds relying on the implicit default keep their original class names; set `production: { mangle: true }` to restore mangling. ([#190](https://github.com/nguyennhutien/csszyx/issues/190))
* **compiler:** one way to declare each mask gradient class ([#190](https://github.com/nguyennhutien/csszyx/issues/190))

### Features

* compile-time variants, a compiler-free runtime entry, and opt-in mangling ([#190](https://github.com/nguyennhutien/csszyx/issues/190))
* **unplugin:** let a build choose where the mangle map ships ([#190](https://github.com/nguyennhutien/csszyx/issues/190))
* **unplugin:** make class mangling opt-in ([#190](https://github.com/nguyennhutien/csszyx/issues/190))
* **compiler:** emit the sz fallback matrix on every engine ([#190](https://github.com/nguyennhutien/csszyx/issues/190))
* **tooling-metadata:** suggest negative values where the utility allows them ([#190](https://github.com/nguyennhutien/csszyx/issues/190))
* **compiler:** report unresolvable szr, szv and szs through the shared matrix ([#190](https://github.com/nguyennhutien/csszyx/issues/190))
* **runtime:** compiler-free core entry with opt-in object lowering ([#190](https://github.com/nguyennhutien/csszyx/issues/190))
* **compiler:** rewrite proven string-only szr imports to the core entry ([#190](https://github.com/nguyennhutien/csszyx/issues/190))
* **runtime:** szv table picker for build-precompiled variants ([#190](https://github.com/nguyennhutien/csszyx/issues/190))
* **compiler:** precompile szv variant tables at qualifying szr call sites ([#190](https://github.com/nguyennhutien/csszyx/issues/190))
* **compiler:** split mixed import clauses when retargeting szr ([#190](https://github.com/nguyennhutien/csszyx/issues/190))
* **compiler:** cross-module szv registry for imported factory precompile ([#190](https://github.com/nguyennhutien/csszyx/issues/190))
* **runtime:** route provable szPart helpers through a compiler-free entry ([#190](https://github.com/nguyennhutien/csszyx/issues/190))
* **compiler:** model mask gradients as the three CSS layers they are ([#190](https://github.com/nguyennhutien/csszyx/issues/190))
* **core:** mirror the mask gradient slots in the Rust engine ([#190](https://github.com/nguyennhutien/csszyx/issues/190))
* **compiler:** one way to declare each mask gradient class ([#190](https://github.com/nguyennhutien/csszyx/issues/190))
* **ts-plugin:** assist the nested mask layer shapes ([#190](https://github.com/nguyennhutien/csszyx/issues/190))

### Bug Fixes

* **compiler:** join variant-key string values with a colon on every engine ([#190](https://github.com/nguyennhutien/csszyx/issues/190))
* **core:** stop reporting custom theme variant keys as typos ([#190](https://github.com/nguyennhutien/csszyx/issues/190))
* **compiler:** negative-selection parity, catalog idempotency, szv scan gate ([#190](https://github.com/nguyennhutien/csszyx/issues/190))
* **core:** mirror JS object key iteration order in szv table compilation ([#190](https://github.com/nguyennhutien/csszyx/issues/190))
* **compiler:** treat lowering fusions as conflicts in the szv precompile ([#190](https://github.com/nguyennhutien/csszyx/issues/190))
* **compiler:** stop claiming an unknown sz key is ignored ([#190](https://github.com/nguyennhutien/csszyx/issues/190))
* **runtime:** deep-merge adjacent sz objects in an array ([#190](https://github.com/nguyennhutien/csszyx/issues/190))
* **runtime:** key mask utilities by the variable they write ([#190](https://github.com/nguyennhutien/csszyx/issues/190))
* **core:** apply the mask layer merge rule in the Rust engine too ([#190](https://github.com/nguyennhutien/csszyx/issues/190))
* **compiler:** bracket a gradient function used as a mask image ([#190](https://github.com/nguyennhutien/csszyx/issues/190))
* **compiler:** treat a gradient function as an arbitrary background image ([#190](https://github.com/nguyennhutien/csszyx/issues/190))
* **types:** default production mangling off in the exported config ([#190](https://github.com/nguyennhutien/csszyx/issues/190))
* **deps:** block yaml and glob denial-of-service paths ([#194](https://github.com/nguyennhutien/csszyx/issues/194))

### Performance

* **core:** resolve diagnostic positions from a line table ([#190](https://github.com/nguyennhutien/csszyx/issues/190))
* **compiler:** prove guarded factory calls and ignore comment mentions ([#190](https://github.com/nguyennhutien/csszyx/issues/190))
* **runtime:** memoize szcn by argument and cache splitBox results ([#190](https://github.com/nguyennhutien/csszyx/issues/190))
* **compiler:** add a single-dimension szv picker ([#190](https://github.com/nguyennhutien/csszyx/issues/190))

## [0.11.11](https://github.com/nguyennhutien/csszyx/compare/v0.11.10...v0.11.11) (2026-07-23)

### Features

* deliver the runtime mangle map inside the bundle and encode runtime-resolved classes ([#180](https://github.com/nguyennhutien/csszyx/issues/180))
* **runtime:** encode runtime-resolved classes in szcn, expose szDecode ([#180](https://github.com/nguyennhutien/csszyx/issues/180))

### Bug Fixes

* preserve szs slots, typed ternaries, and CSS var reservations in the native engine ([#178](https://github.com/nguyennhutien/csszyx/issues/178))
* **core:** reject invalid radial gradient directions ([#178](https://github.com/nguyennhutien/csszyx/issues/178))
* **core:** preserve secondary collision names ([#178](https://github.com/nguyennhutien/csszyx/issues/178))
* **ts-plugin:** reject computed style ancestry ([#178](https://github.com/nguyennhutien/csszyx/issues/178))
* **compiler:** keep recovery tokens ESM-safe ([#178](https://github.com/nguyennhutien/csszyx/issues/178))
* **core:** retain CSS var reservations after escaped quotes ([#178](https://github.com/nguyennhutien/csszyx/issues/178))
* **core:** unwrap typed static sz ternaries ([#178](https://github.com/nguyennhutien/csszyx/issues/178))
* **core:** rewrite component szs slots behind the AST-free triage ([#178](https://github.com/nguyennhutien/csszyx/issues/178))
* **unplugin:** deliver the runtime mangle map inside the bundle ([#180](https://github.com/nguyennhutien/csszyx/issues/180))
* **unplugin:** reserve census class names from the mangle token space ([#180](https://github.com/nguyennhutien/csszyx/issues/180))
* **unplugin:** require the eval-devtool pragma before double-escaping ([#180](https://github.com/nguyennhutien/csszyx/issues/180))
* **unplugin:** keep the runtime mangle map out of webpack dev builds ([#180](https://github.com/nguyennhutien/csszyx/issues/180))
* **unplugin:** restrict bundle map delivery to rollup-convention bundlers ([#180](https://github.com/nguyennhutien/csszyx/issues/180))

### Performance

* **runtime:** read the mangle bridge once per merge ([#180](https://github.com/nguyennhutien/csszyx/issues/180))
* **unplugin:** order the injection guards by cost ([#180](https://github.com/nguyennhutien/csszyx/issues/180))
* **unplugin:** memoize the Base62 token encoder across finalizes ([#180](https://github.com/nguyennhutien/csszyx/issues/180))

## [0.11.10](https://github.com/nguyennhutien/csszyx/compare/v0.11.9...v0.11.10) (2026-07-19)

### Features

* **core:** compile any number of sz property conditionals statically ([#169](https://github.com/nguyennhutien/csszyx/issues/169))

### Bug Fixes

* correct slash-modifier handling across engines and adopt current toolchain majors ([#169](https://github.com/nguyennhutien/csszyx/issues/169))
* **core:** stop the rust parser silently dropping or inventing sz classes ([#169](https://github.com/nguyennhutien/csszyx/issues/169))
* **compiler:** resolve as-cast literals in conditional sz branches ([#169](https://github.com/nguyennhutien/csszyx/issues/169))
* **compiler:** lower className merges natively in the oxc and babel lanes ([#169](https://github.com/nguyennhutien/csszyx/issues/169))
* **unplugin:** keep internal slice labels out of the Babel-fallback warning ([#169](https://github.com/nguyennhutien/csszyx/issues/169))
* **compiler:** converge the color-opacity conditional lane and punt-path safelists ([#169](https://github.com/nguyennhutien/csszyx/issues/169))
* **core:** merge a single ternary with statics as the Babel template ([#169](https://github.com/nguyennhutien/csszyx/issues/169))
* **deps:** move published runtime deps to current majors ([#169](https://github.com/nguyennhutien/csszyx/issues/169))
* **runtime:** drop leaked esbuild binary from optional deps ([#169](https://github.com/nguyennhutien/csszyx/issues/169))
* **compiler:** route shadow-family var colors through the color hint ([#169](https://github.com/nguyennhutien/csszyx/issues/169))
* **cli:** stop misreading slash modifiers as color opacity in migrate ([#169](https://github.com/nguyennhutien/csszyx/issues/169))
* **core:** emit named group and peer markers as slash classes ([#169](https://github.com/nguyennhutien/csszyx/issues/169))
* **cli:** split font-size line-height shorthand into text plus leading ([#169](https://github.com/nguyennhutien/csszyx/issues/169))
* **compiler:** give unitless line-height a bracket-free sz spelling ([#169](https://github.com/nguyennhutien/csszyx/issues/169))
* **compiler:** warn when a spacing number is not a quarter step ([#169](https://github.com/nguyennhutien/csszyx/issues/169))
* **compiler:** warn when a property key receives an object value ([#169](https://github.com/nguyennhutien/csszyx/issues/169))
* **core:** move the native engine to current oxc, napi, and rust ([#169](https://github.com/nguyennhutien/csszyx/issues/169))
* **compiler:** adopt the new babel major and raise the engines floor ([#169](https://github.com/nguyennhutien/csszyx/issues/169))
* harden runtime CSS and dependency security ([#172](https://github.com/nguyennhutien/csszyx/issues/172))

## [0.11.9](https://github.com/nguyennhutien/csszyx/compare/v0.11.8...v0.11.9) (2026-07-16)

### Bug Fixes

* register custom theme colors for szcn without scanCss ([#163](https://github.com/nguyennhutien/csszyx/issues/163))
* **unplugin:** discover @theme tokens without scanCss and accept option keywords ([#163](https://github.com/nguyennhutien/csszyx/issues/163))
* **runtime:** classify data-type-hinted css variables in szcn ([#163](https://github.com/nguyennhutien/csszyx/issues/163))
* restore sitewide search under the docs CSP hardening headers ([#167](https://github.com/nguyennhutien/csszyx/issues/167))
* **docs:** unbreak sitewide search under the CSP hardening headers ([#167](https://github.com/nguyennhutien/csszyx/issues/167))
* **docs:** allow the Cloudflare Web Analytics beacon through the CSP ([#167](https://github.com/nguyennhutien/csszyx/issues/167))

## [0.11.8](https://github.com/nguyennhutien/csszyx/compare/v0.11.7...v0.11.8) (2026-07-16)

### Bug Fixes

* resolve vui 0.11.7 issues and hybrid production mangling ([#160](https://github.com/nguyennhutien/csszyx/issues/160))
* **compiler:** omit nullable dynamic utilities ([#160](https://github.com/nguyennhutien/csszyx/issues/160))
* **compiler:** warn on spread style collisions ([#160](https://github.com/nguyennhutien/csszyx/issues/160))
* **compiler:** preserve raw class discovery order ([#160](https://github.com/nguyennhutien/csszyx/issues/160))
* **runtime:** align generated class merging with szcn ([#160](https://github.com/nguyennhutien/csszyx/issues/160))
* **compiler:** precompile finite ternaries in sz arrays ([#160](https://github.com/nguyennhutien/csszyx/issues/160))
* **compiler:** preserve style through safe prop spreads ([#160](https://github.com/nguyennhutien/csszyx/issues/160))
* **compiler:** recognize boolean text overflow keys ([#160](https://github.com/nguyennhutien/csszyx/issues/160))
* **compiler:** recognize css escape hatch in diagnostics ([#160](https://github.com/nguyennhutien/csszyx/issues/160))
* **unplugin:** preserve arbitrary variants in safelists ([#160](https://github.com/nguyennhutien/csszyx/issues/160))
* **unplugin:** retain exact arbitrary selector bytes ([#160](https://github.com/nguyennhutien/csszyx/issues/160))
* **compiler:** serialize quoted arbitrary variants safely ([#160](https://github.com/nguyennhutien/csszyx/issues/160))
* **tooling:** sync text overflow keys ([#160](https://github.com/nguyennhutien/csszyx/issues/160))
* **runtime:** reject object variant selections cleanly ([#160](https://github.com/nguyennhutien/csszyx/issues/160))
* **cli:** drop unsupported codegen values ([#160](https://github.com/nguyennhutien/csszyx/issues/160))
* **mcp-server:** show quoted theme CSS literally ([#160](https://github.com/nguyennhutien/csszyx/issues/160))
* **runtime:** retain lite input alias compatibility ([#160](https://github.com/nguyennhutien/csszyx/issues/160))
* **tooling:** route playground lint locally ([#160](https://github.com/nguyennhutien/csszyx/issues/160))
* **unplugin:** preserve shared raw class names ([#160](https://github.com/nguyennhutien/csszyx/issues/160))
* **unplugin:** harden raw class ownership scan ([#160](https://github.com/nguyennhutien/csszyx/issues/160))
* **unplugin:** align standalone bundler mangling ([#160](https://github.com/nguyennhutien/csszyx/issues/160))
* **unplugin:** close raw scanner lexical gaps ([#160](https://github.com/nguyennhutien/csszyx/issues/160))

## [0.11.7](https://github.com/nguyennhutien/csszyx/compare/v0.11.6...v0.11.7) (2026-07-14)

### Bug Fixes

* resolve dynamic spacing and unit values the way the static path would ([#150](https://github.com/nguyennhutien/csszyx/issues/150))

## [0.11.6](https://github.com/nguyennhutien/csszyx/compare/v0.11.5...v0.11.6) (2026-07-13)

### Bug Fixes

* emit negative spacing CSS at runtime, drop the dead attributes field, surface MCP validate warnings ([#148](https://github.com/nguyennhutien/csszyx/issues/148))
* **dynamic:** emit CSS for negative spacing utilities at runtime ([#148](https://github.com/nguyennhutien/csszyx/issues/148))
* drop the never-populated attributes field from transform results ([#148](https://github.com/nguyennhutien/csszyx/issues/148))
* **mcp-server:** surface compiler warnings from the validate tool ([#148](https://github.com/nguyennhutien/csszyx/issues/148))

## [0.11.5](https://github.com/nguyennhutien/csszyx/compare/v0.11.4...v0.11.5) (2026-07-12)

### Bug Fixes

* hoist CSS vars on parsed ASTs, merge Vue :class shorthand, raise all packages to 90%+ coverage ([#144](https://github.com/nguyennhutien/csszyx/issues/144))
* **compiler:** find hoisting ancestors in parsed ASTs ([#144](https://github.com/nguyennhutien/csszyx/issues/144))
* **vue-adapter:** merge the :class shorthand — \b can never precede a colon ([#144](https://github.com/nguyennhutien/csszyx/issues/144))

## [0.11.4](https://github.com/nguyennhutien/csszyx/compare/v0.11.3...v0.11.4) (2026-07-10)

### Features

* sz/szv/szs editor autocomplete via a TypeScript language-service plugin ([#138](https://github.com/nguyennhutien/csszyx/issues/138))
* **ts-plugin:** sz/szv/szs autocomplete via a TypeScript language-service plugin ([#138](https://github.com/nguyennhutien/csszyx/issues/138))
* **ts-plugin:** bounded sz completions, bundled metadata, extension coexistence ([#138](https://github.com/nguyennhutien/csszyx/issues/138))
* **vscode:** bundle @csszyx/ts-plugin for zero-config sz completions ([#138](https://github.com/nguyennhutien/csszyx/issues/138))
* **ts-plugin:** decorate typed-position collisions, gate property nesting, preselect values ([#138](https://github.com/nguyennhutien/csszyx/issues/138))
* **vscode:** trigger-character companion for the moments tsserver cannot open ([#138](https://github.com/nguyennhutien/csszyx/issues/138))
* **completions:** token-relationship awareness shared by both providers ([#138](https://github.com/nguyennhutien/csszyx/issues/138))
* **completions:** assist structured object values instead of silencing them ([#138](https://github.com/nguyennhutien/csszyx/issues/138))

### Bug Fixes

* **ts-plugin:** escape backslashes before quotes in value insertion text ([#138](https://github.com/nguyennhutien/csszyx/issues/138))

## [0.11.3](https://github.com/nguyennhutien/csszyx/compare/v0.11.2...v0.11.3) (2026-07-07)

### Bug Fixes

* **deps:** bump crossbeam-epoch to 0.9.20 for RUSTSEC-2026-0204 ([#135](https://github.com/nguyennhutien/csszyx/issues/135))

## [0.11.2](https://github.com/nguyennhutien/csszyx/compare/v0.11.1...v0.11.2) (2026-07-07)

### Features

* **compiler:** add CSSZYX_QUIET_SZ_WARNINGS to mute dev sz warnings ([#133](https://github.com/nguyennhutien/csszyx/issues/133))

### Bug Fixes

* sz key diagnostics — flag utilities, traceable runtime warnings, check coverage ([#133](https://github.com/nguyennhutien/csszyx/issues/133))
* **core,compiler:** stop the rust engine warning on flag-only sz utilities ([#133](https://github.com/nguyennhutien/csszyx/issues/133))
* **core,compiler:** tell users a numeric sz key means an array or spread, not a typo ([#133](https://github.com/nguyennhutien/csszyx/issues/133))
* **compiler,cli:** locate szv and szr catalog key warnings for csszyx check ([#133](https://github.com/nguyennhutien/csszyx/issues/133))
* **compiler:** give runtime sz warnings the object shape and the calling frame ([#133](https://github.com/nguyennhutien/csszyx/issues/133))

## [0.11.1](https://github.com/nguyennhutien/csszyx/compare/v0.11.0...v0.11.1) (2026-07-06)

### Bug Fixes

* **core:** fast path must not drop an szv/szr/dynamic catalog beside a static sz ([#129](https://github.com/nguyennhutien/csszyx/issues/129))
* **release:** reject commit messages with unbalanced parentheses that silently skip a release ([#130](https://github.com/nguyennhutien/csszyx/issues/130))

## [0.11.0](https://github.com/nguyennhutien/csszyx/compare/v0.10.12...v0.11.0) (2026-07-05)

### ⚠ BREAKING CHANGES

* sz array later-wins, szs slots on szsc, Tailwind 4.3.2 ([#125](https://github.com/nguyennhutien/csszyx/issues/125))
* **compiler,core,runtime:** components must read slot styles from the new szsc prop (type both faces with `SzsProps<Slots>`) instead of narrowing szs values through szsClass, which no longer exists — change `szsClass(szs?.title)` to `szsc?.title`. Consumer call sites are unaffected: they keep writing `szs={{ ... }}`. ([#125](https://github.com/nguyennhutien/csszyx/issues/125))
* **compiler,core,runtime:** array elements that touch the same property no longer keep both classes — the later element wins, at build time for static arrays and via szcn group merge at runtime otherwise. Code that relied on stylesheet order to resolve the old keep-both output now gets the later element deterministically. The transform cache schema version is bumped, so existing caches rebuild once. ([#125](https://github.com/nguyennhutien/csszyx/issues/125))
* **compiler,core,runtime,unplugin:** compiled sz arrays merge through unmemoized _szcn ([#125](https://github.com/nguyennhutien/csszyx/issues/125))

### Features

* sz array later-wins, szs slots on szsc, Tailwind 4.3.2 ([#125](https://github.com/nguyennhutien/csszyx/issues/125))
* **compiler,core,runtime:** compiled szs slots land on a dedicated szsc prop ([#125](https://github.com/nguyennhutien/csszyx/issues/125))
* **compiler,core,runtime:** sz arrays compose with later-wins semantics ([#125](https://github.com/nguyennhutien/csszyx/issues/125))
* **compiler:** support Tailwind functions and grid track spacing ([#125](https://github.com/nguyennhutien/csszyx/issues/125))

### Bug Fixes

* **unplugin,cli:** replace polynomial regexes with linear scans ([#125](https://github.com/nguyennhutien/csszyx/issues/125))
* **core,compiler,unplugin:** stop silent safelist loss on AST-budget bails ([#125](https://github.com/nguyennhutien/csszyx/issues/125))
* **compiler,core:** make szv catalog extraction per-key lenient in all engines ([#125](https://github.com/nguyennhutien/csszyx/issues/125))
* **compiler,core:** keep the szv catalog walk linear on const-doubling DAGs ([#125](https://github.com/nguyennhutien/csszyx/issues/125))

### Performance

* **compiler,core,runtime,unplugin:** compiled sz arrays merge through unmemoized _szcn ([#125](https://github.com/nguyennhutien/csszyx/issues/125))
* **unplugin:** hand prescan results to the transform hook (1x cold transform) ([#125](https://github.com/nguyennhutien/csszyx/issues/125))

## [0.10.12](https://github.com/nguyennhutien/csszyx/compare/v0.10.11...v0.10.12) (2026-07-04)

### Bug Fixes

* umbrella runtime exports and linear script-id gates ([#122](https://github.com/nguyennhutien/csszyx/issues/122))
* **csszyx:** export szr, szcn, and szsClass from the umbrella package ([#122](https://github.com/nguyennhutien/csszyx/issues/122))
* **unplugin:** replace backtracking script-id regexes with linear scans ([#122](https://github.com/nguyennhutien/csszyx/issues/122))

## [0.10.11](https://github.com/nguyennhutien/csszyx/compare/v0.10.10...v0.10.11) (2026-07-04)

### Features

* szcn merge groups, engine scan fixes, and runtime memory hardening ([#120](https://github.com/nguyennhutien/csszyx/issues/120))
* **runtime:** szcn classifies ambiguous-prefix values into property groups ([#120](https://github.com/nguyennhutien/csszyx/issues/120))
* **unplugin:** custom @theme tokens join szcn merge groups with zero wiring ([#120](https://github.com/nguyennhutien/csszyx/issues/120))

### Bug Fixes

* **runtime:** szcn under-merges font-* instead of dropping a class ([#120](https://github.com/nguyennhutien/csszyx/issues/120))
* **compiler:** oxc keeps a className expression next to a static sz ([#120](https://github.com/nguyennhutien/csszyx/issues/120))
* **compiler:** szv extraction looks through satisfies and as expressions ([#120](https://github.com/nguyennhutien/csszyx/issues/120))
* **compiler:** native scan no longer silently loses JSX-in-.js files ([#120](https://github.com/nguyennhutien/csszyx/issues/120))
* **runtime:** szv supports base-only configs and traps string coercion ([#120](https://github.com/nguyennhutien/csszyx/issues/120))
* **compiler:** bare szr() static args reach the safelist ([#120](https://github.com/nguyennhutien/csszyx/issues/120))
* **compiler:** nudge when slash-opacity may not apply to a theme token ([#120](https://github.com/nguyennhutien/csszyx/issues/120))
* **compiler:** native engine unwraps parens in dynamic css-var emission ([#120](https://github.com/nguyennhutien/csszyx/issues/120))
* **unplugin:** scan module-flavour files and announce the parser at build time ([#120](https://github.com/nguyennhutien/csszyx/issues/120))
* **dynamic:** ref-count useSz so one unmount cannot wipe live styles ([#120](https://github.com/nguyennhutien/csszyx/issues/120))
* **runtime:** bound hydration error state so aborted subtrees can be GC'd ([#120](https://github.com/nguyennhutien/csszyx/issues/120))
* **dynamic:** warn once when runtime injection grows without bound ([#120](https://github.com/nguyennhutien/csszyx/issues/120))
* **vscode:** drop debounced validation for documents closed mid-window ([#120](https://github.com/nguyennhutien/csszyx/issues/120))
* **runtime:** remember szcn ambiguity drops across registration batches ([#120](https://github.com/nguyennhutien/csszyx/issues/120))

### Performance

* **runtime:** memoize szcn and bucket the prefix table ([#120](https://github.com/nguyennhutien/csszyx/issues/120))
* **runtime:** memoize token classification and share the prefix buckets ([#120](https://github.com/nguyennhutien/csszyx/issues/120))
* **unplugin:** retain source text only while global-var mangling is on ([#120](https://github.com/nguyennhutien/csszyx/issues/120))
* **runtime:** bump szcn group generation only on real registry changes ([#120](https://github.com/nguyennhutien/csszyx/issues/120))

## [0.10.10](https://github.com/nguyennhutien/csszyx/compare/v0.10.9...v0.10.10) (2026-07-03)

### Features

* szs slot styling, engine order parity, and component typing docs ([#117](https://github.com/nguyennhutien/csszyx/issues/117))
* szs slot map styles a compound component's internal parts ([#117](https://github.com/nguyennhutien/csszyx/issues/117))

### Bug Fixes

* **compiler:** factor a hoisted nested conditional so all engines emit one order ([#117](https://github.com/nguyennhutien/csszyx/issues/117))

## [0.10.9](https://github.com/nguyennhutien/csszyx/compare/v0.10.8...v0.10.9) (2026-07-01)

### Features

* **mcp-server:** support --version/--help and document a stdio health probe ([#103](https://github.com/nguyennhutien/csszyx/issues/103))

### Bug Fixes

* **compiler:** expand a finite conditional nested in an sz value across all engines ([#103](https://github.com/nguyennhutien/csszyx/issues/103))
* **compiler:** babel expands a finite conditional nested in a color value ([#103](https://github.com/nguyennhutien/csszyx/issues/103))
* **compiler:** oxc expands a finite conditional nested in a value, matching rust ([#103](https://github.com/nguyennhutien/csszyx/issues/103))
* **core:** native engine joins parametric variants around a nested conditional ([#103](https://github.com/nguyennhutien/csszyx/issues/103))
* remove dead conditionals and suppress SonarCloud sz false positives ([#103](https://github.com/nguyennhutien/csszyx/issues/103))
* pin brace-expansion past the ReDoS advisory ([#103](https://github.com/nguyennhutien/csszyx/issues/103))
* suppress the string-sort SonarCloud false positive ([#103](https://github.com/nguyennhutien/csszyx/issues/103))
* **unplugin:** sort via a local helper so buildless tests still resolve ([#103](https://github.com/nguyennhutien/csszyx/issues/103))

## [0.10.8](https://github.com/nguyennhutien/csszyx/compare/v0.10.7...v0.10.8) (2026-06-29)

### Features

* hybrid-mangle safety, sz-forwarding type bridge, and DX/correctness fixes ([#101](https://github.com/nguyennhutien/csszyx/issues/101))
* **unplugin:** announce the active parser and surface oxc→Babel fallbacks ([#101](https://github.com/nguyennhutien/csszyx/issues/101))
* **cli:** add `csszyx check` to scan a whole project for sz key issues ([#101](https://github.com/nguyennhutien/csszyx/issues/101))
* **unplugin:** warn on hybrid-mangle hazards instead of shipping silently ([#101](https://github.com/nguyennhutien/csszyx/issues/101))
* **unplugin:** reserve class names from the mangler via production.mangleExclude ([#101](https://github.com/nguyennhutien/csszyx/issues/101))
* **cli:** add scan-collisions to surface mangle-token risks ([#101](https://github.com/nguyennhutien/csszyx/issues/101))
* **runtime:** bridge SzPropValue into SzInput so wrappers forward sz without a cast ([#101](https://github.com/nguyennhutien/csszyx/issues/101))

### Bug Fixes

* **cli:** migrate resolves the ambiguous `font` sz key by its value ([#101](https://github.com/nguyennhutien/csszyx/issues/101))
* **compiler:** omit the class attribute for an sz that lowers to zero classes ([#101](https://github.com/nguyennhutien/csszyx/issues/101))
* **unplugin:** rewrite ReDoS-prone regexes to linear time ([#101](https://github.com/nguyennhutien/csszyx/issues/101))
* **cli:** ignore dots in comments, url() and strings in scan-collisions ([#101](https://github.com/nguyennhutien/csszyx/issues/101))
* **unplugin:** guide the hybrid-mangle hotfix and rename-over-exclude order ([#101](https://github.com/nguyennhutien/csszyx/issues/101))
* **unplugin:** clarify the disable-mangle syntax and Turbopack scope ([#101](https://github.com/nguyennhutien/csszyx/issues/101))
* send the parser banner and scan hint to stderr, not stdout ([#101](https://github.com/nguyennhutien/csszyx/issues/101))
* **mcp-server:** resolve llms-full.txt from the monorepo source too ([#101](https://github.com/nguyennhutien/csszyx/issues/101))

## [0.10.7](https://github.com/nguyennhutien/csszyx/compare/v0.10.6...v0.10.7) (2026-06-26)

### Features

* **compiler:** locate unknown-sz-property warnings + DX/crash fixes from vui reports ([#98](https://github.com/nguyennhutien/csszyx/issues/98))
* **compiler:** locate the unknown-sz-property warning by file and line ([#98](https://github.com/nguyennhutien/csszyx/issues/98))
* **core:** locate unknown-sz-property warnings in the native Rust engine ([#98](https://github.com/nguyennhutien/csszyx/issues/98))
* **types:** add @csszyx/types/jsx-react as an alias of /jsx ([#98](https://github.com/nguyennhutien/csszyx/issues/98))

### Bug Fixes

* **runtime:** keep a BEM base class when its --modifier sibling is present ([#98](https://github.com/nguyennhutien/csszyx/issues/98))
* **mcp-server:** csszyx_validate flags removed boolean-sugar aliases ([#98](https://github.com/nguyennhutien/csszyx/issues/98))
* **unplugin:** never apply the mangle map in a dev server ([#98](https://github.com/nguyennhutien/csszyx/issues/98))
* **mcp-server:** resolve packaged llms-full.txt regardless of bundle layout ([#98](https://github.com/nguyennhutien/csszyx/issues/98))
* **unplugin:** only warn about a missing Tailwind entry after observing CSS ([#98](https://github.com/nguyennhutien/csszyx/issues/98))
* **compiler:** __szColorVar omits undefined/null instead of crashing ([#98](https://github.com/nguyennhutien/csszyx/issues/98))
* **compiler:** avoid polynomial-ReDoS regex when relativizing the warn path ([#98](https://github.com/nguyennhutien/csszyx/issues/98))
* **unplugin:** keep the CSS-variable mangle map in a dev server ([#98](https://github.com/nguyennhutien/csszyx/issues/98))

## [0.10.6](https://github.com/nguyennhutien/csszyx/compare/v0.10.5...v0.10.6) (2026-06-25)

### Features

* **runtime:** add public szr — the hand-written name for the _sz resolver ([#96](https://github.com/nguyennhutien/csszyx/issues/96))
* **unplugin:** degrade default rust parser to oxc when no native binary ([#96](https://github.com/nguyennhutien/csszyx/issues/96))

### Bug Fixes

* **unplugin:** szv-only safelist + native fallback, public szr resolver ([#96](https://github.com/nguyennhutien/csszyx/issues/96))
* **unplugin:** safelist a szv-only file's catalog (transformed=false) ([#96](https://github.com/nguyennhutien/csszyx/issues/96))

## [0.10.5](https://github.com/nguyennhutien/csszyx/compare/v0.10.4...v0.10.5) (2026-06-24)

### Features

* szv const-binding + non-static-key extraction, and szcn crash hardening ([#93](https://github.com/nguyennhutien/csszyx/issues/93))
* **compiler:** resolve a const-bound szv config and base/variants ([#93](https://github.com/nguyennhutien/csszyx/issues/93))

### Bug Fixes

* **compiler:** keep szv catalog when a config key is non-static ([#93](https://github.com/nguyennhutien/csszyx/issues/93))
* **runtime:** szcn must not crash on a broken decode map ([#93](https://github.com/nguyennhutien/csszyx/issues/93))
* **core:** Rust szv parity — resolve shorthand const + dedup catalog ([#93](https://github.com/nguyennhutien/csszyx/issues/93))

## [0.10.4](https://github.com/nguyennhutien/csszyx/compare/v0.10.3...v0.10.4) (2026-06-23)

### Features

* szcn directional override, szv prescan discovery, and path-based compileSources ([#91](https://github.com/nguyennhutien/csszyx/issues/91))
* **runtime:** szcn resolves directional shorthand/longhand spacing ([#91](https://github.com/nguyennhutien/csszyx/issues/91))
* **unplugin:** prescan files that declare szv, not just sz props ([#91](https://github.com/nguyennhutien/csszyx/issues/91))
* **compiler:** warn when an alignment prop gets a CSS-longhand value ([#91](https://github.com/nguyennhutien/csszyx/issues/91))
* **runtime:** extend szcn directional override to inset and rounded ([#91](https://github.com/nguyennhutien/csszyx/issues/91))
* **unplugin:** replace compilePackages with path-based compileSources ([#91](https://github.com/nguyennhutien/csszyx/issues/91))

## [0.10.3](https://github.com/nguyennhutien/csszyx/compare/v0.10.2...v0.10.3) (2026-06-23)

### Features

* **runtime:** szcn — mangle-aware className merge (+ docs table fix) ([#88](https://github.com/nguyennhutien/csszyx/issues/88))
* **runtime:** add mergeClasses for mangle-aware className override ([#88](https://github.com/nguyennhutien/csszyx/issues/88))

### Bug Fixes

* **docs:** render markdown tables (enable remark-gfm) ([#88](https://github.com/nguyennhutien/csszyx/issues/88))

## [0.10.2](https://github.com/nguyennhutien/csszyx/compare/v0.10.1...v0.10.2) (2026-06-22)

### Features

* compile workspace-package szv, szv validation, and the quiet warning gate ([#85](https://github.com/nguyennhutien/csszyx/issues/85))
* **unplugin:** prescan opted-in workspace package directories ([#85](https://github.com/nguyennhutien/csszyx/issues/85))
* **runtime:** validate szv config and selection with dev warnings ([#85](https://github.com/nguyennhutien/csszyx/issues/85))
* **unplugin:** add quiet option and route warnings through one gate ([#85](https://github.com/nguyennhutien/csszyx/issues/85))

## [0.10.1](https://github.com/nguyennhutien/csszyx/compare/v0.10.0...v0.10.1) (2026-06-22)

### Features

* **runtime:** partition an sz object with splitBoxSz ([#83](https://github.com/nguyennhutien/csszyx/issues/83))

## [0.10.0](https://github.com/nguyennhutien/csszyx/compare/v0.9.10...v0.10.0) (2026-06-21)

### ⚠ BREAKING CHANGES

* `fontWeight`→`weight`, `fontSize`→`text`, boolean value-sugar (`flex:true`/`absolute:true`/…)→value-keyed form, `_szIf`/`_szSwitch` removed (use plain JS), and the `sz` prop type is now closed (unknown keys are tsc errors). ([#66](https://github.com/nguyennhutien/csszyx/issues/66))

### Features

* single-way sz keys, splitBox nested routing, and security + DX hardening ([#66](https://github.com/nguyennhutien/csszyx/issues/66))

## [0.9.10](https://github.com/nguyennhutien/csszyx/compare/v0.9.9...v0.9.10) (2026-06-13)

### Features

* **types:** ship the SolidJS sz prop JSX augmentation ([#59](https://github.com/nguyennhutien/csszyx/issues/59))

### Bug Fixes

* **cli:** split the executable from the library entry ([#55](https://github.com/nguyennhutien/csszyx/issues/55))
* **cli:** point the turbopack verify script at the executable entry ([#55](https://github.com/nguyennhutien/csszyx/issues/55))
* **unplugin:** make the Turbopack prebuild requirement actionable ([#56](https://github.com/nguyennhutien/csszyx/issues/56))
* **unplugin:** stop the webpack load loader from capturing every module ([#57](https://github.com/nguyennhutien/csszyx/issues/57))
* **unplugin:** mangle Solid-compiled dynamic class expressions ([#58](https://github.com/nguyennhutien/csszyx/issues/58))
* **unplugin:** make stale Next safelist lock recovery single-winner ([#60](https://github.com/nguyennhutien/csszyx/issues/60))

## [0.9.9](https://github.com/nguyennhutien/csszyx/compare/v0.9.8...v0.9.9) (2026-06-12)

* **mcp-server:** add a package README and node engine, and cut the release ([4595027](https://github.com/nguyennhutien/csszyx/commit/4595027f96b56254325213c5374a8826212a05d3))

## [0.9.8](https://github.com/nguyennhutien/csszyx/compare/v0.9.7...v0.9.8) (2026-06-11)

### Bug Fixes

* **unplugin:** escape mangle-map JSON embedded in generated inline scripts ([#50](https://github.com/nguyennhutien/csszyx/issues/50))
* **unplugin:** complete the eval-wrap escaping of the embedded mangle map ([#52](https://github.com/nguyennhutien/csszyx/issues/52))

## [0.9.7](https://github.com/nguyennhutien/csszyx/compare/v0.9.6...v0.9.7) (2026-06-11)

### Bug Fixes

* **mcp-server:** upgrade the MCP SDK past its ReDoS advisory ([#46](https://github.com/nguyennhutien/csszyx/issues/46))

## [0.9.6](https://github.com/nguyennhutien/csszyx/compare/v0.9.5...v0.9.6) (2026-06-10)

### Bug Fixes

* **core:** compile static `sz` business logic at build time in the rust engine — trailing object overrides, static and conditional arrays, `dynamic()`/`szv()` catalogs (identifier-backed and numeric-keyed), `css` arbitrary properties, `text`/`leading` compounds, structured values such as gradients, and a static const spread beside one conditional prop (only the conditional stays runtime) ([#40](https://github.com/nguyennhutien/csszyx/issues/40))
* **compiler:** the same static-beside-conditional fix in the oxc path; the rust and oxc wrappers no longer run a secondary catalog pass ([#40](https://github.com/nguyennhutien/csszyx/issues/40))
* **unplugin:** key the transform cache on the native engine binary identity, so a rebuilt engine never serves stale transforms ([#40](https://github.com/nguyennhutien/csszyx/issues/40))
* **runtime:** concatenation helpers compose array and recursively nested inputs ([#40](https://github.com/nguyennhutien/csszyx/issues/40))

## [0.9.5](https://github.com/nguyennhutien/csszyx/compare/v0.9.4...v0.9.5) (2026-06-07)

### Features

* zero-friction csszyx setup (init types, MCP setup resource, docs) ([#38](https://github.com/nguyennhutien/csszyx/issues/38)) ([924b007](https://github.com/nguyennhutien/csszyx/commit/924b0075cdbcd5e87fb12ec08dbc6f8d3822b145))
* **cli:** `csszyx init` now adds `@csszyx/runtime` + `@csszyx/types` as direct dependencies and generates `csszyx-env.d.ts`, so the `sz` prop types work out of the box (no more "Property 'sz' does not exist") ([#38](https://github.com/nguyennhutien/csszyx/issues/38))
* **mcp-server:** add a `csszyx://setup` resource so AI tools wire csszyx correctly — direct runtime/types deps, the `sz` JSX types, and the Turbopack no-`as` rule ([#38](https://github.com/nguyennhutien/csszyx/issues/38))

## [0.9.4](https://github.com/nguyennhutien/csszyx/compare/v0.9.3...v0.9.4) (2026-06-07)

### Bug Fixes

* **unplugin:** csszyxTurbopack config/runtime defects + release-pipeline improvements ([#36](https://github.com/nguyennhutien/csszyx/issues/36)) ([0b16ed1](https://github.com/nguyennhutien/csszyx/commit/0b16ed1d5978c3bf4efa6eb12d636d537b0ac113))
* **unplugin:** default `csszyxTurbopack()` `config` to `{ mangleVars: false }` so it matches the `csszyx next prebuild` manifest hash — the Turbopack production build no longer fails the config-hash gate ([#36](https://github.com/nguyennhutien/csszyx/issues/36))
* **unplugin:** drop the broken `@csszyx/runtime` resolveAlias (a raw absolute path is treated as project-relative); the injected runtime import resolves when `@csszyx/runtime` is a direct dependency ([#36](https://github.com/nguyennhutien/csszyx/issues/36))

## [0.9.3](https://github.com/nguyennhutien/csszyx/compare/v0.9.2...v0.9.3) (2026-06-07)

### Features

* **unplugin:** Turbopack production-build support — csszyxTurbopack helper + @csszyx/runtime resolution ([#34](https://github.com/nguyennhutien/csszyx/issues/34)) ([412626e](https://github.com/nguyennhutien/csszyx/commit/412626e918a0717566ee1cb36be45b9b86d7b406))
* **unplugin:** add the `@csszyx/unplugin/next` `csszyxTurbopack()` config helper — emits the Turbopack `*.tsx` loader rule without `as` (a broad-glob `as` self-matches into `./X.tsx.tsx`) and aliases `@csszyx/runtime` ([#34](https://github.com/nguyennhutien/csszyx/issues/34))
* **unplugin:** declare `@csszyx/runtime` as a peer dependency so production Turbopack builds resolve the injected runtime helpers ([#34](https://github.com/nguyennhutien/csszyx/issues/34))

## [0.9.2](https://github.com/nguyennhutien/csszyx/compare/v0.9.1...v0.9.2) (2026-06-07)

### Features

* rust transform parity, new variants, and migrate/MCP tooling ([#32](https://github.com/nguyennhutien/csszyx/issues/32)) ([40ca7d4](https://github.com/nguyennhutien/csszyx/commit/40ca7d4047ef64e29031f3deff5073af7f0bc6c7))
* **compiler:** recognize forced-colors, starting, and inert variants ([#32](https://github.com/nguyennhutien/csszyx/issues/32))
* **mcp-server:** expose parametric variants and refresh prompt examples ([#32](https://github.com/nguyennhutien/csszyx/issues/32))

### Bug Fixes

* **core:** emit bare display/position/visibility utilities in the rust path ([#32](https://github.com/nguyennhutien/csszyx/issues/32))
* **core:** escape spaces in arbitrary values in the rust path ([#32](https://github.com/nguyennhutien/csszyx/issues/32))
* **core:** lower color-opacity objects in the rust path ([#32](https://github.com/nguyennhutien/csszyx/issues/32))
* **core:** lower isolation to the bare isolate utility in the rust path ([#32](https://github.com/nguyennhutien/csszyx/issues/32))
* **core:** lower bare numeric fractions in the rust path ([#32](https://github.com/nguyennhutien/csszyx/issues/32))
* **core:** kebab-case unknown property keys in the rust path ([#32](https://github.com/nguyennhutien/csszyx/issues/32))
* **core:** lower supports, data, and not variants in the rust path ([#32](https://github.com/nguyennhutien/csszyx/issues/32))
* **core:** lower group, peer, has, and aria variants in the rust path ([#32](https://github.com/nguyennhutien/csszyx/issues/32))
* **core:** split static class attributes into individual tokens ([#32](https://github.com/nguyennhutien/csszyx/issues/32))
* **cli:** recognize transition and group/peer markers in migrate ([#32](https://github.com/nguyennhutien/csszyx/issues/32))
* **cli:** report component classNames kept by migrate separately ([#32](https://github.com/nguyennhutien/csszyx/issues/32))
* **cli:** surface unrecognized classes from skipped dynamic patterns ([#32](https://github.com/nguyennhutien/csszyx/issues/32))
* **cli:** read the CLI version from the package manifest at runtime ([#32](https://github.com/nguyennhutien/csszyx/issues/32))

## [0.9.1](https://github.com/nguyennhutien/csszyx/compare/v0.9.0...v0.9.1) (2026-06-05)

### Features

* **cli:** add Next.js Turbopack prebuild and safelist watcher commands ([590deb2](https://github.com/nguyennhutien/csszyx/commit/590deb291953b3ce9a9f46ac584b70b5bdc5b9f9))
* **compiler:** add opt-in dynamic CSS variable mangling and global token aliases ([590deb2](https://github.com/nguyennhutien/csszyx/commit/590deb291953b3ce9a9f46ac584b70b5bdc5b9f9))
* **compiler:** add Tailwind v4.3 utilities and variants ([590deb2](https://github.com/nguyennhutien/csszyx/commit/590deb291953b3ce9a9f46ac584b70b5bdc5b9f9))
* **unplugin:** support Next.js 16 Turbopack compile and safelist workflows ([590deb2](https://github.com/nguyennhutien/csszyx/commit/590deb291953b3ce9a9f46ac584b70b5bdc5b9f9))

### Bug Fixes

* **cli:** canonicalize conflicting display utilities during Tailwind migrations ([590deb2](https://github.com/nguyennhutien/csszyx/commit/590deb291953b3ce9a9f46ac584b70b5bdc5b9f9))
* **release:** publish the Svelte and Vue adapters required by unplugin ([590deb2](https://github.com/nguyennhutien/csszyx/commit/590deb291953b3ce9a9f46ac584b70b5bdc5b9f9))
* **runtime:** load the current hydration map script with legacy fallback ([590deb2](https://github.com/nguyennhutien/csszyx/commit/590deb291953b3ce9a9f46ac584b70b5bdc5b9f9))
* **security:** harden template scanners, file snapshots, and packaging inputs ([590deb2](https://github.com/nguyennhutien/csszyx/commit/590deb291953b3ce9a9f46ac584b70b5bdc5b9f9))
* **vite:** support Tailwind v4.3 resolver options on Vite 8 ([590deb2](https://github.com/nguyennhutien/csszyx/commit/590deb291953b3ce9a9f46ac584b70b5bdc5b9f9))

### Performance

* **cli:** replace Babel traversal in Tailwind migration ([590deb2](https://github.com/nguyennhutien/csszyx/commit/590deb291953b3ce9a9f46ac584b70b5bdc5b9f9))
* **unplugin:** batch Rust prescan transforms ([590deb2](https://github.com/nguyennhutien/csszyx/commit/590deb291953b3ce9a9f46ac584b70b5bdc5b9f9))

## [0.9.0](https://github.com/nguyennhutien/csszyx/compare/v0.8.0...v0.9.0) (2026-05-24)

### ⚠ BREAKING CHANGES

* **unplugin:** build.parser default is now "rust". Set build.parser: "oxc" or CSSZYX_PARSER=oxc to keep the previous JavaScript parser path. Missing native binaries on unsupported platforms surface CsszyxNativeUnavailableError with parser-fallback guidance.

### Features

* **unplugin:** flip default parser from oxc to rust ([#28](https://github.com/nguyennhutien/csszyx/issues/28)) ([f6b596c](https://github.com/nguyennhutien/csszyx/commit/f6b596c0a2a0e9848a207d93088b2c5bc638341d))

## [0.8.0](https://github.com/nguyennhutien/csszyx/compare/v0.7.0...v0.8.0) (2026-05-17)

### ⚠ BREAKING CHANGES

- **The default source parser is now oxc-parser + magic-string** (was Babel). No action needed for most projects — produced class names and source maps are byte-identical to Babel output.

  Two operator-visible behavior changes:
  1. **Surgical source preservation.** Whitespace, parentheses, and JSX destructuring that Babel's code generator would have stripped are now preserved verbatim. First-build diffs after upgrade may show original formatting returning. This is intentional — see Phase D rationale in the project roadmap.
  2. **Fallback engaged on unexpected oxc failures.** If oxc throws on a file (parser error, unsupported pattern), the unplugin logs `[csszyx] oxc parser fell back to Babel for ...` and re-runs through Babel. No build break — worth grepping CI logs after upgrade to surface coverage gaps.

  **Opting out:**
  - Per project: set `build.parser: 'babel'` in your csszyx config.
  - Per build: set `CSSZYX_PARSER=babel` in the build environment.

  Both paths route prescan, transform, and HMR discovery through Babel exactly as before this release. Babel removal is not in v0.8.0 scope — `@babel/*` packages remain shipped for the fallback path.

### Features

- default source parser to oxc + build pipeline modernization ([#23](https://github.com/nguyennhutien/csszyx/issues/23)) ([64f32ae](https://github.com/nguyennhutien/csszyx/commit/64f32ae58a1ba1f7eb234c256db370d5c85c6366))

### Bug Fixes

- post-merge CI failures (types dts bundling + Lint job pre-build) ([#24](https://github.com/nguyennhutien/csszyx/issues/24)) ([d0e7a40](https://github.com/nguyennhutien/csszyx/commit/d0e7a40561d58a830d81d158df9321b0514c0486))

## [0.7.0](https://github.com/nguyennhutien/csszyx/compare/v0.6.2...v0.7.0) (2026-05-15)

### Features

- **unplugin:** RSC boundary guard — fail build when csszyx runtime helpers leak into Server Components (direct imports + local import graph traversal) ([#21](https://github.com/nguyennhutien/csszyx/pull/21))
- **compiler:** AST budget guard caps transform input at 50k nodes, fails fast on hostile payloads ([#21](https://github.com/nguyennhutien/csszyx/pull/21))

### Bug Fixes

- **runtime:** separate recovery-manifest checksum from mangle-map checksum (fixes hydration verifier conflating the two) ([#21](https://github.com/nguyennhutien/csszyx/pull/21))

### Security

- devcontainer isolates AI credentials — SSH agent strip + GIT*SSH_COMMAND wrapper-only + filesystem cleanup of /root/.ssh/id*\* ([#21](https://github.com/nguyennhutien/csszyx/pull/21))
- AI commit policy — unsigned commits allowed, push remains the human checkpoint via host SSH agent forwarding ([#21](https://github.com/nguyennhutien/csszyx/pull/21))
- CODEOWNERS routing + npm-publish environment gate ([#21](https://github.com/nguyennhutien/csszyx/pull/21))

## [0.6.2](https://github.com/nguyennhutien/csszyx/compare/v0.6.1...v0.6.2) (2026-05-08)

### Bug Fixes

- **release:** redirect changelog paths to umbrella + add node-workspace plugin ([#10](https://github.com/nguyennhutien/csszyx/issues/10)) ([91d2144](https://github.com/nguyennhutien/csszyx/commit/91d21447f76228f0beaf203c4d8e4d8b2239f9d3))

## [0.6.1](https://github.com/nguyennhutien/csszyx/compare/v0.6.0...v0.6.1) (2026-05-08)

### Bug Fixes

- v0.6.1 — clean stale legacy recovery refs + backfill changelog ([#8](https://github.com/nguyennhutien/csszyx/issues/8)) ([8efe58f](https://github.com/nguyennhutien/csszyx/commit/8efe58f642b10ba2a573f2133c74fb5e5af55878))

## 0.6.0

### ⚠️ Breaking Changes

- **types:** remove legacy `autoInjectRecovery` + `allowCSRRecovery` from `DevelopmentConfig`. Recovery is now controlled per-element via the `szRecover` JSX attribute (`"csr"` or `"dev-only"`). The runtime-level `allowCSRRecovery` option in `RuntimeConfig` (passed to `initRuntime`) remains available.

### ✨ Features

- **compiler:** AST budget guard — aborts traversal at 50k nodes per file with `ASTBudgetExceededError`.
- **compiler:** make AST budget configurable via `build.astBudgetLimit` plugin option.
- **compiler:** emit recovery tokens from `szRecover` JSX attributes (deterministic 12-hex SHA-256 of `filename:line:column:elementType`).
- **unplugin:** aggregate recovery tokens across all transformed files and inject `__SZ_RECOVERY_MANIFEST__` script in HTML.
- **unplugin:** strip `szRecover='dev-only'` tokens from production manifest.

### 🐛 Bug Fixes

- **unplugin:** strip `path` field from production recovery manifest (avoid leaking source layout).
- **ci:** serialize `@csszyx/core` build/test to avoid `wasm-pack` race.
- **vscode-release:** use `package.json` version for artifact name.

### 🔧 Internals

- **ci:** publish to npm with `--provenance` (OIDC attestation).
- **ci:** migrate from changesets to release-please for automated version + changelog.

## 0.5.0

### Minor Changes

- 9385bd5: ### `csszyx/browser` — standalone IIFE runtime for vanilla HTML

  A new sub-path bundles a self-contained runtime that processes `sz="..."`
  attributes in plain HTML pages, no bundler required. Drop a single
  `<script>` tag from unpkg or jsdelivr and start writing `sz` attributes
  directly in `.html` files:

  ```html
  <script src="https://unpkg.com/@tailwindcss/browser@4"></script>
  <script src="https://unpkg.com/csszyx@0.5.0"></script>

  <body sz="{ p: 8, bg: 'slate-950' }">
    <h1 sz="{ text: '4xl', color: 'blue-500' }">Hello csszyx</h1>
  </body>
  ```

  The runtime walks the DOM on load, compiles each `[sz]` element into
  Tailwind classes, and installs a `MutationObserver` so dynamically-added
  elements are processed automatically. CSP-safe (no `eval`/`new Function`).

  **`package.json` changes for CDN auto-discovery:**
  - `unpkg` field → `./dist/browser.iife.js`
  - `jsdelivr` field → `./dist/browser.iife.js`
  - New `./browser` entry in `exports`

  See the new [CDN — Vanilla HTML](https://csszyx.com/docs/cdn-html/) guide
  for full usage including anti-FOUC, version pinning, and offline use.

  ### `@csszyx/vscode` — full HTML attribute support

  The extension now provides autocomplete, hover, and syntax highlighting
  for `sz="..."` attributes in `.html` files (previously JSX/TSX only).
  Both explicit (`sz="{ p: 4 }"`) and implicit (`sz="p: 4, bg: 'red-500'"`)
  syntax forms are supported. Pairs naturally with the new `csszyx/browser`
  runtime — author with full IntelliSense, ship via CDN.

### Patch Changes

- Updated dependencies [9385bd5]
  - @csszyx/compiler@0.5.0
  - @csszyx/runtime@0.5.0
  - @csszyx/core@0.5.0
  - @csszyx/types@0.5.0
  - @csszyx/unplugin@0.5.0
  - @csszyx/dynamic@0.5.0

## 0.4.0

### Minor Changes

- ce9f07f: v0.4.0 — @csszyx/dynamic, MCP server, VS Code extension, migration CLI, compiler hardening.

  ### ⚠️ Breaking Changes
  - **compiler:** `scale3d` and `translate3d` boolean shorthands removed. Use the string form on `scale` / `translate` instead.

    **Migration:**

    ```diff
    - sz={{ scale3d: true }}
    + sz={{ scale: '3d' }}

    - sz={{ translate3d: true }}
    + sz={{ translate: '3d' }}
    ```

  ### ✨ New Packages
  - **`@csszyx/dynamic`** — runtime CSS injection engine. Delta-injects only styles not already in the pre-built stylesheet.
    - API: `dynamic(sz)`, `preloadManifest(url)`, `cleanup()`.
    - 3-layer architecture: manifest (O(1) class lookup) → generator (Tailwind v4 CSS-variable patterns) → injector (21-tier `CSSStyleSheet` for correct cascade).
    - SSR-safe: returns class names only on the server, no CSSOM access.
    - React integration via `@csszyx/dynamic/react` — `useSz()` hook with StrictMode-safe deferred cleanup, `sz` alias, `CsszyxProvider` for custom manifest URLs.
    - Accepts both mutable `SzObject` and `as const` (`ReadonlySzObject`) inputs — no `as any` workaround needed.
  - **`@csszyx/mcp-server`** — Model Context Protocol server for AI assistants (Claude Desktop, Cursor, Copilot). Transport: stdio.
    - **Tools (7):** `sz_lookup`, `sz_reverse`, `sz_expand`, `sz_batch`, `sz_migrate`, `sz_theme`, `sz_validate`.
    - **Resources (3):** `csszyx://docs/sz-props`, `csszyx://docs/variants`, `csszyx://llms-full`.
    - **Prompts (2):** `review-sz-usage`, `migrate-tailwind-component`.
  - **VS Code extension** (`@csszyx/vscode`, marked `private` for now — marketplace publish tracked separately).
    - Completions: key + value (variant-aware depth-1 vs depth-2), boolean shorthands, known variants.
    - Hover: inline CSS preview via sandboxed evaluation of the sz object.
    - Diagnostics: unknown prop warnings with `SUGGESTION_MAP` hints (e.g. `padding` → "Did you mean `p`?"), 300 ms debounce, toggleable via `csszyx.enableDiagnostics`.
    - TextMate grammar injected into `tsx` / `ts` / `jsx` / `js` / `html` scopes.
    - Zero-Babel: uses `@csszyx/compiler/browser` subpath — 85 KB CJS bundle.

  ### 🔧 Compiler

  **New subpath exports (consumer-facing):**
  - **`@csszyx/compiler/browser`** — pure JS transform, no Babel / WASM dependency. Points directly at `src/transform-core.ts`; requires a bundler-aware consumer (Vite, webpack, esbuild, tsc). Used by `@csszyx/dynamic`, the VS Code extension, and the runtime lite bundle.
  - **`@csszyx/compiler/color-var`** — standalone 309 B export of the `__szColorVar` helper. Single source of truth, inlined into `@csszyx/runtime`'s lite bundle to prevent drift.

  **Features:**
  - `css: {}` sub-prop — arbitrary CSS escape hatch (e.g. `css: { display: 'grid' }`). Replaces the internal `NEEDS_ARBITRARY_PROPERTY` mechanism.
  - Build-time ternary literal compilation: `sz={{ p: isLg ? 8 : 4 }}` → `p-8` or `p-4`.
  - Build-time variable and spread resolution with a dev-mode safety guard.
  - Dev-mode runtime-fallback diagnostics: when sz cannot be compiled statically, the compiler explains why and suggests `szv` or `dynamic()`.
  - New props: `animationDelay`, `insetRing` / `insetRingColor` (Tailwind v4.2).
  - New exports for tooling: `PROPERTY_MAP`, `KNOWN_VARIANTS`, `BOOLEAN_SHORTHANDS`, `SUGGESTION_MAP`, `ReadonlySzObject`, `ReadonlySzValue`.

  **Fixes:**
  - Variant prefix propagation to arbitrary-value `filter` / `dropShadow` / `ease` / `animate` / `origin` classes (e.g. `hover:drop-shadow-[...]` now correctly keeps the `hover:` prefix).
  - Hex / rgb / hsl color opacity wrapping: `{ color: '#0d0d12', op: 90 }` → `bg-[#0d0d12]/90`.
  - Opacity formatter: sub-half-step decimals (`0.05`) use `/[0.05]`; integer and half-step use `/50`.
  - CSS variable in color-object form now wraps in `()`.
  - `bgRepeat` `x` / `y` / `repeat-x` / `repeat-y` normalized to `bg-repeat-x` / `bg-repeat-y`.
  - `content` double-quote form normalized to single-quote (Tailwind convention).
  - `translate` shorthand, bg variant prefix, nested spread resolution.
  - User-provided `[]` brackets on sz arbitrary values are now stripped (compiler auto-wraps).
  - `SpacingScale` and `FractionValue` type expansion for Tailwind v4.
  - `browser.d.ts` stub added for `moduleResolution: node` consumers of `@csszyx/compiler/browser`.

  **Removed:**
  - `scale3d` / `translate3d` boolean shorthands (see Breaking Changes).
  - Duplicate transform props.

  ### 🔌 Unplugin
  - **Attribute merging** — sz prop merges cleanly with an existing `className` attribute.
  - **Theme auto-scan** — reads Tailwind `@theme` CSS blocks, generates `.csszyx/theme.d.ts` for IntelliSense on custom design tokens; warns in dev if `tsconfig.json` is missing the entry.
  - **HMR incremental class discovery** — only re-scans changed files in dev mode.
  - **Mangling hardening** (all 3 passes):
    - Pass 1: handle escaped quotes in class string literals.
    - Pass 2: balanced-paren scanner (handles nested template literals).
    - Pass 3: mangle after `&&` operators + SSR template-literal quasi form; merges auto-injected runtime helpers into the existing `@csszyx/runtime` import instead of duplicating.
  - **Webpack dev mode:** class mangling skipped entirely (avoids source-map corruption); mangle-map `"` escaped inside `eval()`-wrapped modules to prevent `SyntaxError: missing ) after argument list`.
  - **SSR regex fix** — handles unminified `className: \`...\`` template-literal form.
  - **HeroSection production mangling fix** — specific regex edge case repaired.

  ### 🛠️ CLI (`@csszyx/cli`)

  **New migrate commands:**
  - `csszyx migrate <path>` — now with HTML file support (`class=` → `sz=`).
  - `csszyx migrate audit <path>` — static analysis; classifies sz fallbacks as static (inline-able), dynamic (needs `szv` / `dynamic()`), or unknown.
  - `csszyx migrate resolve-todos` — resolves TODO markers left by a prior migration.
  - `csszyx migrate inject-todos` — inserts TODO markers for items that need manual review.

  **New flags:** `--braces`, `--no-fouc`, `--inject-runtime (local|cdn)`, `--cdn-url`, `--local-path`.

  **Other:**
  - `customMap` support — maps legacy class strings to sz prop equivalents.
  - Two-pass `injectTodos` workflow (auto + manual review round).
  - Reverse migration normalizes `content` strings to double-quote form.
  - Type generator — produces TypeScript types from `PROPERTY_MAP` for IDE support.
  - `transform-gpu` / `cpu` / `none` moved from boolean map to value map in reverse-map.
  - Arbitrary bracket opacity values (`[0.05]`) now parse to numbers in class-parser.

  ### 📦 Runtime
  - **Lite bundle auto-gen** — `__szColorVar` moved from `runtime/src/lite.ts` (manual copy) to `@csszyx/compiler/color-var` (single source of truth). `tsup noExternal` inlines it at build time — `dist/lite.js` has zero runtime dependency on `@csszyx/compiler`.
  - **Browser-safe internals** — runtime internal imports switched to `@csszyx/compiler/browser` (pure JS, no Babel / WASM).
  - **New `variants` entry** — small helper for variant composition.

  ### 📖 Docs
  - **Landing page** — hero animation, Delta architecture section, benchmarks, Pagefind full-text search modal.
  - **Reference docs for 16 sz prop categories** — layout, spacing, typography, colors, borders, effects, filters, transforms, transitions, animations, interactivity, SVG, tables, flexbox/grid, backgrounds, misc — each with `PropTable` and live preview.
  - **Guide pages:** installation, sz-props, variants, SSR, reusing styles, `szv`, `dynamic()`, migrate CLI, MCP server, VS Code extension.
  - **AI-discovery files** — `llms.txt` / `llms-full.txt` fully regenerated from `scripts/gen-llms.mjs` + spec snippets for transforms, filters, backgrounds, and new props.

  ### 🧪 Testing & CI
  - **`scripts/extract-corpus.ts`** — extracts Tailwind class strings from real-world component libraries (Catalyst, Flowbite, Radix, shadcn, Tremor) into `scripts/corpus/`.
  - **`scripts/check-corpus.ts`** + `pnpm corpus:check` — round-trip validator (migrate → compile → diff). Added as a CI gate.
  - **`property-map-coverage.test.ts`** — fails if any `PROPERTY_MAP` key has no test.
  - **`docs-proptable-sync.test.ts`** — fails if compiler exports drift from reference docs.
  - **E2E suite (23 Playwright tests):** 5 vite-react, 6 `@csszyx/dynamic`, 5 Next.js SSR (hydration checksum, mangle map, edge runtime), 7 edge-case tests.
  - **Test counts:** compiler 2362, unplugin 173, runtime 104, dynamic 114, mcp-server 35, CLI 409, core (WASM) 12.

  ### 🧹 Release & Tooling
  - `@csszyx/vscode` marked `private: true` to prevent accidental npm publish.
  - `eslint.config.js` now ignores `.pnpm-store/` (prevents spurious `jsonc/key-spacing` noise when the pnpm store is inside the repo).
  - `scripts/changeset-auto.mjs` (`pnpm changeset:auto`) — new helper that parses Conventional Commits since the last tag into a draft changeset. Assistive only — the developer still reviews and edits before committing.
  - Devcontainer (Node 22, pnpm 10, Rust + wasm-pack) + `.mise.toml` / `.nvmrc` / `.tool-versions` for reproducible toolchain pinning (local + Cloudflare Pages).
  - CI: pnpm bumped to v10, Node to v22; `wasm-pack` installed via `init.sh` for speed; Rust + wasm-pack added to the lint job.

### Patch Changes

- @csszyx/compiler@0.4.0
- @csszyx/runtime@0.4.0
- @csszyx/core@0.4.0
- @csszyx/types@0.4.0
- @csszyx/unplugin@0.4.0
- @csszyx/dynamic@0.4.0

## 0.3.1

### Patch Changes

- **fix(compiler):** `color` + `leading` props no longer merge into an invalid `text-color/leading` shorthand — the text/leading shorthand regex is now restricted to font-size suffixes only.
- **fix(compiler):** `content` (CSS content property) and `alignContent` (align-content layout) are now separate handlers — previously both mapped to `content-*` causing a naming collision. A single sz object can now express both simultaneously.

## 0.3.0

### Minor Changes

- feat(compiler): add sz props — scheme, fieldSizing, rotateX/Y/Z, skewX/Y, proseInvert; improve arbitrary value and negative number handling

  fix(unplugin): resolve class mangling collision — negative lookahead prevents re-encoding of already-mangled symbols; Babel piggyback prescan eliminates false positives from JSDoc and string literals

  feat: add @csszyx/vars package — low-level CSS custom property helpers (applySzVars, patchSzVars for vanilla JS; useSzVars hook via @csszyx/vars/react)

### Patch Changes

- @csszyx/compiler@0.3.0
- @csszyx/runtime@0.3.0
- @csszyx/core@0.3.0
- @csszyx/types@0.3.0
- @csszyx/unplugin@0.3.0
- @csszyx/vars@0.3.0

## 0.2.0

### Minor Changes

- Add 21 Tailwind v4.2 logical/block props: pbs/pbe, mbs/mbe, blockSize/inlineSize families,
  insetS/E/Bs/Be, borderBs/Be, scrollPbs/Pbe/Mbs/Mbe, fontFeatures. New color names: mauve,
  olive, mist, taupe. The `start`/`end` props now emit `inset-s-*`/`inset-e-*` (TW v4.2
  deprecation; CSS output unchanged).

### Patch Changes

- Updated dependencies
  - @csszyx/compiler@0.2.0
  - @csszyx/runtime@0.2.0
  - @csszyx/core@0.2.0
  - @csszyx/types@0.2.0
  - @csszyx/unplugin@0.2.0

## 0.1.3

### Patch Changes

- Strict color string validation — zero mismatch between TypeScript and Rust.
  String slash opacity (`bg: 'blue-500/20'`) now warns and is suppressed; use
  object form `{ bg: { color: 'blue-500', op: 20 } }` instead.
- `needs_brackets()` in Rust core expanded to match TypeScript exactly: added
  `ch`, `dvh`, `dvw`, `rad`, `turn`, `fr` units and color function prefixes
  (`rgb`, `hsl`, `oklch`, etc.).
- Removed redundant `| (string & {})` union on `bg` type in `sz-props.ts`.

## 0.1.2

### Patch Changes

- `csszyx` README: corrected architecture diagram, feature list, and usage examples.
- `@csszyx/unplugin` README: fixed plugin setup instructions and configuration options.
- `@csszyx/core` README: updated WASM API documentation and build instructions.

## 0.1.1

### Minor Changes

- CSS variable type hints for ambiguous properties — `fontFamily: '--var'` now
  emits `font-(family-name:--var)`, `fontWeight: '--var'` emits
  `font-(weight:--var)`, `text: '--var'` emits `text-(length:--var)`.
- Text/leading shorthand merge — `{ text: 'lg', leading: 7 }` compiles to `text-lg/7`.
- `insetShadowColor` property mapping (`inset-shadow-{color}`).

### Breaking Changes

- `text` key restricted to font-size only. Use `color` for text color, `textAlign`
  for alignment.
- `border` key restricted to width only. Use `borderColor` for border colors.
- `font` catch-all key removed. Use `fontWeight` or `fontFamily`. Using `font`
  now emits a dev warning.

## 0.1.0

### Minor Changes

- Initial public release.
- Build-time `sz` prop transform → Tailwind class strings via `@csszyx/unplugin`
  (Vite + Webpack + esbuild).
- Runtime helpers: `_sz`, `_szIf`, `_szSwitch`, `_szMerge`.
- SSR hydration safety: SHA-256 checksum verification via `@csszyx/core` WASM.
- Production class name mangling: reversed tier encoding (`p-4` → `z`).
- Full TypeScript types with autocomplete for all ~200 `sz` props.
- Tailwind CSS v4 compatibility (JIT engine).
