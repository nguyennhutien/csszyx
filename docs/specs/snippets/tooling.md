## Tooling

### VS Code Extension (`@csszyx/vscode`)

IntelliSense, hover, and diagnostics for `sz` props. Supports JSX, TSX, JS, TS, HTML.

**Features:**

- Key + value completions inside `sz={{ ... }}` (variant-aware, depth 1 and 2)
- Hover preview — shows generated Tailwind className + inline CSS variables via `transform()`
- Diagnostics — unknown prop keys flagged as warnings; SUGGESTION_MAP hints (e.g. `padding` → `p`)
- TextMate grammar injection — syntax highlighting for `sz` attribute

**Settings:**

- `csszyx.enableDiagnostics` (default: `true`) — toggle unknown-prop warnings
- `csszyx.enableHover` (default: `true`) — toggle hover preview

**Build:** esbuild → `dist/extension.js` (85KB CJS, zero Babel, uses `@csszyx/compiler/browser`)

### MCP Server (`@csszyx/mcp-server`)

Exposes CSSzyx to AI assistants via Model Context Protocol.

**Tools:** `sz_expand`, `sz_validate`, `sz_lookup`, `sz_migrate`
**Resources:** `csszyx://docs/sz-props`, `csszyx://docs/variants`, `csszyx://llms-full`
**Prompts:** `review-sz-usage`, `migrate-tailwind-component`

```bash
npm install -g @csszyx/mcp-server
npx @csszyx/mcp-server   # stdio transport (Claude Desktop / Cursor)
```
