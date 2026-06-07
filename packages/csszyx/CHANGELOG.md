# csszyx

## [0.9.4](https://github.com/nguyennhutien/csszyx/compare/v0.9.3...v0.9.4) (2026-06-07)


### Bug Fixes

* **unplugin:** csszyxTurbopack config/runtime defects + release-pipeline improvements ([#36](https://github.com/nguyennhutien/csszyx/issues/36)) ([0b16ed1](https://github.com/nguyennhutien/csszyx/commit/0b16ed1d5978c3bf4efa6eb12d636d537b0ac113))

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
