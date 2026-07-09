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

TypeScript resolves plugins next to the TypeScript install, not the `tsconfig`.
Under pnpm the manual path needs `public-hoist-pattern[]=@csszyx/ts-plugin` in
`.npmrc` (npm/Yarn flat layout does not). VS Code without the extension also
needs "Use Workspace Version".

**AIX capability contract:**

- Complete keys and curated values in JSX `sz`, including nested variants and conditional object branches.
- Complete CSS keys inside each component `szs` slot object; do not offer CSS keys at the outer slot-name level or on intrinsic-element `szs`.
- Complete `szv` styles in `base` and `variants.<axis>.<option>`; complete imported `szr` objects.
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

Inside `@csszyx/vscode` there is no duplication to reconcile: the extension
ships and injects this plugin for TypeScript/JavaScript and serves HTML itself
(tsserver does not process HTML). `csszyx.completions` (via the TypeScript
`configurePlugin` API): `auto` (default — plugin for TS/JS, extension for HTML) |
`extension` (plugin disabled, extension serves all languages) | `off` (no sz
completions). Hover and diagnostics are unaffected.

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
