# CSSzyx for VS Code

Official extension for [**CSSzyx**](https://csszyx.com) — the CSS-in-JS framework with a Tailwind-v4–compatible `sz` prop. This extension brings IntelliSense, hover previews, and diagnostics for `sz` props directly into your editor.

## Features

- **Autocomplete**: Key and value completion inside `sz={{ ... }}`, including Tailwind utility values and nested variants (`hover:`, `dark:`, `md:`, …).
- **Hover Previews**: Hover any `sz` object to see the generated Tailwind classes and the resolved inline CSS.
- **Diagnostics**: Unknown `sz` props are reported as warnings, with "did you mean?" suggestions powered by the same compiler that runs at build time.
- **Syntax Highlighting**: TextMate grammar injected into JSX, TSX, JS, TS, and HTML so `sz` object keys, variants, and values highlight consistently.

All providers run synchronously — no network calls, no async keypress overhead.

## Activation

The extension activates automatically when any of these files open:

- `typescriptreact` (`.tsx`)
- `javascriptreact` (`.jsx`)
- `typescript` (`.ts`)
- `javascript` (`.js`)
- `html` (`.html`)

## Requirements

Your project must have **CSSzyx** installed. The typical setup is the umbrella package:

```bash
pnpm add -D csszyx
```

Individual packages (`@csszyx/compiler`, `@csszyx/unplugin`) also work — the extension loads type/prop metadata from `@csszyx/compiler` and has no hard dependency on the runtime.

## Extension Settings

| Setting                    | Default | Description                               |
| -------------------------- | ------- | ----------------------------------------- |
| `csszyx.enableDiagnostics` | `true`  | Report unknown `sz` props as warnings.    |
| `csszyx.enableHover`       | `true`  | Show generated Tailwind classes on hover. |

## Installation

Install from the VS Code Marketplace:

1. Open the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`)
2. Search for **CSSzyx**
3. Click **Install**

Or install a local `.vsix` with `code --install-extension csszyx-<version>.vsix`.

## Support

- Documentation: <https://csszyx.com>
- Issues & feature requests: <https://github.com/nguyennhutien/csszyx/issues>
- Contact: <hello@csszyx.com>

## License

MIT — see [LICENSE](./LICENSE).
