## Tooling

### TypeScript Language-Service Plugin (`@csszyx/ts-plugin`)

Static completion for TypeScript hosts that load project plugins. Not a
universal LSP; host support must be verified. Two install channels:

- **VS Code:** install the `@csszyx/vscode` extension — it bundles the plugin
  and loads it via `contributes.typescriptServerPlugins`
  (`enableForWorkspaceTypeScriptVersions: true`). Zero config: no `tsconfig`
  entry, no TypeScript-version selection, works under bundled and workspace
  TypeScript, unaffected by pnpm hoisting. Do not tell users to edit `tsconfig`.
- **Other hosts** (Neovim `ts_ls`, WebStorm, Zed, or VS Code without the
  extension): install and add to the leaf `tsconfig`.

```bash
pnpm add -D @csszyx/ts-plugin typescript
```

```jsonc
{
  "compilerOptions": {
    "plugins": [{ "name": "@csszyx/ts-plugin" }],
  },
}
```

Recommend `"editor.quickSuggestions": { "strings": "on" }` (VS Code) so quoted
sz values keep suggesting while typing — same guidance as Tailwind IntelliSense.

TypeScript resolves plugins next to the TypeScript install, not the `tsconfig`.
Under pnpm the manual path needs `public-hoist-pattern[]=@csszyx/ts-plugin` in
`.npmrc` (npm/Yarn flat layout does not). VS Code without the extension also
needs "Use Workspace Version".

**AIX capability contract:**

- Complete keys and curated values in JSX `sz`, including nested variants and conditional object branches.
- Complete CSS keys inside each component `szs` slot object; do not offer CSS keys at the outer slot-name level or on intrinsic-element `szs`.
- Complete `szv` styles in `base` and `variants.<axis>.<option>`; complete imported `szr` objects.
- Token relationships: a key already assigned in the same object is not suggested again; a nested object under a plain utility property (`p: { … }`) gets NO suggestions — only variant keys take style objects. Structured object VALUES are assisted: color props (`bg`, `color`, `borderColor`, …) offer exactly `{ color, op }` (the documented opacity form), `bgImg` offers `{ gradient, dir, in }`, and the `css` escape hatch (arbitrary CSS properties) is deliberately unassisted. Both the plugin and the extension companion enforce identical verdicts (drift-guarded by tests).
- Accept direct, aliased, and namespace imports from `csszyx` / `@csszyx/runtime`; reject local/shadowed/unrelated same-spelled functions.
- Insert numeric suggestions without quotes and string suggestions with quotes. Suggestions are not validation: Tailwind 4 numeric values are open-ended.
- Preserve TypeScript's base completions. On cancellation, timeout, or internal failure, return the untouched base result.

Defaults: `enabled: true`, `values: true`, `maxEntries: 512`,
`deadlineMs: 20`, `failureThreshold: 3`. Usually emit only `{ "name":
"@csszyx/ts-plugin" }`; do not add tuning options without a demonstrated need.

**Not provided by this plugin:** theme-aware values, hover previews,
diagnostics, syntax highlighting, Tailwind config/plugin execution, network, or
telemetry. Those capabilities must not be inferred. The plugin is
self-contained: its metadata is bundled at build time, so it installs with no
runtime dependencies and there is no separate metadata package to install.

Diagnosis note: if the activation line `[csszyx-ts-plugin] activated` is present
but typing letters never opens suggestions while `.`/`'` do, the suggest widget
is being suppressed editor-side (TypeScript's own completions are equally
affected) — not a plugin fault. Two known causes, in likelihood order: a
composing input method — any IME that assembles characters before committing
them, such as Vietnamese Telex/VNI, CJK IMEs, or dead-key layouts; its underline
appears beneath typed letters and an open list stops filtering, and switching to
a plain non-composing layout fixes it — and AI inline suggestions
(microsoft/vscode#315373). Verify by typing `Ma` on an empty line.

Inside `@csszyx/vscode` there is no duplication to reconcile: the extension
ships and injects this plugin for TypeScript/JavaScript and serves HTML itself
(tsserver does not process HTML). In `auto` mode a trigger-character companion
also covers the moments tsserver never auto-opens — `{`/`,` open key items that
insert `key:` and chain into value suggestions; `:` (no space required) and
space open per-key values, the only path by which numeric values (`p: 4`) get a
list. Sessions are partitioned by trigger ownership, so companion and plugin
never duplicate. `csszyx.completions` (via the TypeScript `configurePlugin`
API): `auto` (default) | `extension` (plugin+companion disabled, extension
serves all languages) | `off` (no sz completions). Hover and diagnostics are
unaffected. In a value ternary (`p: ok ? 4 : …`) both branches are values of
the owning key — a finite conditional is valid sz — so value suggestions
continue there by design.

### VS Code Extension (`@csszyx/vscode`)

IntelliSense, hover, and diagnostics for `sz` props. Supports JSX, TSX, JS, TS, HTML.

**Features:**

- Key + value completions inside `sz={{ ... }}` (variant-aware, depth 1 and 2)
- Hover preview — shows generated Tailwind className + inline CSS variables via `transform()`
- Diagnostics — unknown prop keys flagged as warnings; SUGGESTION_MAP hints (e.g. `padding` → `p`)
- TextMate grammar injection — syntax highlighting for `sz` attribute

**Settings:**

- `csszyx.completions` (default: `auto`) — `auto` | `extension` | `off` (see plugin section)
- `csszyx.enableDiagnostics` (default: `true`) — toggle unknown-prop warnings
- `csszyx.enableHover` (default: `true`) — toggle hover preview

**Build:** esbuild → `dist/extension.js` (CJS, bundles `@csszyx/tooling-metadata` + `@csszyx/compiler/browser`); ships `@csszyx/ts-plugin` as a packed dependency for the tsserver-plugin contribution.

### MCP Server (`@csszyx/mcp-server`)

Exposes CSSzyx to AI assistants via Model Context Protocol.

**Tools:** `sz_expand`, `sz_validate`, `sz_lookup`, `sz_migrate`
**Resources:** `csszyx://docs/sz-props`, `csszyx://docs/variants`, `csszyx://llms-full`
**Prompts:** `review-sz-usage`, `migrate-tailwind-component`

```bash
npm install -g @csszyx/mcp-server
npx @csszyx/mcp-server   # stdio transport (Claude Desktop / Cursor)
```
