---
"csszyx": minor
"@csszyx/vscode": minor
"@csszyx/compiler": minor
"@csszyx/runtime": minor
"@csszyx/core": minor
"@csszyx/types": minor
"@csszyx/unplugin": minor
"@csszyx/cli": minor
"@csszyx/vars": minor
"@csszyx/mcp-server": minor
"@csszyx/svelte-adapter": minor
"@csszyx/vue-adapter": minor
"@csszyx/dynamic": minor
---

### `csszyx/browser` — standalone IIFE runtime for vanilla HTML

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
